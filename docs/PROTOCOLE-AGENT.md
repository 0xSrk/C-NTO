**`SIΞRRΛSKΛ—LAB · CΛNTO · PROTOCOLE AGENT · PORTE DU DESK`**

# Protocole agent — brancher une IA sur le desk

CΛNTO ouvre le desk aux agents IA par deux portes locales. Les deux servent les **mêmes outils** que l'agent embarqué (`src/engine/agent/tools.ts`), exécutés par `executeDeskTool` dans le renderer. Aucune n'envoie d'ordre : la soumission d'ordres n'est pas un outil d'agent.

| Porte | Transport | Pour qui | Réglage |
|---|---|---|---|
| **Passerelle MCP** (recommandée) | Model Context Protocol, HTTP « streamable », `http://127.0.0.1:47118/mcp` | Claude Code, Claude Desktop, Codex, Cursor, tout client MCP | Agent IA › Agents externes · MCP |
| Orchestrateur | JSON-RPC 2.0 sur WebSocket, `ws://127.0.0.1:47117` | Un orchestrateur écrit sur mesure | Agent IA › Orchestrateur externe |

## 1. Passerelle MCP

### Ouvrir

Agent IA › **Agents externes · MCP** › *Ouvrir la passerelle*. Elle se rouvre au démarrage suivant tant qu'elle n'est pas fermée. Le port se règle tant qu'elle est fermée (défaut `47118`).

### Contrat

| | |
|---|---|
| Adresse | `http://127.0.0.1:<port>/mcp`, écoute sur `127.0.0.1` seulement |
| Authentification | `Authorization: Bearer <jeton>`. Jeton persistant (`userData/mcp-token.json`, mode `0600`), renouvelable dans le panneau. Comparaison à temps constant |
| Révisions | `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`. Une révision inconnue reçoit la plus récente |
| Mode | Sans état, réponses `application/json`. `GET` et `DELETE` rendent `405` |
| Méthodes | `initialize`, `ping`, `tools/list`, `tools/call`. Le reste rend `-32601` |
| Capacités | `tools` (`listChanged: false`) |
| Refus avant lecture du corps | `Origin` présent (navigateur) → `403` ; `Host` hors loopback → `403` ; jeton absent ou faux → `401` ; corps > 1 Mo → `413` ; plus de 40 requêtes / s → `429` |
| Délai | 15 s au plus pour une réponse du desk ; fenêtre fermée → résultat `isError` lisible |

`tools/call` rend le résultat de l'outil en texte JSON et en `structuredContent`. Un refus du desk (`ok: false`, `error`) devient `isError: true`, pas une erreur de protocole. Un outil inconnu est une erreur de protocole (`-32602`).

### Écriture

Les outils d'écriture (`create_note`, `branch_note`, `link_notes`, `annotate_session`) sont **masqués** de `tools/list` et **refusés** tant que le trader ne coche pas *écriture autorisée*. Le réglage vaut pour les deux portes. Il est contrôlé deux fois : dans le process principal, puis par `executeDeskTool` (source `orch`). Il n'est jamais restauré depuis un coffre.

### Outils

| Outil | Type | Rôle |
|---|---|---|
| `desk_overview` | lecture | Vue d'ensemble du journal et statut du plan prop suivi |
| `list_sessions` / `get_session` | lecture | Journal |
| `search_notes` / `read_note` | lecture | Coffre de notes |
| `calendar_events` | lecture | Catalyseurs officiels fusionnés, repères locaux, entrées personnelles |
| `propfirm_status` | lecture | Rejeu du plan prop sur le compte suivi |
| `journal_breakdown` | lecture | Ventilations par heure et jour (New York), instrument, long / short |
| `monte_carlo` | lecture | Projection bootstrap i.i.d. : percentiles, ruine, objectif (graine fixe) |
| `bridge_status` | lecture | Pont NinjaTrader et Copieur en direct : lien, comptes, PnL, positions |
| `portfolio_snapshot` | lecture | Portefeuille consolidé : valeur nette, poches, exposition |
| `market_levels` | lecture | Dernier prix, PDH / PDL / PDC, Opening Range, VWAP, ATR (source nommée, démo marquée `synthetic`) |
| `create_note` / `branch_note` / `link_notes` | écriture | Notes |
| `annotate_session` | écriture | Note et tags d'une séance (remplace) |

Le catalogue fait foi : `tools/list` le lit dans le desk à chaque fois (cache de 5 s). Noms et types n'existent qu'à un endroit, `src/engine/agent/catalog.ts`, partagé avec l'allowlist de l'orchestrateur.

## 2. Brancher un client

Le panneau copie la configuration avec l'adresse et le jeton. **Le jeton y figure en clair : ne le partagez pas, renouvelez-le s'il a circulé.**

### Claude Code

*Copier pour Claude Code*, puis coller dans un terminal :

```bash
claude mcp add --transport http canto http://127.0.0.1:47118/mcp --header "Authorization: Bearer <jeton>"
```

### Cursor et clients au format `mcpServers`

*Copier la configuration JSON* :

```json
{
  "mcpServers": {
    "canto": {
      "type": "http",
      "url": "http://127.0.0.1:47118/mcp",
      "headers": { "Authorization": "Bearer <jeton>" }
    }
  }
}
```

### Claude Desktop

Claude Desktop lance ses serveurs locaux en stdio. Le pont `mcp-remote` (paquet npm tiers, Node.js requis) relie stdio à la passerelle HTTP. Dans `claude_desktop_config.json` :

```json
{
  "mcpServers": {
    "canto": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:47118/mcp", "--header", "Authorization:${CANTO_AUTH}"],
      "env": { "CANTO_AUTH": "Bearer <jeton>" }
    }
  }
}
```

### Codex (OpenAI)

Codex tourne sur la machine : il se branche comme Claude Code, en serveur MCP HTTP avec l'en-tête `Authorization: Bearer <jeton>`. La syntaxe de configuration est celle de la documentation de Codex.

### ChatGPT (web et application)

ChatGPT appelle les serveurs MCP **depuis le cloud d'OpenAI**. Il ne voit pas `127.0.0.1` : la passerelle locale ne lui est pas joignable, par construction. L'ouvrir à ChatGPT demanderait une adresse HTTPS publique (tunnel) et une authentification OAuth, donc de sortir les données du trader de sa machine. Ce n'est pas fait ; c'est une décision de l'ADMIN.

## 3. Orchestrateur WebSocket

JSON-RPC 2.0 sur `ws://127.0.0.1:<port>`. Jeton de session (mémoire seulement, renouvelé à chaque lancement), `?token=…` ou `desk.auth { token }`. Méthodes : `desk.auth`, `desk.describe`, `desk.ping`, puis `tool.<nom>` (ou `<nom>`). Origines navigateur refusées, 8 clients, 1 Mo par trame, 40 requêtes / s. `desk.describe` rend le catalogue avec le type de chaque outil (`kind`).

## 4. Modèle du Lab

L'emplacement **SIΞRRΛSKΛ Lab · Artefact 003** est réservé dans les préréglages de l'agent embarqué (`src/modules/agent/presets.ts`), sans hôte ni modèle. Son hôte rejoindra la liste épinglée du process principal (`electron/llm-host.ts`) le jour de son ouverture.

## 5. Journal

Chaque appel entrant paraît dans le journal des liens de l'onglet Agent IA (`mcp · tool.<nom>` pour la passerelle MCP), avec son issue. Le jeton n'est jamais écrit dans un journal ni renvoyé dans un statut.

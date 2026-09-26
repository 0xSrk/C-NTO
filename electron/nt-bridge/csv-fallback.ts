/**
 * Quand le WebSocket est vivant, le CSV ne réimporte que les exécutions dont l'ID
 * n'a pas déjà été vu. Un fichier qui n'est pas un export Executions passe tel quel.
 * `null` = plus aucune ligne nouvelle.
 */

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function omitKnownExecutionRows(text: string, known: ReadonlySet<string>): string | null {
  const lines = text.split(/\r?\n/);
  const header = lines[0] ?? '';
  if (!header.trim()) return text;
  const cols = splitCsvLine(header).map((c) => c.trim().toLowerCase());
  const idIdx = cols.findIndex((c) => c === 'id' || c === 'execution id' || c === 'executionid');
  const actionIdx = cols.findIndex((c) => c === 'action' || c === 'side' || c === 'sens');
  const instrumentIdx = cols.findIndex((c) => c === 'instrument' || c === 'symbol');
  if (idIdx < 0 || actionIdx < 0 || instrumentIdx < 0) return text;
  const kept = [header];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = splitCsvLine(line);
    const id = (cells[idIdx] ?? '').trim();
    if (id && known.has(id)) continue;
    kept.push(line);
  }
  if (kept.length === 1) return null;
  return kept.join('\n');
}

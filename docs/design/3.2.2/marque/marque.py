"""Marque CΛNTO 3.2.2 — le Λ en construction, LED à la pointe.

Grille 256 au pas de 8. Pieds du Λ sur la ligne de pied (y 184), pointe au-dessus de la capitale
(y 68 : débord optique de 4 u sur la ligne y 72). Tailles optiques : le trait, les guides, les ancres
et la LED sont calibrés en pixels au rendu ; à 32 px et moins, le Λ et la LED restent seuls.

Usage : python3 marque.py  →  écrit marque-<px>.svg pour chaque taille livrée.
Rendus : build/logo.svg = marque-72 ; build/icon.png = marque-1024 rastérisée (Chromium) ;
build/icon.ico = 16, 24, 32, 48, 64, 128, 256, chacune depuis sa propre taille optique.
"""

LED = '#E5263D'   # --gold, la LED du desk
INK = '#EDEBE4'   # --text-0, l'encre
TAILLES = (16, 24, 32, 48, 64, 72, 128, 256, 1024)


def marque(px: int) -> str:
    u = 256 / px                                        # unités par pixel au rendu
    complete = px >= 48                                 # construction visible à partir de 48 px
    trait = max(1.25, px / 80) * u                      # 1,25 px jusqu'à 100 px, 12,8 px à 1024
    if not complete:
        trait = (1.6 if px <= 16 else 2.0) * u          # petites tailles : le Λ doit tenir seul
    fin = max(0.6, px / 480) * u
    pied_g, pointe, pied_d = (72, 184), (128, 68), (184, 184)
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="{px}" height="{px}">']
    out.append(f'''<defs>
<radialGradient id="fond" cx="50%" cy="46%" r="70%"><stop offset="0" stop-color="#16171B"/><stop offset=".55" stop-color="#0F1013"/><stop offset="1" stop-color="#0A0B0D"/></radialGradient>
<filter id="halo" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="{3.2 * u:.3f}"/></filter>
<radialGradient id="ledHalo"><stop offset="0" stop-color="{LED}" stop-opacity=".75"/><stop offset=".35" stop-color="{LED}" stop-opacity=".28"/><stop offset="1" stop-color="{LED}" stop-opacity="0"/></radialGradient>
</defs>''')
    out.append('<rect width="256" height="256" fill="url(#fond)"/>')
    if complete:
        # Guides : capitale et pied, axe médian plus discret, axe vertical ; cote au-dessus.
        for y, o in ((72, .16), (184, .16), (128, .08)):
            out.append(f'<line x1="0" x2="256" y1="{y}" y2="{y}" stroke="{INK}" stroke-opacity="{o}" stroke-width="{fin:.3f}"/>')
        out.append(f'<line x1="128" x2="128" y1="24" y2="232" stroke="{INK}" stroke-opacity=".07" stroke-width="{fin:.3f}"/>')
        out.append(f'<path d="M72 44 H184 M72 38 V50 M184 38 V50" stroke="{INK}" stroke-opacity=".28" stroke-width="{fin:.3f}" fill="none"/>')
    d = f'M{pied_g[0]} {pied_g[1]} L{pointe[0]} {pointe[1]} L{pied_d[0]} {pied_d[1]}'
    out.append(f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="{trait * 3:.3f}" stroke-linecap="square" stroke-linejoin="miter" stroke-miterlimit="4" opacity=".2" filter="url(#halo)"/>')
    out.append(f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="{trait:.3f}" stroke-linecap="square" stroke-linejoin="miter" stroke-miterlimit="4"/>')
    if complete:
        cote = max(5, px / 24) * u
        for x, y in (pied_g, pied_d):
            out.append(f'<rect x="{x - cote / 2:.2f}" y="{y - cote / 2:.2f}" width="{cote:.2f}" height="{cote:.2f}" fill="#0A0B0D" stroke="{INK}" stroke-opacity=".8" stroke-width="{fin:.3f}"/>')
    # La pointe porte la LED : carré plein, halo rouge.
    led = (max(4, px / 26) if complete else max(3, px / 8)) * u
    x, y = pointe
    out.append(f'<circle cx="{x}" cy="{y}" r="{led * 2.6:.2f}" fill="url(#ledHalo)"/>')
    out.append(f'<rect x="{x - led / 2:.2f}" y="{y - led / 2:.2f}" width="{led:.2f}" height="{led:.2f}" fill="{LED}"/>')
    out.append('</svg>')
    return '\n'.join(out) + '\n'


if __name__ == '__main__':
    for px in TAILLES:
        with open(f'marque-{px}.svg', 'w', encoding='utf-8') as f:
            f.write(marque(px))

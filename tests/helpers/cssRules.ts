/** Ce qu'un passage du pointeur a le droit de changer : la lumière, jamais la place ni la forme (Système 4.1). */
export const HOVER_LIGHT = new Set(['color', 'background-color', 'border-color', 'box-shadow', 'opacity', 'text-shadow', '--k']);

export interface CssRule {
  selector: string;
  /** En-têtes des blocs @ qui l'entourent, du plus large au plus proche. */
  at: string[];
  props: string[];
  body: string;
}

/** Lecture des règles d'une feuille (commentaires ôtés) : sélecteur, blocs @ englobants, propriétés déclarées. */
export function cssRules(source: string): CssRule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: CssRule[] = [];
  const stack: { head: string; body: string }[] = [];
  let buf = '';
  for (const ch of text) {
    if (ch === '{') {
      stack.push({ head: buf.trim(), body: '' });
      buf = '';
    } else if (ch === '}') {
      const top = stack.pop();
      if (top && !top.head.startsWith('@')) {
        const body = `${top.body}${buf}`;
        const props = body
          .split(';')
          .map((decl) => decl.split(':')[0]?.trim() ?? '')
          .filter(Boolean);
        out.push({ selector: top.head, at: stack.filter((s) => s.head.startsWith('@')).map((s) => s.head), props, body });
      }
      buf = '';
    } else if (ch === ';') {
      // Hors de tout bloc (@import…), la déclaration n'appartient à aucune règle.
      if (stack.length > 0) stack[stack.length - 1]!.body += `${buf};`;
      buf = '';
    } else {
      buf += ch;
    }
  }
  return out;
}

/** Les règles :hover d'une feuille qui sortent de la règle : hors de `@media (hover: hover)`, ou qui changent autre chose que la lumière. */
export function hoverOffenses(source: string, where = ''): { offenders: string[]; hovers: number } {
  const offenders: string[] = [];
  let hovers = 0;
  for (const rule of cssRules(source)) {
    if (!/:hover\b/.test(rule.selector)) continue;
    hovers++;
    const at = `${where}${where ? ' ' : ''}${rule.selector}`;
    if (!rule.at.some((head) => /^@media\s*\(hover:\s*hover\)/.test(head))) offenders.push(`${at} : hors de @media (hover: hover)`);
    for (const prop of rule.props) if (!HOVER_LIGHT.has(prop)) offenders.push(`${at} : ${prop}`);
  }
  return { offenders, hovers };
}

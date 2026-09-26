/** Découpe Markdown texte / code. Même règle que le coffre (`src/store/notes.ts` la réexporte). */
export function splitCode(body: string): { text: string; code: boolean }[] {
  const parts: { text: string; code: boolean }[] = [];
  const re = /(```[\s\S]*?```|`[^`\n]*`)/g;
  let last = 0;
  for (const m of body.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parts.push({ text: body.slice(last, i), code: false });
    parts.push({ text: m[0], code: true });
    last = i + m[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last), code: false });
  return parts;
}

/** Corps hors blocs de code : les symboles et le TF-IDF n'y lisent pas un exemple. */
export function proseOf(body: string): string {
  return splitCode(body)
    .filter((p) => !p.code)
    .map((p) => p.text)
    .join('\n');
}

import { COMPONENTS, GLYPH_ID } from '@/design/micro/assets';

/**
 * Un composant de la planche pour un canevas : le même SVG que `<Glyph>`, rendu autonome (espace de noms, taille en
 * pixels) et encré en dur, car une image ne lit pas les variables CSS de la page. Le dessin du master ne change pas.
 */
export function glyphSvg(markup: string, ink: string, paper: string, size: number): string {
  const px = Math.max(1, Math.round(size));
  const head = markup.includes('xmlns=') ? `<svg width="${px}" height="${px}" ` : `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" `;
  return markup.replace(/^<svg /, head).replace(/var\(--k\)/g, ink).replace(/var\(--p\)/g, paper);
}

/** Image d'un composant nommé du desk, à `size` pixels physiques ; `onLoad` quand elle peut être peinte. */
export function glyphImage(name: keyof typeof GLYPH_ID, ink: string, paper: string, size: number, onLoad: () => void): HTMLImageElement {
  const img = new Image();
  img.onload = onLoad;
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(glyphSvg(COMPONENTS[GLYPH_ID[name]] ?? '', ink, paper, size))}`;
  return img;
}

/** Une image chargée et décodable, ou `null` : `drawImage` refuse une image en échec et ne peint rien d'une image en cours. */
export function readyImage(img: HTMLImageElement | undefined): HTMLImageElement | null {
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

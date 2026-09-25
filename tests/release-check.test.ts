import { describe, expect, it } from 'vitest';
import { parseLatestRelease } from '../electron/release-check';

describe('contrôle de version par Release GitHub', () => {
  it('lit le tag de la dernière release publiée', () => {
    expect(parseLatestRelease({ tag_name: 'v2.0.0', html_url: 'https://github.com/0xSrk/C-NTO/releases/tag/v2.0.0' })).toEqual({
      version: '2.0.0',
      url: 'https://github.com/0xSrk/C-NTO/releases/tag/v2.0.0',
    });
    expect(parseLatestRelease({ tag_name: '2.1.0' })?.version).toBe('2.1.0');
  });

  it('ignore brouillons, préversions et tags mal formés', () => {
    expect(parseLatestRelease({ tag_name: 'v2.0.1', draft: true })).toBeNull();
    expect(parseLatestRelease({ tag_name: 'v2.0.1', prerelease: true })).toBeNull();
    expect(parseLatestRelease({ tag_name: 'nightly' })).toBeNull();
    expect(parseLatestRelease({ tag_name: 'v2.0.1-rc1' })).toBeNull();
    expect(parseLatestRelease(null)).toBeNull();
    expect(parseLatestRelease('v2.0.0')).toBeNull();
  });

  it('ne garde une URL que sur github.com', () => {
    expect(parseLatestRelease({ tag_name: 'v2.0.0', html_url: 'http://evil.example/x' })?.url).toBe('');
  });
});

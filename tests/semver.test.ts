import { describe, expect, it } from 'vitest';
import { compareSemver } from '../electron/semver';

describe('compareSemver', () => {
  it('ordonne les versions', () => {
    expect(compareSemver('1.1.0', '1.0.0')).toBe(1);
    expect(compareSemver('1.0.0', '1.1.0')).toBe(-1);
    expect(compareSemver('1.1.0', '1.1.0')).toBe(0);
    expect(compareSemver('v1.2.0', '1.1.9')).toBe(1);
  });
});

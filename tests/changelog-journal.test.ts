/**
 * @vitest-environment jsdom
 */
import { createElement, useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ChangelogBody, VersionMark, changelogUnseen } from '@/app/ChangelogJournal';

function Probe({ version, initial }: { version: string; initial: string | null }) {
  const [seen, setSeen] = useState(initial);
  const [open, setOpen] = useState(false);
  return createElement(
    'div',
    null,
    createElement(VersionMark, {
      version,
      unseen: changelogUnseen(version, seen),
      onOpen: () => {
        setSeen(version);
        setOpen(true);
      },
    }),
    open ? createElement(ChangelogBody, { version }) : null,
  );
}

describe('journal dans le desk', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  async function mount(version: string, initial: string | null) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(Probe, { version, initial }));
    });
    return host;
  }

  it('affiche le point quand la dernière version vue est antérieure, et le retire à l’ouverture', async () => {
    expect(changelogUnseen('3.1.0', '3.0.0')).toBe(true);
    expect(changelogUnseen('3.1.0', null)).toBe(true);
    expect(changelogUnseen('3.1.0', '3.1.0')).toBe(false);

    const node = await mount('3.1.0', '3.0.0');
    expect(node.querySelector('[data-changelog-dot]')).not.toBeNull();
    const button = node.querySelector('button');
    expect(button?.textContent).toContain('v3.1.0');
    await act(async () => {
      button?.click();
    });
    expect(node.querySelector('[data-changelog-dot]')).toBeNull();
    const opened = node.querySelector('details[open]');
    expect(opened?.textContent).toContain('v3.1.0');
    expect(opened?.textContent).toContain('licence MIT');
    const rest = [...node.querySelectorAll('details')].filter((el) => el !== opened);
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((el) => !el.hasAttribute('open'))).toBe(true);
  });

  it('n’ouvre que la version courante et les précédentes', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(createElement(ChangelogBody, { version: '3.0.0' }));
    });
    expect(host.textContent).toContain('Portefeuille');
    expect(host.textContent).not.toContain('AUBE III');
  });
});

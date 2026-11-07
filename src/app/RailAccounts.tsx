import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Glyph } from '@/design/Micro';
import { tr, useI18n } from '@/i18n';
import type { NtBridgeStatus } from '@/lib/desk';
import { useBridge } from '@/store/bridge';
import { useObjects } from '@/store/objects';
import { accountsFit, ACCOUNT_ROWS_MIN } from './railFit';
import s from './shell.module.css';

/**
 * Les comptes du pied du rail (décision de l'ADMIN, 2026-11-07) : la cartouche « Tous les comptes » est retirée ; à sa
 * place, au-dessus du sceau, les comptes connectés au pont NT8. Un compte est connecté quand le pont le rapporte et que
 * son lien vit : hors ligne, le process principal garde les derniers noms reçus (`electron/nt-bridge/server.ts`), ils ne
 * comptent plus. Dans l'ordre où le pont les rapporte, une fois chacun ; un nom vide ne compte pas.
 */
export function connectedAccounts(nt: Pick<NtBridgeStatus, 'link' | 'accountNames'> | null | undefined): string[] {
  if (nt?.link !== 'live') return [];
  return [...new Set((nt.accountNames ?? []).filter((name): name is string => typeof name === 'string' && name.trim() !== ''))];
}

/**
 * Les lignes que la pile montre sans défiler (`accountsFit`) : mesurées sur le rail comme le font les portes — sa hauteur,
 * celle, naturelle, de ses cartouches, et celle du sceau —, suivies à chaque changement de taille. Sans mesure (rien n'est
 * encore posé), deux.
 */
function useAccountsFit(stack: RefObject<HTMLDivElement | null>): number {
  const [fit, setFit] = useState(ACCOUNT_ROWS_MIN);
  useLayoutEffect(() => {
    const el = stack.current;
    const rail = el?.closest<HTMLElement>('[data-chassis="rail"]');
    const nav = rail?.querySelector<HTMLElement>('nav');
    const foot = el?.parentElement;
    const signature = foot?.lastElementChild;
    if (!el || !rail || !nav || !foot || !(signature instanceof HTMLElement) || signature === el) return;
    const px = (v: string) => Number.parseFloat(v) || 0;
    const read = () => {
      if (rail.clientHeight === 0) return;
      const cs = getComputedStyle(rail);
      const next = accountsFit({
        content: rail.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom),
        nav: nav.scrollHeight,
        gap: px(cs.rowGap),
        footGap: px(getComputedStyle(foot).rowGap),
        signature: signature.offsetHeight,
      });
      setFit((prev) => (prev === next ? prev : next));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(rail);
    ro.observe(nav);
    ro.observe(signature);
    for (const child of nav.children) ro.observe(child);
    return () => ro.disconnect();
  }, [stack]);
  return fit;
}

/**
 * Au pied du rail, au-dessus du sceau : rien tant qu'aucun compte n'est connecté ; sinon, la pile des comptes connectés.
 */
export function RailAccounts() {
  useI18n((st) => st.locale);
  const nt = useBridge((b) => b.nt);
  const accounts = connectedAccounts(nt);
  return accounts.length === 0 ? null : <AccountStack accounts={accounts} />;
}

/**
 * Une ligne par compte connecté, sans cartouche, sans filet ni fond : la micro (le pont dont la borne devient le coffre),
 * son voyant allumé à la menthe, puis le nom. Les comptes s'empilent dans la colonne, autant que la place le permet sans
 * faire défiler les cartouches ; au-delà, la pile défile d'une ligne à l'autre. Chaque ligne ouvre la fiche Compte de son
 * compte (OROS5.27, décision 11), par un saut que Retour arrière défait.
 */
function AccountStack({ accounts }: { accounts: string[] }) {
  const stack = useRef<HTMLDivElement>(null);
  const fit = useAccountsFit(stack);
  // L'infobulle vit sur la micro, cachée aux lecteurs d'écran : le nom accessible de la ligne dit déjà le lien.
  const linked = tr('Connecté au pont NT8', 'Connected to the NT8 bridge', 'Conectada al puente NT8');
  return (
    <div
      ref={stack}
      className={s.accounts}
      role="group"
      aria-label={tr('Comptes connectés', 'Connected accounts', 'Cuentas conectadas')}
      data-part="accounts"
      data-rows={fit}
      style={{ '--rows': fit } as CSSProperties}
    >
      {accounts.map((name) => (
        <button
          key={name}
          type="button"
          className={s.account}
          data-account-open={name}
          aria-label={tr(`Ouvrir la fiche du compte ${name}, connecté au pont NT8`, `Open the ${name} account record, connected to the NT8 bridge`, `Abrir la ficha de la cuenta ${name}, conectada al puente NT8`)}
          onClick={(event) => void useObjects.getState().openObject({ type: 'compte', id: name }, { jump: true, focus: true, origin: event.currentTarget })}
        >
          <span className={s.accountMark} data-part="account-mark" aria-hidden="true" title={linked}>
            <span className={s.accountArt}>
              <span className={s.accountBridge}>
                <Glyph name="bridge" />
              </span>
              <span className={s.accountVault}>
                <Glyph name="vault" />
              </span>
              <span className={s.voyant} data-voyant="" />
            </span>
          </span>
          <span className={s.accountName}>{name}</span>
        </button>
      ))}
    </div>
  );
}

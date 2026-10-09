import { useEffect } from 'react';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Button, Empty } from '@/design/primitives';
import { tr, useI18n } from '@/i18n';
import { useCrypto } from '@/store/crypto';

/** Onglet 09 · CRY. Éteint par défaut : seul le process principal allume le module, après son propre dialogue. */
export default function Crypto() {
  useI18n((s) => s.locale);
  const ready = useCrypto((s) => s.ready);
  const enabled = useCrypto((s) => s.enabled);
  const requestEnable = useCrypto((s) => s.requestEnable);

  useEffect(() => {
    void useCrypto.getState().load();
  }, []);

  return (
    <>
      <ModuleHeader tab="crypto" />
      <ModuleContent>
        {ready && !enabled ? (
          <Empty
            title={tr('Module crypto éteint', 'Crypto module off', 'Módulo cripto apagado')}
            text={tr(
              'Données publiques de Coinbase, Binance et Bybit, pour un usage personnel. Le desk ne s’y connecte qu’une fois le module activé.',
              'Public data from Coinbase, Binance and Bybit, for personal use. The desk connects only once the module is on.',
              'Datos públicos de Coinbase, Binance y Bybit, para uso personal. El desk solo se conecta una vez activado el módulo.',
            )}
            action={
              <Button variant="chamfer" onClick={() => void requestEnable()}>
                {tr('Activer le module crypto', 'Turn on the crypto module', 'Activar el módulo cripto')}
              </Button>
            }
          />
        ) : null}
      </ModuleContent>
    </>
  );
}

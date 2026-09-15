import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Empty } from '@/design/primitives';

export default function Agent() {
  return (
    <>
      <ModuleHeader tab="agent" />
      <ModuleContent>
        <Empty title="Module en construction" />
      </ModuleContent>
    </>
  );
}

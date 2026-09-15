import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Empty } from '@/design/primitives';

export default function Note() {
  return (
    <>
      <ModuleHeader tab="note" />
      <ModuleContent>
        <Empty title="Module en construction" />
      </ModuleContent>
    </>
  );
}

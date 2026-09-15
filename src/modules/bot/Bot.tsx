import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Empty } from '@/design/primitives';

export default function Bot() {
  return (
    <>
      <ModuleHeader tab="bot" />
      <ModuleContent>
        <Empty title="Module en construction" />
      </ModuleContent>
    </>
  );
}

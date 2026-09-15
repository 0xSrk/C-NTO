import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Empty } from '@/design/primitives';

export default function Calendrier() {
  return (
    <>
      <ModuleHeader tab="calendrier" />
      <ModuleContent>
        <Empty title="Module en construction" />
      </ModuleContent>
    </>
  );
}

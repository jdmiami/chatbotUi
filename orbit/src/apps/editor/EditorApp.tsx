import type { AppProps } from '../types';
import { AppHeader, DemoChip, EmptyState } from '../../ui/components';

/** PLACEHOLDER — replaced by the real Code app. */
export default function EditorApp(_props: AppProps) {
  return (
    <>
      <AppHeader title="Code" chip={<DemoChip />} />
      <EmptyState icon="info" title="Code">Coming next.</EmptyState>
    </>
  );
}

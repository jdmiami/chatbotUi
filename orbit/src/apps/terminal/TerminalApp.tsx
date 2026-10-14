import type { AppProps } from '../types';
import { AppHeader, DemoChip, EmptyState } from '../../ui/components';

/** PLACEHOLDER — replaced by the real Terminal app. */
export default function TerminalApp(_props: AppProps) {
  return (
    <>
      <AppHeader title="Terminal" chip={<DemoChip />} />
      <EmptyState icon="info" title="Terminal">Coming next.</EmptyState>
    </>
  );
}

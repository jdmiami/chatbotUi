import type { AppProps } from '../types';
import { AppHeader, DemoChip, EmptyState } from '../../ui/components';

/** PLACEHOLDER — replaced by the real Antigravity app. */
export default function AgentApp(_props: AppProps) {
  return (
    <>
      <AppHeader title="Antigravity" chip={<DemoChip />} />
      <EmptyState icon="info" title="Antigravity">Coming next.</EmptyState>
    </>
  );
}

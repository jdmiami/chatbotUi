import type { AppProps } from '../types';
import { AppHeader, DemoChip, EmptyState } from '../../ui/components';

/** PLACEHOLDER — replaced by the real Settings app. */
export default function SettingsApp(_props: AppProps) {
  return (
    <>
      <AppHeader title="Settings" chip={<DemoChip />} />
      <EmptyState icon="info" title="Settings">Coming next.</EmptyState>
    </>
  );
}

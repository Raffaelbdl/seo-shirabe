import type { AuditReport } from '../../lib/types';
import type { Settings } from '../../lib/settings';
import type { AuditState, TabInfo, useAudit } from './useAudit';

export interface TabProps {
  state: AuditState;
  report: AuditReport | null;
  actions: ReturnType<typeof useAudit>;
  tab: TabInfo | null;
  settings: Settings;
  onShow: (selector: string) => void;
}

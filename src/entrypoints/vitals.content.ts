// Web Vitals collector. Registered at runtime (document_start) only for
// origins the user granted, so no install-time host permission is needed.
// It only answers the side panel; it never reads or sends page content.
import { defineContentScript } from 'wxt/utils/define-content-script';
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';

export default defineContentScript({
  matches: [],
  registration: 'runtime',
  runAt: 'document_start',
  main() {
    const vitals: Record<string, number> = {};
    const record = (m: Metric) => {
      vitals[m.name] = m.value;
    };
    const opts = { reportAllChanges: true };
    onLCP(record, opts);
    onCLS(record, opts);
    onINP(record, opts);
    onTTFB(record, opts);
    onFCP(record, opts);
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id || !msg || msg.type !== 'shirabe/vitals') return false;
      sendResponse({ ...vitals });
      return false;
    });
  },
});

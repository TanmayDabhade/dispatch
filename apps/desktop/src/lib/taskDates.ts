// Linear's absolute row dates: `Sep 13` on a list row's far right and `Created Sep 13` on a
// board card's footer. Relative time ("2h ago") stays on live surfaces (runs, sessions); a
// task's dates are facts about the record, so they read as a calendar day. The formatter
// itself lives in @dispatch/ui so its records render the same day the same way.
import { formatShortDate } from '@/ui/ai/list-format';

export { formatShortDate };

/** The card footer line: `Created Sep 13`. */
export function formatCreated(iso: string, now: Date = new Date()): string {
  return `Created ${formatShortDate(iso, now)}`;
}

// Linear's absolute row dates: `Sep 13` on a list row's far right and `Created Sep 13` on a
// board card's footer. Relative time ("2h ago") stays on live surfaces (runs, sessions); a
// task's dates are facts about the record, so they read as a calendar day.

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** `Sep 13`, with the year appended (`Sep 13, 2025`) once it is not the current one. An
 * unparseable value reads as a dash rather than `Invalid Date`. `now` is injectable for tests. */
export function formatShortDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const month = MONTHS[date.getMonth()] ?? '';
  const day = date.getDate();
  if (date.getFullYear() === now.getFullYear()) return `${month} ${day}`;
  return `${month} ${day}, ${date.getFullYear()}`;
}

/** The card footer line: `Created Sep 13`. */
export function formatCreated(iso: string, now: Date = new Date()): string {
  return `Created ${formatShortDate(iso, now)}`;
}

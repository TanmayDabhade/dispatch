import { createContext, useContext } from 'react';

import type { InboxEntry, InboxTarget } from '../../lib/inbox';

/**
 * The persisted notification record (`lib/inbox.ts`) and the two things a surface can do
 * with it, provided by `App` from `useDispatchProject`'s `notificationInbox` /
 * `markNotificationInboxRead` and its `navigateFromInbox` router. The Inbox page's
 * notification pane and the sidebar's Inbox count both read this one seam, so they can
 * never disagree about what is unread.
 */
export interface NotificationInbox {
  /** Newest first. */
  entries: InboxEntry[];
  unreadCount: number;
  markAllRead: () => void;
  /** Routes to the entry's record or page and marks the inbox read. */
  navigate: (target: InboxTarget) => void;
}

const NotificationInboxContext = createContext<NotificationInbox | null>(null);

export const NotificationInboxProvider = NotificationInboxContext.Provider;

/** Throws outside the provider — see `useShellActions` for why a silent no-op is worse. */
export function useNotificationInbox(): NotificationInbox {
  const inbox = useContext(NotificationInboxContext);
  if (inbox === null) {
    throw new Error(
      'useNotificationInbox must be used inside <NotificationInboxProvider>'
    );
  }
  return inbox;
}

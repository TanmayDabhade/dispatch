import { createContext, useContext } from 'react';

import type { InboxEntry, InboxTarget } from '../../lib/inbox';

/**
 * The persisted notification record (`lib/inbox.ts`) and the two things a surface can do
 * with it, provided by `App` from `useDispatchProject`'s `notificationInbox` /
 * `markNotificationInboxRead` and its `navigateFromInbox` router. The Inbox page's
 * notification pane reads it (and any later surface that lists notifications). The rail's
 * Inbox count is a different number on purpose — `buildInbox`'s total, the queue of things
 * waiting on a human — so the two are not expected to agree.
 */
export interface NotificationInbox {
  /** Newest first. */
  entries: InboxEntry[];
  unreadCount: number;
  markAllRead: () => void;
  /** Flips one entry to read — the Inbox page selecting a notification row. */
  markRead: (id: string) => void;
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

import type { ActivityEntry } from '../../../lib/activityFeed';
import { formatRelativeTimeFromIso } from '../../../lib/format';
import { assigneeLabel } from '../../../lib/taskDisplay';
import { Markdown } from '../../runs/Markdown';
import { AssigneeAvatar } from '../AssigneeAvatar';
import { CommentComposer } from './CommentComposer';
import { InitialsAvatar } from '@/ui/ai/initials-avatar';

/** The line's author for the avatar and byline: the actor it was credited to, or Dispatch
 * itself for the orchestrator's own events. */
function authorLabel(entry: ActivityEntry): string {
  return entry.actor === null || entry.actor === 'none'
    ? 'Dispatch'
    : assigneeLabel(entry.actor);
}

// A 16px avatar for a feed line: the actor's own (agent/person initials) or `DI` on a
// muted fill for Dispatch — a token with white-ink contrast in both themes.
function ActorAvatar({ entry }: { entry: ActivityEntry }) {
  if (entry.actor === null || entry.actor === 'none') {
    return (
      <InitialsAvatar
        name="Dispatch"
        color="var(--text-muted)"
        className="size-4 text-[8px]"
      />
    );
  }
  return <AssigneeAvatar assignee={entry.actor} size={16} />;
}

function whenLabel(entry: ActivityEntry): string | null {
  return entry.at === null ? null : formatRelativeTimeFromIso(entry.at);
}

// One system event as a timeline line: `Dispatch dispatched (claude, …) · 2w ago`.
function TimelineRow({ entry }: { entry: ActivityEntry }) {
  const when = whenLabel(entry);
  return (
    <li
      data-slot="activity-event"
      className="text-muted-foreground font-book flex items-start gap-2 text-[12px] leading-4"
    >
      <span className="mt-px shrink-0">
        <ActorAvatar entry={entry} />
      </span>
      <span className="min-w-0 flex-1 break-words">
        <span className="text-(--text-secondary)">{authorLabel(entry)}</span>{' '}
        {entry.text}
        {when !== null && (
          <span className="text-muted-foreground"> · {when}</span>
        )}
      </span>
    </li>
  );
}

// One comment as a card: the author and time in the 12px byline, the body at 15px/450.
function CommentCard({ entry }: { entry: ActivityEntry }) {
  const when = whenLabel(entry);
  return (
    <li
      data-slot="activity-comment"
      className="bg-surface-quaternary rounded-card border-border-strong flex flex-col gap-2 border-[0.5px] p-3"
    >
      <div className="text-muted-foreground font-book flex items-center gap-2 text-[12px]">
        <ActorAvatar entry={entry} />
        <span className="font-medium">{authorLabel(entry)}</span>
        {when !== null && <span>{when}</span>}
      </div>
      <Markdown content={entry.text} variant="prose" />
    </li>
  );
}

// The `Activity` section: a 15px/600 heading, then the feed — orchestrator events as
// muted timeline lines and comments as cards, oldest first — closed by the comment
// composer. `onSubmitNote` receives the composer's trimmed text; `onAttach` is the
// composer's paperclip, opening the task's attachment picker when the page has one.
export function ActivitySection({
  entries,
  onSubmitNote,
  onAttach,
}: {
  entries: ActivityEntry[];
  onSubmitNote: (text: string) => void;
  onAttach?: () => void;
}) {
  return (
    <section data-slot="activity-section" className="flex flex-col gap-3">
      <h3 className="text-foreground text-[15px] leading-6 font-semibold">
        Activity
      </h3>
      {entries.length === 0 ? (
        <p className="text-muted-foreground font-book text-[12px]">
          No activity yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry, i) =>
            entry.kind === 'comment' ? (
              <CommentCard key={i} entry={entry} />
            ) : (
              <TimelineRow key={i} entry={entry} />
            )
          )}
        </ul>
      )}
      <CommentComposer onSubmit={onSubmitNote} onAttach={onAttach} />
    </section>
  );
}

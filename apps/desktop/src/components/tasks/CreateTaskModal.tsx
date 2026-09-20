import type {
  Assignee,
  CreateInput,
  Priority,
  TaskDoc,
  TaskKind,
} from '@dispatch/core/browser';
import {
  Check,
  Flag,
  Layers,
  Milestone,
  Paperclip,
  SquareCheck,
  Tag,
  X,
} from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useState } from 'react';

import { usePersistedDraft } from '../../hooks/usePersistedDraft';
import {
  assigneeLabel,
  kindLabel,
  priorityLabel,
  statusLabel,
} from '../../lib/taskDisplay';
import { useShellActions } from '../shell/ShellActionsContext';
import { useToasts } from '../shell/Toasts';
import { AssigneeAvatar } from './AssigneeAvatar';
import { PriorityIcon } from './PriorityIcon';
import { StatusIcon } from './StatusIcon';
import { IconButton } from '@/ui/ai/icon-button';
import { Pill, SelectPill } from '@/ui/ai/pill';
import { Switch } from '@/ui/ai/switch';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogBody,
  DialogChrome,
  DialogContent,
  DialogFooter,
} from '@/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { Input } from '@/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Textarea } from '@/ui/textarea';

// Fixed, non-config-driven enums — see TaskDetailModal.tsx for why these
// mirror core/types.ts's constants instead of importing them at runtime.
const KINDS: TaskKind[] = ['task', 'epic'];
const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];
const ASSIGNEES: Assignee[] = ['agent', 'human', 'none'];

// Menu values can't be the empty string, so this stands in for the "no epic" choice and is
// mapped back to `null` at the onChange boundary.
const NO_EPIC = '__none__';

export const CREATE_TASK_TITLE_KEY = 'dispatch:create-task-title';
export const CREATE_TASK_DESCRIPTION_KEY = 'dispatch:create-task-description';

interface CreateTaskModalProps {
  statuses: string[];
  epics: TaskDoc[];
  /** Pre-selects the status — kept for callers that pass it directly; the shell's
   * `createPreset` (a `+` on a status group or board column) fills the same slot. */
  initialStatus?: string;
  onCreate: (input: CreateInput) => Promise<void>;
  onClose: () => void;
}

interface ChipOption {
  value: string;
  label: string;
  glyph: ReactNode;
}

// One 28px property chip: a `SelectPill` whose menu lists the options with their 14px glyph
// and a 12px check on the current one. `unset` chips read as the property's name in muted
// text (`Priority`, `Assignee`), the way Linear's new-issue chips do before a value is picked.
function PropertyChip({
  value,
  options,
  onChange,
  label,
  menuTitle,
  unset = false,
}: {
  value: string;
  options: ChipOption[];
  onChange: (value: string) => void;
  /** The chip's accessible name and its text while `unset`. */
  label: string;
  menuTitle: string;
  unset?: boolean;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        data-slot="property-chip"
        data-unset={unset || undefined}
        render={
          <SelectPill
            icon={selected?.glyph}
            className={unset ? 'text-muted-foreground' : undefined}
          />
        }
      >
        {unset ? label : selected?.label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 min-w-[184px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{menuTitle}</DropdownMenuLabel>
          {options.map((o) => (
            <DropdownMenuItem
              key={o.value}
              onClick={() => onChange(o.value)}
              data-selected={o.value === value || undefined}
            >
              {o.glyph}
              <span className="truncate">{o.label}</span>
              {o.value === value && (
                <Check className="ml-auto size-3" aria-label="Selected" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// A chip whose value is free text (labels, the milestone name): the popover holds a 28px
// input; Enter commits, and `values` render as removable pills above it when `multiple`.
function TextChip({
  label,
  glyph,
  values,
  placeholder,
  multiple,
  onChange,
}: {
  label: string;
  glyph: ReactNode;
  values: string[];
  placeholder: string;
  multiple: boolean;
  onChange: (values: string[]) => void;
}) {
  const [text, setText] = useState('');
  const unset = values.length === 0;

  function commit() {
    const next = text.trim();
    if (next === '') return;
    onChange(multiple ? [...new Set([...values, next])] : [next]);
    setText('');
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        data-slot="property-chip"
        data-unset={unset || undefined}
        render={
          <SelectPill
            icon={glyph}
            className={unset ? 'text-muted-foreground' : undefined}
          />
        }
      >
        {unset ? label : values.join(', ')}
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-64 flex-col gap-2">
        {values.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {values.map((v) => (
              <Pill key={v}>
                {v}
                <button
                  type="button"
                  aria-label={`Remove ${v}`}
                  onClick={() => onChange(values.filter((x) => x !== v))}
                  className="text-muted-foreground hover:text-foreground -mr-1 flex size-3.5 items-center justify-center"
                >
                  <X className="size-2.5" />
                </button>
              </Pill>
            ))}
          </div>
        )}
        <Input
          aria-label={placeholder}
          placeholder={placeholder}
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Linear's new-issue dialog (§9): a ~1024px sheet near the top of the window with a crumb
 * header, a borderless 18px title over a 15px description, a row of 28px property chips,
 * and a footer with `Create more` + the indigo `Create task`. Title is the only required
 * field; `⌘⏎` creates, `Save as draft` files it under `draft`, and `Create more` keeps the
 * dialog open with the properties intact for the next one.
 */
export function CreateTaskModal({
  statuses,
  epics,
  initialStatus,
  onCreate,
  onClose,
}: CreateTaskModalProps) {
  const { createPreset } = useShellActions();
  const toasts = useToasts();
  // Title and description survive an accidental close (Escape, outside click) — the two
  // fields with real typing in them. The chips cost one click to redo and stay ephemeral.
  const [title, setTitle] = usePersistedDraft(CREATE_TASK_TITLE_KEY);
  const [description, setDescription] = usePersistedDraft(
    CREATE_TASK_DESCRIPTION_KEY
  );
  const [kind, setKind] = useState<TaskKind>('task');
  const [priority, setPriority] = useState<Priority>('none');
  const [assignee, setAssignee] = useState<Assignee>('none');
  const [status, setStatus] = useState(
    initialStatus ?? createPreset?.status ?? statuses[0] ?? 'backlog'
  );
  const [parent, setParent] = useState<string | null>(
    createPreset?.epic ?? null
  );
  const [milestone, setMilestone] = useState<string | null>(
    createPreset?.milestone ?? null
  );
  const [labels, setLabels] = useState<string[]>([]);
  const [createMore, setCreateMore] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim() !== '' && !submitting;

  // `asStatus` overrides the chip for `Save as draft`. Only a landed create clears the
  // persisted title/description; with `Create more` the dialog stays open for the next one.
  async function submit(asStatus: string = status) {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onCreate({
        title: title.trim(),
        kind,
        priority,
        assignee,
        status: asStatus,
        parent,
        milestone,
        labels,
        description,
      });
      setTitle('');
      setDescription('');
      if (!createMore) onClose();
    } catch (err) {
      toasts.push({
        tone: 'error',
        title: 'Could not create task',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  // `⌘⏎` from any field creates; a chip input that already consumed its Enter is skipped.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.defaultPrevented) return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  }

  const statusOptions: ChipOption[] = statuses.map((s) => ({
    value: s,
    label: statusLabel(s),
    glyph: <StatusIcon status={s} />,
  }));
  const priorityOptions: ChipOption[] = PRIORITIES.map((p) => ({
    value: p,
    label: priorityLabel(p),
    glyph: <PriorityIcon priority={p} />,
  }));
  const assigneeOptions: ChipOption[] = ASSIGNEES.map((a) => ({
    value: a,
    label: assigneeLabel(a),
    glyph: <AssigneeAvatar assignee={a} size={16} />,
  }));
  const epicOptions: ChipOption[] = [
    { value: NO_EPIC, label: 'No epic', glyph: <Milestone /> },
    ...epics.map((epic) => ({
      value: epic.meta.id,
      label: epic.meta.title,
      glyph: <Milestone />,
    })),
  ];
  const kindOptions: ChipOption[] = KINDS.map((k) => ({
    value: k,
    label: kindLabel(k),
    glyph: k === 'epic' ? <Layers /> : <SquareCheck />,
  }));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-label="New task"
        showCloseButton={false}
        onKeyDown={onKeyDown}
        className={
          expanded
            ? 'top-[4%] w-[min(1400px,96vw)] max-w-none translate-y-0 sm:max-w-none'
            : 'top-[12%] w-[min(1024px,92vw)] max-w-none translate-y-0 sm:max-w-none'
        }
      >
        <DialogChrome onExpand={() => setExpanded((v) => !v)}>
          <Pill>Dispatch</Pill>
          <span aria-hidden>›</span>
          <span className="text-(--text-secondary)">New task</span>
        </DialogChrome>

        <DialogBody className="gap-2 pt-1 pb-4">
          <Input
            variant="borderless"
            aria-label="Task title"
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            className="text-[18px] leading-7 font-medium"
          />
          <Textarea
            variant="borderless"
            aria-label="Description"
            placeholder="Add description…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={
              expanded
                ? 'min-h-[240px] text-[15px] leading-6'
                : 'min-h-[72px] text-[15px] leading-6'
            }
          />

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <PropertyChip
              value={status}
              options={statusOptions}
              onChange={setStatus}
              label="Status"
              menuTitle="Change status"
            />
            <PropertyChip
              value={priority}
              options={priorityOptions}
              onChange={(v) => setPriority(v as Priority)}
              label="Priority"
              menuTitle="Change priority"
              unset={priority === 'none'}
            />
            <PropertyChip
              value={assignee}
              options={assigneeOptions}
              onChange={(v) => setAssignee(v)}
              label="Assignee"
              menuTitle="Assign to"
              unset={assignee === 'none'}
            />
            <TextChip
              label="Labels"
              glyph={<Tag />}
              values={labels}
              placeholder="Add label"
              multiple
              onChange={setLabels}
            />
            <PropertyChip
              value={parent ?? NO_EPIC}
              options={epicOptions}
              onChange={(v) => setParent(v === NO_EPIC ? null : v)}
              label="Epic"
              menuTitle="Add to epic"
              unset={parent === null}
            />
            <TextChip
              label="Milestone"
              glyph={<Flag />}
              values={milestone === null ? [] : [milestone]}
              placeholder="Milestone name"
              multiple={false}
              onChange={(v) => setMilestone(v[0] ?? null)}
            />
            <PropertyChip
              value={kind}
              options={kindOptions}
              onChange={(v) => setKind(v as TaskKind)}
              label="Kind"
              menuTitle="Kind"
            />
          </div>
        </DialogBody>

        <DialogFooter
          className="shadow-hairline-top"
          leading={
            <IconButton label="Attach" disabled>
              <Paperclip />
            </IconButton>
          }
        >
          <span className="font-book flex items-center gap-2 text-[13px] text-(--text-secondary)">
            Create more
            <Switch
              aria-label="Create more"
              checked={createMore}
              onCheckedChange={(next) => setCreateMore(next)}
            />
          </span>
          {title.trim() !== '' && (
            <Button
              variant="ghost"
              disabled={submitting}
              onClick={() => void submit('draft')}
            >
              Save as draft
            </Button>
          )}
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

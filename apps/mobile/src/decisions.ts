import {
  approvalReply,
  type Message,
  type ReplyInput,
  runIdOf,
  toolApprovalOf,
  toRunQuestion,
  toScopeRequest,
} from '@dispatch/client';

// What a Needs you card shows and what each of its buttons sends, worked out
// from the open decision's message with no React in sight, so tests can pin
// it down. The screen (app/(tabs)/index.tsx) only draws this.

export type DecisionKind = 'approval' | 'scope' | 'question';

export interface DecisionAction {
  label: string;
  tone: 'primary' | 'plain' | 'danger';
  reply: ReplyInput;
}

export interface DecisionCard {
  kind: DecisionKind;
  title: string;
  /** The question or the reason, in words; empty for a tool call. */
  body: string;
  /** A command, a path list or JSON, shown in mono; null when there is none. */
  code: string | null;
  /** Shown under the code when the daemon cut the tool input short. */
  truncated: boolean;
  actions: DecisionAction[];
  /** True when an answer in the person's own words is accepted. */
  freeText: boolean;
  runId: string | null;
}

const PREVIEW_CHARS = 400;

/** A short look at a tool call's input: a command, a path, or the JSON. */
export function preview(input: unknown): string {
  if (input !== null && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    for (const key of ['command', 'file_path', 'path', 'url', 'pattern']) {
      const value = record[key];
      if (typeof value === 'string') return value;
    }
  }
  const text = JSON.stringify(input) ?? '';
  return text.length > PREVIEW_CHARS
    ? `${text.slice(0, PREVIEW_CHARS)}…`
    : text;
}

/** Who is asking, in words: "A run", "The Overseer", or the sender's name. */
export function askerOf(message: Message): string {
  const from = message.from;
  if (from.startsWith('run:')) return 'A run';
  if (from === 'agent:dispatch') return 'Dispatch';
  if (/overseer/i.test(from)) return 'The Overseer';
  const colon = from.indexOf(':');
  return colon === -1 ? from : from.slice(colon + 1);
}

export function decisionCard(message: Message): DecisionCard {
  const runId = runIdOf(message);

  const approval = toolApprovalOf(message);
  if (approval !== null) {
    // As on the desktop: "for this run" only when the gate offers it, which
    // a call held by the irreversibility floor never does.
    const session = message.choices?.includes('approve-session') ?? true;
    return {
      kind: 'approval',
      title: `Allow ${approval.tool}?`,
      body: '',
      code: preview(approval.input),
      truncated: approval.truncated === true,
      actions: [
        { label: 'Allow', tone: 'primary', reply: approvalReply(true) },
        ...(session
          ? [
              {
                label: 'Allow for run',
                tone: 'plain' as const,
                reply: approvalReply(true, { scope: 'session' }),
              },
            ]
          : []),
        { label: 'Deny', tone: 'danger', reply: approvalReply(false) },
      ],
      freeText: false,
      runId,
    };
  }

  const scope = toScopeRequest(message);
  if (scope !== null) {
    return {
      kind: 'scope',
      title: 'Let the run edit outside its scope?',
      body: scope.reason,
      code: scope.paths.join('\n'),
      truncated: false,
      actions: [
        {
          label: 'Grant',
          tone: 'primary',
          reply: { body: '', choice: 'grant' },
        },
        { label: 'Deny', tone: 'danger', reply: { body: '', choice: 'deny' } },
      ],
      freeText: false,
      runId,
    };
  }

  const question = toRunQuestion(message);
  const options = question?.options ?? message.choices ?? [];
  return {
    kind: 'question',
    title: `${askerOf(message)} asks`,
    body: message.body,
    code: null,
    truncated: false,
    actions: options.map((choice) => ({
      label: choice,
      tone: 'plain' as const,
      reply: { body: choice, choice },
    })),
    freeText: true,
    runId,
  };
}

import type { RunState } from '@dispatch/client';
import type { Assignee, Priority, TaskDoc } from '@dispatch/core/browser';
import {
  Activity,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Milestone,
  SignalHigh,
  Tag,
  Target,
  User,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import {
  facetLabel,
  FILTER_FACETS,
  FILTER_NONE,
  type FilterFacet,
  filterValueLabel,
  setDateFilter,
  type TaskFilterSet,
  toggleFilterValue,
} from '../../lib/taskFilters';
import { AssigneeAvatar } from './AssigneeAvatar';
import { PriorityIcon } from './PriorityIcon';
import { StatusIcon } from './StatusIcon';
import { IconButton } from '@/ui/ai/icon-button';
import { FilterIconButton } from '@/ui/ai/page-header';
import { Input } from '@/ui/input';
import { Kbd } from '@/ui/kbd';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';

const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];
const ASSIGNEES: Assignee[] = ['agent', 'human', 'none'];
const RUN_STATES: (RunState | typeof FILTER_NONE)[] = [
  'running',
  'provisioning',
  'awaiting-approval',
  'finished',
  'failed',
  'cancelled',
  'interrupted-dirty',
  FILTER_NONE,
];

const FACET_ICON: Record<FilterFacet, ReactNode> = {
  status: <CircleDot aria-hidden />,
  priority: <SignalHigh aria-hidden />,
  assignee: <User aria-hidden />,
  labels: <Tag aria-hidden />,
  epic: <Milestone aria-hidden />,
  milestone: <Target aria-hidden />,
  run: <Activity aria-hidden />,
  created: <Calendar aria-hidden />,
  updated: <Calendar aria-hidden />,
};

const DAY_MS = 24 * 60 * 60 * 1000;

// The Dates facets take one bound; these are the quick picks a menu can offer without a
// date input. `days` ago from now, `before` or `after`.
const DATE_PICKS: { label: string; op: 'before' | 'after'; days: number }[] = [
  { label: 'In the last day', op: 'after', days: 1 },
  { label: 'In the last week', op: 'after', days: 7 },
  { label: 'In the last month', op: 'after', days: 30 },
  { label: 'More than a week ago', op: 'before', days: 7 },
  { label: 'More than a month ago', op: 'before', days: 30 },
];

// One menu row: 32px, 14px icon, 13px label, trailing chevron/check.
const ROW_CLASS =
  'flex h-8 w-full cursor-default items-center gap-2 rounded-control px-2 text-left text-[13px] outline-none hover:bg-surface-hover focus-visible:bg-surface-hover [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-3.5 [&_svg:not([class*=text-])]:text-muted-foreground';

export interface FilterMenuContext {
  /** The project's statuses in config order. */
  statuses: readonly string[];
  epics: readonly TaskDoc[];
  /** Every label in use, sorted. */
  labels: readonly string[];
  /** Every milestone name in use, sorted. */
  milestones: readonly string[];
}

export interface FilterMenuProps {
  filters: TaskFilterSet;
  onChange: (filters: TaskFilterSet) => void;
  context: FilterMenuContext;
  /** Controlled open state, so `f` on the list can open it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface FacetOption {
  value: string;
  label: string;
  glyph?: ReactNode;
}

// Every value a facet can filter on, from the project's own vocabulary.
function optionsFor(facet: FilterFacet, ctx: FilterMenuContext): FacetOption[] {
  switch (facet) {
    case 'status':
      return ctx.statuses.map((s) => ({
        value: s,
        label: filterValueLabel('status', s),
        glyph: <StatusIcon status={s} />,
      }));
    case 'priority':
      return PRIORITIES.map((p) => ({
        value: p,
        label: filterValueLabel('priority', p),
        glyph: <PriorityIcon priority={p} />,
      }));
    case 'assignee':
      return ASSIGNEES.map((a) => ({
        value: a,
        label: filterValueLabel('assignee', a),
        glyph: <AssigneeAvatar assignee={a} size={16} />,
      }));
    case 'labels':
      return ctx.labels.map((l) => ({ value: l, label: l }));
    case 'epic':
      return [
        { value: FILTER_NONE, label: 'No epic' },
        ...ctx.epics.map((e) => ({ value: e.meta.id, label: e.meta.title })),
      ];
    case 'milestone':
      return [
        { value: FILTER_NONE, label: 'No milestone' },
        ...ctx.milestones.map((m) => ({ value: m, label: m })),
      ];
    case 'run':
      return RUN_STATES.map((s) => ({
        value: s,
        label: filterValueLabel('run', s),
      }));
    case 'created':
    case 'updated':
      return DATE_PICKS.map((pick) => ({
        value: `${pick.op}:${pick.days}`,
        label: pick.label,
      }));
  }
}

function matches(query: string, text: string): boolean {
  return text.toLowerCase().includes(query.trim().toLowerCase());
}

/**
 * Linear's Filter menu (§7) off the header's funnel (or `f`): a 180px popover with an
 * `Add filter…` search, then one row per facet — Status, Priority, Assignee, Labels, Epic,
 * Milestone, Run state, Created, Updated — each opening its values (a `▸` drill-in rather
 * than a hover submenu, so it works the same from the keyboard). Picking a value toggles it
 * into the facet's clause; the applied clauses render as chips under the header
 * (`AppliedFilters`). Typing searches facets and their values together.
 */
export function FilterMenu({
  filters,
  onChange,
  context,
  open,
  onOpenChange,
}: FilterMenuProps) {
  const [query, setQuery] = useState('');
  const [facet, setFacet] = useState<FilterFacet | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const active = filters.clauses.length > 0;

  // Reopening starts at the facet list with an empty search.
  useEffect(() => {
    if (open === false) {
      setQuery('');
      setFacet(null);
    }
  }, [open]);

  const selectedValues = (f: FilterFacet): ReadonlySet<string> =>
    new Set(filters.clauses.find((c) => c.facet === f)?.values ?? []);

  function pick(f: FilterFacet, value: string) {
    if (f === 'created' || f === 'updated') {
      const [op, days] = value.split(':');
      const bound = new Date(Date.now() - Number(days) * DAY_MS).toISOString();
      onChange(
        setDateFilter(filters, f, op === 'before' ? 'before' : 'after', bound)
      );
      return;
    }
    onChange(toggleFilterValue(filters, f, value));
  }

  // Search results: facets whose name matches, then values across every facet.
  const searchRows = useMemo(() => {
    if (query.trim() === '') return null;
    const facets = FILTER_FACETS.filter((f) => matches(query, facetLabel(f)));
    const values = FILTER_FACETS.flatMap((f) =>
      optionsFor(f, context)
        .filter((o) => matches(query, o.label))
        .map((o) => ({ facet: f, option: o }))
    );
    return { facets, values };
  }, [query, context]);

  const optionRow = (f: FilterFacet, option: FacetOption, crumb: boolean) => {
    const selected = selectedValues(f).has(option.value);
    return (
      <button
        key={`${f}:${option.value}`}
        type="button"
        role="menuitemcheckbox"
        aria-checked={selected}
        onClick={() => pick(f, option.value)}
        className={ROW_CLASS}
      >
        {option.glyph ?? FACET_ICON[f]}
        <span className="min-w-0 truncate">
          {crumb && (
            <span className="text-muted-foreground">{facetLabel(f)} › </span>
          )}
          {option.label}
        </span>
        {selected && <Check className="ml-auto size-3" aria-label="Selected" />}
      </button>
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        onOpenChange?.(next);
        if (!next) {
          setQuery('');
          setFacet(null);
        }
      }}
    >
      <PopoverTrigger render={<FilterIconButton active={active} />} />
      <PopoverContent
        align="end"
        data-slot="filter-menu"
        initialFocus={inputRef}
        className="w-[180px] p-0"
      >
        {facet === null ? (
          <>
            <div className="shadow-hairline-bottom flex h-9 items-center gap-2 px-2.5">
              <Input
                ref={inputRef}
                variant="borderless"
                placeholder="Add filter…"
                aria-label="Add filter"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchRows?.facets.length === 1) {
                    e.preventDefault();
                    setFacet(searchRows.facets[0]);
                    setQuery('');
                  }
                }}
                className="flex-1 text-[13px]"
              />
              <Kbd>F</Kbd>
            </div>
            <div
              role="menu"
              aria-label="Filter facets"
              className="flex max-h-80 flex-col overflow-y-auto p-1"
            >
              {searchRows === null ? (
                FILTER_FACETS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="menuitem"
                    data-facet={f}
                    onClick={() => setFacet(f)}
                    className={ROW_CLASS}
                  >
                    {FACET_ICON[f]}
                    <span className="min-w-0 flex-1 truncate">
                      {facetLabel(f)}
                    </span>
                    {selectedValues(f).size > 0 && (
                      <span className="font-book text-muted-foreground text-[11px]">
                        {selectedValues(f).size}
                      </span>
                    )}
                    <ChevronRight
                      aria-hidden
                      className="text-muted-foreground size-3"
                    />
                  </button>
                ))
              ) : (
                <>
                  {searchRows.facets.map((f) => (
                    <button
                      key={f}
                      type="button"
                      role="menuitem"
                      data-facet={f}
                      onClick={() => {
                        setFacet(f);
                        setQuery('');
                      }}
                      className={ROW_CLASS}
                    >
                      {FACET_ICON[f]}
                      <span className="min-w-0 flex-1 truncate">
                        {facetLabel(f)}
                      </span>
                      <ChevronRight
                        aria-hidden
                        className="text-muted-foreground size-3"
                      />
                    </button>
                  ))}
                  {searchRows.values.map(({ facet: f, option }) =>
                    optionRow(f, option, true)
                  )}
                  {searchRows.facets.length === 0 &&
                    searchRows.values.length === 0 && (
                      <span className="font-book text-muted-foreground flex h-8 items-center px-2 text-[13px]">
                        No matching filter
                      </span>
                    )}
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="shadow-hairline-bottom flex h-9 items-center gap-1 px-1">
              <IconButton
                label="Back to filters"
                onClick={() => setFacet(null)}
              >
                <ChevronLeft aria-hidden />
              </IconButton>
              <span className="text-muted-foreground min-w-0 truncate text-[12px] font-medium">
                {facetLabel(facet)}
              </span>
            </div>
            <div
              role="menu"
              aria-label={`${facetLabel(facet)} values`}
              className="flex max-h-80 flex-col overflow-y-auto p-1"
            >
              {optionsFor(facet, context).length === 0 ? (
                <span className="font-book text-muted-foreground flex h-8 items-center px-2 text-[13px]">
                  Nothing to filter on
                </span>
              ) : (
                optionsFor(facet, context).map((option) =>
                  optionRow(facet, option, false)
                )
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

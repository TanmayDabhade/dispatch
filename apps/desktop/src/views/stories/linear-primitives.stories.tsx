import {
  BellIcon,
  CircleIcon,
  InboxIcon,
  KanbanSquareIcon,
  ListIcon,
  PencilIcon,
  SearchIcon,
  StarIcon,
  WaypointsIcon,
} from 'lucide-react';
import { useState } from 'react';

import { GroupHeader } from '@/ui/ai/group-header';
import { IconButton } from '@/ui/ai/icon-button';
import { InitialsAvatar } from '@/ui/ai/initials-avatar';
import { ListRow } from '@/ui/ai/list-row';
import {
  HeaderIconTriad,
  PageHeader,
  PageHeaderShellContext,
  ViewTabs,
} from '@/ui/ai/page-header';
import { LabelPill, Pill, PillButton, SelectPill } from '@/ui/ai/pill';
import { SegmentedControl } from '@/ui/ai/segmented';
import { Switch } from '@/ui/ai/switch';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/chrome/empty-state';
import { Kbd } from '@/ui/kbd';
import type { GalleryStory } from '@/views/galleryStories';

// Linear's in-progress status glyph (§17): an outer ring and a half-filled pie.
function ProgressGlyph({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className="size-3.5" aria-hidden>
      <circle cx="7" cy="7" r="6" stroke={color} strokeWidth="1.5" />
      <circle
        cx="7"
        cy="7"
        r="2"
        stroke={color}
        strokeWidth="4"
        strokeDasharray="12.189379495928398 24.378758991856795"
        strokeDashoffset="6.0947"
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

// Linear's "no priority" glyph: three dots.
function NoPriorityGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className="size-3.5"
      aria-hidden
    >
      <rect x="1.5" y="7.25" width="3" height="1.5" rx="0.5" opacity="0.9" />
      <rect x="6.5" y="7.25" width="3" height="1.5" rx="0.5" opacity="0.9" />
      <rect x="11.5" y="7.25" width="3" height="1.5" rx="0.5" opacity="0.9" />
    </svg>
  );
}

// `PageHeader`'s sidebar toggle is context-driven, so the story provides a fake shell
// whose hidden state the story itself can flip.
function PageHeaderDemo() {
  const [sidebarHidden, setSidebarHidden] = useState(true);
  const [tab, setTab] = useState('active');
  const [filterActive, setFilterActive] = useState(true);
  return (
    <PageHeaderShellContext.Provider
      value={{
        sidebarHidden,
        onToggleSidebar: () => setSidebarHidden((current) => !current),
        trafficLightInset: false,
        dragRegion: false,
      }}
    >
      <div className="bg-surface-panel rounded-card w-full overflow-hidden">
        <PageHeader
          leading={<InitialsAvatar name="Dispatch" square color="#5e6ad2" />}
          crumb={['Dispatch', 'Tasks']}
          star={
            <IconButton label="Favorite">
              <StarIcon />
            </IconButton>
          }
          actions={
            <>
              <Button variant="ghost">Plan work…</Button>
              <IconButton label="Notifications">
                <BellIcon />
              </IconButton>
            </>
          }
          tabs={
            <ViewTabs
              tabs={[
                { id: 'active', label: 'Active' },
                { id: 'backlog', label: 'Backlog' },
                { id: 'all', label: 'All tasks' },
              ]}
              active={tab}
              onChange={setTab}
            />
          }
          controls={
            <HeaderIconTriad
              filterActive={filterActive}
              onFilter={() => setFilterActive((current) => !current)}
            />
          }
        />
      </div>
    </PageHeaderShellContext.Provider>
  );
}

// `ListRow`'s selection is owned by the caller; the story keeps a set so the hover
// checkbox actually toggles.
function ListRowsDemo() {
  const [selected, setSelected] = useState<Set<string>>(new Set(['t-2dfa1d']));
  const [focused, setFocused] = useState('t-cafe27');
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const row = (
    id: string,
    title: string,
    extra?: { indent?: 0 | 1; crumb?: string }
  ) => (
    <ListRow
      key={id}
      id={id}
      leading={<NoPriorityGlyph />}
      status={<ProgressGlyph color="var(--status-progress)" />}
      title={title}
      crumb={extra?.crumb}
      indent={extra?.indent}
      selected={selected.has(id)}
      focused={focused === id}
      onClick={() => setFocused(id)}
      onSelectToggle={() => toggle(id)}
      trailing={
        <>
          <LabelPill color="#eb5757">Bug</LabelPill>
          <Pill>
            <WaypointsIcon /> 2
          </Pill>
          <InitialsAvatar name="Wyat Soule" />
        </>
      }
      date="Sep 13"
    />
  );
  // Rows default to `role="row"`, so the list itself must be the grid.
  return (
    <div
      role="grid"
      aria-label="Tasks"
      className="bg-surface-panel rounded-card flex w-full flex-col p-2"
    >
      <GroupHeader
        tint="var(--status-progress)"
        icon={<ProgressGlyph color="var(--status-progress)" />}
        name="In progress"
        count={3}
        onToggle={() => {}}
        onAdd={() => {}}
        addLabel="New task"
      />
      {row('t-cafe27', 'Boot force-fail must say why')}
      {row('t-2dfa1d', 'See all agents that are working')}
      {row('t-716d89', 'Rework the kanban columns', {
        indent: 1,
        crumb: 'UI pass',
      })}
    </div>
  );
}

function GroupHeadersDemo() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="bg-surface-panel rounded-card flex w-full flex-col gap-2 p-2">
      <GroupHeader
        tint="var(--status-progress)"
        icon={<ProgressGlyph color="var(--status-progress)" />}
        name="In progress"
        count={3}
        collapsed={collapsed}
        onToggle={() => setCollapsed((current) => !current)}
        onAdd={() => {}}
      />
      <GroupHeader
        tint="var(--status-blocked)"
        icon={<CircleIcon className="text-status-blocked" />}
        name="Blocked"
        count={1}
        onToggle={() => {}}
        onAdd={() => {}}
        actions={
          <IconButton label="Dependency graph">
            <WaypointsIcon />
          </IconButton>
        }
      />
      <GroupHeader
        icon={<CircleIcon className="text-status-backlog" />}
        name="Backlog"
        count={12}
        onToggle={() => {}}
        onAdd={() => {}}
      />
    </div>
  );
}

function SwitchesDemo() {
  const [subIssues, setSubIssues] = useState(true);
  const [empty, setEmpty] = useState(false);
  return (
    <div className="bg-popover rounded-popover shadow-overlay flex w-[260px] flex-col gap-3 p-3">
      <Switch
        label="Show sub-tasks"
        checked={subIssues}
        onCheckedChange={setSubIssues}
      />
      <Switch
        label="Show empty groups"
        checked={empty}
        onCheckedChange={setEmpty}
      />
      <Switch label="Nested sub-tasks" disabled />
    </div>
  );
}

function SegmentedDemo() {
  const [layout, setLayout] = useState('list');
  return (
    <div className="w-[260px]">
      <SegmentedControl
        label="Layout"
        value={layout}
        onChange={setLayout}
        options={[
          { id: 'list', label: 'List', icon: <ListIcon /> },
          { id: 'board', label: 'Board', icon: <KanbanSquareIcon /> },
        ]}
      />
    </div>
  );
}

export const linearPrimitiveStories: GalleryStory[] = [
  {
    id: 'page-header',
    title: 'Page header — crumb, view tabs, icon triad',
    note: 'Two 44px rows under a hairline: crumb + star + ghost actions, then pill view tabs and the Filter / Display / side-panel triad. The sidebar is "hidden" via context, so the show-sidebar button leads; click it to flip. The funnel dot toggles on click.',
    render: () => <PageHeaderDemo />,
  },
  {
    id: 'list-rows',
    title: 'List rows — 36px, hover checkbox, nested child',
    note: 'A status-tinted group header over three ListRows inside a role="grid" list (rows default to role="row"): priority glyph, sans id with -0.26px tracking, status glyph, title, label pill, sub-task count pill, 18px avatar, date. The checkbox appears on hover, focus or selection; the third row nests with a tree connector and a dimmer id.',
    render: () => <ListRowsDemo />,
  },
  {
    id: 'group-headers',
    title: 'Group headers — tinted, collapsible',
    note: '36px bars on the quaternary surface; the left edge picks up 4% of the status colour and fades to neutral. Hover for the collapse chevron; the middle one carries an extra action beside the +.',
    render: () => <GroupHeadersDemo />,
  },
  {
    id: 'pills',
    title: 'Pills — Pill, LabelPill, PillButton, SelectPill',
    note: '24px read-only pills with a half-pixel chip ring; 28px pill buttons on the control surface; a select pill with the 12px chevron.',
    render: () => (
      <div className="flex flex-wrap items-center gap-2">
        <Pill>Project</Pill>
        <LabelPill color="#eb5757">Bug</LabelPill>
        <LabelPill color="#4cb782">Improvement</LabelPill>
        <Pill>
          <WaypointsIcon /> 3
        </Pill>
        <PillButton>Backlog</PillButton>
        <PillButton disabled>Disabled</PillButton>
        <SelectPill>Status</SelectPill>
        <SelectPill icon={<CircleIcon />}>Priority</SelectPill>
      </div>
    ),
  },
  {
    id: 'icon-buttons',
    title: 'Icon buttons — ghost, filled, active',
    note: '28px round buttons with a 14px icon: transparent at rest and filled on hover; `filled` is the sidebar new-task button; `active` brightens the icon.',
    render: () => (
      <div className="flex items-center gap-2">
        <IconButton label="Search">
          <SearchIcon />
        </IconButton>
        <IconButton label="New task" filled>
          <PencilIcon />
        </IconButton>
        <IconButton label="Inbox" active>
          <InboxIcon />
        </IconButton>
        <IconButton label="Disabled" disabled>
          <BellIcon />
        </IconButton>
      </div>
    ),
  },
  {
    id: 'switches',
    title: 'Switches — in a Display popover',
    note: '28×16 toggles: chip-grey with a muted knob off, indigo with a white knob on; 13px/450 label on the left.',
    render: () => <SwitchesDemo />,
  },
  {
    id: 'segmented-control',
    title: 'Segmented control — List | Board',
    note: 'Equal cells with icon above label inside one half-pixel ring; the active cell lifts.',
    render: () => <SegmentedDemo />,
  },
  {
    id: 'initials-avatars',
    title: 'Initials avatars — circle and square',
    note: '18px, 9px white initials on a saturated colour hashed from the name; `square` is the workspace switcher shape.',
    render: () => (
      <div className="flex items-center gap-2">
        <InitialsAvatar name="Wyat Soule" />
        <InitialsAvatar name="Claude" />
        <InitialsAvatar name="Priya Miranda" />
        <InitialsAvatar name="Dispatch" square color="#5e6ad2" />
      </div>
    ),
  },
  {
    id: 'empty-state',
    title: 'Empty state — illustration, heading, pills',
    note: 'Centred 60px line art, 13px heading, muted description at 340px, an indigo primary pill with an inline keycap hint and a secondary pill.',
    render: () => (
      <EmptyState
        icon={InboxIcon}
        heading="No tasks in this view"
        description="Plan work to file a batch of tasks, or dispatch an agent on a single one."
        primary={{ label: 'Plan work', hint: 'N then P', onClick: () => {} }}
        secondary={{ label: 'Import tasks', onClick: () => {} }}
      />
    ),
  },
  {
    id: 'keycaps',
    title: 'Keycaps',
    note: '11px keycaps with the 4px chip radius and a half-pixel ring, as a menu shortcut and a hint.',
    render: () => (
      <div className="flex items-center gap-2 text-[13px]">
        <span>Command menu</span>
        <Kbd>⌘K</Kbd>
        <span className="text-muted-foreground">·</span>
        <span>Settings</span>
        <Kbd>G</Kbd>
        <span className="text-muted-foreground text-[11px]">then</span>
        <Kbd>S</Kbd>
      </div>
    ),
  },
];

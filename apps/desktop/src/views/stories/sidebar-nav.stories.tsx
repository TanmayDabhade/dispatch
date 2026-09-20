import {
  BrainIcon,
  ChevronDownIcon,
  GitBranchIcon,
  InboxIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  PlayIcon,
  RadarIcon,
  SearchIcon,
  ShieldIcon,
  SparklesIcon,
  SquarePenIcon,
} from 'lucide-react';
import { useState } from 'react';

import { IconButton } from '@/ui/ai/icon-button';
import { InitialsAvatar } from '@/ui/ai/initials-avatar';
import { SidebarNav, type SidebarNavSection } from '@/ui/ai/sidebar-nav';
import type { GalleryStory } from '@/views/galleryStories';

// The app rail's shape: a heading-less fixed group (Inbox with an attention count, Drafts,
// Overseer), then collapsible sentence-case sections — covers icons, plain counts, the
// attention dot, a nested row, and a folded section.
function sections(
  collapsed: Record<string, boolean>,
  toggle: (id: string) => void
): SidebarNavSection[] {
  return [
    {
      id: 'top',
      items: [
        {
          id: 'inbox',
          label: 'Inbox',
          icon: <InboxIcon />,
          count: 3,
          state: 'attention',
        },
        { id: 'drafts', label: 'Drafts', icon: <SparklesIcon />, count: 1 },
        { id: 'overseer', label: 'Overseer', icon: <ShieldIcon /> },
      ],
    },
    {
      id: 'workspace',
      label: 'Workspace',
      collapsible: true,
      collapsed: collapsed.workspace === true,
      onToggle: () => toggle('workspace'),
      items: [
        {
          id: 'overview',
          label: 'Control room',
          icon: <LayoutDashboardIcon />,
        },
        { id: 'brain-dump', label: 'Brain dump', icon: <BrainIcon /> },
        { id: 'board', label: 'Tasks', icon: <ListChecksIcon /> },
        { id: 'board-active', label: 'Active', indent: 1 },
        { id: 'board-backlog', label: 'Backlog', indent: 1 },
        { id: 'branches', label: 'Git', icon: <GitBranchIcon /> },
      ],
    },
    {
      id: 'fleet',
      label: 'Fleet',
      collapsible: true,
      collapsed: collapsed.fleet === true,
      onToggle: () => toggle('fleet'),
      items: [
        {
          id: 'all-agents',
          label: 'All agents',
          icon: <RadarIcon />,
          count: 4,
        },
        { id: 'sessions', label: 'Sessions', icon: <PlayIcon /> },
      ],
    },
    {
      id: 'try',
      label: 'Try',
      collapsible: true,
      collapsed: collapsed.try !== false,
      onToggle: () => toggle('try'),
      items: [{ id: 'try-plan', label: 'Plan work…' }],
    },
  ];
}

// SidebarNav is fully controlled — same stateful-wrapper pattern the other demos in
// galleryStories.tsx use — so clicking an item moves the active fill and a heading folds.
function SidebarNavDemo() {
  const [activeId, setActiveId] = useState('inbox');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !(prev[id] === true) }));
  return (
    <div className="bg-frame rounded-card w-[244px] pb-2">
      <SidebarNav
        header={
          <div className="flex h-10 items-center gap-1 pr-0">
            <button
              type="button"
              className="rounded-control hover:bg-surface-hover flex h-7 min-w-0 flex-1 items-center gap-2 pr-1.5 pl-1 text-left transition-colors duration-100"
            >
              <InitialsAvatar square name="dispatch" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-[550] text-(--text-secondary)">
                dispatch
              </span>
              <ChevronDownIcon
                aria-hidden
                className="text-muted-foreground size-3"
              />
            </button>
            <IconButton label="Search">
              <SearchIcon />
            </IconButton>
            <IconButton filled label="New task">
              <SquarePenIcon />
            </IconButton>
          </div>
        }
        sections={sections(collapsed, toggle)}
        activeId={activeId}
        onSelect={setActiveId}
      />
    </div>
  );
}

export const sidebarNavStories: GalleryStory[] = [
  {
    id: 'sidebar-nav-workspace',
    title: 'Sidebar nav — rail',
    note: 'Linear rail grammar on the frame: 18px initials square + name + chevron with search and new-task icon buttons; a heading-less top group (Inbox 3 with the indigo dot, Drafts, Overseer); collapsible sentence-case Workspace/Fleet/Try headings; 28px rows, 14px icons, plain 11px counts, a nested row at 16px. Active is the neutral selected surface — click a row to move it, a heading to fold it.',
    render: () => <SidebarNavDemo />,
  },
];

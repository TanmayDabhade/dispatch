import {
  ArrowRightIcon,
  BotIcon,
  CircleDashedIcon,
  ZapIcon,
} from 'lucide-react';
import { useState } from 'react';

import { type SearchGroup, SearchPanel } from '@/ui/ai/search';
import { Kbd } from '@/ui/kbd';
import type { GalleryStory } from '@/views/galleryStories';

// Dispatch-flavored groups in the command menu's own order: open tasks, live agents,
// navigation and actions with their keycaps.
const SEARCH_GROUPS: SearchGroup[] = [
  {
    id: 'tasks',
    label: 'Tasks',
    items: [
      {
        id: 't-716d89',
        label: 'Rework the kanban columns',
        icon: <CircleDashedIcon aria-hidden />,
        hint: 't-716d89',
      },
      {
        id: 't-cafe27',
        label: 'Boot force-fail must say why',
        icon: <CircleDashedIcon aria-hidden />,
        hint: 't-cafe27',
      },
      {
        id: 't-2dfa1d',
        label: 'See all agents that are working',
        icon: <CircleDashedIcon aria-hidden />,
        hint: 't-2dfa1d',
      },
    ],
  },
  {
    id: 'agents',
    label: 'Agents',
    items: [
      {
        id: 'a-overseer',
        label: 'Overseer',
        icon: <BotIcon aria-hidden />,
        hint: 'Working',
        kbd: 'G A',
      },
      {
        id: 'a-cartographer',
        label: 'Cartographer',
        icon: <BotIcon aria-hidden />,
        hint: 'Idle',
      },
    ],
  },
  {
    id: 'navigation',
    label: 'Navigation',
    items: [
      {
        id: 'go-board',
        label: 'Go to Board',
        icon: <ArrowRightIcon aria-hidden />,
        kbd: '⌘1',
      },
      {
        id: 'go-settings',
        label: 'Go to Settings',
        icon: <ArrowRightIcon aria-hidden />,
        kbd: 'G S',
      },
    ],
  },
  {
    id: 'actions',
    label: 'Actions',
    items: [
      {
        id: 'c-new-task',
        label: 'New task',
        icon: <ZapIcon aria-hidden />,
        kbd: 'C',
      },
      {
        id: 'c-toggle-sidebar',
        label: 'Toggle sidebar',
        icon: <ZapIcon aria-hidden />,
        kbd: '[',
      },
    ],
  },
];

const ASK_HINT = (
  <>
    <span>Ask Overseer</span>
    <Kbd>Tab</Kbd>
  </>
);

// Fully controlled — same stateful-wrapper pattern the other primitive demos in
// galleryStories.tsx use — so typing actually filters and arrow keys actually move.
function SearchPanelDemo({
  groups,
  initialQuery = '',
  emptyHint,
}: {
  groups: SearchGroup[];
  initialQuery?: string;
  emptyHint: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  return (
    <div className="w-full max-w-[720px]">
      <SearchPanel
        query={query}
        onQueryChange={setQuery}
        groups={groups}
        onSelect={() => {}}
        emptyHint={emptyHint}
        inputHint={ASK_HINT}
      />
    </div>
  );
}

export const searchStories: GalleryStory[] = [
  {
    id: 'search-results',
    title: 'Search — command menu',
    note: '720px popover surface with a 12px radius and the half-pixel ring; a 40px input with the Ask Overseer Tab hint; 12px/500 sentence-case section headings; 40px rows with a 14px icon, a 13px/450 label, a muted sans id, and right keycaps. Arrow keys move the active row (bg-surface-active); Enter selects it.',
    render: () => (
      <SearchPanelDemo
        groups={SEARCH_GROUPS}
        emptyHint="Try another task id or title."
      />
    ),
  },
  {
    id: 'search-empty',
    title: 'Search — empty state',
    note: 'No group has a matching item: the EmptyState heading and the caller-supplied emptyHint, no chip-framed icon.',
    render: () => (
      <SearchPanelDemo
        groups={SEARCH_GROUPS}
        initialQuery="zzz-no-match"
        emptyHint="Try another task id or title."
      />
    ),
  },
];

import { useState } from 'react';

import {
  type RecordsColumn,
  type RecordsRow,
  type RecordsSort,
  RecordsTable,
  sortRows,
} from '@/ui/ai/records-table';
import type { GalleryStory } from '@/views/galleryStories';

const RECORDS_COLUMNS: RecordsColumn[] = [
  { key: 'title', label: 'Task', kind: 'text' },
  { key: 'tags', label: 'Tags', kind: 'tags' },
  { key: 'confidence', label: 'Confidence', kind: 'strength' },
  { key: 'lastRun', label: 'Last run', kind: 'time' },
];

// Six Dispatch-flavored tasks covering every cell kind and its edge states: many tags vs.
// none, a very recent run vs. a missing one, and the full 0-3 range of the strength meter.
const RECORDS_ROWS: RecordsRow[] = [
  {
    id: 't-716d89',
    cells: {
      title: 'Rework the kanban columns',
      tags: ['ui', 'kanban'],
      lastRun: '2026-08-11T06:30:00.000Z',
      confidence: 3,
    },
  },
  {
    id: 't-cafe27',
    cells: {
      title: 'Boot force-fail must say why',
      tags: ['dispatchd', 'boot'],
      lastRun: '2026-08-10T09:15:00.000Z',
      confidence: 2,
    },
  },
  {
    id: 't-2dfa1d',
    cells: {
      title: 'See all agents that are working',
      tags: ['agents', 'overview'],
      lastRun: '2026-08-11T02:00:00.000Z',
      confidence: 1,
    },
  },
  {
    id: 'e-f00b6d',
    cells: {
      title: 'Origin-first merges the queue',
      tags: ['merge-queue'],
      lastRun: '2026-08-02T12:00:00.000Z',
      confidence: 0,
    },
  },
  {
    id: 't-17-records',
    cells: {
      title: 'Records table primitive',
      tags: ['ui', 'primitives', 'gallery'],
      lastRun: '2026-08-11T07:58:00.000Z',
      confidence: 3,
    },
  },
  {
    id: 't-overseer',
    cells: {
      title: 'Overseer front and center',
      tags: [],
      lastRun: undefined,
      confidence: 2,
    },
  },
];

// The CRM-style demo: header row on, sortable, rows selectable. The table is fully
// controlled — the same stateful-wrapper pattern the other gallery demos use — so the header
// chevrons re-sort and the checkboxes tick.
function RecordsTableDemo() {
  const [sort, setSort] = useState<RecordsSort>({
    key: 'lastRun',
    dir: 'desc',
  });
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  return (
    <RecordsTable
      columns={RECORDS_COLUMNS}
      rows={sortRows(RECORDS_ROWS, RECORDS_COLUMNS, sort)}
      sort={sort}
      onSortChange={setSort}
      showHeader
      selectable
      selectedIds={selected}
      onToggleSelect={(id) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (!next.delete(id)) next.add(id);
          return next;
        })
      }
      onRowClick={() => {}}
    />
  );
}

// The Linear default: no header, rows straight on the panel, one tinted group bar.
function RecordsListDemo() {
  return (
    <RecordsTable
      columns={RECORDS_COLUMNS}
      groups={[
        {
          key: 'working',
          name: 'In progress',
          tint: 'var(--status-progress)',
          rows: RECORDS_ROWS.slice(0, 3),
          onToggle: () => {},
          onAdd: () => {},
        },
        {
          key: 'ready',
          name: 'Ready',
          tint: 'var(--status-todo)',
          rows: RECORDS_ROWS.slice(3),
          onToggle: () => {},
          onAdd: () => {},
        },
      ]}
      sort={null}
      onRowClick={() => {}}
    />
  );
}

export const recordsTableStories: GalleryStory[] = [
  {
    id: 'records-table-tasks',
    title: 'Records table — CRM header',
    note: 'showHeader on: a 36px label row with sort chevrons (click a header to cycle asc/desc/off) over 36px ListRows with a hover-only checkbox. Tags are label pills (none renders nothing), time is the absolute `Aug 11`, strength the 0-3 meter.',
    render: () => <RecordsTableDemo />,
  },
  {
    id: 'records-table-groups',
    title: 'Records table — grouped, no header',
    note: 'The default: no card, no header row, no dividers; status-tinted 36px GroupHeaders with a hover-only chevron and a + on the right.',
    render: () => <RecordsListDemo />,
  },
];

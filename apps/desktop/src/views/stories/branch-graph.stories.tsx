import { BranchGraph } from '@/components/graph/BranchGraph';
import type { DagTask } from '@/lib/dagLayout';
import type { GalleryStory } from '@/views/galleryStories';

function task(
  id: string,
  title: string,
  status: string,
  created: string,
  blockedBy: string[] = []
): DagTask {
  return { id, title, status, created, blockedBy };
}

// Five tasks in one straight line: two landed, then the open remainder. Everything sits on
// the trunk, so the story isolates the done-vs-path muting and the filled/ring dot pair.
const linearChain: DagTask[] = [
  task('t-a1f2c3', 'Add the branch layout engine', 'landed', '2026-09-01'),
  task('t-b2e4d5', 'Draw the gutter SVG', 'landed', '2026-09-02', ['t-a1f2c3']),
  task('t-c3d6e7', 'Wire the Branches tab', 'ready', '2026-09-03', [
    't-b2e4d5',
  ]),
  task('t-d4c8f9', 'Keyboard navigation between lines', 'ready', '2026-09-04', [
    't-c3d6e7',
  ]),
  task('t-e5b0a1', 'Gallery story for the graph', 'draft', '2026-09-05', [
    't-d4c8f9',
  ]),
];

// A → B, A → C, B,C → D with C already landed: C forks onto lane 1, merges back into D and
// reads muted, while the unfinished B→D chain is the strong trunk.
const diamondSideDone: DagTask[] = [
  task('t-f6a1b2', 'Model attachments on the task', 'landed', '2026-09-01'),
  task('t-a7b2c3', 'Daemon routes for attachments', 'ready', '2026-09-02', [
    't-f6a1b2',
  ]),
  task('t-b8c3d4', 'Client methods for attachments', 'landed', '2026-09-02', [
    't-f6a1b2',
  ]),
  task('t-c9d4e5', 'Attachments row on the task page', 'ready', '2026-09-03', [
    't-a7b2c3',
    't-b8c3d4',
  ]),
];

// Two chains that never touch, interleaved by created date the way a real log is. The longer
// one is the critical path and carries a working task (filled dot plus halo); the shorter
// forks onto lane 1 and stays muted for its whole height.
const twoChainsWorking: DagTask[] = [
  task('t-d0e5f6', 'Saved views model', 'landed', '2026-09-01'),
  task('t-e1f6a7', 'Label picker on the rail', 'ready', '2026-09-02'),
  task('t-f2a7b8', 'Favorites in the sidebar', 'working', '2026-09-03', [
    't-d0e5f6',
  ]),
  task('t-a3b8c9', 'Labels on list rows and cards', 'ready', '2026-09-04', [
    't-e1f6a7',
  ]),
  task('t-b4c9d0', 'Swim lanes by priority', 'ready', '2026-09-05', [
    't-f2a7b8',
  ]),
  task('t-c5d0e1', 'Persist the Display popover', 'ready', '2026-09-06', [
    't-b4c9d0',
  ]),
];

/** Gallery stories for `BranchGraph`: three plain `DagTask` fixtures so the dot, lane and
 * muting treatment can be tuned without a live project. */
export const branchGraphStories: GalleryStory[] = [
  {
    id: 'branch-graph-linear-chain',
    title: 'Branch graph — linear chain',
    note: 'Five tasks on the trunk alone. The two landed tasks draw a filled dot and a thin muted line; the open remainder is the strong critical path with ring dots, ending in a draft.',
    render: () => (
      <BranchGraph
        tasks={linearChain}
        onOpenNode={() => {}}
        ariaLabel="Linear chain"
      />
    ),
  },
  {
    id: 'branch-graph-diamond-side-done',
    title: 'Branch graph — diamond, side branch done',
    note: 'A fork and a merge. The landed side task sits on lane 1 a size down, muted, and merges back with a bezier; the unfinished chain keeps the trunk at full weight.',
    render: () => (
      <BranchGraph
        tasks={diamondSideDone}
        onOpenNode={() => {}}
        ariaLabel="Diamond with one side branch done"
      />
    ),
  },
  {
    id: 'branch-graph-two-chains-working',
    title: 'Branch graph — two chains, working task on the path',
    note: 'Two independent chains interleaved by date. The longer chain is the path and carries a working task with the live halo; the shorter chain holds lane 1 for its whole span and never joins.',
    render: () => (
      <BranchGraph
        tasks={twoChainsWorking}
        onOpenNode={() => {}}
        ariaLabel="Two independent chains"
      />
    ),
  },
];

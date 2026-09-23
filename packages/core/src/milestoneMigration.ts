// The one-time move from the legacy free-form `milestone` string to Linear's
// hierarchy: each distinct value becomes one `kind: 'project'` task, and the
// unparented tasks carrying it are reparented under that project.
//
// Idempotent: a project is found again by kind + title, and a task already
// under its project is left alone, so a second run creates and moves nothing.
// Non-destructive: the `milestone` field itself is kept on every task.
import { isValidParentKind } from './kinds.js';
import type { TaskStorePort } from './store.js';
import type { TaskDoc } from './types.js';

export interface MilestoneMigrationOptions {
  /** Compute the report without writing anything. */
  dryRun?: boolean;
  /** Status a new project starts in (the project's ready role). */
  status?: string;
  /** Credited as each new project's creator. */
  creator?: string | null;
  now?: string;
}

export interface MilestoneProject {
  /** The legacy milestone value, trimmed. */
  name: string;
  /** The project task's id; null for one a dry run would create. */
  projectId: string | null;
  created: boolean;
}

export interface MilestoneMigrationReport {
  dryRun: boolean;
  /** Tasks in the store before and after (after = before on a dry run). */
  tasksBefore: number;
  tasksAfter: number;
  projects: MilestoneProject[];
  /** Ids of projects created (empty on a dry run; see `projects`). */
  projectsCreated: string[];
  reparented: { id: string; milestone: string; parent: string | null }[];
  skipped: { id: string; milestone: string; reason: string }[];
  /** tasksAfter === tasksBefore + projects created (planned, on a dry run). */
  parity: boolean;
}

function milestoneOf(doc: TaskDoc): string | null {
  const name = doc.meta.milestone?.trim() ?? '';
  return name === '' ? null : name;
}

/** Runs (or rehearses) the milestone migration against `store`. */
export function migrateLegacyMilestones(
  store: TaskStorePort,
  options: MilestoneMigrationOptions = {}
): MilestoneMigrationReport {
  const dryRun = options.dryRun ?? false;
  const docs = store.list();
  const tasksBefore = docs.length;
  const existing = new Map<string, string>();
  for (const doc of docs) {
    if (doc.meta.kind === 'project' && !existing.has(doc.meta.title.trim())) {
      existing.set(doc.meta.title.trim(), doc.meta.id);
    }
  }

  const names = [
    ...new Set(docs.map(milestoneOf).filter((n): n is string => n !== null)),
  ];
  const projects: MilestoneProject[] = [];
  const projectIds = new Map<string, string | null>();
  for (const name of names) {
    const found = existing.get(name);
    if (found !== undefined) {
      projects.push({ name, projectId: found, created: false });
      projectIds.set(name, found);
      continue;
    }
    const projectId = dryRun
      ? null
      : store.create(
          {
            title: name,
            kind: 'project',
            ...(options.status === undefined ? {} : { status: options.status }),
            ...(options.creator == null ? {} : { creator: options.creator }),
            description: `Migrated from the legacy milestone "${name}".`,
          },
          options.now
        ).meta.id;
    projects.push({ name, projectId, created: true });
    projectIds.set(name, projectId);
  }

  const reparented: MilestoneMigrationReport['reparented'] = [];
  const skipped: MilestoneMigrationReport['skipped'] = [];
  for (const doc of docs) {
    const milestone = milestoneOf(doc);
    if (milestone === null) continue;
    const parent = projectIds.get(milestone) ?? null;
    const { id } = doc.meta;
    if (parent !== null && id === parent) continue;
    if (parent !== null && doc.meta.parent === parent) {
      skipped.push({ id, milestone, reason: 'already under its project' });
      continue;
    }
    if (doc.meta.parent !== null) {
      skipped.push({
        id,
        milestone,
        reason: `already has parent ${doc.meta.parent}`,
      });
      continue;
    }
    if (!isValidParentKind(doc.meta.kind, 'project')) {
      skipped.push({
        id,
        milestone,
        reason: `a ${doc.meta.kind} cannot sit under a project`,
      });
      continue;
    }
    if (!dryRun && parent !== null) {
      store.update(id, { parent }, options.now);
    }
    reparented.push({ id, milestone, parent });
  }

  const created = projects.filter((p) => p.created).length;
  const tasksAfter = dryRun ? tasksBefore : store.list().length;
  return {
    dryRun,
    tasksBefore,
    tasksAfter,
    projects,
    projectsCreated: projects.flatMap((p) =>
      p.created && p.projectId !== null ? [p.projectId] : []
    ),
    reparented,
    skipped,
    parity: dryRun ? true : tasksAfter === tasksBefore + created,
  };
}

/** The report as terminal text, parity first. */
export function formatMilestoneMigrationReport(
  report: MilestoneMigrationReport
): string {
  const created = report.projects.filter((p) => p.created).length;
  const lines = [
    `${report.dryRun ? 'Dry run: would migrate' : 'Migrated'} ${report.projects.length} legacy milestone(s).`,
    `Tasks: ${report.tasksBefore} before, ${report.dryRun ? `${report.tasksBefore + created} after (planned)` : `${report.tasksAfter} after`} — ${created} project(s) ${report.dryRun ? 'to create' : 'created'}. Parity: ${report.parity ? 'ok' : 'MISMATCH'}.`,
  ];
  for (const p of report.projects) {
    lines.push(
      `  ${p.created ? (report.dryRun ? 'new' : 'created') : 'found'} project ${p.projectId ?? '(new)'}: ${p.name}`
    );
  }
  lines.push(
    `Reparented ${report.reparented.length} task(s)${report.reparented.length === 0 ? '.' : ':'}`
  );
  for (const r of report.reparented) {
    lines.push(`  ${r.id} -> ${r.parent ?? `(new project "${r.milestone}")`}`);
  }
  lines.push(
    `Skipped ${report.skipped.length} task(s)${report.skipped.length === 0 ? '.' : ':'}`
  );
  for (const s of report.skipped) {
    lines.push(`  ${s.id} (${s.milestone}): ${s.reason}`);
  }
  return lines.join('\n');
}

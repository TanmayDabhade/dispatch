import { useMemo, useRef, useState } from 'react';

import { filesFromDataTransfer } from '../../../lib/attachments';
import { liveClaimsFrom } from '../../../lib/dispatchPreview';
import { dispatchReadiness } from '../../../lib/dispatchReadiness';
import { resolveExecuteModel } from '../../../lib/models';
import { isTerminalRunState } from '../../../lib/runState';
import { activeStatusModel } from '../../../lib/statusModel';
import {
  enrichDraftFromPlan,
  enrichPatch,
  enrichPlanError,
} from '../../../lib/taskEnrich';
import { PlanQuestionsForm } from '../../plans/PlanQuestionsForm';
import { EnrichReview } from '../EnrichReview';
import { SpecSection, TaskSpecView } from '../TaskSpecView';
import { AttachmentsRow, useAttachmentUpload } from './AttachmentsRow';
import { DispatchCard } from './DispatchCard';
import type { TaskPageModel } from './pageModel';
import { RelationsEditor } from './RelationsEditor';

/**
 * Spec mode — what a task is and whether it can go: the dispatch card with its readiness
 * checks up top, then the spec itself (TaskSpecView, editable in place), its dependencies,
 * attachments and amendments. The AI "Add detail" pass for a thin spec reviews its draft
 * here before anything is written.
 */
export function SpecMode({ page }: { page: TaskPageModel }) {
  const { item, project } = page;
  const meta = item.meta;
  const writesRef = useRef<HTMLDivElement>(null);
  const upload = useAttachmentUpload(project.client, meta.id);
  const [enrichStarted, setEnrichStarted] = useState(false);
  const [applyingEnrich, setApplyingEnrich] = useState(false);

  const liveRun = page.runs.find((r) => !isTerminalRunState(r.state));
  const liveClaims = useMemo(
    () => liveClaimsFrom(project.runs),
    [project.runs]
  );
  const readiness = dispatchReadiness({
    task: item,
    body: page.bodyLoaded
      ? { description: page.description, criteria: page.criteria }
      : null,
    tasksById: page.tasksById,
    model: activeStatusModel(),
    liveRun,
    reading: project.readinessById.get(meta.id),
    liveClaims,
  });

  // The enrich draft is app-level (it survives closing the page), so only this task's.
  const enrichPlan =
    project.enrichTaskId === meta.id ? project.enrichPlanRecord : undefined;
  const enrichDraft = enrichDraftFromPlan(enrichPlan);
  const enrichError = enrichPlanError(enrichPlan);
  const awaitingAnswer = (enrichPlan?.questions.length ?? 0) > 0;
  const enriching =
    enrichPlan?.state === 'running' ||
    (enrichStarted &&
      !awaitingAnswer &&
      enrichDraft === null &&
      enrichError === null);

  function enrich() {
    setEnrichStarted(true);
    project.handleEnrichTask(meta.id).catch((err: unknown) => {
      setEnrichStarted(false);
      page.fail('Could not start the draft', err);
    });
  }
  function dismissEnrich() {
    setEnrichStarted(false);
    project.handleDismissEnrich();
  }
  async function applyEnrich() {
    if (enrichDraft === null) return;
    setApplyingEnrich(true);
    try {
      await page.patch(enrichPatch(enrichDraft));
      dismissEnrich();
    } finally {
      setApplyingEnrich(false);
    }
  }

  const archived = meta.archivedAt !== undefined;
  const client = project.client;
  const config = project.config;

  // Files dropped or pasted anywhere on the spec attach to the task; a text paste is left
  // to whatever field has focus.
  const attachable = !archived && client !== null;
  function attach(dt: DataTransfer | null): boolean {
    if (!attachable) return false;
    const files = filesFromDataTransfer(dt);
    if (files.length === 0) return false;
    void upload.upload(files);
    return true;
  }

  return (
    <div
      data-slot="spec-mode"
      className="flex flex-col gap-4 pb-10"
      onDragOver={(e) => {
        if (attachable) e.preventDefault();
      }}
      onDrop={(e) => {
        if (attach(e.dataTransfer)) e.preventDefault();
      }}
      onPaste={(e) => {
        if (attach(e.clipboardData)) e.preventDefault();
      }}
    >
      <DispatchCard
        readiness={readiness}
        live={liveRun !== undefined}
        starting={page.dispatching}
        executors={project.executors ?? undefined}
        defaultModel={config === null ? undefined : resolveExecuteModel(config)}
        onDispatch={(executor, model) => void page.dispatch(executor, model)}
        onOpenRun={() => page.selectMode('run')}
        onOpenTask={page.openTask}
        onEnrich={enrich}
        enriching={enriching}
        onAddWrites={() => {
          const input = writesRef.current?.querySelector<HTMLInputElement>(
            'input[aria-label="Add a write path"]'
          );
          input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          input?.focus();
        }}
      />
      {enrichError !== null && (
        <p className="text-red font-book px-4 text-[12px]">{enrichError}</p>
      )}
      {enrichPlan !== undefined && awaitingAnswer && client !== null && (
        <div className="px-4">
          <PlanQuestionsForm
            questions={enrichPlan.questions}
            disabled={enrichPlan.state === 'running'}
            onSend={async (message) => {
              await client.sendPlanMessage(enrichPlan.id, message);
            }}
          />
        </div>
      )}
      {enrichDraft !== null && (
        <div className="px-4">
          <EnrichReview
            draft={enrichDraft}
            applying={applyingEnrich}
            onApply={() => void applyEnrich()}
            onDiscard={dismissEnrich}
          />
        </div>
      )}

      <div ref={writesRef}>
        <TaskSpecView
          header={null}
          spec={{
            title: meta.title,
            status: meta.status,
            priority: meta.priority,
            description: page.description,
            acceptanceCriteria: page.criteria,
            writes: meta.writes,
            risk: meta.risk,
            blockedBy: [],
          }}
          editing={{
            loading: !page.bodyLoaded,
            description: page.description,
            acceptance: page.acceptance,
            onSaveDescription: (description) =>
              void page.patch({ description }),
            onSaveAcceptance: (acceptanceCriteria) =>
              void page.patch({ acceptanceCriteria }),
            onSaveWrites: (writes) => void page.patch({ writes }),
          }}
          dependencies={
            <SpecSection label="Dependencies">
              <RelationsEditor
                item={item}
                tasks={project.tasksIncludingArchived}
                tasksById={page.tasksById}
                model={activeStatusModel()}
                onPatch={(patch) => void page.patch(patch)}
                onOpenTask={page.openTask}
              />
            </SpecSection>
          }
        >
          <SpecSection label="Attachments">
            <AttachmentsRow
              taskId={meta.id}
              attachments={meta.attachments ?? []}
              client={client}
              port={project.port}
              editable={!archived}
              upload={upload.upload}
              uploading={upload.uploading}
            />
          </SpecSection>
          {page.amendments !== '' && (
            <SpecSection label="Amendments">
              <p className="text-muted-foreground font-book text-[13px] whitespace-pre-wrap">
                {page.amendments}
              </p>
            </SpecSection>
          )}
        </TaskSpecView>
      </div>
    </div>
  );
}

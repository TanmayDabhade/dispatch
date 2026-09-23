import { commentInputError, FileCommentStore } from '@dispatch/core';
import type { CommentStorePort } from '@dispatch/core';

import type { ApiContext } from '../api.js';
import { humanActor } from './caller.js';
import { errorResponse, jsonResponse, readJsonBody } from './http.js';

// The comment routes under /api/tasks/:id/comments. Comments are records of
// their own (core's comments.ts), so a write broadcasts `comment.changed`,
// never `task.changed`: a new comment does not refetch the board.

type CommentRouteContext = Pick<
  ApiContext,
  'rootDir' | 'store' | 'events' | 'commentStore' | 'caller' | 'actorContext'
>;

// The daemon passes the backend's store; a hand-built test context without
// one gets the file store, which is what a files-backed project uses.
function commentsOf(ctx: CommentRouteContext): CommentStorePort {
  return ctx.commentStore ?? new FileCommentStore(ctx.rootDir);
}

function taskMissing(ctx: CommentRouteContext, taskId: string): boolean {
  return ctx.store.get(taskId) === null;
}

// GET /api/tasks/:id/comments — the thread, oldest first.
export function listComments(
  ctx: CommentRouteContext,
  taskId: string
): Response {
  if (taskMissing(ctx, taskId)) {
    return errorResponse(404, `task not found: ${taskId}`);
  }
  return jsonResponse(commentsOf(ctx).list(taskId));
}

// POST /api/tasks/:id/comments — `{ body, parentId?, external?, author?,
// created? }`. `author` defaults to whoever made the request; a sync naming
// someone else's comment passes it (and its `created`) explicitly.
export async function addComment(
  req: Request,
  ctx: CommentRouteContext,
  taskId: string
): Promise<Response> {
  if (taskMissing(ctx, taskId)) {
    return errorResponse(404, `task not found: ${taskId}`);
  }
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value as Record<string, unknown>;
  const bodyError = commentInputError(body.body);
  if (bodyError !== null) return errorResponse(400, bodyError);
  for (const key of ['parentId', 'external', 'author', 'created'] as const) {
    const value = body[key];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return errorResponse(400, `invalid ${key}: expected a string`);
    }
  }
  const comments = commentsOf(ctx);
  const parentId = (body.parentId as string | null | undefined) ?? null;
  if (parentId !== null && comments.get(taskId, parentId) === null) {
    return errorResponse(400, `invalid parentId: no comment ${parentId}`);
  }
  const comment = comments.add({
    taskId,
    author: (body.author as string | undefined) ?? humanActor(ctx),
    body: body.body as string,
    parentId,
    external: (body.external as string | null | undefined) ?? null,
    ...(typeof body.created === 'string' ? { created: body.created } : {}),
  });
  ctx.events.broadcast({
    type: 'comment.changed',
    taskId,
    commentIds: [comment.id],
  });
  return jsonResponse(comment, 201);
}

// PATCH /api/tasks/:id/comments/:commentId — `{ body?, external? }`.
export async function updateComment(
  req: Request,
  ctx: CommentRouteContext,
  taskId: string,
  commentId: string
): Promise<Response> {
  const comments = commentsOf(ctx);
  if (comments.get(taskId, commentId) === null) {
    return errorResponse(404, `comment not found: ${commentId}`);
  }
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value as Record<string, unknown>;
  if (body.body !== undefined) {
    const bodyError = commentInputError(body.body);
    if (bodyError !== null) return errorResponse(400, bodyError);
  }
  if (
    body.external !== undefined &&
    body.external !== null &&
    typeof body.external !== 'string'
  ) {
    return errorResponse(400, 'invalid external: expected a string or null');
  }
  const comment = comments.update(taskId, commentId, {
    ...(body.body === undefined ? {} : { body: body.body as string }),
    ...(body.external === undefined ? {} : { external: body.external }),
  });
  ctx.events.broadcast({
    type: 'comment.changed',
    taskId,
    commentIds: [commentId],
  });
  return jsonResponse(comment);
}

// DELETE /api/tasks/:id/comments/:commentId — removes it and its replies.
export function deleteComment(
  ctx: CommentRouteContext,
  taskId: string,
  commentId: string
): Response {
  const removed = commentsOf(ctx).remove(taskId, commentId);
  if (removed.length === 0) {
    return errorResponse(404, `comment not found: ${commentId}`);
  }
  ctx.events.broadcast({
    type: 'comment.changed',
    taskId,
    commentIds: removed,
  });
  return jsonResponse({ removed });
}

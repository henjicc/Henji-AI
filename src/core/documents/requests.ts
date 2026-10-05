import { z } from 'zod'

import { documentIdSchema } from './envelope'
import {
  DOCUMENT_KIND_IDS,
  type CreateDocumentRequest,
  type CreateProjectRequest,
  type DocumentContainerFilter,
  type DocumentContainerRef,
  type DocumentLink,
  type DocumentListQuery,
  type DocumentSessionStateKey,
  type DocumentTarget,
  type DuplicateDocumentRequest,
  type FinalizeDocumentRequest,
  type FinalizeProjectRequest,
  type ImportFileRequest,
  type MoveDocumentRequest,
  type NameCheckRequest,
  type ProjectListQuery,
  type RenameDocumentRequest,
  type RenameProjectRequest,
  type SaveDocumentCoverRequest,
  type SaveDocumentRequest,
  type SetProjectMainDocumentRequest,
  type WriteDocumentSessionStateRequest,
} from './types'

/*
 * 文档接口的请求校验（主进程 IPC 入口使用；与 types.ts 的接口逐一对应）。
 * 路径在这里只做通用检查，是否为绝对路径、是否位于允许的位置由主进程按平台判断。
 */

const pathSchema = z.string().min(1).max(32_767).refine((value) => !value.includes('\0'), '路径无效。')
const nameSchema = z.string().max(1_024)
const kindSchema = z.enum(DOCUMENT_KIND_IDS)

export const containerRefSchema: z.ZodType<DocumentContainerRef> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user') }).strict(),
  z.object({ kind: z.literal('project'), projectId: documentIdSchema }).strict(),
])

const containerFilterSchema: z.ZodType<DocumentContainerFilter> = z.union([
  z.object({ kind: z.literal('any') }).strict(),
  containerRefSchema,
])

export const documentTargetSchema: z.ZodType<DocumentTarget> = z.object({
  id: documentIdSchema,
  path: pathSchema.optional(),
}).strict()

const conflictSchema = z.enum(['fail', 'keepBoth'])

export const documentListQuerySchema: z.ZodType<DocumentListQuery> = z.object({
  kind: kindSchema.optional(),
  container: containerFilterSchema.optional(),
  includeDrafts: z.boolean().optional(),
  includeMissing: z.boolean().optional(),
}).strict()

export const projectListQuerySchema: z.ZodType<ProjectListQuery> = z.object({
  includeDrafts: z.boolean().optional(),
  includeMissing: z.boolean().optional(),
}).strict()

export const createDocumentRequestSchema: z.ZodType<CreateDocumentRequest> = z.object({
  kind: kindSchema,
  container: containerRefSchema,
  content: z.unknown().optional(),
  name: nameSchema.optional(),
  draft: z.boolean().optional(),
  id: documentIdSchema.optional(),
}).strict()

export const saveDocumentRequestSchema: z.ZodType<SaveDocumentRequest> = z.object({
  target: documentTargetSchema,
  expectedRevision: z.number().int().nonnegative(),
  content: z.unknown().refine((value) => value !== undefined, '缺少文档内容。'),
  force: z.boolean().optional(),
}).strict()

export const renameDocumentRequestSchema: z.ZodType<RenameDocumentRequest> = z.object({
  target: documentTargetSchema,
  name: nameSchema,
}).strict()

export const finalizeDocumentRequestSchema: z.ZodType<FinalizeDocumentRequest> = z.object({
  target: documentTargetSchema,
  name: nameSchema,
  folder: pathSchema.optional(),
}).strict()

export const moveDocumentRequestSchema: z.ZodType<MoveDocumentRequest> = z.object({
  target: documentTargetSchema,
  container: containerRefSchema,
  onConflict: conflictSchema.optional(),
}).strict()

export const duplicateDocumentRequestSchema: z.ZodType<DuplicateDocumentRequest> = z.object({
  target: documentTargetSchema,
  name: nameSchema.optional(),
  onConflict: conflictSchema.optional(),
}).strict()

export const nameCheckRequestSchema: z.ZodType<NameCheckRequest> = z.object({
  subject: z.discriminatedUnion('type', [
    z.object({ type: z.literal('project') }).strict(),
    z.object({ type: z.literal('document'), kind: kindSchema }).strict(),
  ]),
  name: nameSchema,
  location: z.union([
    z.object({ container: containerRefSchema }).strict(),
    z.object({ folder: pathSchema }).strict(),
    z.object({ renaming: pathSchema }).strict(),
  ]),
}).strict()

export const documentLinkSchema: z.ZodType<DocumentLink> = z.object({
  docId: documentIdSchema,
  path: pathSchema,
}).strict()

export const saveDocumentCoverRequestSchema: z.ZodType<SaveDocumentCoverRequest> = z.object({
  docId: documentIdSchema,
  sources: z.array(z.object({
    source: z.string().min(1).max(64 * 1024 * 1024),
    sourceKind: z.enum(['image', 'video']),
  }).strict()).min(1).max(4),
}).strict()

export const createProjectRequestSchema: z.ZodType<CreateProjectRequest> = z.object({
  name: nameSchema.optional(),
  draft: z.boolean().optional(),
}).strict()

export const renameProjectRequestSchema: z.ZodType<RenameProjectRequest> = z.object({
  projectId: documentIdSchema,
  name: nameSchema,
}).strict()

export const finalizeProjectRequestSchema: z.ZodType<FinalizeProjectRequest> = z.object({
  projectId: documentIdSchema,
  name: nameSchema,
  parentFolder: pathSchema.optional(),
}).strict()

export const projectIdRequestSchema = z.object({ projectId: documentIdSchema }).strict()
export const documentIdRequestSchema = z.object({ docId: documentIdSchema }).strict()
export const pathRequestSchema = z.object({ path: pathSchema }).strict()

export const setProjectMainDocumentRequestSchema: z.ZodType<SetProjectMainDocumentRequest> = z.object({
  projectId: documentIdSchema,
  documentId: documentIdSchema.nullable(),
}).strict()

export const importFileRequestSchema: z.ZodType<ImportFileRequest> = z.object({
  container: containerRefSchema,
  sourcePath: pathSchema,
  folder: z.enum(['generated', 'materials']),
}).strict()

/** 会话状态的键：小写字母、数字与 . _ - ，由工具自己约定（如 `canvas.history`）。 */
const sessionStateKeySchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, '会话状态键无效。')

export const documentSessionStateKeySchema: z.ZodType<DocumentSessionStateKey> = z.object({
  docId: documentIdSchema,
  key: sessionStateKeySchema,
}).strict()

export const writeDocumentSessionStateRequestSchema: z.ZodType<WriteDocumentSessionStateRequest> = z.object({
  docId: documentIdSchema,
  key: sessionStateKeySchema,
  value: z.unknown(),
}).strict()

import type { ContentTrustReference } from '../../contentTrust'
import { z } from 'zod'
import { documentTargetSchema } from '../../documents/requests'
import { codeFilePathSchema, codeSourceTextSchema } from './sources'
import type { CodeFileReference } from './sources'

/** Author-owned paths; software bookkeeping and Git internals are never editable here. */
export const codeProjectPathSchema = z.string().min(1).refine(value =>
  (codeFilePathSchema.safeParse(value).success || /^[a-zA-Z0-9_\-.\u3400-\u9fff/]+\.(?:md|txt)$/.test(value))
  && value.split('/').every(part => part && part !== '.' && part !== '..' && part.toLowerCase() !== '.git')
  && !/^(?:legacy|素材|组件)(?:\/|$)/i.test(value),
'path 必须是工程内相对源码、JSON、着色器、md 或 txt 路径；不能进入 .git、legacy、素材、组件。')
export const codeProjectReadSchema = z.object({ target: documentTargetSchema }).strict()
export const codeProjectChangeSchema = z.object({
  target: documentTargetSchema, message: z.string().trim().min(1).max(2000),
  changes: z.array(z.object({ path: codeProjectPathSchema, source: codeSourceTextSchema.nullable(), expectedHash: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict()).min(1),
}).strict()
export const codeProjectCommitSchema = z.object({ target: documentTargetSchema, message: z.string().trim().min(1).max(2000) }).strict()
export const codeProjectResolveSchema = z.object({ target: documentTargetSchema, entry: codeFilePathSchema, commit: z.string().regex(/^[a-f0-9]{40}$/).optional() }).strict()
export type CodeProjectResolve = z.infer<typeof codeProjectResolveSchema>
export interface CodeProjectClosure { foreign?: ContentTrustReference; commit: string; entry: string; files: CodeFileReference[] }
export type CodeProjectChange = z.infer<typeof codeProjectChangeSchema>
export interface CodeProjectFile { path: string; source: string; hash: string; bytes: number }
export interface CodeProjectState {
  head: string | null
  files: CodeProjectFile[]
  tree: { path: string; bytes: number }[]
  log: { oid: string; message: string; time: string; paths: string[] }[]
  changes: { path: string; kind: 'added' | 'modified' | 'deleted' }[]
}

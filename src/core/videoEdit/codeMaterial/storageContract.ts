import { z } from 'zod'
import { documentTargetSchema } from '../../documents/requests'
import { codeMaterialFilesSchema, codeSourceHashSchema, codeComponentPinsSchema } from './sources'
import { codeComponentNameSchema } from './components'
import type { DocumentTransferResult } from '../../documents/types'

export interface MigrateCodeStorageResult {
  documents: DocumentTransferResult[]
  importedVersions: number
  archivedFolders: number
  retainedFolders: number
}

export const writeCodeVersionRequestSchema = z.object({ target: documentTargetSchema, definitionId: z.string().min(1).max(100), name: z.string().min(1).max(200), folder: z.string().min(1).optional(), contents: codeMaterialFilesSchema }).strict()
export const readCodeFileRequestSchema = z.object({ location: z.string().min(1), hash: codeSourceHashSchema, path: z.string().min(1) }).strict()
export const publishCodeComponentRequestSchema = z.object({ target: documentTargetSchema, name: codeComponentNameSchema, source: z.string(), description: z.string(), exports: z.array(z.string()), imports: codeComponentPinsSchema, keepBoth: z.boolean().optional() }).strict()
export type WriteCodeVersionRequest = z.infer<typeof writeCodeVersionRequestSchema>
export type PublishCodeComponentRequest = z.infer<typeof publishCodeComponentRequestSchema>

export const withdrawCodeComponentRequestSchema = z.object({ target: documentTargetSchema, location: z.string().min(1), hash: codeSourceHashSchema }).strict()
export type WithdrawCodeComponentRequest = z.infer<typeof withdrawCodeComponentRequestSchema>

export const discardCodeFilesRequestSchema = z.object({ files: z.array(readCodeFileRequestSchema), retainedLocations: z.array(z.string()) }).strict()
export type DiscardCodeFilesRequest = z.infer<typeof discardCodeFilesRequestSchema>

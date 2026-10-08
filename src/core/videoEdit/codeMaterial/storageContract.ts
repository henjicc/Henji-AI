import { z } from 'zod'
import { documentTargetSchema } from '../../documents/requests'
import { codeMaterialFilesSchema, codeSourceHashSchema, codeComponentPinsSchema } from './sources'
import { codeComponentNameSchema } from './components'

export const writeCodeVersionRequestSchema = z.object({ target: documentTargetSchema, definitionId: z.string().min(1).max(100), name: z.string().min(1).max(200), folder: z.string().min(1).optional(), contents: codeMaterialFilesSchema }).strict()
export const readCodeFileRequestSchema = z.object({ location: z.string().min(1), hash: codeSourceHashSchema, path: z.string().min(1) }).strict()
export const publishCodeComponentRequestSchema = z.object({ target: documentTargetSchema, name: codeComponentNameSchema, source: z.string(), description: z.string(), exports: z.array(z.string()), imports: codeComponentPinsSchema, keepBoth: z.boolean().optional() }).strict()
export type WriteCodeVersionRequest = z.infer<typeof writeCodeVersionRequestSchema>
export type PublishCodeComponentRequest = z.infer<typeof publishCodeComponentRequestSchema>

export const withdrawCodeComponentRequestSchema = z.object({ target: documentTargetSchema, location: z.string().min(1), hash: codeSourceHashSchema }).strict()
export type WithdrawCodeComponentRequest = z.infer<typeof withdrawCodeComponentRequestSchema>

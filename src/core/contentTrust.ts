import { z } from 'zod'
import { ApplicationPreflightFailure } from './application-control/execution/transactionFailure'

export const EXTERNAL_CONTENT_CODE_SETTING_KEY = 'general.allow_external_content_code'

export const contentSourceTypeSchema = z.enum(['style_package', 'template', 'project', 'document_package', 'code_asset', 'web_recording', 'skill'])
export const contentTrustReferenceSchema = z.object({ id: z.string(), sourceType: contentSourceTypeSchema, sourceName: z.string() }).strict()
export type ContentTrustReference = z.infer<typeof contentTrustReferenceSchema>
export const foreignContentSchema = contentTrustReferenceSchema
export const contentTrustQuerySchema = z.object({ contents: z.array(contentTrustReferenceSchema) }).strict()
export type ContentTrustQuery = z.infer<typeof contentTrustQuerySchema>
export const contentTrustFailureSchema = z.object({ state: z.enum(['awaiting_user_confirmation', 'denied']), records: z.array(contentTrustReferenceSchema) })
export type ContentTrustFailure = z.infer<typeof contentTrustFailureSchema>
export const contentTrustCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('prepare'), sourceType: z.enum(['web_recording', 'skill']), id: z.string() }).strict(),
  z.object({ action: z.literal('check'), query: contentTrustQuerySchema }).strict(),
  z.object({ action: z.literal('policy') }).strict(),
  z.object({ action: z.literal('set-policy'), allow: z.boolean() }).strict(),
  z.object({ action: z.literal('decide'), challenge: z.string(), decision: z.enum(['once', 'always', 'deny']) }).strict(),
  z.object({ action: z.literal('retry'), records: z.array(contentTrustReferenceSchema) }).strict(),
])
export type ContentTrustCommand = z.input<typeof contentTrustCommandSchema>
export interface ContentTrustCheck { records: ContentTrustReference[]; state: 'allowed' | ContentTrustFailure['state']; allowExternalContentCode: boolean; challenge?: string }
export interface ContentTrustPrompt { query: ContentTrustQuery }
export function readContentTrustFailure(error: unknown): ContentTrustFailure | undefined {
  const seen = new Set<object>()
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error)
    const parsed = contentTrustFailureSchema.safeParse('contentTrust' in error ? error.contentTrust : undefined)
    if (parsed.success) return parsed.data
    error = 'cause' in error ? error.cause : undefined
  }
  return undefined
}
export class ContentTrustRequiredError extends ApplicationPreflightFailure {
  readonly contentTrust: ContentTrustFailure
  constructor(readonly state: ContentTrustFailure['state'] = 'awaiting_user_confirmation', records: readonly ContentTrustReference[] = []) {
    super(state === 'denied' ? '这份内容里的代码尚未运行。' : '这份内容包含代码，正在等待用户确认。')
    this.name = 'ContentTrustRequiredError'
    this.contentTrust = { state, records: records.map(record => contentTrustReferenceSchema.parse(record)) }
  }
}
export function restoreContentTrustError(error: Error, failure: unknown): Error {
  const parsed = contentTrustFailureSchema.safeParse(failure)
  return parsed.success ? new ContentTrustRequiredError(parsed.data.state, parsed.data.records) : error
}

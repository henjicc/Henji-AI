import type { ContentTrustQuery } from '../core/contentTrust'

interface ContentTrustConfirmation {
  ensure(query: ContentTrustQuery, signal?: AbortSignal): Promise<void>
  prepare(type: 'web_recording' | 'skill', id: string, signal?: AbortSignal): Promise<void>
}
let confirmation: ContentTrustConfirmation | undefined
export function installContentTrustConfirmation(value: ContentTrustConfirmation): void { confirmation = value }
export function contentTrustConfirmation(): ContentTrustConfirmation {
  if (!confirmation) throw new Error('信任确认尚未就绪，代码尚未运行。')
  return confirmation
}

import type { ContentTrustReference } from '@/core/contentTrust'
import type { CodeAuthorBundle } from '@/core/videoEdit/codeAuthorProgram'

export interface AuthorTrustRequest { context?: ContentTrustReference[]; url?: string }
let check: ((request: AuthorTrustRequest) => Promise<void>) | undefined
export function installAuthorTrustGate(gate: (request: AuthorTrustRequest) => Promise<void>): void { check = gate }
/** 所有原生 import 都经过这里，包括声明读取；Worker 不持有用户选择或批准入口。 */
export async function assertAuthorTrust(request: AuthorTrustRequest): Promise<void> {
  if (!check) throw new Error('代码信任检查尚未就绪，代码尚未运行。')
  await check(request)
}
const sourceIdentities = new Map<string, ContentTrustReference[]>()
export function rememberAuthorTrustUrl(url: string, bundle: CodeAuthorBundle): () => void {
  sourceIdentities.set(url, bundle.trustContext ?? [])
  return () => { sourceIdentities.delete(url) }
}
export function authorTrustContext(url: string): ContentTrustReference[] | undefined { return sourceIdentities.get(url) }

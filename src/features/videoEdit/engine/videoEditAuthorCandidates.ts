import type { CodeAuthorBundle } from '@/core/videoEdit/codeAuthorProgram'
import { CODE_AUTHOR_SHAPED_TEXT_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
import { loadAuthorModule, type AuthorModule } from './videoEditAuthorModule'
import { authorEffectMetadata, type AuthorEffectMetadata } from './videoEditAuthorParameters'
import { prepareAuthorModuleUrls } from './videoEditAuthorModules'

const candidates = new Map<string, Promise<AuthorModule>>()

/** 参数探测只执行已完成资源准备的模块，不为读取声明创建 GPU 合成器。 */
export function loadAuthorCandidate(url: string, bundle?: CodeAuthorBundle, apiVersion: number | undefined = bundle?.apiVersion): Promise<AuthorModule> {
  let pending = candidates.get(url)
  if (!pending) {
    pending = (async () => {
      const urls = bundle ? await prepareAuthorModuleUrls(bundle) : undefined
      try {
        const effect = await loadAuthorModule(urls?.url ?? url, bundle?.trustContext, apiVersion, bundle)
        const dispose = effect.dispose
        effect.dispose = async () => { try { await dispose?.() } finally { urls?.dispose() } }
        return effect
      } catch (error) { urls?.dispose(); throw error }
    })().catch(error => { if (candidates.get(url) === pending) candidates.delete(url); throw error })
    candidates.set(url, pending)
  }
  return pending
}
export async function readAuthorCandidateMetadata(url: string, apiVersion?: number, bundle?: CodeAuthorBundle): Promise<AuthorEffectMetadata> {
  if ((apiVersion ?? 4) >= CODE_AUTHOR_SHAPED_TEXT_MIN_API_VERSION && !bundle) throw new Error(`作者 API ${apiVersion} 参数探测需要完整编译产物`)
  return structuredClone(authorEffectMetadata(await loadAuthorCandidate(url, bundle, apiVersion), apiVersion))
}
export async function releaseAuthorCandidate(url: string): Promise<void> {
  const pending = candidates.get(url)
  candidates.delete(url)
  await (await pending)?.dispose?.()
}
export async function closeAuthorCandidates(): Promise<void> {
  const results = await Promise.allSettled([...candidates.keys()].map(releaseAuthorCandidate))
  const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
  if (errors.length) throw new AggregateError(errors, '候选作者模块释放失败')
}

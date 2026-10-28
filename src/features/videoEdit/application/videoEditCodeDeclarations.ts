import type { VideoEditCodeDeclarationReader } from '@/core/videoEdit/codeInputParameters'
import { ensureVideoEditCodeParameterMetadata, readVideoEditCodeMetadata, VideoEditCodeMetadataPending } from './videoEditCodeState'
import type { VideoEditInstance } from './videoEditService'

/** 读不出声明（源码缺失或编译不过）以后，隔这么久才在后台重读一次：失败可能是暂时的，但不能每次重绘都触发一次编译。 */
const RETRY_UNREADABLE_MS = 30_000
interface Failure { at: number; retrying: boolean }
const unreadable = new WeakMap<VideoEditInstance, Map<string, Failure>>()
const listeners = new Set<() => void>()
/** 读不出声明的版本在后台重读成功时通知：用它算的结果（预渲染分段指纹）要从“整份计入”换回按时段计入。 */
export function subscribeVideoEditCodeDeclarations(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }

function retry(owner: VideoEditInstance, versionId: string, definitionId: string, failure: Failure): void {
  failure.retrying = true
  void ensureVideoEditCodeParameterMetadata(owner, owner.document, definitionId, versionId).then(() => {
    unreadable.get(owner)?.delete(versionId)
    for (const listener of listeners) listener()
  }, () => { failure.at = performance.now(); failure.retrying = false })
}

/**
 * 应用层给片子数据解析用的代码声明读取器（预渲染分段指纹、运动审查的画面输入等）：只有引用片子数据的代码才会读。
 * 第一次读取时抛出 VideoEditCodeMetadataPending，调用方等它读好（读好以前的指纹不能拿来回收或渲染文件）。
 * 读不出来时返回 undefined，调用方按“说不清”退回整份计入。之后一直按退路继续，不再回到读取中：
 * 每隔 RETRY_UNREADABLE_MS 在后台重读一次，读好了通知订阅方，失败只刷新失败时刻。
 */
export function videoEditCodeDeclarationReader(owner: VideoEditInstance): VideoEditCodeDeclarationReader {
  const read = readVideoEditCodeMetadata(owner, owner.document)
  return instance => {
    const failure = unreadable.get(owner)?.get(instance.versionId)
    if (failure) {
      if (!failure.retrying && performance.now() - failure.at >= RETRY_UNREADABLE_MS) retry(owner, instance.versionId, instance.definitionId, failure)
      return undefined
    }
    try { return read(instance).parameters }
    catch (error) {
      if (!(error instanceof VideoEditCodeMetadataPending)) return undefined
      void error.ready.catch(() => {
        const versions = unreadable.get(owner) ?? new Map<string, Failure>()
        versions.set(instance.versionId, { at: performance.now(), retrying: false }); unreadable.set(owner, versions)
      })
      throw error
    }
  }
}
/** 等声明读好（读不出来的按 undefined）再执行：用到声明的结果要和最终的一致时（回收预渲染文件、分析画面输入）用它。 */
export async function settleVideoEditCodeDeclarations<T>(operation: () => T): Promise<T> {
  for (;;) {
    try { return operation() }
    catch (error) { if (!(error instanceof VideoEditCodeMetadataPending)) throw error; await error.ready.catch(() => undefined) }
  }
}

import { planMusicRemix, type MusicRemixPlan, type MusicRemixRequest } from './musicRemixPlan'

/** 音频重构路径规划 Worker：长目标（数千层动态规划）不占用界面线程。 */
export type MusicRemixWorkerResponse = { kind: 'plan'; plan: MusicRemixPlan } | { kind: 'error'; message: string }
const scope = self as unknown as DedicatedWorkerGlobalScope
scope.onmessage = (event: MessageEvent<MusicRemixRequest>): void => {
  try { scope.postMessage({ kind: 'plan', plan: planMusicRemix(event.data) } satisfies MusicRemixWorkerResponse) }
  catch (error) { scope.postMessage({ kind: 'error', message: error instanceof Error ? error.message : '重构路径计算失败。' } satisfies MusicRemixWorkerResponse) }
}

import { optimizeMotionDraft, type OptimizeMotionInput } from '@/core/creativeIntent/candidates'
import { CreativeIntentError } from '@/core/creativeIntent/sampling'
import type { MotionWorkerRequest } from './videoEditMotionWorkerProtocol'
import type { MotionSample } from '@/core/creativeIntent/contracts'
const scope = self as unknown as DedicatedWorkerGlobalScope
let input: OptimizeMotionInput | undefined
let samples: MotionSample[] = []
scope.onmessage = (event: MessageEvent<MotionWorkerRequest>): void => {
  try {
    if (event.data.kind === 'begin') { samples = [...event.data.input.samples]; input = { ...event.data.input, samples }; scope.postMessage({ kind: 'received' }); return }
    if (!input) throw new Error('原稿尚未就绪。')
    if (event.data.kind === 'page') { samples.push(...event.data.entries); scope.postMessage({ kind: 'received' }); return }
    const result = optimizeMotionDraft(input)
    const original = optimizeMotionDraft({ ...input, draft: { ...input.draft, fidelity: 1 }, intent: undefined }).candidates[0]
    scope.postMessage({ result, original }); input = undefined; samples = []
  }
  catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : '整理失败，请重试。', code: error instanceof CreativeIntentError ? error.code : undefined, refs: error instanceof CreativeIntentError ? error.refs : [] }) }
}

import { optimizeMotionDraft, type OptimizeMotionInput } from '@/core/creativeIntent/candidates'
import { CreativeIntentError } from '@/core/creativeIntent/sampling'
import type { MotionWorkerRequest, MotionWorkerResponse } from './videoEditMotionWorkerProtocol'
import type { MotionSample } from '@/core/creativeIntent/contracts'
const scope = self as unknown as DedicatedWorkerGlobalScope
let input: OptimizeMotionInput | undefined
let samples: MotionSample[] = []
const post = (response: MotionWorkerResponse): void => scope.postMessage(response)
scope.onmessage = (event: MessageEvent<MotionWorkerRequest>): void => { void handle(event.data) }
async function handle(message: MotionWorkerRequest): Promise<void> {
  try {
    if (message.kind === 'spatial-layout') {
      const { planSpatialLayout } = await import('@/core/videoEdit/spatialLayout')
      post({ kind: 'spatial-layout', patch: await planSpatialLayout(message.snapshot, message.intent, message.output, new AbortController().signal) }); return
    }
    if (message.kind === 'spatial-evaluate') {
      const { evaluateSpatialFrame } = await import('@/core/videoEdit/spatialEvaluation')
      post({ kind: 'spatial-frame', frame: evaluateSpatialFrame(message.composition, message.frame, message.output, message.quality) }); return
    }
    if (message.kind === 'spatial-propagate') {
      const { planSpatialPropagation } = await import('@/core/videoEdit/spatialPropagation')
      post({ kind: 'spatial-propagation', result: await planSpatialPropagation({ ...message.request, signal: new AbortController().signal }) }); return
    }
    if (message.kind === 'begin') { samples = [...message.input.samples]; input = { ...message.input, samples }; post({ kind: 'received' }); return }
    if (!input) throw new Error('原稿尚未就绪。')
    if (message.kind === 'page') { samples.push(...message.entries); post({ kind: 'received' }); return }
    const result = optimizeMotionDraft(input)
    const original = optimizeMotionDraft({ ...input, draft: { ...input.draft, fidelity: 1 }, intent: undefined, beatFrames: undefined }).candidates[0]
    post({ result, original }); input = undefined; samples = []
  }
  catch (error) { post({ error: error instanceof Error ? error.message : '整理失败，请重试。', code: error instanceof CreativeIntentError ? error.code : undefined, refs: error instanceof CreativeIntentError ? error.refs : [], ...(error instanceof Error && 'facts' in error ? { facts: error.facts as import('@/core/videoEdit/spatialTypes').SpatialFrame['facts'] } : {}) }) }
}

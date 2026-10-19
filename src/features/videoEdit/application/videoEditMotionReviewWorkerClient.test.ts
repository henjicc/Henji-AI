import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { analyzeVideoEditMotionStructure } from './videoEditMotionReviewWorkerClient'
import { collectVideoEditMotionStructure } from '@/core/videoEdit/motionStructure'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditMotionReviewRequest, VideoEditMotionReviewResponse } from '../engine/videoEditMotionReviewWorker'

class TestWorker {
  static instances: TestWorker[] = []
  onmessage: ((event: MessageEvent<VideoEditMotionReviewResponse>) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  request?: VideoEditMotionReviewRequest
  constructor() { TestWorker.instances.push(this) }
  postMessage(value: VideoEditMotionReviewRequest): void { this.request = value }
  respond(): void { this.onmessage?.({ data: { result: collectVideoEditMotionStructure(this.request!.composition, this.request!.range) } } as MessageEvent<VideoEditMotionReviewResponse>) }
}
beforeEach(() => { TestWorker.instances = []; vi.stubGlobal('Worker', TestWorker) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const document = createVideoEditDocument('空白')
document.sequences = [createVideoEditSequence('主')]
const request = { composition: videoEditComposition(document, document.sequences[0].id), range: { from: 0, to: 30 }, policy: {} }
it('one worker owns a query and releases its listeners and resources after real kernel completion', async () => {
  const signal = new AbortController().signal, remove = vi.spyOn(signal, 'removeEventListener')
  const pending = analyzeVideoEditMotionStructure(request, signal)
  TestWorker.instances[0].respond()
  expect(await pending).toEqual({ records: [], sampledFrames: 0, sampledInstances: 0 })
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce()
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  expect(TestWorker.instances[0].onmessage).toBeNull()
})
it('cancels before creation or during work, ignores a late reply and does not affect another query', async () => {
  const cancelled = new AbortController(); cancelled.abort()
  await expect(analyzeVideoEditMotionStructure(request, cancelled.signal)).rejects.toThrow()
  expect(TestWorker.instances).toHaveLength(0)
  const controller = new AbortController()
  const first = analyzeVideoEditMotionStructure(request, controller.signal)
  const second = analyzeVideoEditMotionStructure(request, new AbortController().signal)
  const late = TestWorker.instances[0].onmessage!
  controller.abort(new Error('取消结构分析'))
  late(new MessageEvent<VideoEditMotionReviewResponse>('message', { data: { result: { records: [], sampledFrames: 0, sampledInstances: 0 } } }))
  await expect(first).rejects.toThrow('取消结构分析')
  TestWorker.instances[1].respond(); expect(await second).toHaveProperty('sampledFrames', 0)
  expect(TestWorker.instances.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true)
})
it.each(['error', 'message', 'post', 'domain'] as const)('%s failure releases the worker and rejects the query', async kind => {
  if (kind === 'post') vi.spyOn(TestWorker.prototype, 'postMessage').mockImplementationOnce(() => { throw new Error('发送失败') })
  const pending = analyzeVideoEditMotionStructure(request, new AbortController().signal)
  const worker = TestWorker.instances[0]
  if (kind === 'error') worker.onerror?.({ message: '线程失败' })
  if (kind === 'message') worker.onmessageerror?.()
  if (kind === 'domain') worker.onmessage?.(new MessageEvent<VideoEditMotionReviewResponse>('message', { data: { error: '范围超出预算' } }))
  await expect(pending).rejects.toThrow()
  expect(worker.terminate).toHaveBeenCalledOnce()
})
it('the real worker entry uses the same domain kernel and returns domain failures through the envelope', async () => {
  const posted: VideoEditMotionReviewResponse[] = []
  const scope = { postMessage: (value: VideoEditMotionReviewResponse) => posted.push(value), onmessage: undefined as unknown as (event: MessageEvent<VideoEditMotionReviewRequest>) => void }
  vi.stubGlobal('self', scope)
  await import('../engine/videoEditMotionReviewWorker')
  scope.onmessage(new MessageEvent('message', { data: request }))
  expect(posted[0]).toHaveProperty('result.sampledInstances', 0)
})

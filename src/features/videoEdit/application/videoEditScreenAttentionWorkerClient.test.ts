import { afterEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import { screenAttentionFixture } from '@/tests/screenAttentionFixture'
import { screenAttentionSettingsSchema } from '@/core/videoEdit/screenAttention'
import { analyzeVideoEditScreenAttentionOffThread } from './videoEditScreenAttentionWorkerClient'
import type { VideoEditScreenAttentionRequest } from '../engine/videoEditScreenAttentionAnalysis'
const platform = vi.hoisted(() => ({ dirname: vi.fn(), allowRoot: vi.fn() }))
vi.mock('@/platform/runtime', async () => {
  const { createElectronMedia } = await import('@/platform/adapters/electron/media')
  return { isDesktopRuntime: () => true, getPlatform: () => ({ system: { paths: { dirname: platform.dirname } }, media: { ...createElectronMedia(), allowRoot: platform.allowRoot } }) }
})
const workers: FakeWorker[] = []
class FakeWorker {
  onmessage?: (event: { data: unknown }) => void
  onerror?: (event: { message: string }) => void
  terminate = vi.fn()
  request?: VideoEditScreenAttentionRequest
  constructor() { workers.push(this) }
  postMessage(request: VideoEditScreenAttentionRequest): void { this.request = request }
}
afterEach(() => { workers.length = 0; vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function fixture() {
  const document = createVideoEditTestDocument('注意力测试'); const log = await screenAttentionFixture()
  log.source.pages.forEach((page, i) => { page.path = `D:/recording/page-${i}.json` })
  document.media.push({ id: 'screen', path: 'D:/recording/screen.mp4', name: '原片', kind: 'video', durationSeconds: 10, width: 1920, height: 1080, recordingCursor: log.source })
  vi.stubGlobal('Worker', FakeWorker)
  const dirname = platform.dirname.mockResolvedValue('D:/recording')
  const allow = platform.allowRoot.mockResolvedValue(undefined)
  const request: VideoEditScreenAttentionRequest = { composition: videoEditComposition(document, document.sequences[0].id), clipId: 'clip', target: { width: 1920, height: 1080 }, settings: screenAttentionSettingsSchema.parse({}) }
  return { request, dirname, allow }
}
it('新媒体消费边界授权去重、转换 Worker 副本，保持原始落盘路径；完成终止 Worker', async () => {
  const { request, dirname, allow } = await fixture()
  const pending = analyzeVideoEditScreenAttentionOffThread(request, new AbortController().signal)
  await vi.waitFor(() => expect(workers).toHaveLength(1))
  expect(dirname).toHaveBeenCalledOnce(); expect(allow).toHaveBeenCalledWith('D:/recording')
  expect(workers[0].request!.composition.media[0].recordingCursor!.pages[0].path).toMatch(/^henji-media:\/\//)
  expect(request.composition.media[0].recordingCursor!.pages[0].path).toBe('D:/recording/page-0.json')
  workers[0].onmessage!({ data: { result: { clip: {}, quietFrames: 0, impreciseCapabilities: 0 } } })
  await expect(pending).resolves.toMatchObject({ quietFrames: 0 }); expect(workers[0].terminate).toHaveBeenCalledOnce()
})
it('取消终止独占 Worker，授权拒绝不启动，不吞读取/计算错误', async () => {
  const { request, allow } = await fixture(); const controller = new AbortController()
  const pending = analyzeVideoEditScreenAttentionOffThread(request, controller.signal)
  const rejected = expect(pending).rejects.toThrow('取消')
  await vi.waitFor(() => expect(workers).toHaveLength(1)); controller.abort(new Error('取消')); await rejected
  expect(workers[0].terminate).toHaveBeenCalledOnce()
  allow.mockRejectedValueOnce(new Error('目录授权失败'))
  await expect(analyzeVideoEditScreenAttentionOffThread(request, new AbortController().signal)).rejects.toThrow('目录授权失败')
  expect(workers).toHaveLength(1)
})

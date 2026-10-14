import { expect, it, vi } from 'vitest'
import { OcrPrivacyService, type PrivacyServiceDependencies } from './privacyService'
function setup() {
  const deps: PrivacyServiceDependencies = { identity: vi.fn(async source => ({ path: source, identity: 'initial' })), probe: vi.fn(async () => ({ width: 1920, height: 1080, fps: 60, startSeconds: 2 })), ensureModel: vi.fn(async id => id), ffmpegPath: vi.fn(async () => 'ffmpeg'), providers: ['cpu'],
    infer: vi.fn(async (_job, progress) => { progress(10, 10); return { privacy: { candidates: [], warnings: [] }, frames: 10, inferredFrames: 1 } }), cancel: vi.fn(), emit: vi.fn(), log: vi.fn() }
  return { deps, service: new OcrPrivacyService(deps), request: { requestId: 'request', source: 'source', mediaId: 'screen', startUs: 3000000, endUs: 4000000, originUs: 1000000 } }
}
it('容器起点只用于seek，录制时钟和进度保留；主进程只委托后台', async () => {
  const { deps, service, request } = setup(); await service.detect(request)
  expect(deps.infer).toHaveBeenCalledWith(expect.objectContaining({ seekSeconds: 1, startUs: 4000000, endUs: 5000000, fps: 10, models: [{ name: 'ppocr', path: 'text_detection_ppocr' }, { name: 'ppocr_rec', path: 'text_recognition_ppocr' }] }), expect.any(Function))
  expect(service.hasActiveJobs()).toBe(false); expect(deps.emit).toHaveBeenCalledWith({ requestId: 'request', progress: 1 })
})
it('资源校验期间取消不派发推理，原片变化拒绝迟到结果', async () => {
  const { deps, service, request } = setup()
  vi.mocked(deps.ensureModel).mockImplementationOnce(async () => { service.cancel(request.requestId); return 'model' })
  await expect(service.detect(request)).rejects.toThrow('取消'); expect(deps.infer).not.toHaveBeenCalled()
  const other = setup(); vi.mocked(other.deps.identity).mockResolvedValueOnce({ path: 'source', identity: 'a' }).mockResolvedValueOnce({ path: 'source', identity: 'b' })
  await expect(other.service.detect(other.request)).rejects.toThrow('已变化'); expect(other.service.hasActiveJobs()).toBe(false)
})
it('唯一内置 tiny 档读取字典、保留快速归一化并透传光标', async () => {
  const { deps, service, request } = setup()
  const cursor = [{ monoUs: 4000000, point: [30, 40] as [number, number] }]
  await service.detect({ ...request, cursor })
  expect(deps.ensureModel).toHaveBeenCalledWith('text_recognition_ppocr', 'dict')
  expect(deps.infer).toHaveBeenLastCalledWith(expect.objectContaining({ dictionaryPath: 'text_recognition_ppocr', normalization: 'rgb-half', cursor }), expect.any(Function))
})

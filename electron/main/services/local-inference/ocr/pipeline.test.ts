import { expect, it, vi } from 'vitest'
import { runOcrPrivacy, type OcrPrivacyDependencies } from './pipeline'
import type { OcrPrivacyJob } from './protocol'
import type { LocalModelRunner } from '../analysis'
const text = 'demo@example.com', alphabet = [...new Set([...text])]
function prediction(value: string): { data: Float32Array; dims: number[] } {
  const classes = alphabet.length + 2, ids = [...value].flatMap(c => [alphabet.indexOf(c) + 1, 0]), data = new Float32Array(ids.length * classes)
  ids.forEach((id, i) => { data[i * classes + id] = .99 }); return { data, dims: [1, ids.length, classes] }
}
const job: OcrPrivacyJob = { id: 'fixture', dictionaryPath: 'dict', source: 'fixture.mp4', ffmpegPath: 'ffmpeg', models: [{ name: 'ppocr', path: 'det' }, { name: 'ppocr_rec', path: 'rec' }], providers: ['cpu'], seekSeconds: 0, durationSeconds: .4, startUs: 3000000, endUs: 3400000, fps: 10, mediaId: 'screen', display: { width: 640, height: 360 } }
function fixture(): { deps: OcrPrivacyDependencies; controller: AbortController; detect: LocalModelRunner['run'] } {
  const controller = new AbortController(); let index = 0
  const detect = vi.fn(async (feeds: Parameters<Awaited<ReturnType<OcrPrivacyDependencies['openModel']>>['run']>[0]) => {
    const [, , height, width] = feeds.x.dims, data = new Float32Array(width * height)
    const y0 = index++ ? 160 : 80
    for (let y = y0; y < y0 + 20; y++) for (let x = 100; x < 500; x++) data[y * width + x] = .99
    return { out: { data, dims: [1, 1, height, width] } }
  })
  return { controller, detect, deps: { signal: controller.signal, alphabet, progress: vi.fn(),
    async *frames(size) { const a = new Uint8Array(size.width * size.height * 3).fill(255), b = a.slice(); b.fill(0); yield a; yield a; yield b; yield b },
    async openModel(model) { return { provider: 'cpu', run: model.name === 'ppocr' ? detect : async () => ({ out: prediction(text) }) } },
  } }
}
it('注入截图/模型输出完整管线：静帧免推理、邮箱跨滚动关联、定位、脱敏和进度', async () => {
  const { deps, detect } = fixture(), result = await runOcrPrivacy(job, deps)
  expect(result).toMatchObject({ frames: 4, inferredFrames: 2 }); expect(detect).toHaveBeenCalledTimes(2)
  expect(result.privacy.candidates).toHaveLength(1)
  const candidate = result.privacy.candidates[0]
  expect(candidate).toMatchObject({ kind: 'email', status: 'pending', startUs: 3000000, endUs: 3400000 })
  expect(candidate.samples).toHaveLength(3); expect(candidate.samples[2].box[1]).toBeGreaterThan(candidate.samples[0].box[1]); expect(candidate.samples[1].monoUs).toBe(3100000)
  expect(candidate.samples[0].box[0]).toBeCloseTo((100 - 400 * 20 * 1.2 / (2 * 420)) / 800, 3)
  expect(JSON.stringify(result)).not.toContain(text); expect(deps.progress).toHaveBeenLastCalledWith(4, 4)
})
it('取消、模型失败和解码错误拒绝整个候选集合', async () => {
  const { deps, controller } = fixture(); controller.abort(new Error('取消'))
  await expect(runOcrPrivacy(job, deps)).rejects.toThrow('取消')
  const second = fixture(); second.deps.openModel = async () => { throw new Error('推理失败') }
  await expect(runOcrPrivacy(job, second.deps)).rejects.toThrow('推理失败')
  const third = fixture(); third.deps.frames = async function* () { yield new Uint8Array(1) }
  await expect(runOcrPrivacy(job, third.deps)).rejects.toThrow('大小')
})
it('识别固定一个 CPU 动态会话，稀疏读屏检测选 CPU；其他智能区域不受影响', async () => {
  const { deps } = fixture(), open = vi.spyOn(deps, 'openModel')
  await runOcrPrivacy({ ...job, providers: ['dml', 'cpu'] }, deps)
  expect(open).toHaveBeenCalledTimes(2)
  expect(open).toHaveBeenCalledWith(job.models[1], ['cpu'], 'dynamic', { intraOpNumThreads: 4 })
  expect(open).toHaveBeenCalledWith(job.models[0], ['cpu'], expect.any(String), { intraOpNumThreads: 4, allowSpinning: false })
})
it('频繁光标移动不触发逐帧推理，屏蔽区域每秒重新检查', async () => {
  const { deps, detect } = fixture()
  deps.frames = async function* (size) {
    for (let i = 0; i < 11; i++) {
      const rgb = new Uint8Array(size.width * size.height * 3).fill(255)
      rgb[(10 * size.width + 10 + i * 3) * 3] = 0
      yield rgb
    }
  }
  const result = await runOcrPrivacy({ ...job, durationSeconds: 1.1, endUs: 4100000, cursor: Array.from({ length: 11 }, (_, i) => ({ monoUs: 3000000 + i * 100000, point: [10 + i * 3, 10] })) }, deps)
  expect(result).toMatchObject({ frames: 11, inferredFrames: 2 })
  expect(detect).toHaveBeenCalledTimes(2)
})

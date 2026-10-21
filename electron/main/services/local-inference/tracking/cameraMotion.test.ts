import { expect, it } from 'vitest'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { decodeSmartRegionLayout } from '../../../../../src/core/videoEdit/smartRegions'
import type { VideoEditTrackHeader } from '../../../../../src/core/videoEdit/tracking'
import { composeVideoEditSimilarity, invertVideoEditSimilarity, type VideoEditSimilarity } from '../../../../../src/core/videoEdit/trackTransform'
import { loadTrackingOpenCv } from './openCvTracking'
import { CameraMotionEstimator } from './cameraMotion'
import { runTracking, type TrackingDependencies } from './trackJob'
import type { TrackingJob } from './trackingProtocol'

/** 第 f 帧画面 → 第 0 帧画面的真实相机变换（画面中心为原点、画面高度为单位）：手持抖动 + 轻微转动。 */
const truth = (f: number): VideoEditSimilarity => { const angle = 0.004 * Math.sin(f * 0.9); const s = 1 + 0.003 * Math.sin(f * 0.7); return { a: s * Math.cos(angle), b: s * Math.sin(angle), tx: 0.012 * Math.sin(f * 1.3) + 0.002 * f, ty: 0.01 * Math.cos(f * 1.7) } }

/** 纹理背景按相机运动成像，再叠一个快速运动的前景方块（占画面约 12%），它不应影响相机估计。 */
async function shaky(width: number, height: number, count: number): Promise<Uint8Array[]> {
  const { cv } = await loadTrackingOpenCv()
  const big = { width: width * 2, height: height * 2 }; const rgb = new Uint8Array(big.width * big.height * 3)
  let seed = 9127
  for (let y = 0; y < big.height; y += 5) for (let x = 0; x < big.width; x += 5) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const v = 20 + seed % 220
    for (let dy = 0; dy < 5 && y + dy < big.height; dy++) for (let dx = 0; dx < 5 && x + dx < big.width; dx++) rgb.fill(v, ((y + dy) * big.width + x + dx) * 3, ((y + dy) * big.width + x + dx) * 3 + 3)
  }
  const source = cv.matFromArray(big.height, big.width, cv.CV_8UC3, rgb); const frames: Uint8Array[] = []
  try {
    for (let f = 0; f < count; f++) {
      // 输出像素 p（第 f 帧）取自第 0 帧的 C_f(p)：把 C_f 换成大纹理上的像素仿射（中心对齐）。
      const c = truth(f); const k = height
      const m = cv.matFromArray(2, 3, cv.CV_64F, [c.a, -c.b, big.width / 2 + c.tx * k - (c.a * width / 2 - c.b * height / 2), c.b, c.a, big.height / 2 + c.ty * k - (c.b * width / 2 + c.a * height / 2)])
      const output = new cv.Mat()
      try {
        cv.warpAffine(source, output, m, new cv.Size(width, height), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP)
        const frame = new Uint8Array(output.data)
        const size = Math.round(height * 0.35); const ox = Math.round((f * 37) % (width - size)); const oy = Math.round(height * 0.3)
        for (let y = oy; y < oy + size; y++) for (let x = ox; x < ox + size; x++) frame.fill(((x + y + f * 9) >> 2) % 2 ? 230 : 25, (y * width + x) * 3, (y * width + x) * 3 + 3)
        frames.push(frame)
      } finally { m.delete(); output.delete() }
    }
  } finally { source.delete() }
  return frames
}

it('相机运动：合成手持抖动加前景运动物体，累计路径误差小于半个像素，续跟与一次跟完一致', async () => {
  const width = 640; const height = 360; const frames = await shaky(width, height, 40)
  const files = new Map<string, Uint8Array>()
  const job: TrackingJob = { id: 'camera', method: 'camera', models: [], ffmpegPath: 'unused', source: 'synthetic', containerStartUs: 0, fps: 30, display: { width, height }, prompts: [{ frame: 10 }], range: { first: 0, last: 39 }, direction: 'both', outputPath: 'full', providers: ['cpu'] }
  const deps: TrackingDependencies = { openModel: async () => { throw new Error('不应打开模型') }, frames: async function* ({ first, count }) { for (let f = first; f < first + count; f++) if (frames[f]) yield frames[f] }, readFile: async path => files.get(path), writeFile: async (path, data) => { files.set(path, data) }, deflate: b => deflateRawSync(b), inflate: b => inflateRawSync(b), signal: new AbortController().signal, log: () => {}, progress: () => {} }
  await runTracking(job, deps)
  await runTracking({ ...job, outputPath: 'partial', limit: 5 }, deps)
  await runTracking({ ...job, outputPath: 'resumed', existingPath: 'partial' }, deps)
  const header = (path: string): VideoEditTrackHeader => decodeSmartRegionLayout<VideoEditTrackHeader>(files.get(path)!).header
  const full = header('full')
  expect(full.firstFrame).toBe(0); expect(full.frameCount).toBe(40); expect(full.camera).toHaveLength(40)
  expect(header('resumed').camera).toEqual(full.camera)
  // 估计的 C_f 是第 f 帧 → 锚定帧（第 10 帧）；真值换算为 C10⁻¹ ∘ C_f。
  const anchor = invertVideoEditSimilarity(truth(10))
  let worst = 0
  for (let f = 0; f < 40; f++) {
    const [a, b, tx, ty, confidence] = full.camera![f]
    expect(confidence).toBeGreaterThan(0.5)
    const expected = composeVideoEditSimilarity(anchor, truth(f))
    for (const [x, y] of [[-0.8, -0.5], [0.8, 0.5], [0, 0]]) {
      const ex = expected.a * x - expected.b * y + expected.tx; const ey = expected.b * x + expected.a * y + expected.ty
      worst = Math.max(worst, Math.hypot(a * x - b * y + tx - ex, b * x + a * y + ty - ey) * height)
    }
  }
  expect(worst).toBeLessThan(0.5)
  // 估计本身（不含解码）：640×360 每帧耗时。
  const { cv } = await loadTrackingOpenCv(); const estimator = new CameraMotionEstimator(cv, width, height)
  estimator.reset(frames[0]); const started = performance.now()
  for (let f = 1; f < 40; f++) estimator.step(frames[f])
  estimator.dispose()
  expect((performance.now() - started) / 39).toBeLessThan(40)
}, 60000)

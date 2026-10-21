/*
 * 防抖对照实测（手动专项，不进日常测试）：合成三段手持抖动素材（行走、手持静止、运动镜头；含前景运动物体），
 * 对比本项目实现（OpenCV LK + 两点 RANSAC 相机运动 → HiGHS L1 最优路径）与 FFmpeg vid.stab 的
 * 残余抖动（输出帧间全局位移的方差）、裁切比例与分析耗时。
 *   npx vite-node scripts/benchmark-stabilization.ts            结果写到 .tmp/stabilize-bench/
 * 依赖随包 FFmpeg 9 GPL（node scripts/video-decoder-ffmpeg.cjs path，含 vidstabdetect/vidstabtransform）。
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import highsLoader from 'highs'
import { loadTrackingOpenCv } from '../electron/main/services/local-inference/tracking/openCvTracking'
import { CameraMotionEstimator, cameraFrameSize } from '../electron/main/services/local-inference/tracking/cameraMotion'
import { composeVideoEditSimilarity, type VideoEditSimilarity } from '../src/core/videoEdit/trackTransform'
import { solveVideoEditStabilization, type VideoEditCameraSample, type VideoEditClipStabilization } from '../src/core/videoEdit/stabilization'

const root = process.cwd()
const out = path.join(root, '.tmp/stabilize-bench'); fs.mkdirSync(out, { recursive: true })
const ffmpegDir = execFileSync(process.execPath, [path.join(root, 'scripts/video-decoder-ffmpeg.cjs'), 'path'], { encoding: 'utf8' }).trim().split(/\r?\n/).at(-1)!
const ffmpeg = path.join(ffmpegDir, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const W = 1280; const H = 720; const FPS = 30; const FRAMES = 300
type Cv = Awaited<ReturnType<typeof loadTrackingOpenCv>>['cv']

function readRgb(file: string, width: number, height: number): Uint8Array {
  return new Uint8Array(execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-vf', `scale=${width}:${height}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 }))
}
/** 场景：真实照片铺成的大画面（翻转避免明显重复）。 */
function scene(): { rgb: Uint8Array; width: number; height: number } {
  const tiles = ['astronaut', 'hair-edge-original', 'face-scratch-original'].map(name => readRgb(path.join(root, `tests/fixtures/image-inpainting/${name}.png`), 512, 512))
  const width = 3584; const height = 2048; const rgb = new Uint8Array(width * height * 3)
  for (let ty = 0; ty < height / 512; ty++) for (let tx = 0; tx < width / 512; tx++) {
    const tile = tiles[(tx + ty * 2) % 3]; const flipX = (tx + ty) % 2 === 1; const flipY = ty % 2 === 1
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const sx = flipX ? 511 - x : x; const sy = flipY ? 511 - y : y
      rgb.set(tile.subarray((sy * 512 + sx) * 3, (sy * 512 + sx) * 3 + 3), ((ty * 512 + y) * width + tx * 512 + x) * 3)
    }
  }
  return { rgb, width, height }
}
/** 确定性噪声（低通随机游走用）。 */
function noise(seed: number): () => number { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 - 0.5 } }

interface Pose { cx: number; cy: number; angle: number; scale: number }
const scenarios: Record<string, (t: number, n: () => number, state: { wx: number; wy: number; wa: number }) => Pose> = {
  // 行走：缓慢前推、横移，2 Hz 上下颠簸、0.9 Hz 左右摇摆与侧倾，加高频抖动；画面里有人横穿（前景运动物体）。
  walk: (t, n) => ({ cx: 1792 + 1.6 * t + 6 * Math.sin(2 * Math.PI * 0.9 * t / FPS) + 2 * n(), cy: 1024 + 14 * Math.sin(2 * Math.PI * 1.9 * t / FPS) + 2 * n(), angle: 0.8 * Math.PI / 180 * Math.sin(2 * Math.PI * 0.9 * t / FPS + 0.5), scale: 1 + 0.12 * t / FRAMES }),
  // 手持静止：低通随机游走（约 ±10 像素、±0.5°）加 1.5 像素高频抖动。
  handheld: (_t, n, s) => { s.wx = s.wx * 0.92 + 2.2 * n(); s.wy = s.wy * 0.92 + 2.2 * n(); s.wa = s.wa * 0.95 + 0.0006 * n(); return { cx: 1792 + s.wx * 3 + 1.5 * n(), cy: 1024 + s.wy * 3 + 1.5 * n(), angle: s.wa * 4, scale: 1 } },
  // 运动镜头：匀速横摇 6 像素/帧，3 Hz 抖动与随机抖动。
  pan: (t, n) => ({ cx: 900 + 6 * t + 3 * n(), cy: 1024 + 4 * Math.sin(2 * Math.PI * 3 * t / FPS) + 3 * n(), angle: 0.3 * Math.PI / 180 * Math.sin(2 * Math.PI * 2.1 * t / FPS), scale: 1 }),
}

async function encode(file: string, frames: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, width = W, height = H): Promise<void> {
  const child = spawn(ffmpeg, ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-r', String(FPS), '-i', '-', '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', '-pix_fmt', 'yuv420p', file])
  const done = new Promise<void>((resolve, reject) => { child.on('exit', code => code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))); child.on('error', reject) })
  for await (const frame of frames) if (!child.stdin.write(frame)) await new Promise(resolve => child.stdin.once('drain', resolve))
  child.stdin.end(); await done
}
function decode(file: string, width: number, height: number): Uint8Array[] {
  const bytes = execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-vf', `scale=${width}:${height}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 2 ** 31 })
  const size = width * height * 3; const frames: Uint8Array[] = []
  for (let offset = 0; offset + size <= bytes.length; offset += size) frames.push(new Uint8Array(bytes.buffer, bytes.byteOffset + offset, size))
  return frames
}
function warp(cv: Cv, source: { rgb: Uint8Array; width: number; height: number }, matrix: number[], width: number, height: number): Uint8Array {
  const input = cv.matFromArray(source.height, source.width, cv.CV_8UC3, source.rgb); const m = cv.matFromArray(2, 3, cv.CV_64F, matrix); const output = new cv.Mat()
  try { cv.warpAffine(input, output, m, new cv.Size(width, height), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 255)); return new Uint8Array(output.data) } finally { input.delete(); m.delete(); output.delete() }
}

/** 合成一段抖动素材：输出像素 → 大画面像素的仿射（中心对齐），前景物体按屏幕坐标叠加。 */
async function synthesize(cv: Cv, canvas: ReturnType<typeof scene>, name: string): Promise<string> {
  const file = path.join(out, `${name}-shaky.mp4`); if (fs.existsSync(file)) return file
  const n = noise(name.length * 7919); const state = { wx: 0, wy: 0, wa: 0 }
  const person = readRgb(path.join(root, 'tests/fixtures/image-inpainting/astronaut.png'), 220, 300)
  function* frames(): Iterable<Uint8Array> {
    for (let t = 0; t < FRAMES; t++) {
      const p = scenarios[name](t, n, state); const c = Math.cos(p.angle) / p.scale; const s = Math.sin(p.angle) / p.scale
      const frame = warp(cv, canvas, [c, -s, p.cx - (c * W / 2 - s * H / 2), s, c, p.cy - (s * W / 2 + c * H / 2)], W, H)
      if (name === 'walk') { const ox = Math.round(W - 300 - t * 3.5); for (let y = 0; y < 300; y++) for (let x = 0; x < 220; x++) { const fx = ox + x; if (fx >= 0 && fx < W) frame.set(person.subarray((y * 220 + x) * 3, (y * 220 + x) * 3 + 3), ((y + 330) * W + fx) * 3) } }
      yield frame
    }
  }
  await encode(file, frames()); return file
}

/** 输出帧间全局位移（OpenCV estimateAffine2D，两种实现用同一把尺子）：方差（像素²，1280 宽度下）。 */
function measureJitter(cv: Cv, frames: Uint8Array[], width: number, height: number): { variance: number; meanAbs: number } {
  const steps: Array<[number, number]> = []; let previous: InstanceType<Cv['Mat']> | undefined
  for (const rgb of frames) {
    const src = cv.matFromArray(height, width, cv.CV_8UC3, rgb); const gray = new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGB2GRAY); src.delete()
    if (previous) {
      const corners = new cv.Mat(); cv.goodFeaturesToTrack(previous, corners, 400, 0.01, 8)
      const next = new cv.Mat(); const status = new cv.Mat(); const error = new cv.Mat()
      cv.calcOpticalFlowPyrLK(previous, gray, corners, next, status, error, new cv.Size(21, 21), 3)
      const a: number[] = []; const b: number[] = []
      for (let i = 0; i < corners.rows; i++) if (status.data[i]) { a.push(corners.data32F[i * 2], corners.data32F[i * 2 + 1]); b.push(next.data32F[i * 2], next.data32F[i * 2 + 1]) }
      const from = cv.matFromArray(a.length / 2, 1, cv.CV_32FC2, a); const to = cv.matFromArray(b.length / 2, 1, cv.CV_32FC2, b); const inliers = new cv.Mat()
      const m = cv.estimateAffine2D(from, to, inliers, cv.RANSAC, 1.5)
      if (!m.empty()) { const d = m.data64F; const cx = width / 2; const cy = height / 2; steps.push([(d[0] * cx + d[1] * cy + d[2] - cx) * W / width, (d[3] * cx + d[4] * cy + d[5] - cy) * W / width]) }
      for (const mat of [corners, next, status, error, from, to, inliers, m]) mat.delete()
      previous.delete()
    }
    previous = gray
  }
  previous?.delete()
  const mean = [steps.reduce((s, v) => s + v[0], 0) / steps.length, steps.reduce((s, v) => s + v[1], 0) / steps.length]
  return { variance: steps.reduce((s, v) => s + (v[0] - mean[0]) ** 2 + (v[1] - mean[1]) ** 2, 0) / steps.length, meanAbs: steps.reduce((s, v) => s + Math.hypot(v[0], v[1]), 0) / steps.length }
}

/** 实际裁切：抽样帧上原片 → 输出的相似变换缩放（输出把原片放大多少），裁切 = 1 − 1/缩放。 */
function measureCrop(cv: Cv, input: Uint8Array[], output: Uint8Array[], width: number, height: number): number {
  const scales: number[] = []
  for (let t = 5; t < Math.min(input.length, output.length); t += 15) {
    const gray = (rgb: Uint8Array): InstanceType<Cv['Mat']> => { const src = cv.matFromArray(height, width, cv.CV_8UC3, rgb); const g = new cv.Mat(); cv.cvtColor(src, g, cv.COLOR_RGB2GRAY); src.delete(); return g }
    const a = gray(input[t]); const b = gray(output[t])
    const corners = new cv.Mat(); cv.goodFeaturesToTrack(a, corners, 400, 0.01, 8)
    const next = new cv.Mat(); const status = new cv.Mat(); const error = new cv.Mat()
    cv.calcOpticalFlowPyrLK(a, b, corners, next, status, error, new cv.Size(31, 31), 5)
    const from: number[] = []; const to: number[] = []
    for (let i = 0; i < corners.rows; i++) if (status.data[i]) { from.push(corners.data32F[i * 2], corners.data32F[i * 2 + 1]); to.push(next.data32F[i * 2], next.data32F[i * 2 + 1]) }
    const f = cv.matFromArray(from.length / 2, 1, cv.CV_32FC2, from); const g = cv.matFromArray(to.length / 2, 1, cv.CV_32FC2, to); const inliers = new cv.Mat()
    const m = cv.estimateAffine2D(f, g, inliers, cv.RANSAC, 2)
    if (!m.empty()) { const d = m.data64F; scales.push(Math.sqrt(Math.abs(d[0] * d[4] - d[1] * d[3]))) }
    for (const mat of [a, b, corners, next, status, error, f, g, inliers, m]) mat.delete()
  }
  scales.sort((x, y) => x - y)
  return 1 - 1 / scales[Math.floor(scales.length / 2)]
}

async function ours(cv: Cv, input: string, name: string, params: VideoEditClipStabilization): Promise<{ analysisMs: number; solveMs: number; crop: number; output: string }> {
  const size = cameraFrameSize({ width: W, height: H })
  const started = performance.now()
  const small = decode(input, size.width, size.height)
  const estimator = new CameraMotionEstimator(cv, size.width, size.height)
  const samples: VideoEditCameraSample[] = [{ transform: { a: 1, b: 0, tx: 0, ty: 0 }, confidence: 1 }]
  estimator.reset(small[0])
  for (let t = 1; t < small.length; t++) { const { motion, confidence } = estimator.step(small[t]); samples.push({ transform: composeVideoEditSimilarity(samples[t - 1].transform, motion), confidence }) }
  estimator.dispose()
  const analysisMs = performance.now() - started
  const solution = solveVideoEditStabilization(await highsLoader(), samples, W / H, params)
  // 输出像素 q → 原画面 B(zoom·q)（与渲染层同一换算，这里用 CPU 重采样只为测量与对照视频）。
  const full = decode(input, W, H)
  const output = path.join(out, `${name}-ours-${params.smoothness}.mp4`)
  await encode(output, full.map((rgb, t) => {
    const b: VideoEditSimilarity = solution.corrections[t]; const z = solution.zoom
    const a = b.a * z; const c = b.b * z
    return warp(cv, { rgb, width: W, height: H }, [a, -c, H * b.tx + W / 2 - (a * W / 2 - c * H / 2), c, a, H * b.ty + H / 2 - (c * W / 2 + a * H / 2)], W, H)
  }))
  return { analysisMs, solveMs: solution.solveMs, crop: solution.crop, output }
}

function vidstab(input: string, name: string): { analysisMs: number; transformMs: number; output: string } {
  const output = path.join(out, `${name}-vidstab.mp4`)
  let started = performance.now()
  spawnSync(ffmpeg, ['-y', '-v', 'error', '-i', input, '-vf', `vidstabdetect=shakiness=8:accuracy=15:result=${name}.trf`, '-f', 'null', '-'], { stdio: 'inherit', cwd: out })
  const analysisMs = performance.now() - started
  started = performance.now()
  const run = spawnSync(ffmpeg, ['-y', '-v', 'verbose', '-i', input, '-vf', `vidstabtransform=input=${name}.trf:smoothing=15:optzoom=1:interpol=bicubic`, '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', '-pix_fmt', 'yuv420p', output], { encoding: 'utf8', cwd: out })
  const transformMs = performance.now() - started
  const zoom = Number(/zoom[^\d-]*(-?\d+(?:\.\d+)?)/i.exec(run.stderr.split(/\r?\n/).filter(line => /zoom/i.test(line)).join('\n'))?.[1] ?? NaN)
  return { analysisMs, transformMs, zoom, output }
}

async function main(): Promise<void> {
  const { cv } = await loadTrackingOpenCv()
  const canvas = scene(); const report: Record<string, unknown> = {}
  for (const name of Object.keys(scenarios)) {
    const input = await synthesize(cv, canvas, name)
    const measureSize = { width: 640, height: 360 }
    const raw = measureJitter(cv, decode(input, measureSize.width, measureSize.height), measureSize.width, measureSize.height)
    const params: VideoEditClipStabilization = { smoothness: name === 'handheld' ? 'locked' : 'natural', maxCrop: 0.2, rotation: true, scale: true }
    const mine = await ours(cv, input, name, params)
    const theirs = vidstab(input, name)
    const inputSmall = decode(input, 640, 360); const mineSmall = decode(mine.output, 640, 360); const theirsSmall = decode(theirs.output, 640, 360)
    report[name] = {
      input: { jitterVariancePx2: +raw.variance.toFixed(3), meanStepPx: +raw.meanAbs.toFixed(2) },
      ours: { smoothness: params.smoothness, jitterVariancePx2: +measureJitter(cv, mineSmall, 640, 360).variance.toFixed(4), cropPercent: +(mine.crop * 100).toFixed(1), measuredCropPercent: +(measureCrop(cv, inputSmall, mineSmall, 640, 360) * 100).toFixed(1), analysisMs: Math.round(mine.analysisMs), solveMs: mine.solveMs },
      vidstab: { jitterVariancePx2: +measureJitter(cv, theirsSmall, 640, 360).variance.toFixed(4), measuredCropPercent: +(measureCrop(cv, inputSmall, theirsSmall, 640, 360) * 100).toFixed(1), analysisMs: Math.round(theirs.analysisMs), transformAndEncodeMs: Math.round(theirs.transformMs) },
    }
    console.log(name, JSON.stringify(report[name]))
    // 并排对照：左原片、中本实现、右 vid.stab。
    spawnSync(ffmpeg, ['-y', '-v', 'error', '-i', input, '-i', mine.output, '-i', theirs.output, '-filter_complex', '[0:v]scale=640:360[a];[1:v]scale=640:360[b];[2:v]scale=640:360[c];[a][b][c]hstack=3', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', path.join(out, `${name}-compare.mp4`)], { stdio: 'inherit' })
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
}
void main().then(() => process.exit(0), error => { console.error(error); process.exit(1) })

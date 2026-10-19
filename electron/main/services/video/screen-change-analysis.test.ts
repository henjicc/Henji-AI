import { afterAll, beforeAll, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { loadFfmpegPath } from './ffmpeg-loader'
import { runLoudnessFfmpeg } from '../audio/loudness'
import { ScreenChangeWorker } from './screen-change-worker-client'
import { analyzeScreenChanges } from './screen-change-analysis'
import { analyzeVideoMotion } from './motion-analysis'
import { reviewMotionSamples } from '../../../../src/core/media/motionReview'
import { readVideoAnalysisGeometry } from './ops'

let directory: string; let workerPath: string; let source: string; let binary: string
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-screen-changes-'))
  workerPath = process.env.HENJI_TEST_SCREEN_CHANGE_WORKER ? path.resolve(process.env.HENJI_TEST_SCREEN_CHANGE_WORKER) : path.join(directory, 'worker.cjs')
  source = path.join(directory, 'popup.mkv'); binary = await loadFfmpegPath()
  if (process.env.HENJI_TEST_SCREEN_CHANGE_WORKER) await fs.access(workerPath)
  else await build({ entryPoints: [path.resolve('electron/main/services/video/screen-change-worker.ts')], outfile: workerPath, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', define: { __filename: JSON.stringify(path.resolve('package.json')) } })
  await runLoudnessFfmpeg(['-y', '-f', 'lavfi', '-i', "color=black:s=480x270:r=30:d=4,drawbox=x=100:y=50:w=100:h=60:color=white:t=fill:enable='between(t,1,1.2)'", '-c:v', 'ffv1', source], new AbortController().signal, binary)
}, 20000)
afterAll(async () => { if (directory) await fs.rm(directory, { recursive: true, force: true }) })

it('真实FFmpeg和Worker粗扫局部弹出，再按30fps复核，保持非零源时间与变化区域', async () => {
  const progress: number[] = []
  const result = await analyzeScreenChanges({ requestId: 'popup', source, startSeconds: .5, endSeconds: 3.5, sensitivity: 50, analysis: 'screen_changes' },
    new AbortController().signal, value => progress.push(value), binary, workerPath)
  expect(result.coarse.candidates).toHaveLength(1)
  expect(result.coarse.candidates[0]).toMatchObject({ kind: 'transient', abrupt: true })
  expect(result.coarse.candidates[0].atSeconds).toBeCloseTo(1.1)
  expect(result.coarse.candidates[0].region.x).toBeCloseTo(100 / 480, 2)
  expect(result.coarse.candidates[0].region.width).toBeCloseTo(100 / 480, 2)
  expect(result.refinements).toHaveLength(1)
  const refined = result.refinements[0].scan
  expect(refined.samplingFps).toBe(30)
  expect(refined.candidates[0].kind).toBe('transient')
  expect(Math.abs(refined.candidates[0].atSeconds - 1)).toBeLessThanOrEqual(1 / 30 + 1e-7)
  expect(Math.abs(refined.candidates[0].returnSeconds! - 1.233333333)).toBeLessThanOrEqual(1 / 30 + 1e-7)
  expect(progress.at(-1)).toBe(1)
  expect(progress.every((value, index) => value >= 0 && value <= 1 && (!index || value >= progress[index - 1]))).toBe(true)
}, 20000)
it('运动分析复用实际解码与Worker，保留源偏移、局部弹出及静止证据', async () => {
  const progress: number[] = []
  const request = { requestId: 'motion', source, startSeconds: .5, endSeconds: 3.5, sensitivity: 50, analysis: 'motion' as const }
  const scan = await analyzeVideoMotion(request, new AbortController().signal, value => progress.push(value), binary, workerPath)
  expect(scan).toMatchObject({ samplingFps: 15, sampledFrames: 45, startSeconds: .5, endSeconds: 3.5 })
  const report = reviewMotionSamples(scan.samples)
  expect(report.events.some(event => event.fromSeconds >= .9 && event.fromSeconds < 1.2)).toBe(true)
  expect(report.events.some(event => event.kind === 'move')).toBe(false)
  expect(report.stillness.some(range => range.fromSeconds >= 1.2 && range.toSeconds === 3.5)).toBe(true)
  expect(progress.at(-1)).toBe(1)
  expect(progress.every((value, i) => value >= 0 && value <= 1 && (!i || value >= progress[i - 1]))).toBe(true)
  await expect(analyzeVideoMotion({ ...request, endSeconds: 10 }, new AbortController().signal, () => undefined, binary, workerPath)).rejects.toThrow('完整覆盖')
  const controller = new AbortController()
  await expect(analyzeVideoMotion(request, controller.signal, value => { if (value > 0) controller.abort(new Error('取消运动分析')) }, binary, workerPath)).rejects.toThrow()
}, 20000)
it('motion decode preserves portrait and non-square-pixel picture proportions', async () => {
  const portrait = path.join(directory, 'portrait.mkv'), anamorphic = path.join(directory, 'anamorphic.mkv')
  await runLoudnessFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=270x480:rate=15:duration=1', '-c:v', 'ffv1', portrait], new AbortController().signal, binary)
  await runLoudnessFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=480x270:rate=15:duration=1', '-vf', 'setsar=3/4', '-c:v', 'ffv1', anamorphic], new AbortController().signal, binary)
  const scan = async (source: string) => analyzeVideoMotion({ requestId: 'geometry', source, startSeconds: 0, endSeconds: 1, sensitivity: 50, analysis: 'motion' }, new AbortController().signal, () => undefined, binary, workerPath)
  expect(await scan(portrait)).toMatchObject({ width: 180, height: 320, sampledFrames: 15 })
  expect(await scan(anamorphic)).toMatchObject({ width: 320, height: 240, sampledFrames: 15 })
  const normal = path.join(directory, 'normal.mp4'), rotated = path.join(directory, 'rotated.mp4')
  await runLoudnessFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=480x270:rate=15:duration=1', '-c:v', 'mpeg4', normal], new AbortController().signal, binary)
  await runLoudnessFfmpeg(['-y', '-display_rotation:v:0', '90', '-i', normal, '-c', 'copy', rotated], new AbortController().signal, binary)
  const geometry = await readVideoAnalysisGeometry(rotated)
  expect(geometry.aspectRatio).toBeCloseTo(16 / 9, 6); expect(Math.abs(geometry.rotation)).toBe(90)
  expect(await scan(rotated)).toMatchObject({ width: 320, height: 180, sampledFrames: 15 })
}, 20000)
it('取消真实解码后等待子进程与Worker释放；读取失败和不完整范围明确失败', async () => {
  const request = { requestId: 'cancel', source, startSeconds: 0, endSeconds: 4, sensitivity: 50, analysis: 'screen_changes' as const }
  const controller = new AbortController()
  await expect(analyzeScreenChanges(request, controller.signal, value => { if (value > 0) controller.abort(new Error('取消真实分析')) }, binary, workerPath)).rejects.toThrow()
  await expect(analyzeScreenChanges({ ...request, source: path.join(directory, 'missing.mkv') }, new AbortController().signal, () => undefined, binary, workerPath)).rejects.toThrow('解码失败')
  await expect(analyzeScreenChanges({ ...request, endSeconds: 10 }, new AbortController().signal, () => undefined, binary, workerPath)).rejects.toThrow('未完整覆盖')
}, 20000)
it('真实Worker接受跨帧采样块，拒绝并发、半帧和结束后继续使用，并可重复释放', async () => {
  const options = { width: 2, height: 1, channels: 3 as const, fps: 5, startSeconds: 0, endSeconds: 1 }
  const worker = new ScreenChangeWorker(options, workerPath)
  try {
    const first = worker.push(Uint8Array.of(0, 0, 0))
    await expect(worker.push(Uint8Array.of(0))).rejects.toThrow('一个在途')
    await first
    await worker.push(Uint8Array.of(0, 0, 0, 255, 255, 255, 0, 0, 0))
    expect(await worker.finish()).toMatchObject({ sampledFrames: 2, candidates: [{ atSeconds: .2 }] })
    await expect(worker.push(Uint8Array.of(0))).rejects.toThrow('已结束')
  } finally { await worker.dispose() }
  expect(worker.dispose()).toBe(worker.dispose())
  await expect(worker.push(new Uint8Array(6))).rejects.toThrow('已关闭')
  const incomplete = new ScreenChangeWorker(options, workerPath)
  try { await incomplete.push(Uint8Array.of(0)); await expect(incomplete.finish()).rejects.toThrow('不完整') }
  finally { await incomplete.dispose() }
}, 20000)
it('Worker缺失和取消在途采样都拒绝等待者，释放后不再接受采样', async () => {
  const options = { width: 480, height: 270, channels: 3 as const, fps: 5, startSeconds: 0, endSeconds: 1 }
  const missing = new ScreenChangeWorker(options, path.join(directory, 'missing-worker.cjs'))
  try { await expect(missing.push(Uint8Array.of(0))).rejects.toThrow() } finally { await missing.dispose() }
  const worker = new ScreenChangeWorker(options, workerPath)
  const pending = expect(worker.push(new Uint8Array(1024 * 1024))).rejects.toMatchObject({ name: 'AbortError' })
  await worker.dispose(); await pending
  await expect(worker.finish()).rejects.toThrow('已关闭')
}, 20000)

import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { LocalModelSessions, loadOnnxRuntime } from '../onnxRuntime'
import { OcrRecognitionPool } from './recognitionPool'
import { FrameOcr } from './frameOcr'
import { readRecognitionDictionary } from './recognition'
import { runOcrPrivacy } from './pipeline'
import { frameSelection, screenOcrFrames } from './screenFrames'
import { ffmpegFrames } from '../frameReader'
import type { OcrPrivacyJob } from './protocol'
import type { PrivacyBox } from '../../../../../src/core/screenRecording/privacy'

const models = process.env.HENJI_OCR_MODELS, worker = process.env.HENJI_OCR_WORKER
describe.skipIf(!models || !worker)('OCR 实模并发与编码录屏调度', () => {
  let sessions: LocalModelSessions
  afterAll(async () => { await sessions?.dispose() })
  async function prepare() {
    sessions ??= new LocalModelSessions(await loadOnnxRuntime(), () => undefined)
    const alphabet = readRecognitionDictionary(await fs.readFile(path.join(models!, 'ppocrv6_tiny_dict.txt'), 'utf8'))
    const detector = await sessions.open({ name: 'ppocr', path: path.join(models!, 'pp-ocrv6_tiny_det.onnx') }, ['cpu'], 'dynamic', { intraOpNumThreads: 4, allowSpinning: false })
    return { alphabet, detector }
  }
  it.skipIf(!process.env.HENJI_OCR_DENSE || !process.env.HENJI_OCR_CAPTURE)('正式三线程池稠密页实测、fp32/int8 文本差异和真实凭据逐字回归', async () => {
    const { alphabet, detector } = await prepare(), reports = []
    const dense = await sharp(process.env.HENJI_OCR_DENSE!).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const captured = await sharp(process.env.HENJI_OCR_CAPTURE!).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    for (const model of ['pp-ocrv6_tiny_rec.onnx', 'pp-ocrv6_tiny_rec_int8.onnx']) {
      const pool = new OcrRecognitionPool(path.join(models!, model), alphabet, 'rgb-half', worker)
      const rows = []
      try {
        for (let round = 0; round < 5; round++) {
          // Each frame gets an empty crop cache; only sessions are warm.
          const started = performance.now()
          const result = await new FrameOcr(detector, pool.recognize, alphabet).run(dense.data, dense.info.width, dense.info.height, new AbortController().signal)
          rows.push({ ms: performance.now() - started, ...result })
          expect(result.lines.length).toBeGreaterThanOrEqual(90)
        }
        const result = await new FrameOcr(detector, pool.recognize, alphabet).run(captured.data, captured.info.width, captured.info.height, new AbortController().signal)
        expect(result.lines.map(line => line.text)).toEqual(expect.arrayContaining(['demo@example.com', 'sk-testABCDEFGHIJKLMNOP1234']))
        reports.push({ model, targetMs: 200, hotMeanMs: rows.slice(2).reduce((s, row) => s + row.ms, 0) / 3, rows, captured: result.lines })
      } finally { await pool.dispose() }
    }
    await fs.mkdir('.tmp/ocr2', { recursive: true })
    await fs.writeFile('.tmp/ocr2/production.json', JSON.stringify(reports, null, 2))
  }, 120000)
  it.skipIf(!process.env.HENJI_OCR_VIDEO || !process.env.HENJI_OCR_FFMPEG || !process.env.HENJI_OCR_CURSOR)('带编码噪声与移动光标的原片，滚动后新邮箱不漏检，取消可中断扫描', async () => {
    const { alphabet } = await prepare(), cursor = JSON.parse(await fs.readFile(process.env.HENJI_OCR_CURSOR!, 'utf8')) as NonNullable<OcrPrivacyJob['cursor']>
    const job: OcrPrivacyJob = { id: 'native-scheduling', models: [{ name: 'ppocr', path: path.join(models!, 'pp-ocrv6_tiny_det.onnx') }, { name: 'ppocr_rec', path: path.join(models!, 'pp-ocrv6_tiny_rec.onnx') }], providers: ['cpu'], dictionaryPath: path.join(models!, 'ppocrv6_tiny_dict.txt'), source: process.env.HENJI_OCR_VIDEO!, ffmpegPath: process.env.HENJI_OCR_FFMPEG!, mediaId: 'fixture', seekSeconds: 0, durationSeconds: 30, startUs: 0, endUs: 30000000, fps: 10, display: { width: 3840, height: 2160 }, cursor }
    const pool = new OcrRecognitionPool(job.models[1].path, alphabet, 'rgb-half', worker)
    const controller = new AbortController(); let changes: readonly PrivacyBox[] = []
    try {
      const result = await runOcrPrivacy(job, { alphabet, signal: controller.signal, openModel: (...args) => sessions.open(...args), recognize: pool.recognize, changes: () => changes, frames: () => screenOcrFrames(job, controller.signal, () => undefined, value => { changes = value }), progress: () => undefined })
      expect(result.frames).toBe(300); expect(result.inferredFrames / result.frames).toBeLessThanOrEqual(.2)
      const first = result.privacy.candidates.filter(c => c.kind === 'email' && c.startUs === 0)
      const scrolled = result.privacy.candidates.filter(c => c.kind === 'email' && c.startUs === 18000000)
      expect(first).toHaveLength(1); expect(scrolled).toHaveLength(1)
      expect(scrolled[0].endUs).toBe(30000000)
      expect(first[0].fingerprint).not.toBe(scrolled[0].fingerprint)
      const cancelled = new AbortController()
      const iterator = screenOcrFrames(job, cancelled.signal, () => cancelled.abort(new Error('取消扫描')))
      await expect(iterator.next()).rejects.toThrow('取消')
    } finally { await pool.dispose() }
  }, 120000)
  it.skipIf(!process.env.HENJI_OCR_STATIC || !process.env.HENJI_OCR_FFMPEG)('静止编码画面只选首帧，超长选择表达式走临时滤镜文件且不补帧', async () => {
    const job: OcrPrivacyJob = { id: 'static', models: [], providers: ['cpu'], dictionaryPath: '', source: process.env.HENJI_OCR_STATIC!, ffmpegPath: process.env.HENJI_OCR_FFMPEG!, mediaId: 'fixture', seekSeconds: 0, durationSeconds: 3, startUs: 0, endUs: 3000000, fps: 10, display: { width: 3840, height: 2160 } }
    let count = 0, selected = 0
    for await (const _frame of screenOcrFrames(job, new AbortController().signal, () => undefined, changes => { if (changes.length) selected++ })) count++
    expect(count).toBe(30); expect(selected).toBe(1)
    const selection = frameSelection(Array.from({ length: 3000 }, (_, i) => i * 100))
    expect(selection.length).toBeGreaterThan(16000)
    let frames = 0
    for await (const _frame of ffmpegFrames(job.ffmpegPath, job, { width: 16, height: 16 }, new AbortController().signal, selection)) frames++
    expect(frames).toBe(1)
  }, 30000)
})

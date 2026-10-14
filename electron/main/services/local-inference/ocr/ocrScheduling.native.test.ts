import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { LocalModelSessions, loadOnnxRuntime } from '../onnxRuntime'
import { OcrRecognitionPool } from './recognitionPool'
import { FrameOcr, withOcrImageBudget } from './frameOcr'
import { readRecognitionDictionary, RECOGNITION_BATCH_POLICY } from './recognition'
import { runOcrPrivacy } from './pipeline'
import { frameSelection, screenOcrFrames } from './screenFrames'
import { ffmpegFrames } from '../frameReader'
import type { OcrPrivacyJob } from './protocol'
import type { PrivacyBox } from '../../../../../src/core/screenRecording/privacy'
import { sensitiveTextMatches } from '../../../../../src/core/screenRecording/privacy'

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
    const { alphabet, detector } = await prepare()
    const dense = await sharp(process.env.HENJI_OCR_DENSE!).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const captured = await sharp(process.env.HENJI_OCR_CAPTURE!).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const reports = await withOcrImageBudget(async () => {
      const reports = []
      for (const model of ['pp-ocrv6_tiny_rec.onnx', 'pp-ocrv6_tiny_rec_int8.onnx']) {
        const modelPath = model.includes('int8') ? path.resolve('resources/local-models/text_recognition_ppocr', model) : path.join(models!, model)
        const pool = new OcrRecognitionPool(modelPath, alphabet, 'rgb-half', worker)
        const rows = []
        try {
          for (let round = 0; round < 25; round++) {
            // Each frame gets an empty crop cache; only sessions are warm.
            const started = performance.now()
            const result = await new FrameOcr(detector, pool.recognize, alphabet).run(dense.data, dense.info.width, dense.info.height, new AbortController().signal)
            rows.push({ ms: performance.now() - started, ...result })
            expect(result.lines.length).toBeGreaterThanOrEqual(90)
          }
          const result = await new FrameOcr(detector, pool.recognize, alphabet).run(captured.data, captured.info.width, captured.info.height, new AbortController().signal)
          expect(result.lines.map(line => line.text)).toEqual(expect.arrayContaining(['demo@example.com', 'sk-testABCDEFGHIJKLMNOP1234']))
          const hot = rows.slice(5).map(row => row.ms).sort((a, b) => a - b)
          reports.push({ model, targetMs: 200, acceptanceMs: 210, hotMeanMs: hot.reduce((s, ms) => s + ms, 0) / hot.length, hotMedianMs: (hot[9] + hot[10]) / 2, hotP95Ms: hot[18], rows, captured: result.lines })
        } finally { await pool.dispose() }
      }
      return reports
    })
    await fs.mkdir('.tmp/ocr2', { recursive: true })
    await fs.writeFile('.tmp/ocr2/production.json', JSON.stringify(reports, null, 2))
    // Opt-in hardware benchmark: keep failure evidence before enforcing the agreed hot-frame budget.
    expect(reports.find(report => report.model.includes('int8'))!.hotMeanMs).toBeLessThanOrEqual(210)
  }, 120000)
  it.skipIf(!process.env.HENJI_OCR_SCREEN)('随包 int8 与 fp32 的中英混排 CER 不下降，假邮箱和密钥逐字召回', async () => {
    const { alphabet, detector } = await prepare()
    const texts = ['Screen recording privacy review', 'demo@example.com', 'sk-testABCDEFGHIJKLMNOP1234', 'Normal text stays visible', '中文屏幕录制隐私检查', 'Scroll to review the next step']
    const svg = `<svg width="3840" height="2160"><rect width="3840" height="2160" fill="white"/>${texts.map((text, i) => `<text x="160" y="${200 + i * 160}" font-family="Microsoft YaHei" font-size="48" fill="black">${text}</text>`).join('')}</svg>`
    const privacy = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer()
    const screen = await sharp(process.env.HENJI_OCR_SCREEN!).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const truth = ['FlashOCR截图识别验收测试', 'Rust+ONNXRuntime最小可验证项目MVP', 'Detection+Recognition+CTCDecode', '小字号文本测试：疾风知劲草board1234567890', 'fnmain(){letx=vec![1,2,3];}', 'ifscore>=0.6{accept(line);}', '第二栏：多栏布局测试', 'Englishmixed中文mixed12345', '符号测试!@#$%^&*()_+-=[]{};:,.<>/?', '底部一行文字0123456789']
    const reports = []
    // Compare against both the former fp32 batching and current batching, so a policy regression cannot mask quantization loss.
    for (const [model, pixelBudget] of [['pp-ocrv6_tiny_rec.onnx', 4096], ['pp-ocrv6_tiny_rec.onnx', RECOGNITION_BATCH_POLICY.pixelBudget], ['pp-ocrv6_tiny_rec_int8.onnx', RECOGNITION_BATCH_POLICY.pixelBudget]] as const) {
      const modelPath = model.includes('int8') ? path.resolve('resources/local-models/text_recognition_ppocr', model) : path.join(models!, model)
      const pool = new OcrRecognitionPool(modelPath, alphabet, 'rgb-half', worker, undefined, undefined, { ...RECOGNITION_BATCH_POLICY, pixelBudget })
      try {
        const ocr = (): FrameOcr => new FrameOcr(detector, pool.recognize, alphabet)
        const sensitive = await ocr().run(privacy, 3840, 2160, new AbortController().signal)
        expect(sensitive.lines.map(l => l.text)).toEqual(expect.arrayContaining(texts))
        expect(sensitive.lines.flatMap(l => sensitiveTextMatches(l.text)).map(m => m.kind)).toEqual(expect.arrayContaining(['email', 'secret']))
        const result = await ocr().run(screen.data, screen.info.width, screen.info.height, new AbortController().signal)
        const remaining = result.lines.filter(l => l.confidence >= .5).map(l => l.text.replaceAll(' ', ''))
        let errors = 0
        for (const text of truth) {
          const distances = remaining.map(line => editDistance(text, line)), index = distances.indexOf(Math.min(...distances))
          errors += index < 0 ? text.length : distances[index]
          if (index >= 0) remaining.splice(index, 1)
        }
        reports.push({ model, pixelBudget, errors, cer: errors / truth.join('').length, lines: result.lines, sensitive: sensitive.lines })
      } finally { await pool.dispose() }
    }
    await fs.mkdir('.tmp/ocr3', { recursive: true })
    await fs.writeFile('.tmp/ocr3/accuracy-native.json', JSON.stringify(reports, null, 2))
    expect(reports[2].cer).toBeLessThanOrEqual(reports[0].cer)
    expect(reports[2].cer).toBeLessThanOrEqual(reports[1].cer)
  }, 120000)
  it.skipIf(!process.env.HENJI_OCR_VIDEO || !process.env.HENJI_OCR_FFMPEG || !process.env.HENJI_OCR_CURSOR)('带编码噪声与移动光标的原片，滚动后新邮箱不漏检，取消可中断扫描', async () => {
    const { alphabet } = await prepare(), cursor = JSON.parse(await fs.readFile(process.env.HENJI_OCR_CURSOR!, 'utf8')) as NonNullable<OcrPrivacyJob['cursor']>
    const job: OcrPrivacyJob = { id: 'native-scheduling', models: [{ name: 'ppocr', path: path.resolve('resources/local-models/text_detection_ppocr/pp-ocrv6_tiny_det.onnx') }, { name: 'ppocr_rec', path: path.resolve('resources/local-models/text_recognition_ppocr/pp-ocrv6_tiny_rec_int8.onnx') }], providers: ['cpu'], dictionaryPath: path.join(models!, 'ppocrv6_tiny_dict.txt'), source: process.env.HENJI_OCR_VIDEO!, ffmpegPath: process.env.HENJI_OCR_FFMPEG!, mediaId: 'fixture', seekSeconds: 0, durationSeconds: 30, startUs: 0, endUs: 30000000, fps: 10, display: { width: 3840, height: 2160 }, cursor }
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

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1]
    for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(a[i] !== b[j])))
    row = next
  }
  return row[b.length]
}

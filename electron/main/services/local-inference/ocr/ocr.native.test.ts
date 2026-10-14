import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { LocalModelSessions, loadOnnxRuntime } from '../onnxRuntime'
import { FrameOcr } from './frameOcr'
import { readRecognitionDictionary, type RecognitionNormalization } from './recognition'
import { sensitiveTextMatches } from '../../../../../src/core/screenRecording/privacy'
import { ppocrInput, ppocrInputSize, TEXT_DETECTION_PRESETS, textBoxesFromMap } from '../analyzers/textDetection'

/** Explicit real-weight suite: HENJI_OCR_MODELS=<isolated weights> npx vitest run <this file> --pool=forks --maxWorkers=1 */
const models = process.env.HENJI_OCR_MODELS
describe.skipIf(!models)('PP-OCRv6 真实权重', () => {
  let sessions: LocalModelSessions
  afterAll(async () => { await sessions?.dispose() })
  async function engine(tier: string, normalization: RecognitionNormalization, threads: number): Promise<FrameOcr> {
    sessions ??= new LocalModelSessions(await loadOnnxRuntime(), () => undefined)
    const detector = await sessions.open({ name: 'ppocr', path: path.join(models!, 'pp-ocrv6_tiny_det.onnx') }, ['cpu'], 'dynamic', { intraOpNumThreads: threads })
    const recognizer = await sessions.open({ name: 'ppocr_rec', path: path.join(models!, `pp-ocrv6_${tier}_rec.onnx`) }, ['cpu'], 'dynamic', { intraOpNumThreads: threads })
    const alphabet = readRecognitionDictionary(await fs.readFile(path.join(models!, tier === 'tiny' ? 'ppocrv6_tiny_dict.txt' : 'ppocrv6_dict.txt'), 'utf8'))
    return new FrameOcr(detector, recognizer, alphabet, normalization)
  }
  it('原图裁片、行召回、CER、框 IoU 与假邮箱/密钥召回', async () => {
    const texts = ['Screen recording privacy review', 'demo@example.com', 'sk-testABCDEFGHIJKLMNOP1234', 'Normal text stays visible', '中文屏幕录制隐私检查', 'Scroll to review the next step']
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2160"><rect width="3840" height="2160" fill="white"/>${texts.map((text, i) => `<text x="160" y="${200 + i * 160}" font-family="Microsoft YaHei" font-size="48" fill="black">${text}</text>`).join('')}</svg>`
    const rgb = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer()
    const reports = []
    for (const tier of ['tiny', 'small']) for (const normalization of ['rgb-half', 'bgr-unit'] as const) {
      const ocr = await engine(tier, normalization, 4), result = await ocr.run(rgb, 3840, 2160, new AbortController().signal)
      const lines = result.lines.filter(l => l.confidence >= 0.5)
      const pairs = texts.map((text, i) => ({ text, line: lines.find(l => Math.abs((l.box[1] + l.box[3] / 2) * 2160 - (180 + i * 160)) < 50) }))
      const errors = pairs.reduce((sum, p) => sum + editDistance(p.text.replaceAll(' ', ''), (p.line?.text ?? '').replaceAll(' ', '')), 0)
      const cer = errors / texts.join('').replaceAll(' ', '').length
      const sensitive = lines.flatMap(l => sensitiveTextMatches(l.text)).map(m => m.kind)
      reports.push({ tier, normalization, cer, recall: pairs.filter(p => p.line).length / texts.length, sensitive, ...result, lines })
      if (tier === 'tiny' && normalization === 'rgb-half') {
        expect(pairs.every(p => p.line)).toBe(true)
        expect(cer).toBeLessThanOrEqual(0.05)
        expect(sensitive).toEqual(expect.arrayContaining(['email', 'secret']))
        // Ground truth bounds come from the actual rendered pixels for each known line band.
        for (const [i, pair] of pairs.entries()) {
          let x0 = 3840, y0 = 2160, x1 = 0, y1 = 0
          for (let y = 120 + i * 160; y < 220 + i * 160; y++) for (let x = 100; x < 1800; x++) {
            if (rgb[(y * 3840 + x) * 3] < 100) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1) }
          }
          const b = pair.line!.box, a = [x0, y0, x1 - x0, y1 - y0], detected = [b[0] * 3840, b[1] * 2160, b[2] * 3840, b[3] * 2160]
          expect(iou(a, detected)).toBeGreaterThanOrEqual(0.5)
        }
      }
    }
    await fs.mkdir('.tmp/ocr', { recursive: true })
    await fs.writeFile('.tmp/ocr/accuracy.json', JSON.stringify(reports, null, 2))
    await sharp(rgb, { raw: { width: 3840, height: 2160, channels: 3 } }).png().toFile('.tmp/ocr/privacy.png')
  }, 120000)
  it.skipIf(!process.env.HENJI_OCR_DENSE)('4K 稠密页热态基准（禁用缓存，每次都识别所有行）', async () => {
    const { data, info } = await sharp(process.env.HENJI_OCR_DENSE!).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const reports = []
    for (const tier of ['tiny', 'small']) for (const threads of [2, 4, 6]) {
      const rows = []
      for (let i = 0; i < 4; i++) {
        // A new job cache with the same resident sessions measures actual inference, never cache hits.
        const ocr = await engine(tier, 'rgb-half', threads), started = performance.now()
        const result = await ocr.run(data, info.width, info.height, new AbortController().signal)
        rows.push({ ms: performance.now() - started, det: result.detectionMs, rec: result.recognitionMs, lines: result.lines.length })
      }
      reports.push({ tier, threads, rows })
    }
    await fs.mkdir('.tmp/ocr', { recursive: true })
    await fs.writeFile('.tmp/ocr/dense.json', JSON.stringify(reports, null, 2))
    const hot = reports.find(r => r.tier === 'tiny' && r.threads === 4)!.rows.slice(1)
    expect(Math.max(...hot.map(r => r.ms))).toBeLessThanOrEqual(400)
    // eslint-disable-next-line no-console -- Explicit native benchmark evidence.
    console.log(JSON.stringify(reports))
  }, 180000)
  it.skipIf(!process.env.HENJI_OCR_SCREEN)('FlashOCR 同图多字号中英混排评测与检测后端/字幕预设回归', async () => {
    const { data, info } = await sharp(process.env.HENJI_OCR_SCREEN!).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const truth = ['FlashOCR截图识别验收测试', 'Rust+ONNXRuntime最小可验证项目MVP', 'Detection+Recognition+CTCDecode', '小字号文本测试：疾风知劲草board1234567890', 'fnmain(){letx=vec![1,2,3];}', 'ifscore>=0.6{accept(line);}', '第二栏：多栏布局测试', 'Englishmixed中文mixed12345', '符号测试!@#$%^&*()_+-=[]{};:,.<>/?', '底部一行文字0123456789']
    const reports = []
    for (const tier of ['tiny', 'small']) for (const normalization of ['rgb-half', 'bgr-unit'] as const) {
      const ocr = await engine(tier, normalization, 4)
      const result = await ocr.run(data, info.width, info.height, new AbortController().signal)
      const remaining = result.lines.filter(l => l.confidence >= .5).map(l => l.text.replaceAll(' ', ''))
      let errors = 0
      for (const text of truth) {
        const distances = remaining.map(line => editDistance(text, line)), index = distances.indexOf(Math.min(...distances))
        errors += index >= 0 ? distances[index] : text.length
        if (index >= 0) remaining.splice(index, 1)
      }
      reports.push({ tier, normalization, cer: errors / truth.join('').length, ...result })
    }
    const size = ppocrInputSize(info.width, info.height), scaled = await sharp(data, { raw: { ...info, channels: 3 } }).resize(size.width, size.height, { kernel: 'linear' }).raw().toBuffer()
    const feeds = { x: { type: 'float32' as const, data: ppocrInput(scaled, size.width, size.height), dims: [1, 3, size.height, size.width] } }
    const backends = []
    for (const provider of process.platform === 'win32' ? ['cpu', 'dml'] as const : ['cpu'] as const) {
      const started = performance.now()
      const runner = await sessions.open({ name: 'ppocr', path: path.join(models!, 'pp-ocrv6_tiny_det.onnx') }, [provider], `${size.width}x${size.height}`, { intraOpNumThreads: 4 })
      const loadMs = performance.now() - started, rows = []
      for (let n = 0; n < 4; n++) {
        const t = performance.now(), output = Object.values(await runner.run(feeds))[0]
        rows.push(performance.now() - t)
        expect(output.data).toBeInstanceOf(Float32Array)
        const subtitle = textBoxesFromMap(output.data as Float32Array, size.width, size.height, TEXT_DETECTION_PRESETS.subtitle)
        expect(subtitle.length).toBeGreaterThanOrEqual(10)
      }
      backends.push({ provider: runner.provider, loadMs, rows })
    }
    await fs.mkdir('.tmp/ocr', { recursive: true })
    await fs.writeFile('.tmp/ocr/screen.json', JSON.stringify({ reports, backends }, null, 2))
  }, 120000)
  it.skipIf(!process.env.HENJI_OCR_CAPTURE)('真实 4K/150% 录制帧的敏感信息召回', async () => {
    const { data, info } = await sharp(process.env.HENJI_OCR_CAPTURE!).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([3840, 2160])
    const reports = []
    for (const tier of ['tiny', 'small']) {
      const ocr = await engine(tier, tier === 'tiny' ? 'rgb-half' : 'bgr-unit', 4)
      const result = await ocr.run(data, info.width, info.height, new AbortController().signal)
      const texts = result.lines.map(l => l.text)
      expect(texts).toEqual(expect.arrayContaining(['demo@example.com', 'sk-testABCDEFGHIJKLMNOP1234']))
      reports.push({ tier, ...result })
    }
    await fs.mkdir('.tmp/ocr', { recursive: true })
    await fs.writeFile('.tmp/ocr/capture.json', JSON.stringify(reports, null, 2))
  }, 120000)
  it.skipIf(!process.env.HENJI_OCR_EXPORT)('确认后真实导出在滚动前后遮住凭据，并保留普通文字', async () => {
    const reports = []
    for (const second of [0.5, 2.8]) {
      const { data, info } = await sharp(path.join(process.env.HENJI_OCR_EXPORT!, `export-${second}.png`)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      const result = await (await engine('tiny', 'rgb-half', 4)).run(data, info.width, info.height, new AbortController().signal)
      expect(result.lines.flatMap(l => sensitiveTextMatches(l.text))).toEqual([])
      const ordinary = result.lines.find(l => l.text === 'Normal text stays visible')
      expect(ordinary).toBeDefined()
      expect(result.lines.map(l => l.text)).toContain('中文录屏隐私检查')
      reports.push({ second, ordinaryY: ordinary!.box[1], ...result })
    }
    expect(reports[0].ordinaryY - reports[1].ordinaryY).toBeGreaterThan(0.05)
    await fs.mkdir('.tmp/ocr', { recursive: true })
    await fs.writeFile('.tmp/ocr/export.json', JSON.stringify(reports, null, 2))
  }, 120000)
})
function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 0; i < a.length; i++) { const next = [i + 1]; for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(a[i] !== b[j]))); row = next }
  return row[b.length]
}
function iou(a: number[], b: number[]): number {
  const area = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]))
  return area / (a[2] * a[3] + b[2] * b[3] - area)
}

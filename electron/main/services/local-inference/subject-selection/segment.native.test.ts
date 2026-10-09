import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { loadOnnxRuntime, LocalModelSessions } from '../onnxRuntime'
import { runImageSubjectSelection } from './segment'
import type { ImageSubjectSelectionJob } from './protocol'
import type { LocalInferenceModelFile } from '../protocol'

const modelRoot = process.env.HENJI_SUBJECT_MODELS, report = process.env.HENJI_SUBJECT_REPORT
// 显式真实模型，无下载、不启动Electron。模型会话/预后处理计时，不冒充屏幕呈现。
describe.skipIf(!modelRoot || !report)('静态主体 CPU/DirectML 原生证据', () => {
  it('点框、自动多主体及 RVM/Selfie 同图运行，遮罩与性能写到仓库外', async () => {
    await fs.mkdir(report!, { recursive: true })
    const base = await sharp('tests/fixtures/image-inpainting/astronaut.png').resize(512, 512).ensureAlpha().raw().toBuffer()
    const models: LocalInferenceModelFile[] = [
      { name: 'etam_image_encoder', path: path.join(modelRoot!, 'object_segmentation_efficienttam/efficienttam_ti_512_image_encoder.onnx') },
      { name: 'etam_mask_decoder', path: path.join(modelRoot!, 'object_segmentation_efficienttam/efficienttam_ti_512_mask_decoder.onnx') },
      { name: 'rvm', path: path.join(modelRoot!, 'person_matting_rvm/rvm_mobilenetv3_fp16.onnx') },
      { name: 'selfie', path: path.join(modelRoot!, 'selfie_segmentation/mediapipe_selfie_segmentation_fp16.onnx') },
    ]
    const rows: Record<string, unknown>[] = []
    const regions: Array<[string, ImageSubjectSelectionJob['region']]> = [
      ['point', { kind: 'point', points: [{ x: 0.25, y: 0.65, foreground: true }] }],
      ['box', { kind: 'box', x: 0.1, y: 0.05, width: 0.75, height: 0.9 }],
      ['auto', { kind: 'subject' }], ['portrait', { kind: 'portrait', quality: 'fine' }], ['selfie', { kind: 'portrait', quality: 'fast' }],
    ]
    for (const requested of ['cpu', 'dml'] as const) {
      const logs: Record<string, unknown>[] = [], pool = new LocalModelSessions(await loadOnnxRuntime(), (_level, _message, event, context) => logs.push({ event, ...context }))
      try {
        for (const [label, region] of regions) {
          for (let repeat = 0; repeat < (label === 'point' ? 3 : 1); repeat++) {
            const result = await runImageSubjectSelection({ id: `${label}-${requested}-${repeat}`, width: 512, height: 512, rgba: new Uint8Array(base).buffer, region, models,
              providers: requested === 'dml' ? ['dml', 'cpu'] : ['cpu'] }, { signal: new AbortController().signal, openModel: (file, providers, shape) => pool.open(file, providers, shape), log: () => undefined, progress: () => undefined })
            rows.push({ label, requested, repeat, model: result.model, actual: result.providers, durationMs: result.durationMs, inferenceMs: result.inferenceMs, candidates: result.candidates.map(c => ({ score: c.score, area: c.area, bounds: c.bounds })) })
            expect(result.candidates.length).toBeGreaterThan(0)
            if (repeat === 0) {
              const rgba = new Uint8Array(base)
              const mask = result.candidates[0].mask, data = new Uint8Array(mask.width * mask.height)
              for (const [offset, length, value] of mask.runs) data.fill(value, offset, offset + length)
              const resized = await sharp(data, { raw: { width: mask.width, height: mask.height, channels: 1 } }).resize(512, 512).toColourspace('b-w').raw().toBuffer()
              for (let i = 0; i < resized.length; i++) { const a = resized[i] / 255 * 0.45; rgba[i * 4] = Math.round(rgba[i * 4] * (1 - a)); rgba[i * 4 + 1] = Math.round(rgba[i * 4 + 1] * (1 - a) + 200 * a); rgba[i * 4 + 2] = Math.round(rgba[i * 4 + 2] * (1 - a) + 255 * a) }
              await sharp(rgba, { raw: { width: 512, height: 512, channels: 4 } }).png().toFile(path.join(report!, `${label}-${requested}.png`))
            }
          }
        }
      } finally { await pool.dispose(); await fs.writeFile(path.join(report!, `${requested}-fallbacks.json`), JSON.stringify(logs, null, 2)) }
    }
    await fs.writeFile(path.join(report!, 'subject-metrics.json'), JSON.stringify({ machine: { cpu: os.cpus()[0].model, node: process.version }, excludes: ['model download', 'renderer tile sampling', 'IPC', 'screen presentation'], rows }, null, 2))
  }, 300_000)
  it('真实双人图返回多主体候选而不猜定一个身份', async () => {
    const person = await sharp('tests/fixtures/image-inpainting/astronaut.png').resize(256, 256).png().toBuffer()
    const rgba = await sharp({ create: { width: 512, height: 512, channels: 4, background: 'white' } }).composite([{ input: person, left: 0, top: 128 }, { input: person, left: 256, top: 128 }]).ensureAlpha().raw().toBuffer()
    const pool = new LocalModelSessions(await loadOnnxRuntime(), () => undefined), rows: Record<string, unknown>[] = []
    try {
      for (const kind of ['subject', 'portrait'] as const) {
        const models: LocalInferenceModelFile[] = kind === 'portrait' ? [{ name: 'rvm', path: path.join(modelRoot!, 'person_matting_rvm/rvm_mobilenetv3_fp16.onnx') }]
          : [{ name: 'etam_image_encoder', path: path.join(modelRoot!, 'object_segmentation_efficienttam/efficienttam_ti_512_image_encoder.onnx') }, { name: 'etam_mask_decoder', path: path.join(modelRoot!, 'object_segmentation_efficienttam/efficienttam_ti_512_mask_decoder.onnx') }]
        const result = await runImageSubjectSelection({ id: `two-${kind}`, width: 512, height: 512, rgba: new Uint8Array(rgba).buffer, region: kind === 'portrait' ? { kind, quality: 'fine' } : { kind }, models, providers: ['cpu'] }, { signal: new AbortController().signal, openModel: (file, providers, shape) => pool.open(file, providers, shape), log: () => undefined, progress: () => undefined })
        expect(result.candidates.length).toBeGreaterThanOrEqual(2)
        rows.push({ kind, candidates: result.candidates.map(({ mask: _mask, ...candidate }) => candidate), providers: result.providers, durationMs: result.durationMs })
      }
      await sharp(rgba, { raw: { width: 512, height: 512, channels: 4 } }).png().toFile(path.join(report!, 'two-people-source.png'))
      await fs.writeFile(path.join(report!, 'two-people-metrics.json'), JSON.stringify(rows, null, 2))
    } finally { await pool.dispose() }
  }, 60_000)

})

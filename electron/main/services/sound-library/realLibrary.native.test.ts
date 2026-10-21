import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createContentDiskCache } from '../media/content-disk-cache'
import { LocalModelSessions, loadOnnxRuntime } from '../local-inference/onnxRuntime'
import { executionProviderOrder } from '../local-inference/providers'
import { runSoundAnalysis, runSoundTextEmbedding } from '../local-inference/sound/analyze'
import type { SoundClapModels } from '../local-inference/sound/protocol'
import type { SoundLibraryFolderRecord } from '../../../../src/core/soundLibrary/soundLibraryFolders'
import { SoundLibraryService } from './service'

/*
 * 真实音效库验收（不进普通单测）：HENJI_SOUND_LIBRARY 指向用户音效文件夹，HENJI_FFMPEG 指向 ffmpeg，
 * HENJI_CLAP_MODELS 可选（缺省时只验证不依赖模型的名字检索与降级）。输出建索引耗时与检索命中，供标定阈值。
 */
const root = process.env.HENJI_SOUND_LIBRARY, ffmpeg = process.env.HENJI_FFMPEG, models = process.env.HENJI_CLAP_MODELS
const report = process.env.HENJI_SOUND_REPORT
const clap: SoundClapModels | null = models ? { audioModelPath: path.join(models, 'larger_clap_general_audio_fp16.onnx'), textModelPath: path.join(models, 'larger_clap_general_text_fp16.onnx'), tokenizerPath: path.join(models, 'tokenizer.json'), tokenizerConfigPath: path.join(models, 'tokenizer_config.json') } : null

describe.skipIf(!root || !ffmpeg)('真实音效库', () => {
  let pool: LocalModelSessions | undefined
  const openModel = async (model: Parameters<LocalModelSessions['open']>[0], providers: Parameters<LocalModelSessions['open']>[1], shape: string) => (pool ??= new LocalModelSessions(await loadOnnxRuntime(), () => undefined)).open(model, providers, shape)
  afterAll(async () => { await pool?.dispose() })
  const lines: string[] = []
  const service = async (cacheDir: string, withModel: boolean) => {
    const folders: SoundLibraryFolderRecord[] = [{ id: '00000000-0000-4000-8000-000000000001', path: root!, addedAt: new Date().toISOString() }]
    return new SoundLibraryService({
      readFolders: async () => folders, writeFolders: async () => undefined, chooseFolder: async () => null, allowFolder: folder => folder,
      analyze: (files, models, progress) => runSoundAnalysis({ id: 'a', ffmpegPath: ffmpeg!, files: files.map(file => ({ path: file })), ...(models ? { clap: models } : {}), providers: executionProviderOrder(process.platform) }, { openModel, signal: new AbortController().signal, progress, log: () => undefined }),
      embedText: async (models, texts) => (await runSoundTextEmbedding({ id: 't', clap: models, texts, providers: executionProviderOrder(process.platform) }, { openModel, signal: new AbortController().signal, log: () => undefined })).embeddings,
      clapModels: async () => withModel ? clap : null,
      cache: createContentDiskCache({ directory: () => cacheDir, extension: '.json' }),
      emit: () => undefined, log: (level, message, event, context) => { if (event === 'sound_library.index.completed') lines.push(`${message} ${JSON.stringify(context)}`) },
    })
  }

  it('首次整理、再次整理命中缓存；坏文件跳过并说明', async () => {
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-sound-cache-'))
    const library = await service(cacheDir, Boolean(clap))
    let started = performance.now()
    const state = await library.refresh()
    const first = performance.now() - started
    const folder = state.folders[0]
    started = performance.now()
    await (await service(cacheDir, Boolean(clap))).refresh()
    const second = performance.now() - started
    lines.unshift(`首次整理 ${(first / 1000).toFixed(1)}s，重启后命中缓存 ${(second / 1000).toFixed(2)}s；音效 ${folder.soundCount}，听音向量 ${folder.listeningCount}，跳过 ${folder.skipped.length}：${folder.skipped.map(file => `${file.relativePath}（${file.reason}）`).join('；')}`)
    expect(folder.soundCount).toBeGreaterThan(600)
    expect(folder.skipped.some(file => file.relativePath.includes('Umbrella'))).toBe(true)
    expect(second).toBeLessThan(first / 5)
    if (report) await fs.writeFile(path.join(report, 'index.txt'), lines.join('\n'))
    await fs.rm(cacheDir, { recursive: true, force: true })
  }, 900_000)

  it('名字检索与击中点；模型未下载时降级为只按名字', async () => {
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-sound-cache-'))
    const library = await service(cacheDir, false)
    const result = await library.search({ keywords: ['whoosh', '嗖'], description: 'a fast whoosh', maxDurationSeconds: 1.5, limit: 10 })
    expect(result.listening).toBe('model_not_downloaded')
    expect(result.matches.length).toBe(10)
    expect(result.matches.every(match => match.durationSeconds <= 1.5)).toBe(true)
    expect(result.noGoodMatch).toBe(false)
    const none = await library.search({ keywords: ['applause', '掌声'], limit: 5 })
    expect(none.noGoodMatch).toBe(true)
    expect((await library.search({ keywords: ['heartbeat', '心跳'], limit: 1 })).matches[0].relativePath).toContain('Heart beat')
    const hit = (await library.search({ keywords: ['嗖02'], limit: 1 })).matches[0]
    if (report) await fs.writeFile(path.join(report, 'name.txt'), [JSON.stringify(result.matches.map(match => [match.relativePath, match.durationSeconds.toFixed(2), match.hitSeconds.toFixed(3)])), JSON.stringify(hit)].join('\n'))
    await fs.rm(cacheDir, { recursive: true, force: true })
  }, 900_000)
})

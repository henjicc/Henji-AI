import fs from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
import { applyAudioEditGainRegions, audioEditSoundRecipe, type AudioEditGainRegion, type AudioEditRenderedAudio, type AudioEditRepair } from '../../../../src/core/audioEdit/regions'
import { buildProjectAudioEditTimeline, editedDurationFrames } from '../../../../src/core/audioEdit/timeline'
import { audioEditProjectSchema } from '../../../../src/core/audioEdit/schema'
import { createMainLogger } from '../logging'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { audioEditCacheDirectory, identifyAudioEditSource, prepareAudioEditAudio, validateAudioEditAudio, verifyAudioEditSource } from './media'
import { processAudioEditVstChain, audioEditProcessorCacheIdentity } from './processors'
import { runAudioRepair, audioRepairMaskDimensions, encodeAudioRepairMask } from './dsp-adapter'
import { audioRenderKey, cachedAudioFile } from './render-cache'
import { runAudioEditProcess } from './process'
import { AudioEditSpliceRenderer } from '../../../../src/core/audioEdit/spliceCrossfade'
import { createF32WavWriter, openF32Wav, type F32WavReader } from './pcm-wav'

const logger = createMainLogger('main.audio_edit.render')

/**
 * 音量区域在主进程按一秒一块直接乘到声音上。不再拼成一条 FFmpeg aeval 表达式：表达式解析器的嵌套深度有限，
 * 区域到一百个左右（快节奏处理呼吸声常有上百处减弱）就无法配置滤镜，口播一打开就报错；逐采样求值上百项也慢。
 */
async function renderAudioEditGains(project: AudioEditProjectDocument, reader: F32WavReader, gains: readonly AudioEditGainRegion[], output: string, signal?: AbortSignal): Promise<void> {
  const { sampleRate, channels } = project.source
  const sorted = [...gains].sort((a, b) => a.startFrame - b.startFrame)
  const writer = await createF32WavWriter(output, sampleRate, channels, reader.frames)
  try {
    for (let start = 0; start < reader.frames; start += sampleRate) {
      signal?.throwIfAborted()
      const count = Math.min(sampleRate, reader.frames - start)
      const pcm = (await reader.read(start, count)).slice()
      applyAudioEditGainRegions(pcm, start, channels, sorted.filter(region => region.startFrame < start + count && region.endFrame > start))
      await writer.write(pcm)
    }
  } finally { await writer.close(); await reader.close() }
}
async function repairMask(repair: AudioEditRepair, sampleRate: number, signal?: AbortSignal): Promise<Uint8Array> {
  const { width, height } = audioRepairMaskDimensions(repair, sampleRate)
  const worker = new Worker(path.join(__dirname, 'audio-edit-mask-worker.cjs'), { workerData: { strokes: repair.strokes, width, height } })
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      const abort = (): void => { reject(signal?.reason ?? new Error('修复已取消')); void worker.terminate() }
      signal?.addEventListener('abort', abort, { once: true })
      const cleanup = (): void => signal?.removeEventListener('abort', abort)
      worker.once('message', (bytes: Uint8Array) => { cleanup(); resolve(encodeAudioRepairMask(bytes, width, height)) })
      worker.once('error', error => { cleanup(); reject(error) })
      worker.once('exit', code => { cleanup(); if (code !== 0) reject(new Error(`画笔计算未完成：${code}`)) })
      if (signal?.aborted) abort()
    })
  } finally { await worker.terminate() }
}

/** Source-time stages shared by preview, XML, finished WAV and dynamic links. Cuts never enter this cache key. */
export async function prepareAudioEditRenderSource(project: AudioEditProjectDocument, processing = project.vstEnabled, signal?: AbortSignal): Promise<string> {
  audioEditProjectSchema.parse(project)
  await verifyAudioEditSource(project, false, signal)
  const identity = project.source.identity ?? await identifyAudioEditSource(project.source.sourcePath, signal)
  const directory = audioEditCacheDirectory(project.id)
  let key = audioRenderKey(['audio-render-v1', identity.digest, project.source.sampleRate, project.source.channels, project.source.audioStreamIndex])
  let input = await prepareAudioEditAudio(project, signal)
  for (const repair of (project.repairs ?? []).filter(r => r.enabled && r.strength > 0)) {
    const { id: _id, enabled: _enabled, ...recipe } = repair
    key = audioRenderKey([key, recipe])
    const source = input
    input = await cachedAudioFile(directory, `repair-${key}`, 'wav', async output => {
      const mask = repair.strokes?.length ? `${output}.mask` : undefined
      try {
        if (mask) await fs.writeFile(mask, await repairMask(repair, project.source.sampleRate, signal))
        await runAudioRepair(source, output, repair, mask, signal)
        await validateAudioEditAudio(output, project.source.sampleRate, project.source.channels, project.source.durationFrames, signal)
      } finally { if (mask) await removeUnmanagedCachePath(mask, { force: true }) }
    }, signal)
  }
  const gains = (project.gainRegions ?? []).filter(r => r.enabled)
  if (gains.length) {
    // 只按声音算键：呼吸、气口转成手动剪辑只换 id，不重新生成整段音频
    key = audioRenderKey([key, audioEditSoundRecipe(undefined, gains).gains])
    const source = input
    input = await cachedAudioFile(directory, `gain-${key}`, 'wav', async output => {
      await renderAudioEditGains(project, await openRenderSource(project, source, signal), gains, output, signal)
      await validateAudioEditAudio(output, project.source.sampleRate, project.source.channels, project.source.durationFrames, signal)
    }, signal)
  }
  if (processing) {
    key = audioRenderKey([key, project.processorChain ?? [], await audioEditProcessorCacheIdentity(project.processorChain)])
    const source = input
    input = await cachedAudioFile(directory, `effects-${key}`, 'wav', async output => {
      const processed = await processAudioEditVstChain(source, directory, project.processorChain, signal)
      try { await validateAudioEditAudio(processed.outputPath, project.source.sampleRate, project.source.channels, project.source.durationFrames, signal); await fs.copyFile(processed.outputPath, output) }
      finally { await Promise.all(processed.temporaryPaths.map(file => removeUnmanagedCachePath(file, { force: true }))) }
    }, signal)
  }
  return input
}

/** 渲染源已是 32 位浮点 WAV 时直接随机读；否则先在缓存里转一份。 */
async function openRenderSource(project: AudioEditProjectDocument, source: string, signal?: AbortSignal): Promise<F32WavReader> {
  const direct = await openF32Wav(source)
  if (direct && direct.sampleRate === project.source.sampleRate && direct.channels === project.source.channels) return direct
  await direct?.close()
  const converted = await cachedAudioFile(audioEditCacheDirectory(project.id), `render-f32-${audioRenderKey([source, project.source.sampleRate, project.source.channels])}`, 'wav', async output => {
    await runAudioEditProcess(await loadFfmpegPath(), ['-v', 'error', '-y', '-i', source, '-map', '0:a:0', '-vn', '-c:a', 'pcm_f32le', '-rf64', 'auto', '-ar', String(project.source.sampleRate), '-ac', String(project.source.channels), output], signal)
  }, signal)
  const reader = await openF32Wav(converted)
  if (!reader) throw new Error('渲染源转码后仍无法读取，请重试。')
  return reader
}

/** 逐段拼接成片：每段按一秒分块写出，拼接点由共享的交叉淡化渲染器处理（与试听同一个函数）。 */
async function renderAudioEditSplices(project: AudioEditProjectDocument, reader: F32WavReader, spans: ReturnType<typeof buildProjectAudioEditTimeline>, durationFrames: number, output: string, signal?: AbortSignal): Promise<void> {
  const { sampleRate, channels } = project.source
  const splices = new AudioEditSpliceRenderer(spans, { sampleRate, channels, durationFrames: reader.frames }, reader)
  const writer = await createF32WavWriter(output, sampleRate, channels, durationFrames)
  try {
    for (const [index, span] of spans.entries()) {
      const length = span.sourceEndFrame - span.sourceStartFrame
      for (let local = 0; local < length; local += sampleRate) {
        signal?.throwIfAborted()
        await writer.write(await splices.render(index, local, Math.min(length, local + sampleRate)))
      }
    }
  } finally { await writer.close(); await reader.close() }
}

export async function renderAudioEditProject(project: AudioEditProjectDocument, processing = project.vstEnabled, signal?: AbortSignal): Promise<AudioEditRenderedAudio> {
  const started = performance.now()
  logger.info('开始渲染音频', { event: 'audio_edit.render.start', context: { projectId: project.id, revision: project.revision } })
  try {
    const source = await prepareAudioEditRenderSource(project, processing, signal)
    const spans = buildProjectAudioEditTimeline(project)
    const durationFrames = editedDurationFrames(spans)
    if (!durationFrames) throw new Error('当前没有可渲染的声音，请保留至少一段音频。')
    // 拼接算法变更只失效成品缓存，源时间上的修复、增益与效果缓存仍可复用。
    const key = audioRenderKey(['splice-crossfade-v1', source, spans, project.source.sampleRate])
    const audioPath = await cachedAudioFile(audioEditCacheDirectory(project.id), `finished-${key}`, 'wav', async output => {
      await renderAudioEditSplices(project, await openRenderSource(project, source, signal), spans, durationFrames, output, signal)
      await validateAudioEditAudio(output, project.source.sampleRate, project.source.channels, durationFrames, signal)
    }, signal)
    await verifyAudioEditSource(project, false, signal)
    logger.info('音频渲染完成', { event: 'audio_edit.render.completed', context: { projectId: project.id, elapsedMs: performance.now() - started } })
    return { audioPath, durationFrames, sampleRate: project.source.sampleRate, channels: project.source.channels, revision: project.revision }
  } catch (error) { logger.error('音频渲染失败', { event: 'audio_edit.render.failed', error, context: { projectId: project.id } }); throw error }
}

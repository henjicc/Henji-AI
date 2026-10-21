import fs from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
import type { AudioEditGainRegion, AudioEditRenderedAudio, AudioEditRepair } from '../../../../src/core/audioEdit/regions'
import { buildProjectAudioEditTimeline, editedDurationFrames } from '../../../../src/core/audioEdit/timeline'
import { audioEditProjectSchema } from '../../../../src/core/audioEdit/schema'
import { createMainLogger } from '../logging'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'
import { loadFfmpegPath, ffmpegFilterComplexFileArgs } from '../video/ffmpeg-loader'
import { audioEditCacheDirectory, identifyAudioEditSource, prepareAudioEditAudio, validateAudioEditAudio, verifyAudioEditSource } from './media'
import { processAudioEditVstChain, audioEditProcessorCacheIdentity } from './processors'
import { runAudioRepair, audioRepairMaskDimensions, encodeAudioRepairMask } from './dsp-adapter'
import { audioRenderKey, cachedAudioFile } from './render-cache'
import { runAudioEditProcess } from './process'
import { buildAudioEditConcatFilter } from './export-render'

const logger = createMainLogger('main.audio_edit.render')
export function audioGainExpression(regions: readonly AudioEditGainRegion[]): string {
  return regions.filter(r => r.enabled).map(r => {
    const fadeIn = r.fadeInFrames ? `min(1,(n-${r.startFrame})/${r.fadeInFrames})` : '1'
    const fadeOut = r.fadeOutFrames ? `min(1,(${r.endFrame}-1-n)/${r.fadeOutFrames})` : '1'
    return `if(gte(n,${r.startFrame})*lt(n,${r.endFrame}),${10 ** (r.gainDb / 20)}*${fadeIn}*${fadeOut},1)`
  }).join('*') || '1'
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
    key = audioRenderKey([key, gains])
    const source = input
    input = await cachedAudioFile(directory, `gain-${key}`, 'wav', async output => {
      const script = `${output}.filter`
      try {
        const ffmpeg = await loadFfmpegPath()
        await fs.writeFile(script, `[0:a]aeval=exprs='val(ch)*(${audioGainExpression(gains)})':c=same[out]`)
        await runAudioEditProcess(ffmpeg, ['-v', 'error', '-y', '-i', source, ...await ffmpegFilterComplexFileArgs(ffmpeg, script), '-map', '[out]', '-c:a', 'pcm_f32le', output], signal)
        await validateAudioEditAudio(output, project.source.sampleRate, project.source.channels, project.source.durationFrames, signal)
      } finally { await removeUnmanagedCachePath(script, { force: true }) }
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

export async function renderAudioEditProject(project: AudioEditProjectDocument, processing = project.vstEnabled, signal?: AbortSignal): Promise<AudioEditRenderedAudio> {
  const started = performance.now()
  logger.info('开始渲染音频', { event: 'audio_edit.render.start', context: { projectId: project.id, revision: project.revision } })
  try {
    const source = await prepareAudioEditRenderSource(project, processing, signal)
    const spans = buildProjectAudioEditTimeline(project)
    const durationFrames = editedDurationFrames(spans)
    if (!durationFrames) throw new Error('当前没有可渲染的声音，请保留至少一段音频。')
    const key = audioRenderKey([source, spans])
    const audioPath = await cachedAudioFile(audioEditCacheDirectory(project.id), `finished-${key}`, 'wav', async output => {
      const script = `${output}.filter`
      try {
        const ffmpeg = await loadFfmpegPath()
        await fs.writeFile(script, buildAudioEditConcatFilter(spans, '0:a:0'))
        await runAudioEditProcess(ffmpeg, ['-v', 'error', '-y', '-i', source, ...await ffmpegFilterComplexFileArgs(ffmpeg, script), '-map', '[out]', '-c:a', 'pcm_f32le', output], signal)
        await validateAudioEditAudio(output, project.source.sampleRate, project.source.channels, durationFrames, signal)
      } finally { await removeUnmanagedCachePath(script, { force: true }) }
    }, signal)
    await verifyAudioEditSource(project, false, signal)
    logger.info('音频渲染完成', { event: 'audio_edit.render.completed', context: { projectId: project.id, elapsedMs: performance.now() - started } })
    return { audioPath, durationFrames, sampleRate: project.source.sampleRate, channels: project.source.channels, revision: project.revision }
  } catch (error) { logger.error('音频渲染失败', { event: 'audio_edit.render.failed', error, context: { projectId: project.id } }); throw error }
}

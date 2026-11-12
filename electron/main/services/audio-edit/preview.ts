import { execFile } from 'node:child_process'
import type { AudioEditPreviewChunk, AudioEditPreviewChunkRequest, AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
import { createMainLogger } from '../logging'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { readAudioEditProjectSnapshot } from './project-store'
import { prepareAudioEditRenderPlan } from './render'
import { prepareAudioEditAudio } from './media'
import { openF32Wav, type F32WavReader } from './pcm-wav'
import { listAudioEditProcessors } from './processors'
import { applyAudioEditGainLayers, type AudioEditGainLayers } from './gain-layers'

/*
 * 试听与拖动播放头试听的取块：一秒一次，一小时作品播放一遍几千次。
 * 作品按文件快照对象身份（加上本机插件清单）缓存“作品 → 底声文件 + 增益层”（文件一改快照就换新对象），同一版本只推一遍修复、效果链与缓存检查；
 * 缓存文件被清理掉时读取失败，丢掉这条记录重新推一遍再读。
 * 底声是 32 位浮点 WAV（项目自己生成的缓存基本都是）时保持打开直接随机读，不为每块起 FFmpeg。
 * 区间音量与末尾的呼吸处理在取块时乘上（与导出同一个函数），改了马上能听到，不等整条声音重新渲染。
 */

const logger = createMainLogger('main.audio_edit.preview')
/** 渲染源句柄闲置多久关掉：缓存清理要能删文件（Windows 上打开着的文件删不掉）。 */
const READER_IDLE_MS = 10_000
const READER_LIMIT = 4
const SLOW_CHUNK_MS = 200
const RENDER_SOURCE_LIMIT = 8

type SoundMode = 'source' | 'edited'
interface RenderSource { path: string; layers: AudioEditGainLayers }
interface RenderSourceEntry { project: Readonly<AudioEditProjectDocument>; processors: string; path: Promise<RenderSource> }
const renderSources = new Map<string, RenderSourceEntry>()
interface OpenReader { reader: Promise<F32WavReader | null>; timer?: ReturnType<typeof setTimeout> }
const readers = new Map<string, OpenReader>()

/** 效果链里有插件时，插件装上或卸掉会改变剪后声音（找不到的插件处理时跳过），所以插件清单也算进缓存键。 */
async function processorIdentity(project: Readonly<AudioEditProjectDocument>, mode: SoundMode): Promise<string> {
  if (mode === 'source' || !(project.effectChain ?? []).some(item => item.kind === 'plugin')) return ''
  return (await listAudioEditProcessors()).map(processor => `${processor.id}:${processor.available}`).sort().join('|')
}

async function renderSourceFor(project: Readonly<AudioEditProjectDocument>, mode: SoundMode): Promise<RenderSource> {
  const key = `${project.id}:${mode}`
  const processors = await processorIdentity(project, mode)
  const cached = renderSources.get(key)
  if (cached?.project === project && cached.processors === processors) {
    renderSources.delete(key); renderSources.set(key, cached)
    return cached.path
  }
  const started = performance.now()
  const prepared: Promise<RenderSource> = mode === 'source'
    ? prepareAudioEditAudio(project).then(path => ({ path, layers: [] }))
    : prepareAudioEditRenderPlan(project).then(plan => ({ path: plan.base, layers: plan.layers }))
  const path = prepared.then(result => {
    logger.info('试听声音已就绪', { event: 'audio_edit.preview.source.completed', context: { projectId: project.id, mode, revision: project.revision, durationFrames: project.source.durationFrames, sampleRate: project.source.sampleRate, channels: project.source.channels, gainLayers: result.layers.length, elapsedMs: performance.now() - started } })
    return result
  })
  const entry: RenderSourceEntry = { project, processors, path }
  renderSources.delete(key)
  renderSources.set(key, entry)
  while (renderSources.size > RENDER_SOURCE_LIMIT) renderSources.delete(renderSources.keys().next().value as string)
  path.catch(() => forgetRenderSource(key, entry))
  return path
}

function forgetRenderSource(key: string, entry?: RenderSourceEntry): void {
  if (!entry || renderSources.get(key) === entry) renderSources.delete(key)
}

function closeReader(path: string): void {
  const open = readers.get(path)
  if (!open) return
  readers.delete(path)
  clearTimeout(open.timer)
  void open.reader.then(reader => reader?.close()).catch(() => undefined)
}

/** 打开（或复用）渲染源的随机读句柄；不是同采样率、同声道的 32 位浮点 WAV 时返回 null。 */
async function readerFor(path: string, project: Readonly<AudioEditProjectDocument>): Promise<F32WavReader | null> {
  let open = readers.get(path)
  if (open) { readers.delete(path); clearTimeout(open.timer) }
  else {
    const reader = openF32Wav(path).then(async reader => {
      if (reader && (reader.sampleRate !== project.source.sampleRate || reader.channels !== project.source.channels)) { await reader.close(); return null }
      return reader
    })
    open = { reader }
    reader.catch(() => { if (readers.get(path) === open) readers.delete(path) })
  }
  readers.set(path, open)
  open.timer = setTimeout(() => closeReader(path), READER_IDLE_MS)
  open.timer.unref?.()
  while (readers.size > READER_LIMIT) closeReader(readers.keys().next().value as string)
  return open.reader
}

function decodeWithFfmpeg(binary: string, source: string, project: Readonly<AudioEditProjectDocument>, startFrame: number, frameCount: number): Promise<Buffer> {
  const { sampleRate, channels } = project.source
  return new Promise<Buffer>((resolve, reject) => {
    execFile(binary, ['-v', 'error', '-ss', (startFrame / sampleRate).toFixed(9), '-i', source, '-t', (frameCount / sampleRate).toFixed(9),
      '-f', 'f32le', '-acodec', 'pcm_f32le', '-ar', String(sampleRate), '-ac', String(channels), 'pipe:1'],
    { encoding: 'buffer', windowsHide: true, maxBuffer: frameCount * channels * 4 + 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout))
  })
}

export async function prepareAudioEditPreviewChunk(request: AudioEditPreviewChunkRequest): Promise<AudioEditPreviewChunk> {
  const started = performance.now()
  const project = await readAudioEditProjectSnapshot(request.projectId)
  const { sampleRate, channels, durationFrames } = project.source
  const sourceStartFrame = Math.max(0, Math.min(durationFrames, Math.round(request.sourceStartFrame)))
  const frameCount = Math.min(Math.max(1, Math.round(request.frameCount)), sampleRate * 4, durationFrames - sourceStartFrame)
  if (frameCount <= 0) return { sourceStartFrame, sourceEndFrame: sourceStartFrame, sampleRate, channels, pcm: new ArrayBuffer(0) }
  const mode: SoundMode = request.mode === 'source' ? 'source' : 'edited'
  let pcm: ArrayBuffer | undefined
  let direct = false
  let gainLayers = 0
  for (let attempt = 0; !pcm; attempt++) {
    const { path: source, layers } = await renderSourceFor(project, mode)
    gainLayers = layers.length
    try {
      const reader = await readerFor(source, project)
      direct = Boolean(reader)
      let samples: Float32Array
      if (reader) samples = await reader.read(sourceStartFrame, Math.min(frameCount, reader.frames - sourceStartFrame))
      else {
        const decoded = await decodeWithFfmpeg(await loadFfmpegPath(), source, project, sourceStartFrame, frameCount)
        samples = new Float32Array(decoded.byteLength / 4)
        new Uint8Array(samples.buffer).set(decoded.subarray(0, samples.byteLength))
      }
      applyAudioEditGainLayers(samples, sourceStartFrame, channels, layers)
      pcm = samples.buffer as ArrayBuffer
    } catch (error) {
      // 渲染源文件可能已被缓存清理删掉：丢掉记录和句柄，重新推一遍渲染源（会重建缓存文件）再读一次
      closeReader(source)
      forgetRenderSource(`${project.id}:${mode}`)
      if (attempt > 0) throw error
      logger.warn('试听声音读取失败，重新准备后再读', { event: 'audio_edit.preview.source.retry', error, context: { projectId: project.id, mode } })
    }
  }
  const sourceEndFrame = sourceStartFrame + Math.floor(pcm.byteLength / 4 / channels)
  const elapsedMs = performance.now() - started
  const context = { projectId: project.id, mode, sourceStartFrame, frameCount: sourceEndFrame - sourceStartFrame, durationFrames, direct, gainLayers, elapsedMs }
  if (elapsedMs >= SLOW_CHUNK_MS) logger.info('试听取块较慢', { event: 'audio_edit.preview.chunk.slow', context })
  else logger.debug('试听取块完成', { event: 'audio_edit.preview.chunk.completed', context })
  return { sourceStartFrame, sourceEndFrame, sampleRate, channels, pcm }
}

/** 仅供测试：清空渲染源缓存并关掉打开的句柄。 */
export function resetAudioEditPreviewForTests(): void {
  renderSources.clear()
  for (const path of [...readers.keys()]) closeReader(path)
}

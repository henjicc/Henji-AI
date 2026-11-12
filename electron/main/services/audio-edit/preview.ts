import { execFile } from 'node:child_process'
import type { AudioEditPreviewChunk, AudioEditPreviewChunkRequest, AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
import { createMainLogger } from '../logging'
import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'
import { readAudioEditProjectSnapshot } from './project-store'
import { prepareAudioEditRenderPlan } from './render'
import { prepareAudioEditAudio } from './media'
import { openF32Wav, type F32WavReader } from './pcm-wav'
import { listAudioEditProcessors } from './processors'
import { applyAudioEditGainLayers, type AudioEditGainLayers } from './gain-layers'
import { audioEditSourceEdited, audioEditSourceRecipe } from '../../../../src/core/audioEdit/regions'
import { audioEditSourceRevisionKey } from '../../../../src/core/audioEdit/sourceRevision'

/*
 * 试听与拖动播放头试听的取块：一秒一次，一小时作品播放一遍几千次。
 * 作品按文件快照对象身份（加上本机插件清单）缓存“作品 → 底声文件 + 增益层”（文件一改快照就换新对象），同一版本只推一遍修复、效果链与缓存检查；
 * 缓存文件被清理掉时读取失败，丢掉这条记录重新推一遍再读。
 * 底声是 32 位浮点 WAV（项目自己生成的缓存基本都是）时保持打开直接随机读，不为每块起 FFmpeg。
 * 区间音量与末尾的呼吸处理在取块时乘上（与导出同一个函数），改了马上能听到，不等整条声音重新渲染。
 * 外部 PCM / FLAC 素材刚导入、整条浮点副本还在后台转时，没有声音处理的块先从原素材解码（与副本逐样本相同），不等转完；压缩音频等副本。
 */

const logger = createMainLogger('main.audio_edit.preview')
/** 渲染源句柄闲置多久关掉：缓存清理要能删文件（Windows 上打开着的文件删不掉）。 */
const READER_IDLE_MS = 10_000
const READER_LIMIT = 4
const SLOW_CHUNK_MS = 200
const RENDER_SOURCE_LIMIT = 8

type SoundMode = 'source' | 'edited'
interface RenderSource { path: string; layers: AudioEditGainLayers }
/** ready：渲染源已经就绪（还在后台转浮点副本时为 undefined，可先从原素材解码）。 */
interface RenderSourceEntry { project: Readonly<AudioEditProjectDocument>; processors: string; path: Promise<RenderSource>; ready?: RenderSource }
const renderSources = new Map<string, RenderSourceEntry>()
/** 渲染源已缓存时几毫秒就绪：先等这么久，免得为本来马上能直接读的块起一次 FFmpeg。 */
const READY_GRACE_MS = 40
/** 从原素材按块解码时往前多解的秒数：压缩音频解码要前一帧的状态，预卷后取到的样本与整段解码相同。 */
const FALLBACK_PREROLL_SECONDS = 1
interface OpenReader { reader: Promise<F32WavReader | null>; timer?: ReturnType<typeof setTimeout> }
const readers = new Map<string, OpenReader>()

/** 效果链里有插件时，插件装上或卸掉会改变剪后声音（找不到的插件处理时跳过），所以插件清单也算进缓存键。 */
async function processorIdentity(project: Readonly<AudioEditProjectDocument>, mode: SoundMode): Promise<string> {
  if (mode === 'source' || !(project.effectChain ?? []).some(item => item.kind === 'plugin')) return ''
  return (await listAudioEditProcessors()).map(processor => `${processor.id}:${processor.available}`).sort().join('|')
}

async function renderSourceFor(project: Readonly<AudioEditProjectDocument>, mode: SoundMode): Promise<RenderSource> {
  return (await renderSourceEntry(project, mode)).path
}

async function renderSourceEntry(project: Readonly<AudioEditProjectDocument>, mode: SoundMode): Promise<RenderSourceEntry> {
  const key = `${project.id}:${mode}`
  const processors = await processorIdentity(project, mode)
  const cached = renderSources.get(key)
  if (cached?.project === project && cached.processors === processors) {
    renderSources.delete(key); renderSources.set(key, cached)
    return cached
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
  path.then(result => { entry.ready = result }, () => forgetRenderSource(key, entry))
  return entry
}

/**
 * 渲染源还在后台准备（外部素材整条转浮点副本）时能否先从原素材解码：原声，或作品还没有任何声音处理（编辑后声音就是原声）。
 * 有修复、效果、区间音量时要等处理好的底声。
 */
function mayDecodeOriginal(project: Readonly<AudioEditProjectDocument>, mode: SoundMode): boolean {
  return project.source.ownership === 'external' && (mode === 'source' || !audioEditSourceEdited(audioEditSourceRecipe(project)))
}

/**
 * 按块解码能证明与副本逐样本相同的素材：WAV、W64、AIFF、CAF 里的 PCM 与 FLAC 文件——样本时间戳就是样本序号，没有编码延迟、编辑列表或时间戳空档。
 * 压缩音频（VBR mp3 的编码延迟、mp4/mov 的编辑列表与时间戳空档、别的编码器写出的 AAC 起点）拿不准，等副本转完再播（界面有“正在处理”进度）。
 * 按素材记录键记住探测结果，同一份素材只起一次 ffprobe。
 */
const PCM_CONTAINERS = new Set(['wav', 'w64', 'aiff', 'caf', 'flac'])
const exactOriginals = new Map<string, Promise<boolean>>()
function originalDecodesExactly(source: Readonly<AudioEditProjectDocument['source']>): Promise<boolean> {
  const key = `${audioEditSourceRevisionKey(source)}|${source.audioStreamIndex ?? 0}`
  let known = exactOriginals.get(key)
  if (!known) {
    known = loadFfprobePath().then(ffprobe => new Promise<boolean>(resolve => {
      execFile(ffprobe, ['-v', 'error', '-select_streams', String(source.audioStreamIndex ?? 0), '-show_entries', 'stream=codec_name:format=format_name', '-of', 'json', source.sourcePath],
        { encoding: 'utf8', windowsHide: true }, (error, stdout) => {
          if (error) { resolve(false); return }
          try {
            const parsed = JSON.parse(stdout) as { streams?: Array<{ codec_name?: string }>; format?: { format_name?: string } }
            const codec = parsed.streams?.[0]?.codec_name ?? ''
            resolve((codec.startsWith('pcm_') || codec === 'flac') && (parsed.format?.format_name ?? '').split(',').some(name => PCM_CONTAINERS.has(name)))
          } catch { resolve(false) }
        })
    }))
    exactOriginals.set(key, known)
    while (exactOriginals.size > 64) exactOriginals.delete(exactOriginals.keys().next().value as string)
  }
  return known
}

/**
 * 从原素材解码 [startFrame, startFrame + frameCount)：与浮点副本同一套采样编号（副本从解码出的第一个样本起算，即声音流起点）。
 * 不让 FFmpeg 精确定位（它从定位点直接起解，压缩音频头一帧缺上一帧的状态），而是往前多解一秒、保留原始时间戳，按样本时间戳裁出这一块
 * （声音滤镜的时间基是 1/采样率；atrim 的 start_sample 是从收到的第一个样本起数的个数，不能用）。
 */
function decodeOriginal(binary: string, project: Readonly<AudioEditProjectDocument>, startFrame: number, frameCount: number): Promise<Buffer> {
  const { sampleRate, channels, sourcePath, audioStreamIndex, audioStartSeconds = 0, video } = project.source
  const origin = Math.round(audioStartSeconds * sampleRate)
  const from = origin + startFrame
  // FFmpeg 的输入定位以容器起点为零点：容器起点取声音流与视频流里更早的那个。
  const containerStart = Math.min(audioStartSeconds, video?.startSeconds ?? audioStartSeconds)
  const seek = Math.max(0, from / sampleRate - FALLBACK_PREROLL_SECONDS - containerStart)
  return new Promise<Buffer>((resolve, reject) => {
    execFile(binary, ['-v', 'error', '-nostdin', '-noaccurate_seek', '-copyts', '-ss', seek.toFixed(6), '-i', sourcePath, '-map', `0:${audioStreamIndex ?? 0}`, '-vn',
      '-af', `atrim=start_pts=${from}:end_pts=${from + frameCount}`, '-ac', String(channels), '-ar', String(sampleRate), '-f', 'f32le', '-c:a', 'pcm_f32le', 'pipe:1'],
    { encoding: 'buffer', windowsHide: true, maxBuffer: frameCount * channels * 4 + 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout))
  })
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
  let fallback = false
  // 外部素材刚导入、浮点副本还在后台转：能证明逐样本相同的素材先从原素材按块解码，导入后马上能播；副本好了就直接读副本。
  if (mayDecodeOriginal(project, mode)) {
    const entry = await renderSourceEntry(project, mode)
    if (!entry.ready) await Promise.race([entry.path.catch(() => undefined), new Promise(resolve => setTimeout(resolve, READY_GRACE_MS))])
    if (!entry.ready && await originalDecodesExactly(project.source)) {
      const decoded = await decodeOriginal(await loadFfmpegPath(), project, sourceStartFrame, frameCount)
      const samples = new Float32Array(Math.floor(decoded.byteLength / 4 / channels) * channels)
      new Uint8Array(samples.buffer).set(decoded.subarray(0, samples.byteLength))
      pcm = samples.buffer as ArrayBuffer
      fallback = true
    }
  }
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
  const context = { projectId: project.id, mode, sourceStartFrame, frameCount: sourceEndFrame - sourceStartFrame, durationFrames, direct, fallback, gainLayers, elapsedMs }
  if (elapsedMs >= SLOW_CHUNK_MS) logger.info('试听取块较慢', { event: 'audio_edit.preview.chunk.slow', context })
  else logger.debug('试听取块完成', { event: 'audio_edit.preview.chunk.completed', context })
  return { sourceStartFrame, sourceEndFrame, sampleRate, channels, pcm }
}

/** 仅供测试：清空渲染源缓存并关掉打开的句柄。 */
export function resetAudioEditPreviewForTests(): void {
  renderSources.clear()
  exactOriginals.clear()
  for (const path of [...readers.keys()]) closeReader(path)
}

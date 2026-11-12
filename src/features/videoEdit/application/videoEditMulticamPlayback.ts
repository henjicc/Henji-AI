import { createLogger } from '@/core/logging'
import { VIDEO_EDIT_DEFAULT_DECODE_CAPACITY, videoEditDecodeCost, videoEditLearnDecodeCapacity, type VideoEditDecodeStream } from '@/core/videoEdit/decodeLoad'
import type { VideoEditMedia, VideoEditSequence } from '@/core/videoEdit/document'
import { videoProxySize, type VideoProxyPreset, type VideoProxyResult } from '@/core/videoEdit/proxy'
import { videoEditFps } from '@/core/videoEdit/time'
import { videoEditNativeMediaProbe } from './videoEditMediaProbe'
import { createVideoEditProxies, ensureVideoEditProxyState, getVideoEditProxyPreference, getVideoEditProxySources, readVideoEditProxyState } from './videoEditProxy'
import { listVideoEditInstances, publishVideoEdit, requireVideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.multicamPreview')

/**
 * 多机位视图能不能实时播放：格子要同时解各机位（有代理的解代理），节目画面再解一路，合计负载（`decodeLoad.ts`）
 * 超过本机能力就判为可能卡顿。
 */
export interface VideoEditMulticamPlayback {
  /** `unknown`：还在读取素材信息。 */
  realtime: 'smooth' | 'may_stutter' | 'unknown'
  /** 全部机位素材，按机位顺序。 */
  cameras: string[]
  /** 格子在解原片（还没有可用代理）的机位素材，按机位顺序。 */
  originals: string[]
  /** 建代理的分辨率选项（按最大的原片算出实际输出的短边）；只有一档时没有选择。 */
  proxyChoices: Array<{ value: VideoProxyPreset; label: string }>
  /** 其中还没开始生成代理的。 */
  withoutProxy: string[]
  /** 合计负载与本机能力（参考路，见 `decodeLoad.ts`），只进日志。 */
  load: number
  capacity: number
}

/** 本机能装下的参考路数；这次运行里按实际播放修正（不落盘：开剪辑后自动预渲染等负载会让一次观测偏低，不该带到下次）。 */
let capacity = VIDEO_EDIT_DEFAULT_DECODE_CAPACITY
const streams = new Map<string, VideoEditDecodeStream>()
const probing = new Map<string, Promise<void>>()
const streamKey = (media: VideoEditMedia): string => `${media.path}\u0000${media.sourceRevision ?? ''}`

function cameraMedia(document: { media: VideoEditMedia[]; items: Array<{ id: string; mediaId?: string }> }, source: VideoEditSequence): VideoEditMedia[] {
  return (source.multicam?.cameras ?? []).flatMap(camera => {
    const clip = source.clips.find(value => value.id === camera.clipId)
    const mediaId = document.items.find(item => item.id === clip?.itemId)?.mediaId
    const media = document.media.find(value => value.id === mediaId && value.kind === 'video')
    return media ? [media] : []
  })
}

/** 读不到探测结果（原生服务不可用）时只知道尺寸与帧率：按 H.264 与参考码率估（宁可估高）。 */
function fallbackStream(media: VideoEditMedia): VideoEditDecodeStream {
  return { codec: 'h264', width: media.width, height: media.height, fps: media.frameRate ? videoEditFps(media.frameRate) : 30 }
}
function proxyStream(proxy: VideoProxyResult, original: VideoEditDecodeStream): VideoEditDecodeStream {
  return { codec: 'h264', width: proxy.width, height: proxy.height, fps: original.fps, bitDepth: 8 }
}

async function probe(media: VideoEditMedia): Promise<void> {
  const key = streamKey(media)
  if (streams.has(key)) return
  let pending = probing.get(key)
  if (!pending) {
    pending = (async () => {
      let stream = fallbackStream(media)
      try {
        const outcome = await videoEditNativeMediaProbe.probe(media.path)
        const video = outcome.status === 'probed' ? outcome.probe.streams.find(value => value.index === outcome.probe.primaryVideoStreamIndex && value.video) : undefined
        if (video?.video) {
          const rate = video.video.avgFrameRate ?? video.video.realFrameRate
          stream = { codec: video.codec, width: video.video.width, height: video.video.height, fps: rate && rate.den > 0 ? rate.num / rate.den : stream.fps, bitRate: video.bitRate ?? null, bitDepth: video.video.bitDepth, chroma: video.video.chromaSubsampling }
        }
      } catch (error) { logger.debug('多机位素材探测失败，按尺寸估算', { event: 'video_edit.multicam.decode_load.probe_failed', error, context: { mediaId: media.id } }) }
      streams.set(key, stream)
      // 读取方先拿到 unknown；读到后通知一次，界面与监视器按新判断刷新。
      publishVideoEdit()
    })().finally(() => probing.delete(key))
    probing.set(key, pending)
  }
  await pending
}

/** 当前的判断（同步、只读缓存）；素材信息还没读到时为 `unknown` 并开始读取，读到后发视图通知。 */
export function readVideoEditMulticamPlayback(projectId: string, sourceId: string): VideoEditMulticamPlayback {
  const document = requireVideoEditInstance(projectId).document
  const source = document.sequences?.find(sequence => sequence.id === sourceId && sequence.multicam)
  if (!source) throw new Error('多机位源序列不存在。')
  const cameras = cameraMedia(document, source)
  const proxies = getVideoEditProxySources(projectId, true)
  const originals = cameras.filter(media => !proxies[media.id]).map(media => media.id)
  const withoutProxy = originals.filter(id => readVideoEditProxyState(projectId, id).status !== 'generating')
  const ids = cameras.map(media => media.id)
  const proxyChoices = choices(cameras.filter(media => originals.includes(media.id)))
  const known = cameras.map(media => streams.get(streamKey(media)))
  if (known.some(stream => !stream)) {
    for (const media of cameras) void probe(media)
    return { realtime: 'unknown', cameras: ids, originals, withoutProxy, proxyChoices, load: 0, capacity }
  }
  const programProxies = getVideoEditProxyPreference(projectId).enabled
  const cost = (index: number, useProxy: boolean): number => {
    const proxy = useProxy ? proxies[cameras[index].id] : undefined
    return videoEditDecodeCost(proxy ? proxyStream(proxy, known[index]!) : known[index]!)
  }
  // 格子每个机位一路；节目画面再解一路，按最重的机位算（节目只在开了代理时读代理）。
  const grid = cameras.reduce((sum, _, index) => sum + cost(index, true), 0)
  const program = Math.max(0, ...cameras.map((_, index) => cost(index, programProxies)))
  const load = grid + program
  return { realtime: originals.length && load > capacity ? 'may_stutter' : 'smooth', cameras: ids, originals, withoutProxy, proxyChoices, load, capacity }
}

/**
 * 代理分辨率选项：标签写实际输出的短边（4K 横屏原片 auto 得 1080P、720p 得 720P）。720p 不比 auto 小（原片本身不大）时
 * 只剩 auto 一档。
 */
function choices(originals: readonly VideoEditMedia[]): VideoEditMulticamPlayback['proxyChoices'] {
  const largest = originals.reduce<VideoEditMedia | undefined>((best, media) => !best || media.width * media.height > best.width * best.height ? media : best, undefined)
  if (!largest) return []
  const short = (preset: VideoProxyPreset): number => { const size = videoProxySize(largest.width, largest.height, preset); return Math.min(size.width, size.height) }
  const auto = { value: 'auto' as const, label: `${short('auto')}P` }
  return short('720p') < short('auto') ? [auto, { value: '720p', label: `${short('720p')}P` }] : [auto]
}

/** 读到全部机位的素材信息与代理状态后的判断（助手读取、界面首次判断用）。 */
export async function ensureVideoEditMulticamPlayback(projectId: string, sourceId: string): Promise<VideoEditMulticamPlayback> {
  const owner = requireVideoEditInstance(projectId)
  const source = owner.document.sequences?.find(sequence => sequence.id === sourceId && sequence.multicam)
  if (source) for (const media of cameraMedia(owner.document, source)) { await ensureVideoEditProxyState(projectId, media.id); await probe(media) }
  if (!listVideoEditInstances().includes(owner)) throw new Error('原剪辑已关闭。')
  return readVideoEditMulticamPlayback(projectId, sourceId)
}

/**
 * 多机位格子逐帧解的一次播放结束：估算带得动却明显丢帧时下调本机能力，之后这组素材判为可能卡顿（提示建代理、格子只解参考帧）。
 * `load` 是这次播放全程的负载（播放中负载变了的不交来）。
 */
export function reportVideoEditMulticamPlayback(projectId: string, sourceId: string, observed: { load: number; droppedRatio: number; expectedFrames: number }): void {
  // 太短的播放说明不了吞吐：起播头一秒解码本来就慢。
  if (observed.expectedFrames < 120) return
  const next = videoEditLearnDecodeCapacity(capacity, observed)
  if (next === capacity) return
  logger.info('按实际播放下调显卡解码能力估计', { event: 'video_edit.multicam.decode_capacity.updated', context: { projectId, sourceId, from: capacity, to: next, load: observed.load, droppedRatio: observed.droppedRatio } })
  capacity = next
  publishVideoEdit()
}

const DISMISSED_KEY = 'videoEdit.multicamProxyPrompt'
function dismissedKeys(): Set<string> {
  try { const value = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]'); return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []) } catch { return new Set() }
}
const promptKey = (projectId: string, sourceId: string, mediaIds: readonly string[]): string => `${projectId}:${sourceId}:${[...mediaIds].sort().join(',')}`

/**
 * 要不要提示建代理：判为可能卡顿、还有机位没建代理，而且这个多机位的这组机位素材还没提示过（关掉或已点创建）。
 * “这组”按多机位的全部机位素材算：点创建后代理逐个建好、逐个开始生成都不改变它，不会在批量生成途中再提示；换了机位素材才算新的一组。
 */
export function videoEditMulticamProxyPromptVisible(projectId: string, sourceId: string, playback: VideoEditMulticamPlayback): boolean {
  return playback.realtime === 'may_stutter' && playback.withoutProxy.length > 0 && !dismissedKeys().has(promptKey(projectId, sourceId, playback.cameras))
}

export function dismissVideoEditMulticamProxyPrompt(projectId: string, sourceId: string, playback: VideoEditMulticamPlayback): void {
  const keys = dismissedKeys(); keys.add(promptKey(projectId, sourceId, playback.cameras))
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...keys])) } catch (error) { logger.warn('多机位代理提示的关闭记录未保存', { event: 'video_edit.multicam.proxy_prompt.dismiss_failed', error }) }
  publishVideoEdit()
}

/** “创建代理”：这组里还没有代理的机位逐个后台生成（复用素材代理的排队与进度），建好一路格子就换上一路。 */
export async function createVideoEditMulticamProxies(projectId: string, sourceId: string, preset: VideoProxyPreset): Promise<void> {
  const playback = readVideoEditMulticamPlayback(projectId, sourceId)
  dismissVideoEditMulticamProxyPrompt(projectId, sourceId, playback)
  logger.info('为多机位创建代理', { event: 'video_edit.multicam.proxy_prompt.create', context: { projectId, sourceId, preset, mediaIds: playback.withoutProxy, load: playback.load, capacity: playback.capacity } })
  await createVideoEditProxies(projectId, playback.withoutProxy, preset)
}

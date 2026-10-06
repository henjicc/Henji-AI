import {
  decodeSmartRegionLayout, processSmartRegionMatte, rasterizeSmartRegionBoxes, resolveSmartRegionMaskParams, smartRegionAnalysisKind,
  smartRegionBoxesAt, smartRegionFrameAt, smartRegionLayoutBytes, smartRegionMaskSize, smartRegionSegmentCovers,
  type SmartRegionAnalysisKind, type SmartRegionMaskSetting, type SmartRegionSegmentLayout,
} from '@/core/videoEdit/smartRegions'

/*
 * 剪辑渲染 Worker 读取智能区域缓存（任务 4.7d）：主线程把已分析好的段落（可 fetch 的地址）发过来，
 * 渲染每帧时按片段的素材时间取出那一帧的结果并画成低分辨率蒙版，交给合成场景参与效果混合。
 * - 结果文件按需分段读取（HTTP Range）：先读文件头与帧索引，人物蒙版每次读相邻 16 帧并解压；
 * - 解压后的人物蒙版、按参数生成的蒙版各保留一小份最近使用的缓存，暂停时反复重画同一帧不重复计算。
 * 没有可用段落时返回 undefined，调用方跳过这个效果（预览先不显示，导出前会等分析完成）。
 */

export interface VideoEditSmartRegionSegment { url: string; startUs: number; endUs: number; still: boolean }
/** 素材地址（Worker 里可 fetch 的形态）→ 分析种类 → 段落。 */
export type VideoEditSmartRegionSegments = Readonly<Record<string, Partial<Record<SmartRegionAnalysisKind, readonly VideoEditSmartRegionSegment[]>>>>

export interface VideoEditSmartRegionMask { width: number; height: number; data: Uint8Array }

const CHUNK_FRAMES = 16
const MAX_LAYOUTS = 16
const MAX_MATTES = 96
const MAX_MASKS = 12

let segments: VideoEditSmartRegionSegments = {}
const layouts = new Map<string, Promise<SmartRegionSegmentLayout>>()
const mattes = new Map<string, Promise<Uint8Array>>()
const masks = new Map<string, VideoEditSmartRegionMask>()

function remember<T>(cache: Map<string, T>, key: string, value: T, limit: number): T {
  cache.delete(key); cache.set(key, value)
  while (cache.size > limit) cache.delete(cache.keys().next().value as string)
  return value
}

export function setVideoEditSmartRegionSegments(value: VideoEditSmartRegionSegments): void {
  segments = value
  // 不再引用的文件可能已被清理或重写，缓存跟着清掉。
  const live = new Set(Object.values(value).flatMap(kinds => Object.values(kinds).flatMap(list => (list ?? []).map(segment => segment.url))))
  for (const cache of [layouts, mattes, masks] as Array<Map<string, unknown>>) for (const key of [...cache.keys()]) if (!live.has(key.split('\u0000')[0])) cache.delete(key)
}

export async function fetchRange(url: string, start: number, end: number): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } })
  if (!response.ok) throw new Error(`智能区域缓存读取失败（${response.status}）。`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  // 服务端不支持 Range 时返回整个文件。
  return response.status === 206 ? bytes : bytes.subarray(start, end)
}

function layoutOf(url: string): Promise<SmartRegionSegmentLayout> {
  const cached = layouts.get(url)
  if (cached) return remember(layouts, url, cached, MAX_LAYOUTS)
  const pending = (async () => {
    let head = await fetchRange(url, 0, 64 * 1024)
    const total = smartRegionLayoutBytes(head)
    if (head.byteLength < total) head = await fetchRange(url, 0, total)
    return decodeSmartRegionLayout(head)
  })()
  pending.catch(() => { if (layouts.get(url) === pending) layouts.delete(url) })
  return remember(layouts, url, pending, MAX_LAYOUTS)
}

export async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** 读一帧人物蒙版：按 16 帧一组读取并解压，同组其余帧一并缓存。 */
function matteOf(url: string, layout: SmartRegionSegmentLayout, frame: number): Promise<Uint8Array> {
  const key = `${url}\u0000${frame}`
  const cached = mattes.get(key)
  if (cached) return remember(mattes, key, cached, MAX_MATTES)
  const first = Math.floor(frame / CHUNK_FRAMES) * CHUNK_FRAMES
  const last = Math.min(layout.frames.length - 1, first + CHUNK_FRAMES - 1)
  const start = layout.dataOffset + layout.frames[first].offset
  const end = layout.dataOffset + layout.frames[last].offset + layout.frames[last].length
  const chunk = fetchRange(url, start, end)
  let result: Promise<Uint8Array> | undefined
  for (let index = first; index <= last; index++) {
    const entry = layout.frames[index]
    const pending = chunk.then(bytes => inflate(bytes.subarray(entry.offset - layout.frames[first].offset, entry.offset - layout.frames[first].offset + entry.length)))
    pending.catch(() => { if (mattes.get(`${url}\u0000${index}`) === pending) mattes.delete(`${url}\u0000${index}`) })
    if (index === frame) result = pending
    else if (!mattes.has(`${url}\u0000${index}`)) remember(mattes, `${url}\u0000${index}`, pending, MAX_MATTES)
  }
  return remember(mattes, key, result!, MAX_MATTES)
}

/**
 * 片段素材在 `timeUs`（素材绝对时钟，微秒）这一刻的区域蒙版（0–255，宽高为蒙版自身分辨率，按显示比例）。
 * 还没有分析结果时返回 undefined。
 */
export async function videoEditSmartRegionMask(mediaUrl: string, setting: SmartRegionMaskSetting, timeUs: number): Promise<VideoEditSmartRegionMask | undefined> {
  const kind = smartRegionAnalysisKind(setting.regionId)
  const segment = segments[mediaUrl]?.[kind]?.find(entry => smartRegionSegmentCovers(entry, timeUs, timeUs))
    ?? segments[mediaUrl]?.[kind]?.find(entry => entry.still)
  if (!segment) return undefined
  const layout = await layoutOf(segment.url)
  const { header } = layout
  const params = resolveSmartRegionMaskParams(setting)
  const frame = smartRegionFrameAt(header, timeUs)
  // 人脸按轨迹插值，蒙版跟着精确时间走；其他按帧缓存。
  const moment = header.kind === 'face' && !header.still ? Math.round(timeUs / 1000) : frame
  const key = `${segment.url}\u0000${moment}\u0000${params.feather}\u0000${params.expand}\u0000${params.invert}`
  const cached = masks.get(key)
  if (cached) return remember(masks, key, cached, MAX_MASKS)
  let mask: VideoEditSmartRegionMask
  if (header.matte) {
    const matte = await matteOf(segment.url, layout, frame)
    mask = { width: header.matte.width, height: header.matte.height, data: processSmartRegionMatte(matte, header.matte.width, header.matte.height, params) }
  } else {
    const size = smartRegionMaskSize(header.sourceWidth, header.sourceHeight)
    mask = { ...size, data: rasterizeSmartRegionBoxes(smartRegionBoxesAt(header, timeUs), header.kind === 'face' ? 'ellipse' : 'rect', params, size.width, size.height) }
  }
  return remember(masks, key, mask, MAX_MASKS)
}

import { composeVideoEditSequence } from '@/core/videoEdit/composition'
import { videoEditClipMedia, videoEditDuration, type VideoEditClip, type VideoEditComposition, type VideoEditSequence } from '@/core/videoEdit/document'
import type { VideoEditRenderDivisor } from '@/core/videoEdit/playbackResolution'
import type { VideoProxyResult } from '@/core/videoEdit/proxy'

/**
 * 多机位监视器的网格合成（对齐 PR、达芬奇的多机位监视器）：所有机位作为同一个源序列的嵌套片段，各自指定机位，按网格摆进
 * 一张画面，一个渲染会话、一个 GPU 设备、一次合成画出全部机位。网格的时间轴就是源序列的时间轴（网格第 N 帧 = 源序列第 N 帧），
 * 所以父序列上切机位、加剪辑点都不改网格内容，播放中切机位不会重建解码。
 */
export interface VideoEditMulticamGrid {
  composition: VideoEditComposition
  columns: number
  rows: number
  /** 源序列与它用到的素材、嵌套序列与布局；不含父序列，不随切机位变化。 */
  contentKey: string
  /** 各机位素材当前可用的代理；变化时会话要重新选代理。 */
  proxyKey: string
  /** 各机位的素材 ID（按机位顺序；找不到素材时为 undefined），比对代理变化用。 */
  cameraMedia: Array<string | undefined>
}

type GridProxies = Readonly<Record<string, Pick<VideoProxyResult, 'key'>>>
/** 各机位素材当前可用代理的签名：代理生成好或失效时变化。 */
export function videoEditMulticamProxyKey(cameraMedia: ReadonlyArray<string | undefined>, proxies: GridProxies): string {
  return JSON.stringify(cameraMedia.map(id => id && proxies[id]?.key))
}

/** Worker 一侧的格子画布：整张网格合成好后按格切开，画到各格自己的离屏画布。 */
export interface VideoEditGridSurfaces { surfaces: OffscreenCanvas[]; columns: number }

/** 网格单边像素上限：再大的格子显示也用不到更大的合成，超过时提高缩小倍数。 */
const GRID_MAX_DIMENSION = 8192

export function videoEditMulticamGridLayout(cameras: number): { columns: number; rows: number } {
  const columns = cameras > 4 ? 3 : 2
  return { columns, rows: Math.max(1, Math.ceil(cameras / columns)) }
}

type GridDocument = Pick<VideoEditComposition, 'media' | 'items' | 'sequences' | 'styles' | 'templates' | 'colorLuts' | 'codeMaterials' | 'scenes' | 'revision' | 'foreign'>

export function videoEditMulticamGrid(document: GridDocument, source: VideoEditSequence, proxies: GridProxies = {}): VideoEditMulticamGrid {
  const cameras = source.multicam?.cameras
  const sourceItem = document.items.find(item => item.kind === 'sequence' && item.sequenceId === source.id)
  if (!cameras?.length || !sourceItem) throw new Error('多机位源序列已移除。')
  // 只带源序列用得到的序列、条目与素材：父序列的改动（切机位、剪辑点）不进网格内容。
  const sequences = new Map<string, VideoEditSequence>(); const itemIds = new Set([sourceItem.id])
  const visit = (sequence: VideoEditSequence): void => {
    if (sequences.has(sequence.id)) return
    sequences.set(sequence.id, sequence)
    for (const clip of sequence.clips) {
      itemIds.add(clip.itemId)
      const nestedId = document.items.find(item => item.id === clip.itemId)?.sequenceId
      const nested = nestedId ? document.sequences?.find(value => value.id === nestedId) : undefined
      if (nested) visit(nested)
    }
  }
  visit(source)
  const items = document.items.filter(item => itemIds.has(item.id))
  const mediaIds = new Set(items.flatMap(item => item.mediaId ? [item.mediaId] : []))
  const media = document.media.filter(value => mediaIds.has(value.id))
  const scoped = { ...document, items, media, sequences: [...sequences.values()] }
  const child = composeVideoEditSequence(scoped, source)
  const { columns, rows } = videoEditMulticamGridLayout(cameras.length)
  const duration = videoEditDuration(source)
  // 机位画面按网格画布适配后再缩放：画布是 columns × rows 个源画面，缩放 1/min(columns, rows) 正好一格。
  const scale = 1 / Math.min(columns, rows)
  const clips: VideoEditClip[] = cameras.map((camera, index) => ({ id: `multicam-grid:${camera.id}`, itemId: sourceItem.id, name: camera.name, kind: 'sequence', track: index, start: 0, duration, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 },
    x: (index % columns + .5) / columns - .5, y: (Math.floor(index / columns) + .5) / rows - .5, scale, rotation: 0, opacity: 1, volume: 0, text: '', multicamCameraId: camera.id }))
  const composition: VideoEditComposition = {
    id: `multicam-grid:${source.id}`, name: source.name, width: child.width * columns, height: child.height * rows,
    frameRate: source.frameRate, fps: child.fps, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: source.sampleRate, channels: source.channels,
    tracks: cameras.map((camera, index) => ({ id: `multicam-grid:${camera.id}`, name: camera.name, index, kind: 'video', locked: false, enabled: true, muted: true, solo: false })),
    clips, annotations: [], media, items, sequences: scoped.sequences, revision: document.revision,
    ...(document.styles ? { styles: document.styles } : {}), ...(document.templates ? { templates: document.templates } : {}), ...(document.colorLuts ? { colorLuts: document.colorLuts } : {}),
    ...(document.codeMaterials ? { codeMaterials: document.codeMaterials } : {}), ...(document.scenes ? { scenes: document.scenes } : {}), ...(document.foreign ? { foreign: document.foreign } : {}),
  }
  const cameraMedia = cameras.map(camera => {
    const clip = source.clips.find(value => value.id === camera.clipId)
    return clip ? videoEditClipMedia(child, clip)?.id : undefined
  })
  return { composition, columns, rows, contentKey: JSON.stringify({ ...composition, revision: 0 }), proxyKey: videoEditMulticamProxyKey(cameraMedia, proxies), cameraMedia }
}

const DIVISORS = [8, 4, 2, 1] as const
/**
 * 网格合成的缩小倍数：格子（一个源画面）缩小后仍不小于显示宽度 `displayWidth`（设备像素）的最大倍数，只看显示尺寸；
 * 各机位纹理缩到多小另按各自解码尺寸取（`videoEditPictureDivisorForTarget`），有代理不会让合成变大。
 * 网格超过单边上限时再提高。
 */
export function videoEditMulticamGridDivisor(grid: Pick<VideoEditMulticamGrid, 'composition' | 'columns'>, displayWidth: number): VideoEditRenderDivisor {
  const largest = Math.max(grid.composition.width, grid.composition.height), cellWidth = grid.composition.width / grid.columns
  return DIVISORS.find(divisor => cellWidth / divisor >= displayWidth && largest / divisor <= GRID_MAX_DIMENSION)
    ?? [...DIVISORS].reverse().find(divisor => largest / divisor <= GRID_MAX_DIMENSION) ?? 8
}

/**
 * 一幅解码画面（显示尺寸 `width`×`height`）复制进合成设备时的盒式缩小倍数：缩到按“适合”放进渲染目标后实际画出的大小为止，
 * 不再更小。原片按目标缩小，代理或小画面已经够小就少缩或不缩。
 */
export function videoEditPictureDivisorForTarget(width: number, height: number, targetWidth: number, targetHeight: number): VideoEditRenderDivisor {
  const fit = Math.min(targetWidth / Math.max(1, width), targetHeight / Math.max(1, height))
  return DIVISORS.find(divisor => divisor * fit <= 1 + 1e-9) ?? 1
}

/** Worker 一侧：整张网格在 GPU 上拷成位图后切给各格子的画布（2D 画布的位图绘制在 GPU 上完成，不回读像素）。 */
export class VideoEditGridCells {
  private readonly contexts: Array<OffscreenCanvasRenderingContext2D | null>
  constructor(private readonly surfaces: readonly OffscreenCanvas[], private readonly columns: number) {
    this.contexts = surfaces.map(surface => surface.getContext('2d', { alpha: false }))
  }
  present(picture: ImageBitmap): void {
    const rows = Math.max(1, Math.ceil(this.surfaces.length / this.columns))
    const width = picture.width / this.columns, height = picture.height / rows
    const cellWidth = Math.max(1, Math.round(width)), cellHeight = Math.max(1, Math.round(height))
    this.surfaces.forEach((surface, index) => {
      if (surface.width !== cellWidth) surface.width = cellWidth
      if (surface.height !== cellHeight) surface.height = cellHeight
      this.contexts[index]?.drawImage(picture, index % this.columns * width, Math.floor(index / this.columns) * height, width, height, 0, 0, cellWidth, cellHeight)
    })
  }
  dispose(): void { for (const surface of this.surfaces) { surface.width = 1; surface.height = 1 } }
}

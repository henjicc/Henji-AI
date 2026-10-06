/**
 * 片段缩略图条（任务 2.4）的纯计算：主进程（参数校验、缓存键）与渲染层（铺帧、取帧时间）共用。
 *
 * - 取帧高度按设备像素分档，同一档在任何轨道高度、缩放下复用同一份帧；
 * - 取帧时间落在素材绝对时钟的二进制网格上（1/64 秒 × 2^k，k 由“每格代表的秒数”决定），
 *   因此放大一级只新增一半的帧、缩小一级全部命中缓存；同一素材的不同片段共享同一组帧；
 * - 每个片段的第一格固定取入点那一帧（首帧）。
 */

/** 缓存格式版本：改动取帧参数（缩放算法、编码质量）时递增，旧缓存自然失效。 */
export const FILMSTRIP_FORMAT_VERSION = 1
/** 取帧高度档（设备像素）。 */
export const FILMSTRIP_HEIGHTS = [32, 48, 64, 96, 128, 192, 256] as const
export type FilmstripHeight = typeof FILMSTRIP_HEIGHTS[number]
/** 网格最小单位：1/64 秒（微秒）。 */
export const FILMSTRIP_GRID_US = 15_625
/** 取帧时间上限（48 小时，微秒），超出视为非法请求。 */
export const FILMSTRIP_MAX_TIME_US = 48 * 3600 * 1_000_000

export function isFilmstripHeight(value: unknown): value is FilmstripHeight {
  return typeof value === 'number' && (FILMSTRIP_HEIGHTS as readonly number[]).includes(value)
}

/** 能覆盖该设备像素高度的最小档；超过最高档时取最高档。 */
export function filmstripHeightBucket(devicePixels: number): FilmstripHeight {
  return FILMSTRIP_HEIGHTS.find(height => height >= devicePixels) ?? FILMSTRIP_HEIGHTS[FILMSTRIP_HEIGHTS.length - 1]
}

/** 一格的显示宽度（CSS 像素）：按素材画面比例，限制在 [12, 4 × 高度]。 */
export function filmstripTileWidth(heightCss: number, aspect: number): number {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9
  return Math.max(12, Math.min(heightCss * 4, Math.round(heightCss * ratio)))
}

/** 每格代表 `spanUs` 微秒时的网格步长：不大于格宽的最大 1/64 秒 × 2^k。 */
export function filmstripGridStepUs(spanUs: number): number {
  let step = FILMSTRIP_GRID_US
  while (step * 2 <= spanUs && step < FILMSTRIP_MAX_TIME_US) step *= 2
  return step
}

export interface FilmstripTile {
  index: number
  /** 相对片段左缘的 CSS 像素。 */
  left: number
  width: number
  /** 素材绝对时钟上的取帧时间（微秒，整数）。 */
  timeUs: number
}

export interface FilmstripPlanInput {
  /** 片段显示宽度（CSS 像素）。 */
  clipWidth: number
  tileWidth: number
  /** 可见范围（相对片段左缘的 CSS 像素）；只铺这一段，前后各多铺一格。 */
  visibleFrom: number
  visibleTo: number
  /** 片段入点（素材绝对时钟，秒）。 */
  sourceInSeconds: number
  /** 每 CSS 像素代表的素材秒数；提供源时间映射时仅用于验证显示比例为正。 */
  secondsPerPixel: number
  /** 可选的源时间映射（变速／倒放片段由其唯一换算入口提供），像素相对片段左缘。 */
  sourceSecondsAtPixel?: (pixel: number) => number
  /** 素材结束时刻（与导入时长同一时钟，秒）。 */
  mediaEndSeconds: number
  /** 素材一帧的时长（秒），用于让最后一格落在最后一帧上。 */
  frameSeconds: number
}

export function planFilmstripTiles(input: FilmstripPlanInput): FilmstripTile[] {
  const { clipWidth, tileWidth, secondsPerPixel } = input
  if (!(clipWidth > 0) || !(tileWidth > 0) || !(secondsPerPixel > 0) || !(input.visibleTo > input.visibleFrom)) return []
  const count = Math.ceil(clipWidth / tileWidth)
  const first = Math.max(0, Math.floor(input.visibleFrom / tileWidth) - 1)
  const last = Math.min(count - 1, Math.floor(input.visibleTo / tileWidth) + 1)
  if (last < first) return []
  const lastUs = Math.max(0, Math.floor((input.mediaEndSeconds - Math.max(input.frameSeconds, 0.001)) * 1_000_000))
  // Floor: a microsecond past the in-point picture would make FFmpeg return the next picture.
  const sourceAt = input.sourceSecondsAtPixel
  const head = sourceAt ? sourceAt(0) : input.sourceInSeconds
  const tail = sourceAt ? sourceAt(clipWidth) : input.mediaEndSeconds
  const inUs = Math.min(lastUs, Math.max(0, Math.floor(head * 1_000_000)))
  // 映射可能倒放，量化后仍须位于首尾取帧范围内，尤其是很短的片段与接近源时间 0 的尾格。
  const minUs = sourceAt ? Math.min(inUs, Math.max(0, Math.floor(tail * 1_000_000))) : inUs
  const maxUs = sourceAt ? Math.min(lastUs, Math.max(inUs, Math.floor(tail * 1_000_000))) : lastUs
  const span = sourceAt ? Math.abs(sourceAt(tileWidth) - head) : tileWidth * secondsPerPixel
  const step = filmstripGridStepUs(span * 1_000_000)
  const tiles: FilmstripTile[] = []
  for (let index = first; index <= last; index++) {
    const left = index * tileWidth
    const exact = sourceAt ? sourceAt(left) * 1_000_000 : inUs + left * secondsPerPixel * 1_000_000
    const timeUs = index === 0 ? inUs : Math.min(maxUs, Math.max(minUs, Math.floor(exact / step) * step))
    tiles.push({ index, left, width: Math.min(tileWidth, clipWidth - left), timeUs })
  }
  return tiles
}

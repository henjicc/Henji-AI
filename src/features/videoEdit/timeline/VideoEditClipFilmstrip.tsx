import { memo, useMemo } from 'react'
import { filmstripHeightBucket, filmstripTileWidth, planFilmstripEndTiles, planFilmstripTiles, type FilmstripMode, type FilmstripTile } from '@/core/media/filmstripFrames'
import { useFilmstripFrames, useFilmstripFramesRevision, type FilmstripFrameRef } from '@/hooks/useFilmstripFrames'
import { filmstripFrameKey, nearestFilmstripFrame, readFilmstripFrame } from '@/services/videoFilmstrip/filmstripFrameService'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { videoEditClipSourceSecondsAt, type VideoEditClipTiming } from '@/core/videoEdit/clipSpeed'

/**
 * 画面片段的缩略图（任务 2.4，重要记录 006 / 019）：默认只在开头放入点那一帧，可选首尾各一张或连续铺满；连续时第一格固定是入点那一帧，其后按格宽铺开；
 * 只铺可见范围（前后各多一格），滚动缩放稳定后才请求新帧；新帧未到时显示同一素材最接近的已有帧，不留白不闪烁。
 * 变速／倒放的每格源时间都由 clipSpeed 换算，再沿用源时钟网格与缓存；静态图片片段每格都是这张图。
 */
export const VideoEditClipFilmstrip = memo(function VideoEditClipFilmstrip({ clipId, source, sourceRevision, still, aspect, mediaEndSeconds, frameSeconds, clip, fps, pixels, clipWidth, height, visibleFrom, visibleTo, devicePixelRatio, active, mode = 'continuous' }: {
  clipId: string
  source: string
  sourceRevision?: string
  /** 静态图片：不取帧，每格显示原图。 */
  still: boolean
  aspect: number
  mediaEndSeconds: number
  frameSeconds: number
  clip: VideoEditClipTiming
  fps: number
  /** 每时间线帧的 CSS 像素数。 */
  pixels: number
  clipWidth: number
  /** 片段内部高度（CSS 像素）。 */
  height: number
  /** 可见范围（相对片段左缘，CSS 像素）。 */
  visibleFrom: number
  visibleTo: number
  devicePixelRatio: number
  /** 时间线不可见时不请求。 */
  active: boolean
  /** 铺法：只在开头、首尾、连续（剪辑设置“片段缩略图”）。 */
  mode?: FilmstripMode
}) {
  const revision = useFilmstripFramesRevision()
  const tileWidth = filmstripTileWidth(height, aspect)
  const bucket = filmstripHeightBucket(height * devicePixelRatio)
  const tiles = useMemo(() => {
    const input = {
      clipWidth, tileWidth, visibleFrom, visibleTo, mediaEndSeconds, frameSeconds,
      sourceInSeconds: videoEditClipSourceSecondsAt(clip, clip.start, fps), secondsPerPixel: 1 / (pixels * fps),
      sourceSecondsAtPixel: still ? undefined : (pixel: number) => videoEditClipSourceSecondsAt(clip, clip.start + Math.min(clip.duration - 1, Math.floor(pixel / pixels)), fps),
    }
    return mode === 'continuous' ? planFilmstripTiles(input) : planFilmstripEndTiles(input, mode === 'head_tail')
  }, [clipWidth, tileWidth, visibleFrom, visibleTo, clip, fps, pixels, still, mediaEndSeconds, frameSeconds, mode])
  const refs = useMemo(() => still ? [] : tiles.map((tile): FilmstripFrameRef => ({ source, ...(sourceRevision ? { sourceRevision } : {}), timeUs: tile.timeUs, height: bucket })), [still, tiles, source, sourceRevision, bucket])
  const firstKeys = useMemo(() => new Set(refs.flatMap((ref, index) => tiles[index].index === 0 ? [filmstripFrameKey(ref)] : [])), [refs, tiles])
  useFilmstripFrames(refs, firstKeys, active)
  const stillUrl = still ? resolveImageDisplayUrl(source) : undefined
  // eslint-disable-next-line react-hooks/exhaustive-deps -- revision is the store snapshot that invalidates the reads
  const urls = useMemo(() => still ? tiles.map(() => stillUrl) : refs.map(ref => readFilmstripFrame(ref) ?? nearestFilmstripFrame(ref)), [still, stillUrl, tiles, refs, revision])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- revision is the store snapshot that invalidates the reads
  const exact = useMemo(() => still ? tiles.length : refs.filter(ref => readFilmstripFrame(ref)).length, [still, tiles, refs, revision])
  return <div className="pointer-events-none absolute inset-0 overflow-hidden" data-video-edit-filmstrip={clipId} data-filmstrip-tiles={tiles.length} data-filmstrip-ready={exact} aria-hidden>
    {tiles.map((tile: FilmstripTile, index) => {
      const url = urls[index]
      // 1px 间隔露出片段底色，分出每一格（设计稿 Filmstrip）。
      return url ? <img key={tile.index} src={url} alt="" draggable={false} decoding="async" className="absolute top-0 h-full object-cover object-left" style={{ left: tile.left, width: Math.max(1, tile.width - 1) }} /> : null
    })}
  </div>
})

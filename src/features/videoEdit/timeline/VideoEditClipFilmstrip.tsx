import { memo, useMemo } from 'react'
import { filmstripHeightBucket, filmstripTileWidth, planFilmstripTiles, type FilmstripTile } from '@/core/media/filmstripFrames'
import { useFilmstripFrames, useFilmstripFramesRevision, type FilmstripFrameRef } from '@/hooks/useFilmstripFrames'
import { filmstripFrameKey, nearestFilmstripFrame, readFilmstripFrame } from '@/services/videoFilmstrip/filmstripFrameService'
import { resolveImageDisplayUrl } from '@/services/imageSource'

/**
 * 画面片段的缩略图条（任务 2.4，重要记录 006）：第一格固定是入点那一帧，其后按格宽铺开；
 * 只铺可见范围（前后各多一格），滚动缩放稳定后才请求新帧；新帧未到时显示同一素材最接近的已有帧，不留白不闪烁。
 * 静态图片片段每格都是这张图。
 */
export const VideoEditClipFilmstrip = memo(function VideoEditClipFilmstrip({ clipId, source, sourceRevision, still, aspect, mediaEndSeconds, frameSeconds, sourceInSeconds, clipWidth, height, secondsPerPixel, visibleFrom, visibleTo, devicePixelRatio, active }: {
  clipId: string
  source: string
  sourceRevision?: string
  /** 静态图片：不取帧，每格显示原图。 */
  still: boolean
  aspect: number
  mediaEndSeconds: number
  frameSeconds: number
  sourceInSeconds: number
  clipWidth: number
  /** 片段内部高度（CSS 像素）。 */
  height: number
  secondsPerPixel: number
  /** 可见范围（相对片段左缘，CSS 像素）。 */
  visibleFrom: number
  visibleTo: number
  devicePixelRatio: number
  /** 时间线不可见时不请求。 */
  active: boolean
}) {
  const revision = useFilmstripFramesRevision()
  const tileWidth = filmstripTileWidth(height, aspect)
  const bucket = filmstripHeightBucket(height * devicePixelRatio)
  const tiles = useMemo(() => planFilmstripTiles({ clipWidth, tileWidth, visibleFrom, visibleTo, sourceInSeconds, secondsPerPixel, mediaEndSeconds, frameSeconds }), [clipWidth, tileWidth, visibleFrom, visibleTo, sourceInSeconds, secondsPerPixel, mediaEndSeconds, frameSeconds])
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

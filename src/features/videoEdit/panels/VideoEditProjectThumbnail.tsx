import { useEffect, useRef, useState } from 'react'
import { Type } from 'lucide-react'
import { ICON_MEDIA_AUDIO, ICON_MEDIA_IMAGE, ICON_MEDIA_VIDEO, ICON_WORKSPACE_VIDEO_EDIT } from '@/core/theme/icons'
import type { VideoEditMedia } from '@/core/videoEdit/document'
import { getPlatform } from '@/platform/runtime'
import { resolveImageDisplayUrl } from '@/services/imageSource'

/** Virtualized rows request host-cached previews only while their actual viewport is visible. */
export function VideoEditProjectThumbnail({ media, kind, active }: { media?: VideoEditMedia; kind: string; active: boolean }): React.ReactElement {
  const host = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [preview, setPreview] = useState<{ path: string; url: string } | null>(null)
  const [failedPath, setFailedPath] = useState<string | null>(null)
  useEffect(() => {
    if (!active || !host.current) { setVisible(false); return }
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [active])
  useEffect(() => {
    if (!active || !visible || media?.kind !== 'video') return
    const controller = new AbortController()
    void getPlatform().video.getCachedThumbnail(media.path, controller.signal).then(result => {
      if (!controller.signal.aborted) { setFailedPath(null); setPreview({ path: media.path, url: resolveImageDisplayUrl(result.path) }) }
    }).catch(() => { if (!controller.signal.aborted) setFailedPath(media.path) })
    return () => controller.abort()
  }, [active, visible, media?.kind, media?.path])
  const url = active && visible && media && failedPath !== media.path ? media.kind === 'image' ? resolveImageDisplayUrl(media.path) : preview?.path === media.path ? preview.url : null : null
  const Icon = kind === 'audio' ? ICON_MEDIA_AUDIO : kind === 'image' ? ICON_MEDIA_IMAGE : kind === 'video' ? ICON_MEDIA_VIDEO : kind === 'text' ? Type : ICON_WORKSPACE_VIDEO_EDIT
  return <div ref={host} className="flex h-full w-full items-center justify-center overflow-hidden text-text-muted" title={media && failedPath === media.path ? '预览图不可用，双击打开源素材或重新定位文件。' : undefined}>
    {url ? <img src={url} alt="" draggable={false} className="h-full w-full object-contain" onError={() => { if (media) setFailedPath(media.path) }} /> : <Icon size={20} />}
  </div>
}

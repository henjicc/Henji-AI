import { ALL_FORMATS, Input, UrlSource } from 'mediabunny'
import { getPlatform } from '@/platform/runtime'
import { toFetchableMediaUrl } from '@/services/imageSource'
import { appendVideoEditMedia, editVideoProject, requireVideoEditInstance } from './videoEditService'
import type { VideoEditMedia } from '@/core/videoEdit/document'

export async function inspectVideoEditMedia(path: string): Promise<VideoEditMedia> {
  const platform = getPlatform()
  if (!await platform.system.fs.exists(path)) throw new Error('源文件已移动或丢失，请重新定位素材。')
  await platform.media.allowRoot(await platform.system.paths.dirname(path))
  const base = { id: crypto.randomUUID(), path, name: path.split(/[\\/]/).at(-1) || '素材' }
  if (/\.(png|jpe?g|webp|bmp|avif)$/i.test(path)) {
    const response = await fetch(toFetchableMediaUrl(path)); if (!response.ok) throw new Error('无法读取图片。')
    const bitmap = await createImageBitmap(await response.blob())
    try { return { ...base, kind: 'image', width: bitmap.width, height: bitmap.height, durationSeconds: 0 } } finally { bitmap.close() }
  }
  const input = new Input({ source: new UrlSource(toFetchableMediaUrl(path), { maxCacheSize: 8 * 1024 * 1024, getRetryDelay: () => null }), formats: ALL_FORMATS })
  try {
    const video = await input.getPrimaryVideoTrack()
    const audio = await input.getPrimaryAudioTrack()
    if (!video && !audio) throw new Error('文件没有可用的音视频轨道。')
    if (video && !await video.canDecode()) throw new Error('当前设备无法解码此视频，请先转为 H.264 SDR 视频。')
    if (audio && !await audio.canDecode()) throw new Error('当前设备无法解码此音轨。')
    return { ...base, kind: video ? 'video' : 'audio', width: video?.displayWidth ?? 0, height: video?.displayHeight ?? 0, durationSeconds: await input.computeDuration() }
  } finally { input.dispose() }
}
export async function importVideoEditPaths(projectId: string, paths: string[]): Promise<void> {
  for (const path of paths) {
    if (requireVideoEditInstance(projectId).document.media.some(media => media.path === path)) continue
    appendVideoEditMedia(projectId, await inspectVideoEditMedia(path))
  }
}
export async function chooseVideoEditMedia(projectId: string): Promise<void> {
  const paths = await getPlatform().system.dialog.open({ multiple: true, filters: [{ name: '视频、图片与音频', extensions: ['mp4', 'mov', 'webm', 'mkv', 'mp3', 'wav', 'm4a', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'webp', 'avif'] }] })
  if (paths) await importVideoEditPaths(projectId, Array.isArray(paths) ? paths : [paths])
}
export async function relinkVideoEditMedia(projectId: string, mediaId: string): Promise<void> {
  const path = await getPlatform().system.dialog.open()
  if (!path || Array.isArray(path)) return
  const media = await inspectVideoEditMedia(path)
  editVideoProject(projectId, document => ({ ...document, media: document.media.map(item => item.id === mediaId ? { ...media, id: mediaId } : item) }))
}

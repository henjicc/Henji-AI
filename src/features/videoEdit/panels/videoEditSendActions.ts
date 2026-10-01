import type { VideoEditCreativeSourceRequest } from '@/core/videoEdit/creativeResult'
import type { MenuItem } from '@/hooks/useContextMenu'
import { planVideoEditSend, sendCreativeResultToVideoEdit, type VideoEditSendMediaKind, type VideoEditSendMode } from '../application/videoEditResultSend'
import type { VideoEditResultReceipt, VideoEditResultTarget } from '../application/videoEditResultTarget'

export type VideoEditSendNotify = (message: string, type?: 'success' | 'error') => void
export type VideoEditSendSourceResolver = () => VideoEditCreativeSourceRequest | Promise<VideoEditCreativeSourceRequest>
/** A target frozen by the workspace that started the round trip (e.g. an edited program frame). */
export interface VideoEditBoundTarget { target: VideoEditResultTarget; label: string }

export const VIDEO_EDIT_SEND_MODES: Array<{ mode: VideoEditSendMode; title: string }> = [{ mode: 'add', title: '加入播放头' }, { mode: 'replace', title: '替换所选片段' }]
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)
function isAbort(error: unknown): boolean { return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError' }

export async function runVideoEditSend(run: () => Promise<VideoEditResultReceipt>, notify: VideoEditSendNotify): Promise<void> {
  try { await run(); notify('已加入剪辑并保存，可在剪辑中撤销。', 'success') }
  catch (error) { if (!isAbort(error)) notify(`未能加入剪辑：${errorMessage(error)}`, 'error') }
}

/** Context-menu entries for hosts that already own a right-click menu (generation results). */
export function videoEditSendMenuItems(mediaKind: VideoEditSendMediaKind, resolveSource: VideoEditSendSourceResolver, notify: VideoEditSendNotify, icon: React.ReactNode): MenuItem[] {
  return VIDEO_EDIT_SEND_MODES.map(({ mode, title }) => {
    const plan = planVideoEditSend({ mediaKind, mode })
    return { id: `video-edit-${mode}`, label: `剪辑：${title}`, icon, disabled: !plan.available,
      onClick: () => { void runVideoEditSend(async () => sendCreativeResultToVideoEdit(await resolveSource(), { mediaKind, mode }), notify) } }
  })
}


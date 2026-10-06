import { Folder, type LucideIcon } from 'lucide-react'
import { ICON_ASSET_CODE, ICON_MEDIA_AUDIO, ICON_MEDIA_IMAGE, ICON_MEDIA_VIDEO, ICON_NODE_TEXT, ICON_VIDEO_EDIT_ADJUSTMENT, ICON_VIDEO_EDIT_GRAPHIC, ICON_WORKSPACE_VIDEO_EDIT } from '@/core/theme/icons'

/** 素材面板里各类条目的图标（缩略图占位与列表行共用）：素材箱、序列与各类素材项。 */
export function videoEditKindIcon(kind: string): LucideIcon {
  return kind === 'bin' ? Folder : kind === 'audio' ? ICON_MEDIA_AUDIO : kind === 'image' ? ICON_MEDIA_IMAGE : kind === 'video' ? ICON_MEDIA_VIDEO : kind === 'text' ? ICON_NODE_TEXT : kind === 'code' ? ICON_ASSET_CODE : kind === 'graphic' ? ICON_VIDEO_EDIT_GRAPHIC : kind === 'adjustment' ? ICON_VIDEO_EDIT_ADJUSTMENT : ICON_WORKSPACE_VIDEO_EDIT
}

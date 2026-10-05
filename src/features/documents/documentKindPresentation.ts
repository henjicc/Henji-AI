import type { LucideIcon } from 'lucide-react'

import {
  ICON_TOOL_AUDIO_EDIT,
  ICON_TOOL_CAMERA_STAGE,
  ICON_TOOL_IMAGE_EDIT,
  ICON_WORKSPACE_CANVAS,
  ICON_WORKSPACE_VIDEO_EDIT,
} from '@/core/theme/icons'
import type { DocumentKindId } from '@/core/documents/types'

/*
 * 文档类型的界面部分（实施方案 2.6 “渲染层另登记界面部分”）：显示名与图标。
 * 显示名是 i18n 键 `ui:documentLibrary.kinds.<类型>`（重要记录 010：里面的东西直接用工具名称）；
 * 打开方式由各工具经 `registerDocumentOpener` 登记。
 */

export interface DocumentKindPresentation {
  /** `ui` 命名空间下的显示名键（如“画布”）。 */
  readonly nameKey: string
  readonly icon: LucideIcon
}

const PRESENTATIONS: Readonly<Record<DocumentKindId, DocumentKindPresentation>> = {
  video_edit: { nameKey: 'documentLibrary.kinds.video_edit', icon: ICON_WORKSPACE_VIDEO_EDIT },
  canvas: { nameKey: 'documentLibrary.kinds.canvas', icon: ICON_WORKSPACE_CANVAS },
  audio_edit: { nameKey: 'documentLibrary.kinds.audio_edit', icon: ICON_TOOL_AUDIO_EDIT },
  camera_stage: { nameKey: 'documentLibrary.kinds.camera_stage', icon: ICON_TOOL_CAMERA_STAGE },
  image_document: { nameKey: 'documentLibrary.kinds.image_document', icon: ICON_TOOL_IMAGE_EDIT },
}

export function documentKindPresentation(kind: DocumentKindId): DocumentKindPresentation {
  return PRESENTATIONS[kind]
}

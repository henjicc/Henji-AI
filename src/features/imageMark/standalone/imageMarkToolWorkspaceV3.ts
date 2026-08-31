import type { ImageEditDocument } from '@/core/imageEdit'
import {
  parseImageEditSessionReferenceV3,
  type ImageEditSessionReferenceV3,
} from '@/core/imageEdit/v3/sessionReference'

export interface ImageMarkToolWorkspaceSourceV3 {
  url: string
  name: string
  sessionKey: number
  initialDocument: ImageEditDocument
  dpi?: number
  session?: ImageEditSessionReferenceV3
}

let rememberedSource: ImageMarkToolWorkspaceSourceV3 | null = null

function cloneSource(
  source: ImageMarkToolWorkspaceSourceV3,
): ImageMarkToolWorkspaceSourceV3 {
  return {
    ...source,
    initialDocument: structuredClone(source.initialDocument),
    ...(source.session ? { session: { ...source.session } } : {}),
  }
}

/** 工具工作区切走后保留稳定文档引用；不保存当前工具、面板或 pointer 瞬态状态。 */
export function rememberImageMarkToolWorkspaceSourceV3(
  source: ImageMarkToolWorkspaceSourceV3,
): void {
  rememberedSource = cloneSource(source)
}

export function rememberImageMarkToolWorkspaceSessionV3(
  sessionKey: number,
  value: ImageEditSessionReferenceV3,
): boolean {
  if (!rememberedSource || rememberedSource.sessionKey !== sessionKey) return false
  const session = parseImageEditSessionReferenceV3(value, rememberedSource.url)
  if (!session) throw new TypeError('工具箱图片编辑会话引用无效')
  rememberedSource = {
    ...rememberedSource,
    url: session.sourceUrl,
    session: { ...session },
  }
  return true
}

export function readImageMarkToolWorkspaceSourceV3(): ImageMarkToolWorkspaceSourceV3 | null {
  return rememberedSource ? cloneSource(rememberedSource) : null
}

export function clearImageMarkToolWorkspaceSourceV3(): void {
  rememberedSource = null
}

import {
  parseImageEditSessionReferenceV3,
  type ImageEditSessionReferenceV3,
} from '@/core/imageEdit/v3/sessionReference'

export const CANVAS_EDIT_V3_SESSION_OPTION = 'imageEditSession'

export function parseCanvasEditV3NodeSession(
  value: unknown,
  imageUrl: string,
): ImageEditSessionReferenceV3 | null {
  if (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === 'image-edit-v3'
    && (typeof (value as Record<string, unknown>).sourceUrl !== 'string'
      || (value as Record<string, unknown>).sourceUrl !== imageUrl)
  ) {
    throw new TypeError('画布图片编辑会话来源与节点图片不一致')
  }
  const session = parseImageEditSessionReferenceV3(value, imageUrl)
  if (session && session.sourceUrl !== imageUrl) {
    throw new TypeError('画布图片编辑会话来源与节点图片不一致')
  }
  return session
}

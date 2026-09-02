import type { ImageEditorToolIdV3 } from '../application/imageEditorHostProfiles'

export const IMAGE_EDITOR_ANNOTATION_TOOL_IDS_V3 = [
  'annotation-text',
  'annotation-callout',
  'annotation-arrow',
  'annotation-rect',
  'annotation-ellipse',
  'annotation-number',
  'annotation-pen',
] as const satisfies readonly ImageEditorToolIdV3[]

export type ImageEditorAnnotationToolIdV3 = typeof IMAGE_EDITOR_ANNOTATION_TOOL_IDS_V3[number]

export function isImageEditorAnnotationToolV3(
  toolId: ImageEditorToolIdV3,
): toolId is ImageEditorAnnotationToolIdV3 {
  return (IMAGE_EDITOR_ANNOTATION_TOOL_IDS_V3 as readonly string[]).includes(toolId)
}

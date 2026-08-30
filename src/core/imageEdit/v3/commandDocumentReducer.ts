import { ImageEditCommandValidationErrorV3 } from './commandErrors'
import type { ImageEditCommandV3 } from './commandTypes'
import { parseImageEditDocumentV3 } from './documentCodec'
import type { ImageEditCanvasGeometryV3, ImageEditDocumentV3 } from './documentTypes'

export function applyImageEditOutputGeometryCommandV3(
  document: ImageEditDocumentV3,
  command: Extract<ImageEditCommandV3, { type: 'document.update-output-geometry' }>,
  nextRevision: number,
): { geometry: ImageEditCanvasGeometryV3; inverse: ImageEditCommandV3 } {
  let validated: ImageEditDocumentV3
  try {
    validated = parseImageEditDocumentV3({
      ...document,
      geometry: {
        ...document.geometry,
        orientation: command.orientation,
        crop: command.crop,
      },
    })
  } catch {
    throw new ImageEditCommandValidationErrorV3('图片输出方向或裁剪范围无效')
  }
  const previous = document.geometry
  const next = validated.geometry
  const sameOrientation = previous.orientation.rotate === next.orientation.rotate
    && previous.orientation.mirrored === next.orientation.mirrored
  const sameCrop = previous.crop === null && next.crop === null
    || previous.crop !== null && next.crop !== null
      && previous.crop.x === next.crop.x && previous.crop.y === next.crop.y
      && previous.crop.width === next.crop.width && previous.crop.height === next.crop.height
  if (sameOrientation && sameCrop) {
    throw new ImageEditCommandValidationErrorV3('图片输出几何没有变化')
  }
  return {
    geometry: validated.geometry,
    inverse: {
      commandId: `${command.commandId}:inverse`,
      expectedRevision: nextRevision,
      type: 'document.update-output-geometry',
      orientation: { ...document.geometry.orientation },
      crop: document.geometry.crop ? { ...document.geometry.crop } : null,
    },
  }
}

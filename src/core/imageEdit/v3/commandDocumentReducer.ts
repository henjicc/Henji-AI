import { ImageEditCommandValidationErrorV3 } from './commandErrors'
import type { ImageEditCommandV3 } from './commandTypes'
import { parseImageEditDocumentV3 } from './documentCodec'
import type { ImageEditCanvasGeometryV3, ImageEditDocumentV3 } from './documentTypes'
import type { ImageEditLayerV3 } from './layerTypes'

export function applyImageEditCanvasSizeCommandV3(document: ImageEditDocumentV3,
  command: Extract<ImageEditCommandV3, { type: 'document.set-canvas-size' }>, nextRevision: number): { geometry: ImageEditCanvasGeometryV3; layers: ImageEditLayerV3[]; inverse: ImageEditCommandV3 } {
  if (![command.width, command.height].every(value => Number.isSafeInteger(value) && value > 0)) throw new ImageEditCommandValidationErrorV3('画布尺寸必须为正整数')
  const geometry = { ...document.geometry, width: command.width, height: command.height }
  try { parseImageEditDocumentV3({ ...document, geometry }) }
  catch { throw new ImageEditCommandValidationErrorV3('画布边界不能截断当前裁剪范围，请先取消裁剪') }
  if (geometry.width === document.geometry.width && geometry.height === document.geometry.height) throw new ImageEditCommandValidationErrorV3('画布尺寸没有变化')
  const previous: typeof command.rasterCanvases = {}, remaining = new Set(Object.keys(command.rasterCanvases))
  const map = (layers: ImageEditLayerV3[]): ImageEditLayerV3[] => layers.map(layer => {
    if (layer.type === 'group') return { ...layer, children: map(layer.children) }
    if (!remaining.has(layer.id)) return layer
    if (layer.type !== 'raster') throw new ImageEditCommandValidationErrorV3('像素网格只能属于像素图层')
    remaining.delete(layer.id); previous[layer.id] = layer.rasterCanvasSize ?? null
    const size = command.rasterCanvases[layer.id]
    if (size && ![size.width, size.height].every(value => Number.isSafeInteger(value) && value > 0)) throw new ImageEditCommandValidationErrorV3('像素网格尺寸无效')
    const result = { ...layer }; if (size) result.rasterCanvasSize = { ...size }; else delete result.rasterCanvasSize
    return result
  })
  const layers = map(document.layers)
  if (remaining.size) throw new ImageEditCommandValidationErrorV3('像素网格引用的图层不存在')
  return { geometry, layers, inverse: { type: command.type, commandId: `${command.commandId}:inverse`, expectedRevision: nextRevision,
    width: document.geometry.width, height: document.geometry.height, rasterCanvases: previous } }
}

export function applyImageEditOutputGeometryCommandV3(
  document: ImageEditDocumentV3,
  command: Extract<ImageEditCommandV3, { type: 'document.update-output-geometry' }>,
  nextRevision: number,
): { geometry: ImageEditCanvasGeometryV3; layers: ImageEditLayerV3[]; inverse: ImageEditCommandV3 } {
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
    layers: document.layers,
    inverse: {
      commandId: `${command.commandId}:inverse`,
      expectedRevision: nextRevision,
      type: 'document.update-output-geometry',
      orientation: { ...document.geometry.orientation },
      crop: document.geometry.crop ? { ...document.geometry.crop } : null,
    },
  }
}

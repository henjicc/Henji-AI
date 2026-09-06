import { invertImageEditTransformV3, mapImageEditTransformPointV3 } from '@/core/imageEdit/v3'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditLayerV3, ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import { resolveAnnotationLayerToOutputMatrixV3 } from './annotationGeometryV3'
import { flattenImageEditLayerTreeV3, type ImageEditLayerLocationV3 } from './layerTreeV3'

export interface LayerContentBoundsV3 { x: number; y: number; width: number; height: number }
export interface LayerAlphaMapV3 {
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  alpha: Uint8Array
  hitThreshold: number
  bounds: LayerContentBoundsV3 | null
}
export type LayerAlphaMapsV3 = ReadonlyMap<string, LayerAlphaMapV3>
export type LayerTransformHandleV3 = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate'
export const LAYER_TRANSFORM_HANDLES_V3 = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate'] as const

/** Alpha 代理仅用于交互命中，不参与正式渲染、保存或导出。 */
export function createLayerAlphaMapV3(
  width: number, height: number, sourceWidth: number, sourceHeight: number, alpha: Uint8Array,
): LayerAlphaMapV3 {
  let left = width, top = height, right = -1, bottom = -1
  // mip 滤波会在透明边缘产生极弱振铃；按本层峰值的 5% 定义交互轮廓，
  // 避免控制框包住不可见噪声，同时保留整体低透明度的内容。
  let peak = 0
  for (const value of alpha) peak = Math.max(peak, value)
  const hitThreshold = Math.max(1, Math.ceil(peak * 0.05))
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] < hitThreshold) continue
      left = Math.min(left, x); top = Math.min(top, y)
      right = Math.max(right, x); bottom = Math.max(bottom, y)
    }
  }
  return {
    width, height, sourceWidth, sourceHeight, alpha, hitThreshold,
    bounds: right < left ? null : {
      x: left * sourceWidth / width, y: top * sourceHeight / height,
      width: (right - left + 1) * sourceWidth / width,
      height: (bottom - top + 1) * sourceHeight / height,
    },
  }
}

function sample(map: LayerAlphaMapV3 | undefined, x: number, y: number): number | undefined {
  if (!map) return undefined
  if (x < 0 || y < 0 || x >= map.sourceWidth || y >= map.sourceHeight) return 0
  return map.alpha[Math.floor(y * map.height / map.sourceHeight) * map.width
    + Math.floor(x * map.width / map.sourceWidth)] / 255
}

function maskValue(layer: ImageEditLayerV3, x: number, y: number, maps: LayerAlphaMapsV3): number | undefined {
  const mask = layer.mask
  if (!mask) return 1
  let value: number | undefined
  if ('kind' in mask) {
    const tx = Math.floor(x / mask.tileSize), ty = Math.floor(y / mask.tileSize)
    const resourceId = mask.tiles[`0/${tx}/${ty}`]
    value = resourceId ? sample(maps.get(resourceId), x - tx * mask.tileSize, y - ty * mask.tileSize) : mask.defaultValue
  } else {
    value = sample(maps.get(`mask:${mask.resourceId}`) ?? maps.get(mask.resourceId), x, y)
  }
  return value === undefined ? undefined : mask.inverted ? 1 - value : value
}

export function layerToOutputV3(document: ImageEditDocumentV3, location: ImageEditLayerLocationV3,
  transform: ImageEditTransformV3 = location.layer.transform): ImageEditTransformV3 {
  return resolveAnnotationLayerToOutputMatrixV3(document, [transform, ...location.ancestors.slice().reverse().map((layer) => layer.transform)])
}

/** 从视觉栈顶向下命中；未准备好的上层不能被当成透明而误选底图。 */
export function pickImageEditorLayerV3(document: ImageEditDocumentV3, point: readonly [number, number],
  maps: LayerAlphaMapsV3): string | null | undefined {
  const groups = new Set<string>()
  const expand = (layers: readonly ImageEditLayerV3[]): void => {
    for (const layer of layers) if (layer.type === 'group') { groups.add(layer.id); expand(layer.children) }
  }
  expand(document.layers)
  for (const location of flattenImageEditLayerTreeV3(document.layers, groups)) {
    const { layer, ancestors } = location
    if (layer.type !== 'raster' || [layer, ...ancestors].some((entry) => !entry.visible || entry.locked || entry.opacity === 0)) continue
    const [x, y] = mapImageEditTransformPointV3(invertImageEditTransformV3(layerToOutputV3(document, location)), ...point)
    const tx = Math.floor(x / 512), ty = Math.floor(y / 512)
    const tile = layer.tiles[`0/${tx}/${ty}`]
    let alpha = tile ? sample(maps.get(tile), x - tx * 512, y - ty * 512)
      : layer.source.kind === 'resource' ? sample(maps.get(layer.source.resourceId), x, y) : 0
    if (alpha === 0) continue
    if (alpha === undefined) return undefined
    for (let index = 0; index <= ancestors.length; index += 1) {
      const entry = index === 0 ? location : {
        ...location, layer: ancestors[index - 1], ancestors: ancestors.slice(0, index - 1),
      }
      const local = mapImageEditTransformPointV3(invertImageEditTransformV3(layerToOutputV3(document, entry)), ...point)
      const mask = maskValue(entry.layer, ...local, maps)
      if (mask === undefined) return undefined
      alpha *= mask * entry.layer.opacity
    }
    const sourceMap = tile ? maps.get(tile) : layer.source.kind === 'resource' ? maps.get(layer.source.resourceId) : undefined
    if (alpha >= (sourceMap?.hitThreshold ?? 1) / 255 * layer.opacity
      * ancestors.reduce((value, ancestor) => value * ancestor.opacity, 1)) return layer.id
  }
  return null
}

export function imageEditorLayerContentBoundsV3(layer: ImageEditLayerV3, maps: LayerAlphaMapsV3): LayerContentBoundsV3 | null {
  if (layer.type !== 'raster') return null
  const bounds: LayerContentBoundsV3[] = []
  const source = layer.source.kind === 'resource' ? maps.get(layer.source.resourceId)?.bounds : null
  if (source) bounds.push(source)
  for (const [key, id] of Object.entries(layer.tiles)) {
    const [mip, x, y] = key.split('/').map(Number)
    const tile = maps.get(id)?.bounds
    if (mip === 0 && tile) bounds.push({ ...tile, x: tile.x + x * 512, y: tile.y + y * 512 })
  }
  if (!bounds.length) return null
  const x = Math.min(...bounds.map((b) => b.x)), y = Math.min(...bounds.map((b) => b.y))
  return { x, y, width: Math.max(...bounds.map((b) => b.x + b.width)) - x,
    height: Math.max(...bounds.map((b) => b.y + b.height)) - y }
}

/** 固定对侧锚点；角点默认等比，Shift 自由缩放；旋转绕内容中心，Shift 吸附 15°。 */
export function transformImageEditorLayerByHandleV3(start: ImageEditTransformV3, bounds: LayerContentBoundsV3,
  handle: LayerTransformHandleV3, fromParent: readonly [number, number], toParent: readonly [number, number],
  shift: boolean): ImageEditTransformV3 {
  if (handle === 'rotate') {
    const center = mapImageEditTransformPointV3(start, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    let angle = Math.atan2(toParent[1] - center[1], toParent[0] - center[0])
      - Math.atan2(fromParent[1] - center[1], fromParent[0] - center[0])
    if (shift) angle = Math.round(angle / (Math.PI / 12)) * Math.PI / 12
    const c = Math.cos(angle), s = Math.sin(angle)
    const [a, b, d, e, x, y] = start
    return [c * a - s * b, s * a + c * b, c * d - s * e, s * d + c * e,
      center[0] + c * (x - center[0]) - s * (y - center[1]),
      center[1] + s * (x - center[0]) + c * (y - center[1])]
  }
  const inverse = invertImageEditTransformV3(start)
  const from = mapImageEditTransformPointV3(inverse, ...fromParent)
  const to = mapImageEditTransformPointV3(inverse, ...toParent)
  const horizontal = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0
  const vertical = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0
  let sx = horizontal ? Math.max(0.01, 1 + horizontal * (to[0] - from[0]) / bounds.width) : 1
  let sy = vertical ? Math.max(0.01, 1 + vertical * (to[1] - from[1]) / bounds.height) : 1
  if (horizontal && vertical && !shift) sx = sy = Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy
  const anchorX = bounds.x + (horizontal < 0 ? bounds.width : horizontal === 0 ? bounds.width / 2 : 0)
  const anchorY = bounds.y + (vertical < 0 ? bounds.height : vertical === 0 ? bounds.height / 2 : 0)
  return [start[0] * sx, start[1] * sx, start[2] * sy, start[3] * sy,
    start[4] + start[0] * anchorX * (1 - sx) + start[2] * anchorY * (1 - sy),
    start[5] + start[1] * anchorX * (1 - sx) + start[3] * anchorY * (1 - sy)]
}

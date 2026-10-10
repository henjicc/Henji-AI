import {rasterizeVectorCoverage} from '@/core/imaging/vectorContent'
import { inverseDeform, prepareDeformation, rotateAffine, scaleAffineAtAnchor } from '@/core/imaging/transforms';
import { imageEditLayerMaskTransformV3 } from '@/core/imageEdit/v3/renderContracts/maskTransform'
import { maskDensity } from '@/core/imaging/compositing'
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
  if (!mask || !layer.maskAttachment.enabled) return 1
  const tx = Math.floor(x / mask.tileSize), ty = Math.floor(y / mask.tileSize)
  const resourceId = mask.tiles[`0/${tx}/${ty}`]
  const value = resourceId ? sample(maps.get(resourceId), x - tx * mask.tileSize, y - ty * mask.tileSize) : mask.vectorPaths ? rasterizeVectorCoverage(mask.vectorPaths,{x:Math.floor(x),y:Math.floor(y),width:1,height:1})[0] : mask.defaultValue
  return value === undefined ? undefined : maskDensity(mask.inverted ? 1 - value : value, layer.maskAttachment.density)
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
    if (!['raster','smart','text','shape','path'].includes(layer.type) || [layer, ...ancestors].some((entry) => !entry.visible || entry.locked || entry.opacity === 0 || entry.fillOpacity === 0)) continue
    const raw = mapImageEditTransformPointV3(invertImageEditTransformV3(layerToOutputV3(document, location)), ...point)
    const normalized=inverseDeform(prepareDeformation(layer.deformation),[raw[0]/document.geometry.width,raw[1]/document.geometry.height]);if(!normalized)continue;
    const [x,y]=[normalized[0]*document.geometry.width,normalized[1]*document.geometry.height]
    const tx = Math.floor(x / 512), ty = Math.floor(y / 512)
    const raster=layer.type==='raster'||layer.type==='smart'?layer:null
    const tile=raster?.tiles[`0/${tx}/${ty}`]
    let alpha=raster?(tile?sample(maps.get(tile),x-tx*512,y-ty*512):raster.source.kind==='resource'?sample(maps.get(raster.source.resourceId),x,y):0):sample(maps.get(`vector:${layer.id}`),x,y)
    if (alpha === 0) continue
    if (alpha === undefined) return undefined
    for (let index = 0; index <= ancestors.length; index += 1) {
      const entry = index === 0 ? location : {
        ...location, layer: ancestors[index - 1], ancestors: ancestors.slice(0, index - 1),
      }
      let local = mapImageEditTransformPointV3(invertImageEditTransformV3(layerToOutputV3(document, entry, imageEditLayerMaskTransformV3(entry.layer))), ...point)
      if(entry.layer.deformation && entry.layer.maskAttachment.linked) {local=mapImageEditTransformPointV3(invertImageEditTransformV3(entry.layer.maskAttachment.transform),x,y);}
      const mask = maskValue(entry.layer, ...local, maps)
      if (mask === undefined) return undefined
      alpha *= mask * entry.layer.opacity * entry.layer.fillOpacity
    }
    const sourceMap = tile ? maps.get(tile) : raster?.source.kind === 'resource' ? maps.get(raster.source.resourceId) : maps.get(`vector:${layer.id}`)
    if (alpha >= (sourceMap?.hitThreshold ?? 1) / 255 * layer.opacity
      * ancestors.reduce((value, ancestor) => value * ancestor.opacity, 1)) return layer.id
  }
  return null
}

export function imageEditorLayerContentBoundsV3(layer: ImageEditLayerV3, maps: LayerAlphaMapsV3): LayerContentBoundsV3 | null {
  if(layer.type==='text'||layer.type==='shape'||layer.type==='path') return maps.get(`vector:${layer.id}`)?.bounds ?? null
  if (layer.type !== 'raster' && layer.type !== 'smart') return null
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
    return rotateAffine(start,center,fromParent,toParent,shift)
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
  return scaleAffineAtAnchor(start,[anchorX,anchorY],[sx,sy])
}

import { useEffect, useRef, useState } from 'react'
import { createImageEditorV3RequestId, readImageEditorV3SourceMetadata, readImageEditorV3SourceTile, readImageEditorV3BrushTiles } from '@/commands/imageEditorV3'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import { createLogger } from '@/core/logging'
import type { ImageEditorV3ResourceDescriptor, ImageEditorV3ResourceRef } from '@/platform/contracts/imageEditorV3'
import { createLayerAlphaMapV3, type LayerAlphaMapV3, type LayerAlphaMapsV3 } from './layerPickingV3'

const logger = createLogger('features.image_edit.v3.layer_picking')
interface PickResourceV3 { id: string; key: string; sparse: boolean; mask: boolean; byteSize: number }

/** 一个会话一份有界 Alpha 缓存；内容寻址不随 transform/revision 改变。 */
export function useImageEditorLayerPickingV3(document: ImageEditDocumentV3,
  descriptors: readonly ImageEditorV3ResourceDescriptor[]): LayerAlphaMapsV3 {
  const cache = useRef(new Map<string, LayerAlphaMapV3>())
  const [maps, setMaps] = useState<LayerAlphaMapsV3>(() => new Map())
  const resources = new Map<string, PickResourceV3>()
  const add = (id: string, sparse: boolean, mask = false): void => {
    const descriptor = descriptors.find((entry) => entry.resourceRef === id)
    const key = mask ? `mask:${id}` : id
    if (descriptor) resources.set(key, { id, key, sparse, mask, byteSize: descriptor.byteLength })
  }
  const visit = (layers: readonly ImageEditLayerV3[]): void => {
    for (const layer of layers) {
      if (layer.type === 'raster') {
        if (layer.source.kind === 'resource') add(layer.source.resourceId, false)
        Object.values(layer.tiles).forEach((id) => add(id, true))
      }
      if (layer.mask) {
        if ('kind' in layer.mask) Object.values(layer.mask.tiles).forEach((id) => add(id, true))
        else add(layer.mask.resourceId, false, true)
      }
      if (layer.type === 'group') visit(layer.children)
    }
  }
  visit(document.layers)
  const resourceKey = JSON.stringify([...resources.values()].sort((a, b) => a.id.localeCompare(b.id)))
  useEffect(() => {
    const abort = new AbortController()
    const plan = JSON.parse(resourceKey) as PickResourceV3[]
    const ids = new Set(plan.map(({ key }) => key))
    for (const id of cache.current.keys()) if (!ids.has(id)) cache.current.delete(id)
    setMaps(new Map(cache.current))
    const load = async ({ id, sparse, mask, byteSize }: PickResourceV3): Promise<LayerAlphaMapV3> => {
      if (sparse) {
        const { tiles } = await readImageEditorV3BrushTiles({
          requestId: createImageEditorV3RequestId('layer-pick-brush'),
          tiles: [{ tileKey: '0/0/0', resource: { resourceId: id, byteSize } }],
        }, abort.signal)
        const tile = tiles[0]?.tile
        if (!tile) throw new Error('图层命中瓦片缺失')
        const alpha = new Uint8Array(tile.width * tile.height)
        for (let i = 0; i < alpha.length; i += 1) alpha[i] = Math.ceil(Math.min(1, Math.max(0,
          tile.data[tile.storage === 'mask-float32' ? i : i * 4 + 3])) * 255)
        return createLayerAlphaMapV3(tile.width, tile.height, tile.width, tile.height, alpha)
      }
      const resourceRef = id as ImageEditorV3ResourceRef
      const metadata = await readImageEditorV3SourceMetadata({
        requestId: createImageEditorV3RequestId('layer-pick-metadata'), resourceRef,
      }, abort.signal)
      if (!metadata.hasAlpha && !mask) return createLayerAlphaMapV3(1, 1, metadata.width, metadata.height, new Uint8Array([255]))
      const mip = Math.max(0, Math.ceil(Math.log2(Math.max(metadata.width, metadata.height) / 512)))
      const tile = await readImageEditorV3SourceTile({
        requestId: createImageEditorV3RequestId('layer-pick-alpha'), resourceRef,
        mip, tileX: 0, tileY: 0, halo: 0, bitDepth: 8,
      }, abort.signal)
      if (tile.bitDepth !== 8 || tile.width > 512 || tile.height > 512
        || tile.pixels.byteLength !== tile.width * tile.height * 4) throw new Error('图层命中像素契约不匹配')
      const rgba = new Uint8Array(tile.pixels)
      const alpha = new Uint8Array(tile.width * tile.height)
      for (let i = 0; i < alpha.length; i += 1) alpha[i] = rgba[i * 4 + 3]
      // 与正式旧式蒙版一致：存在透明度时用 Alpha，否则用感知域亮度。
      if (mask && !alpha.some((value) => value < 255)) {
        for (let i = 0; i < alpha.length; i += 1) alpha[i] = Math.round(
          rgba[i * 4] * 0.2126 + rgba[i * 4 + 1] * 0.7152 + rgba[i * 4 + 2] * 0.0722)
      }
      return createLayerAlphaMapV3(tile.width, tile.height, metadata.width, metadata.height, alpha)
    }
    void (async () => {
      logger.debug('开始准备图层命中数据', { event: 'image_editor_v3.layer_picking.start', context: { resourceCount: plan.length } })
      // 顺序读取，避免与正式预览争用解码准入；每份最多 512² 字节 Alpha。
      for (const resource of plan) {
        if (abort.signal.aborted) return
        if (cache.current.has(resource.key)) continue
        try {
          const map = await load(resource)
          if (abort.signal.aborted) return
          const bytes = [...cache.current.values()].reduce((sum, entry) => sum + entry.alpha.byteLength, 0)
          if (bytes + map.alpha.byteLength > 64 * 1024 * 1024) throw new Error('图层命中缓存达到预算，未加载的图层请从面板选择')
          cache.current.set(resource.key, map)
          setMaps(new Map(cache.current))
        } catch (error) {
          if (abort.signal.aborted) return
          logger.warn('图层命中数据准备失败，仍可从图层面板选择', {
            event: 'image_editor_v3.layer_picking.failed',
            context: { resourceId: resource.id, reason: error instanceof Error ? error.message : String(error) },
          })
        }
      }
      logger.debug('图层命中数据准备结束', { event: 'image_editor_v3.layer_picking.completed', context: { readyCount: cache.current.size } })
    })()
    return () => abort.abort()
  }, [document.id, resourceKey])
  return maps
}

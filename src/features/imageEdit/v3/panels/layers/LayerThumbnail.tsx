import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { createImageEditRenderHash, type ImageEditHashValue } from '@/core/imageEdit/v3/renderHash'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { createLogger } from '@/core/logging'
import type { ImageEditThumbnailsV3 } from '../thumbnails'

const logger = createLogger('features.imageEdit.layer_thumbnail')
export function LayerThumbnailV3({ document, layer, thumbnails, fallback }: { document: ImageEditDocumentV3; layer: ImageEditLayerV3; thumbnails?: ImageEditThumbnailsV3 | null; fallback: ReactNode }): JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  const { version, id, geometry, color } = document
  const snapshot = useMemo<ImageEditDocumentV3>(() => ({ version, id, geometry, color, revision: 0,
    namedRegions: [], layers: [{ ...layer, visible: true, clipping: false }] }), [version, id, geometry, color, layer])
  const key = useMemo(() => createImageEditRenderHash(JSON.parse(JSON.stringify(snapshot)) as ImageEditHashValue), [snapshot])
  useEffect(() => {
    setUrl(null)
    if (!thumbnails || (layer.type === 'raster' && layer.source.kind === 'empty' && Object.keys(layer.tiles).length === 0)) return
    const abort = new AbortController()
    // 单层快照取消剪贴，保留自己的内容、蒙版与滤镜；不修改作品。
    void thumbnails.readDocument(snapshot, key, abort.signal)
      .then(value => { if (!abort.signal.aborted) setUrl(value) })
      .catch(error => { if (!abort.signal.aborted) logger.warn('图层缩略图暂不可用', { event: 'image_edit.layer.thumbnail.failed', error }) })
    return () => abort.abort()
  }, [key, thumbnails, snapshot, layer])
  return <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded bg-raised text-text2">
    {url ? <img data-layer-thumbnail className="h-full w-full object-contain" alt="" src={resolveImageDisplayUrl(url)} /> : fallback}
  </span>
}

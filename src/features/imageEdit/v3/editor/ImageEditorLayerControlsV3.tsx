import { useLayoutEffect, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { UiButton } from '@/components/ui'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { paintImageEditorLayerControlsV3 } from './layerControlsPresentationV3'
import { findImageEditLayerLocationV3 } from './layerTreeV3'
import { isImageEditLayerTransformableV3 } from './layerTransformV3'
import { layerToOutputV3, LAYER_TRANSFORM_HANDLES_V3, type LayerContentBoundsV3 } from './layerPickingV3'


export function ImageEditorLayerControlsV3({ rootRef, document, layerId, bounds, outputWidth, outputHeight, zoom }: {
  rootRef: RefObject<HTMLDivElement>
  document: ImageEditDocumentV3
  layerId: string | null
  bounds: LayerContentBoundsV3 | null
  outputWidth: number
  outputHeight: number
  zoom: number
}): JSX.Element | null {
  const { t } = useTranslation('ui')
  const location = layerId ? findImageEditLayerLocationV3(document.layers, layerId) : null
  const visible = isImageEditLayerTransformableV3(location) && location.layer.type === 'raster' && bounds !== null
  useLayoutEffect(() => {
    if (visible && location && bounds) paintImageEditorLayerControlsV3(rootRef.current,
      layerToOutputV3(document, location), bounds, outputWidth, outputHeight, zoom)
  }, [bounds, document, location, outputHeight, outputWidth, rootRef, visible, zoom])
  if (!visible) return null
  return (
    <div ref={rootRef} data-layer-transform-controls={layerId} className="pointer-events-none absolute inset-0">
      {[0, 1, 2, 3, 4].map((edge) => (
        <div key={edge} data-layer-transform-edge={edge} className="absolute h-px origin-left bg-accent" />
      ))}
      {LAYER_TRANSFORM_HANDLES_V3.map((handle) => (
        <UiButton key={handle} variant="plain" data-layer-transform-handle={handle}
          aria-label={t(handle === 'rotate' ? 'imageEditor.v3.layerControls.rotate' : 'imageEditor.v3.layerControls.resize', { handle })}
          // ui-surface-allow: 图片上的小型变换控制点需要对比描边，不是面板或嵌套卡片。
          className={`pointer-events-auto absolute !h-3 !min-h-0 !w-3 !min-w-0 !p-0 !border !border-accent !bg-panel ${handle === 'rotate' ? '!rounded-full cursor-grab' : '!rounded-hairline cursor-crosshair'}`} />
      ))}
    </div>
  )
}

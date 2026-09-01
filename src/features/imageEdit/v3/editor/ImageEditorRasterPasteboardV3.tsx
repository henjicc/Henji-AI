import type { RefObject } from 'react'

import type { ImageEditRasterLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { imageEditorRasterPasteboardTransformV3 } from './rasterPasteboardV3'

interface ImageEditorRasterPasteboardV3Props {
  feedbackRef: RefObject<HTMLDivElement>
  layer: ImageEditRasterLayerV3
  sourceImageUrl: string
  documentWidth: number
  stageWidth: number
}

export function ImageEditorRasterPasteboardV3({
  feedbackRef,
  layer,
  sourceImageUrl,
  documentWidth,
  stageWidth,
}: ImageEditorRasterPasteboardV3Props): JSX.Element {
  return (
    <div
      ref={feedbackRef}
      data-move-feedback-frame
      data-raster-pasteboard-layer={layer.id}
      className="pointer-events-none absolute inset-0 overflow-visible"
    >
      <img
        src={resolveImageDisplayUrl(sourceImageUrl)}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="absolute left-0 top-0 block h-full w-full max-w-none select-none object-fill"
        style={{
          transform: imageEditorRasterPasteboardTransformV3(
            layer.transform,
            stageWidth,
            documentWidth,
          ),
          transformOrigin: '0 0',
        }}
      />
    </div>
  )
}

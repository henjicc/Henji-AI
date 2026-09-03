import type { RefObject } from 'react'

import type { ImageEditRasterLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { imageEditorRasterPasteboardTransformV3 } from './rasterPasteboardV3'

interface ImageEditorRasterPasteboardV3Props {
  feedbackRef: RefObject<HTMLDivElement>
  imageRef: RefObject<HTMLImageElement>
  layer: ImageEditRasterLayerV3
  sourceImageUrl: string
  documentWidth: number
  frame: {
    left: number
    top: number
    width: number
    height: number
  }
  ready: boolean
  onReady: () => void
}

export function ImageEditorRasterPasteboardV3({
  feedbackRef,
  imageRef,
  layer,
  sourceImageUrl,
  documentWidth,
  frame,
  ready,
  onReady,
}: ImageEditorRasterPasteboardV3Props): JSX.Element {
  return (
    <div
      ref={feedbackRef}
      data-move-feedback-frame
      data-raster-pasteboard-layer={layer.id}
      data-raster-source-ready={ready ? 'true' : 'false'}
      className="pointer-events-none absolute overflow-visible"
      style={{
        left: frame.left,
        top: frame.top,
        width: frame.width,
        height: frame.height,
        visibility: ready ? 'visible' : 'hidden',
      }}
    >
      <img
        ref={imageRef}
        src={resolveImageDisplayUrl(sourceImageUrl)}
        alt=""
        aria-hidden="true"
        draggable={false}
        onLoad={onReady}
        className="absolute left-0 top-0 block h-full w-full max-w-none select-none object-fill"
        style={{
          transform: imageEditorRasterPasteboardTransformV3(
            layer.transform,
            frame.width,
            documentWidth,
          ),
          transformOrigin: '0 0',
        }}
      />
    </div>
  )
}

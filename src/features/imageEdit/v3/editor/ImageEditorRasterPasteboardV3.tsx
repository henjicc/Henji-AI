import type { RefObject } from 'react'

import { resolveImageDisplayUrl } from '@/services/imageSource'
import {
  imageEditorRasterPasteboardTransformV3,
  imageEditorRasterProxyTransformV3,
} from './rasterPasteboardV3'
import type { ImageEditorRasterPasteboardEntryV3 } from './useImageEditorRasterPasteboardV3'

interface ImageEditorRasterPasteboardV3Props {
  rootRef: RefObject<HTMLDivElement>
  entries: readonly ImageEditorRasterPasteboardEntryV3[]
  documentWidth: number
  frame: {
    left: number
    top: number
    width: number
    height: number
  }
  ready: boolean
  alwaysVisible: boolean
  bindLayerFeedbackRef: (layerId: string) => (element: HTMLDivElement | null) => void
  onLayerReady: (layerId: string) => void
  onLayerFailed: () => void
}

export function ImageEditorRasterPasteboardV3({
  rootRef,
  entries,
  documentWidth,
  frame,
  ready,
  alwaysVisible,
  bindLayerFeedbackRef,
  onLayerReady,
  onLayerFailed,
}: ImageEditorRasterPasteboardV3Props): JSX.Element {
  return (
    <div
      ref={rootRef}
      data-raster-pasteboard-stack={alwaysVisible ? 'single' : 'multi'}
      data-raster-source-ready={ready ? 'true' : 'false'}
      className="pointer-events-none absolute inset-0"
      style={{ visibility: alwaysVisible && ready ? 'visible' : 'hidden' }}
    >
      {entries.map((entry) => {
        const imageTransform = entry.proxy && entry.metadata
          ? imageEditorRasterProxyTransformV3(
              entry.layer.transform,
              frame.width,
              documentWidth,
              entry.proxy.width,
              entry.proxy.height,
              entry.metadata.width,
              entry.metadata.height,
            )
          : imageEditorRasterPasteboardTransformV3(
              entry.layer.transform,
              frame.width,
              documentWidth,
            )
        return (
          <div
            key={entry.layer.id}
            ref={bindLayerFeedbackRef(entry.layer.id)}
            data-move-feedback-frame
            data-raster-pasteboard-layer={entry.layer.id}
            data-raster-source-ready={ready ? 'true' : 'false'}
            className="pointer-events-none absolute overflow-visible"
            style={{ left: frame.left, top: frame.top }}
          >
            <img
              src={resolveImageDisplayUrl(entry.sourceUrl)}
              alt=""
              aria-hidden="true"
              draggable={false}
              onLoad={() => onLayerReady(entry.layer.id)}
              onError={onLayerFailed}
              className={entry.proxy
                ? 'absolute left-0 top-0 block max-w-none select-none'
                : 'absolute left-0 top-0 block h-full w-full max-w-none select-none object-fill'}
              style={{
                ...(entry.proxy ? undefined : { width: frame.width, height: frame.height }),
                transform: imageTransform,
                transformOrigin: '0 0',
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

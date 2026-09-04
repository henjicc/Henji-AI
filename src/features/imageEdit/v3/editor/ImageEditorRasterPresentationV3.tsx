import type { ComponentProps, RefObject } from 'react'

import { ImageEditorRasterPasteboardV3 } from './ImageEditorRasterPasteboardV3'
import { ImageEditorViewportTilesV3 } from './ImageEditorViewportTilesV3'
import type { ImageEditorRasterPasteboardV3State } from './useImageEditorRasterPasteboardV3'
import type { ImageEditorViewportDocumentFrameV3 } from './useImageEditorViewportLayoutV3'

interface ImageEditorRasterPresentationV3Props {
  stableDisplayRef: RefObject<HTMLDivElement>
  liveBlurFeedback: number | null
  viewportSession: ComponentProps<typeof ImageEditorViewportTilesV3>['session']
  viewportLayout: ComponentProps<typeof ImageEditorViewportTilesV3>['layout']
  label: string
  pasteboard: ImageEditorRasterPasteboardV3State
  documentFrame: ImageEditorViewportDocumentFrameV3 | null
  documentWidth: number
}

/** 稳定瓦片表面与瞬态普通栅格栈共用同一文档裁切层。 */
export function ImageEditorRasterPresentationV3({
  stableDisplayRef,
  liveBlurFeedback,
  viewportSession,
  viewportLayout,
  label,
  pasteboard,
  documentFrame,
  documentWidth,
}: ImageEditorRasterPresentationV3Props): JSX.Element {
  return (
    <>
      <div
        ref={stableDisplayRef}
        data-raster-display-frame
        data-live-blur-feedback={liveBlurFeedback === null ? undefined : 'active'}
        className={`pointer-events-none absolute inset-0 overflow-hidden ${
          pasteboard.alwaysVisible && pasteboard.ready ? 'invisible' : ''
        }`}
        style={{
          visibility: pasteboard.alwaysVisible && pasteboard.ready ? 'hidden' : 'visible',
          ...(liveBlurFeedback === null ? undefined : {
            filter: `blur(${liveBlurFeedback}px)`,
            willChange: 'filter',
          }),
        }}
      >
        <ImageEditorViewportTilesV3
          session={viewportSession}
          layout={viewportLayout}
          label={label}
        />
      </div>
      {pasteboard.entries.length > 0 && documentFrame && pasteboard.sourceIdentity ? (
        <ImageEditorRasterPasteboardV3
          rootRef={pasteboard.rootRef}
          entries={pasteboard.entries}
          documentWidth={documentWidth}
          frame={documentFrame}
          ready={pasteboard.ready}
          alwaysVisible={pasteboard.alwaysVisible}
          bindLayerFeedbackRef={pasteboard.bindLayerFeedbackRef}
          onLayerReady={pasteboard.markReady}
          onLayerFailed={pasteboard.markFailed}
        />
      ) : null}
    </>
  )
}

import { ImageEditorCommandBarV3 } from './ImageEditorCommandBarV3'
import { ImageEditorLayersPanelV3 } from './ImageEditorLayersPanelV3'
import { ImageEditorPreviewV3 } from './ImageEditorPreviewV3'
import { ImageEditorPropertiesPanelV3 } from './ImageEditorPropertiesPanelV3'
import { ImageEditorToolRailV3 } from './ImageEditorToolRailV3'
import type { ImageEditorV3Props } from './types'
import { useImageEditorControllerV3 } from './useImageEditorControllerV3'

export function ImageEditorV3(props: ImageEditorV3Props): JSX.Element {
  const { controller, bus } = useImageEditorControllerV3(props)
  const showLayers = controller.profile.panels.includes('layers')
  const showProperties = controller.profile.panels.includes('properties')
  const showSidebar = showLayers || showProperties

  return (
    <div
      data-image-editor-v3
      data-host-profile={controller.profile.id}
      className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-bg-dark text-text-dark ${props.className ?? ''}`}
    >
      <ImageEditorCommandBarV3
        controller={controller}
        toolbarLeading={props.toolbarLeading}
        toolbarActions={props.toolbarActions}
      />
      <div className="flex min-h-0 min-w-0 flex-1">
        <ImageEditorToolRailV3 controller={controller} />
        <ImageEditorPreviewV3
          sourceImageUrl={props.sourceImageUrl}
          previewRenderer={props.previewRenderer}
          annotationOverlay={props.annotationOverlay}
          resourceByteSizes={props.resourceByteSizes}
          bus={bus}
          controller={controller}
        />
        {showSidebar ? (
          <aside
            data-surface-level="sidebar"
            className="flex w-80 shrink-0 flex-col border-l border-border-dark bg-panel"
          >
            {showLayers ? (
              <ImageEditorLayersPanelV3 controller={controller} />
            ) : null}
            {showLayers && showProperties ? (
              <div className="h-px shrink-0 bg-border-dark" aria-hidden="true" />
            ) : null}
            {showProperties ? (
              <ImageEditorPropertiesPanelV3
                controller={controller}
                onCreateMaskResource={props.onCreateMaskResource}
              />
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  )
}

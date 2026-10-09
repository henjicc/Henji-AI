import { ImageEditorAnnotationOverlayV3 } from '../editor/ImageEditorAnnotationOverlayV3'
import { ImageEditorSelectionOverlayV3 } from '../editor/ImageEditorSelectionOverlayV3'
import { ImageEditorSelectionMaskOverlayV3 } from '../editor/ImageEditorSelectionMaskOverlayV3'
import { ImageEditorCropOverlayV3 } from '../editor/ImageEditorCropOverlayV3'
import { ImageEditorCropParametersV3 } from '../editor/ImageEditorCropParametersV3'
import { ImageEditorRepairParametersV3 } from '../editor/ImageEditorRepairParametersV3'
import { ImageEditorSelectionParametersV3 } from '../editor/ImageEditorSelectionParametersV3'
import { LegacyToolOptions } from '../tools/legacy/LegacyToolOptions'
import type { ToolDefinition, ToolOverlaySlot } from '../toolFramework/types'

import { legacyToolManifest } from '../tools/legacy/manifest'
const annotations: ToolOverlaySlot = { id: 'annotation', render: ({ controller, bindKeyboard }) => <ImageEditorAnnotationOverlayV3 controller={controller} bindKeyboard={bindKeyboard} /> }
const regions: ToolOverlaySlot = { id: 'selection', render: (context) => context.controller.profile.id === 'mask'
  ? <ImageEditorSelectionMaskOverlayV3 {...context} /> : <ImageEditorSelectionOverlayV3 {...context} /> }
const crop: ToolOverlaySlot = { id: 'crop', activeOnly: true, requiresLayout: true, resetOnCancel: true,
  onCancel: ({ controller }) => controller.clearOutputGeometryPreview(`${controller.sessionId}:output-geometry`),
  render: (context) => <ImageEditorCropOverlayV3 {...context} /> }

const adapters: Record<string, Pick<ToolDefinition, 'Options' | 'overlays'>> = {
  navigation: { overlays: [annotations] },
  crop: { Options: ImageEditorCropParametersV3, overlays: [crop] },
  selection: { Options: props => props.controller.profile.id === 'mask'
    ? <LegacyToolOptions {...props} /> : <ImageEditorSelectionParametersV3 {...props} />, overlays: [regions] },
  repair: { Options: ImageEditorRepairParametersV3, overlays: [regions] },
  annotation: { Options: LegacyToolOptions, overlays: [annotations] },
}

export const tools: readonly ToolDefinition[] = legacyToolManifest.map(definition => ({
  ...definition, ...adapters[definition.group.id],
  ...(definition.id === 'move' ? { Options: LegacyToolOptions } : {}),
}))

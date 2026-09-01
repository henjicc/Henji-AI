export type ImageEditorHostProfileIdV3 = 'full' | 'quick' | 'canvas-edit' | 'mask';

export type ImageEditorToolIdV3 =
  | 'move'
  | 'hand'
  | 'zoom'
  | 'crop'
  | 'select-rect'
  | 'select-ellipse'
  | 'select-lasso'
  | 'annotation-text'
  | 'annotation-callout'
  | 'annotation-arrow'
  | 'annotation-rect'
  | 'annotation-ellipse'
  | 'annotation-number'
  | 'annotation-pen'
  | 'raster-brush'
  | 'eraser'
  | 'mask-edit';

export type ImageEditorPanelIdV3 = 'layers' | 'properties' | 'histogram' | 'color' | 'history';
export type ImageEditorLayerControlV3 = 'blend-mode' | 'mask';
export type ImageEditorSaveActionV3 = 'save-document' | 'save-package' | 'export-raster';
export type ImageEditorLayerKindV3 = 'raster' | 'annotation' | 'effect' | 'adjustment' | 'group';

export type ImageEditorCapabilityReadinessStateV3 = 'ready' | 'disabled' | 'limited';

export type ImageEditorReadinessReasonKeyV3 =
  | 'imageEditor.v3.readiness.reasons.hand'
  | 'imageEditor.v3.readiness.reasons.zoom'
  | 'imageEditor.v3.readiness.reasons.selectRect'
  | 'imageEditor.v3.readiness.reasons.selectEllipse'
  | 'imageEditor.v3.readiness.reasons.selectLasso'
  | 'imageEditor.v3.readiness.reasons.maskEdit'
  | 'imageEditor.v3.readiness.reasons.glowUnavailable'
  | 'imageEditor.v3.readiness.reasons.glowExport'
  | 'imageEditor.v3.readiness.reasons.hdrExport'
  | 'imageEditor.v3.readiness.reasons.quickHdr'
  | 'imageEditor.v3.readiness.reasons.exportDocumentNotReady'
  | 'imageEditor.v3.readiness.reasons.viewerDocumentNotReady'
  | 'imageEditor.v3.readiness.reasons.exportHdrMetadata'
  | 'imageEditor.v3.readiness.reasons.exportHdrPixelLimit'
  | 'imageEditor.v3.readiness.reasons.exportBitDepth'
  | 'imageEditor.v3.readiness.reasons.exportInvalidIcc';

export interface ImageEditorCapabilityReadinessV3 {
  state: ImageEditorCapabilityReadinessStateV3;
  /** Stable UI key for known product limitations. Resolved only by presentation consumers. */
  reasonKey?: ImageEditorReadinessReasonKeyV3;
  /** Opaque lower-layer detail when no stable product reason exists. */
  reason?: string;
}

/** Carries a structured host limitation across non-React preparation code. */
export class ImageEditorReadinessErrorV3 extends Error {
  constructor(readonly readiness: ImageEditorCapabilityReadinessV3) {
    super(readiness.reason ?? readiness.reasonKey ?? readiness.state);
    this.name = 'ImageEditorReadinessErrorV3';
  }
}

export interface ImageEditorCapabilityV3<TId extends string> {
  id: TId;
  readiness: ImageEditorCapabilityReadinessV3;
}

export interface ImageEditorHostProfileV3 {
  id: ImageEditorHostProfileIdV3;
  tools: readonly ImageEditorCapabilityV3<ImageEditorToolIdV3>[];
  layerKinds: readonly ImageEditorLayerKindV3[];
  effects: readonly ImageEditorCapabilityV3<string>[];
  adjustments: readonly string[];
  panels: readonly ImageEditorPanelIdV3[];
  layerControls: readonly ImageEditorLayerControlV3[];
  saveActions: readonly ImageEditorSaveActionV3[];
  hdrReadiness: ImageEditorCapabilityReadinessV3;
  allowPackageExternalSources: boolean;
}

const ready = <TId extends string>(id: TId): ImageEditorCapabilityV3<TId> => ({
  id,
  readiness: { state: 'ready' },
});

const MOVE_TOOL = ready('move');
const HAND_TOOL = ready('hand');
const ZOOM_TOOL = ready('zoom');
const NAVIGATION_TOOLS: readonly ImageEditorCapabilityV3<ImageEditorToolIdV3>[] = [
  MOVE_TOOL,
  HAND_TOOL,
  ZOOM_TOOL,
];
const SELECTION_TOOLS: readonly ImageEditorCapabilityV3<ImageEditorToolIdV3>[] = [
  ready('select-rect'),
  ready('select-ellipse'),
  ready('select-lasso'),
];
const ANNOTATION_TOOLS: readonly ImageEditorCapabilityV3<ImageEditorToolIdV3>[] = [
  ready('annotation-text'),
  ready('annotation-callout'),
  ready('annotation-arrow'),
  ready('annotation-rect'),
  ready('annotation-ellipse'),
  ready('annotation-number'),
  ready('annotation-pen'),
];
const RASTER_TOOLS: readonly ImageEditorCapabilityV3<ImageEditorToolIdV3>[] = [
  ready('raster-brush'),
  ready('eraser'),
  ready('mask-edit'),
];
const CORE_EFFECTS: readonly ImageEditorCapabilityV3<string>[] = [
  ready('image.gaussian-blur-v2'),
  ready('image.diffusion'),
  ready('image.vgpu-glow'),
];
const HDR_LIMITATION: ImageEditorCapabilityReadinessV3 = {
  state: 'limited',
  reasonKey: 'imageEditor.v3.readiness.reasons.hdrExport',
};

export const IMAGE_EDITOR_HOST_PROFILES_V3: Readonly<
  Record<ImageEditorHostProfileIdV3, ImageEditorHostProfileV3>
> = {
  full: {
    id: 'full',
    tools: [...NAVIGATION_TOOLS, ready('crop'), ...ANNOTATION_TOOLS],
    layerKinds: ['raster', 'effect'],
    effects: CORE_EFFECTS,
    adjustments: [],
    panels: ['layers', 'properties'],
    layerControls: [],
    saveActions: ['save-document', 'export-raster'],
    hdrReadiness: {
      state: 'disabled',
      reasonKey: 'imageEditor.v3.readiness.reasons.hdrExport',
    },
    allowPackageExternalSources: false,
  },
  quick: {
    id: 'quick',
    tools: [...NAVIGATION_TOOLS, ready('crop'), ...ANNOTATION_TOOLS],
    layerKinds: ['effect'],
    effects: CORE_EFFECTS.filter(({ id }) => id !== 'image.vgpu-glow'),
    adjustments: [],
    panels: ['layers', 'properties'],
    layerControls: ['blend-mode'],
    saveActions: ['save-document', 'export-raster'],
    hdrReadiness: {
      state: 'disabled',
      reasonKey: 'imageEditor.v3.readiness.reasons.quickHdr',
    },
    allowPackageExternalSources: false,
  },
  'canvas-edit': {
    id: 'canvas-edit',
    tools: [...NAVIGATION_TOOLS, ready('crop'), ...ANNOTATION_TOOLS],
    layerKinds: ['raster', 'effect'],
    effects: CORE_EFFECTS,
    adjustments: [],
    panels: ['layers', 'properties'],
    layerControls: [],
    saveActions: ['save-document'],
    hdrReadiness: {
      state: 'disabled',
      reasonKey: 'imageEditor.v3.readiness.reasons.hdrExport',
    },
    allowPackageExternalSources: false,
  },
  mask: {
    id: 'mask',
    tools: [...NAVIGATION_TOOLS, ...SELECTION_TOOLS, ...RASTER_TOOLS],
    layerKinds: ['raster'],
    effects: [],
    adjustments: [],
    panels: ['layers', 'properties'],
    layerControls: ['mask'],
    saveActions: ['save-document'],
    hdrReadiness: HDR_LIMITATION,
    allowPackageExternalSources: false,
  },
};

export function getImageEditorHostProfileV3(id: ImageEditorHostProfileIdV3): ImageEditorHostProfileV3 {
  return IMAGE_EDITOR_HOST_PROFILES_V3[id];
}

export function getReadyImageEditorToolIdsV3(
  profile: ImageEditorHostProfileV3,
): ImageEditorToolIdV3[] {
  return profile.tools
    .filter(({ readiness }) => readiness.state === 'ready')
    .map(({ id }) => id);
}

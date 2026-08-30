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
  | 'annotation-arrow'
  | 'annotation-rect'
  | 'annotation-pen'
  | 'raster-brush'
  | 'eraser'
  | 'mask-edit';

export type ImageEditorPanelIdV3 = 'layers' | 'properties' | 'histogram' | 'color' | 'history';
export type ImageEditorSaveActionV3 = 'save-document' | 'save-package' | 'export-raster';
export type ImageEditorLayerKindV3 = 'raster' | 'annotation' | 'effect' | 'adjustment' | 'group';

export interface ImageEditorHostProfileV3 {
  id: ImageEditorHostProfileIdV3;
  tools: readonly ImageEditorToolIdV3[];
  layerKinds: readonly ImageEditorLayerKindV3[];
  effects: readonly string[];
  adjustments: readonly string[];
  panels: readonly ImageEditorPanelIdV3[];
  saveActions: readonly ImageEditorSaveActionV3[];
  allowHdr: boolean;
  allowPackageExternalSources: boolean;
}

const NAVIGATION_TOOLS: readonly ImageEditorToolIdV3[] = ['move', 'hand', 'zoom'];
const SELECTION_TOOLS: readonly ImageEditorToolIdV3[] = [
  'select-rect', 'select-ellipse', 'select-lasso',
];
const ANNOTATION_TOOLS: readonly ImageEditorToolIdV3[] = [
  'annotation-text', 'annotation-arrow', 'annotation-rect', 'annotation-pen',
];
const CORE_EFFECTS = ['image.gaussian-blur-v2', 'image.diffusion', 'image.vgpu-glow'] as const;
const CORE_ADJUSTMENTS = ['exposure', 'curves', 'temperature-tint', 'hsl'] as const;

export const IMAGE_EDITOR_HOST_PROFILES_V3: Readonly<
  Record<ImageEditorHostProfileIdV3, ImageEditorHostProfileV3>
> = {
  full: {
    id: 'full',
    tools: [
      ...NAVIGATION_TOOLS, 'crop', ...SELECTION_TOOLS, ...ANNOTATION_TOOLS,
      'raster-brush', 'eraser', 'mask-edit',
    ],
    layerKinds: ['raster', 'annotation', 'effect', 'adjustment', 'group'],
    effects: CORE_EFFECTS,
    adjustments: CORE_ADJUSTMENTS,
    panels: ['layers', 'properties', 'histogram', 'color', 'history'],
    saveActions: ['save-document', 'save-package', 'export-raster'],
    allowHdr: true,
    allowPackageExternalSources: true,
  },
  quick: {
    id: 'quick',
    tools: [...NAVIGATION_TOOLS, 'crop', ...ANNOTATION_TOOLS],
    layerKinds: ['annotation', 'effect', 'adjustment'],
    effects: ['image.gaussian-blur-v2', 'image.diffusion'],
    adjustments: ['exposure', 'hsl'],
    panels: ['layers', 'properties'],
    saveActions: ['save-document', 'export-raster'],
    allowHdr: false,
    allowPackageExternalSources: false,
  },
  'canvas-edit': {
    id: 'canvas-edit',
    tools: [...NAVIGATION_TOOLS, 'crop', ...ANNOTATION_TOOLS, 'raster-brush', 'eraser', 'mask-edit'],
    layerKinds: ['raster', 'annotation', 'effect', 'adjustment', 'group'],
    effects: CORE_EFFECTS,
    adjustments: CORE_ADJUSTMENTS,
    panels: ['layers', 'properties', 'history'],
    saveActions: ['save-document'],
    allowHdr: true,
    allowPackageExternalSources: false,
  },
  mask: {
    id: 'mask',
    tools: [...NAVIGATION_TOOLS, ...SELECTION_TOOLS, 'raster-brush', 'eraser', 'mask-edit'],
    layerKinds: ['raster'],
    effects: [],
    adjustments: [],
    panels: ['layers', 'properties', 'history'],
    saveActions: ['save-document'],
    allowHdr: true,
    allowPackageExternalSources: false,
  },
};

export function getImageEditorHostProfileV3(id: ImageEditorHostProfileIdV3): ImageEditorHostProfileV3 {
  return IMAGE_EDITOR_HOST_PROFILES_V3[id];
}

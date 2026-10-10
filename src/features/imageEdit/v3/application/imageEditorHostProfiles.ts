import { toolManifestRegistration } from '../toolFramework/toolManifest';
import type { ImageEditorRegisteredToolId } from '../toolFramework/types';
import { listCreatableImageEditOperationIdsV3 } from '@/core/imageEdit/v3/operationCatalog';

export type ImageEditorHostProfileIdV3 = 'full' | 'quick' | 'canvas-edit' | 'mask';

export type ImageEditorToolIdV3 = ImageEditorRegisteredToolId;

export type ImageEditorPanelIdV3 = 'layers' | 'properties' | 'histogram' | 'color' | 'history' | 'channels' | 'adjustments';
export type ImageEditorLayerControlV3 = 'blend-mode' | 'mask';
export type ImageEditorSaveActionV3 = 'save-document' | 'save-package' | 'export-raster';
export type ImageEditorLayerKindV3 = 'raster' | 'smart' | 'text' | 'shape' | 'path' | 'effect' | 'adjustment' | 'group';

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

const registeredTools = (profileId: ImageEditorHostProfileIdV3): readonly ImageEditorCapabilityV3<ImageEditorToolIdV3>[] => {
  // 失败时保留会话焦点以展示正式错误；空登记器不接受任何编辑输入。
  if (toolManifestRegistration.failed) return [ready('move')];
  return toolManifestRegistration.registry.list().filter(tool => tool.profiles.includes(profileId)).map(tool => ready(tool.id));
};
const CORE_EFFECTS: readonly ImageEditorCapabilityV3<string>[] =
  listCreatableImageEditOperationIdsV3('effect').map(ready);
const HDR_LIMITATION: ImageEditorCapabilityReadinessV3 = {
  state: 'limited',
  reasonKey: 'imageEditor.v3.readiness.reasons.hdrExport',
};

export const IMAGE_EDITOR_HOST_PROFILES_V3: Readonly<
  Record<ImageEditorHostProfileIdV3, ImageEditorHostProfileV3>
> = {
  full: {
    id: 'full',
    get tools() { return registeredTools('full'); },
    layerKinds: ['raster', 'smart', 'text', 'shape', 'path', 'effect', 'adjustment', 'group'],
    effects: CORE_EFFECTS,
    adjustments: listCreatableImageEditOperationIdsV3('adjustment'),
    panels: ['layers', 'properties', 'history', 'channels', 'adjustments', 'color'],
    layerControls: ['blend-mode', 'mask'],
    saveActions: ['save-document', 'export-raster'],
    hdrReadiness: {
      state: 'disabled',
      reasonKey: 'imageEditor.v3.readiness.reasons.hdrExport',
    },
    allowPackageExternalSources: false,
  },
  quick: {
    id: 'quick',
    get tools() { return registeredTools('quick'); },
    layerKinds: ['text', 'shape', 'path', 'effect'],
    effects: CORE_EFFECTS.filter(({ id }) => id !== 'image.vgpu-glow'),
    adjustments: [],
    panels: ['layers', 'properties', 'history'],
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
    get tools() { return registeredTools('canvas-edit'); },
    layerKinds: ['raster', 'smart', 'text', 'shape', 'path', 'effect', 'adjustment', 'group'],
    effects: CORE_EFFECTS,
    adjustments: listCreatableImageEditOperationIdsV3('adjustment'),
    panels: ['layers', 'properties', 'history', 'channels', 'adjustments', 'color'],
    layerControls: ['blend-mode', 'mask'],
    saveActions: ['save-document'],
    hdrReadiness: {
      state: 'disabled',
      reasonKey: 'imageEditor.v3.readiness.reasons.hdrExport',
    },
    allowPackageExternalSources: false,
  },
  mask: {
    id: 'mask',
    get tools() { return registeredTools('mask'); },
    layerKinds: ['raster'],
    effects: [],
    adjustments: [],
    panels: ['layers', 'properties', 'history'],
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

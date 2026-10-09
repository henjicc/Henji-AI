import type { ImageEditorV3Controller } from '../editor/types';
import type { ImageEditLayerFilterV3, ImageEditLayerV3, ImageEditJsonObjectV3 } from '@/core/imageEdit/v3/layerTypes';
import { createImageEditAdjustmentLayerV3, createImageEditEffectLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import { updateFilter } from '@/core/imaging/filterStack';

/** Reuse the original parameter controls/gesture lifecycle; only mounting changes. */
export function imageEditFilterParameterAdapterV3(controller: ImageEditorV3Controller, owner: ImageEditLayerV3, filter: ImageEditLayerFilterV3) {
  const layer = filter.operationType === 'effect' ? createImageEditEffectLayerV3(filter.id, owner.name, filter.effectId, filter.params)
    : createImageEditAdjustmentLayerV3(filter.id, owner.name, filter.effectId, filter.params);
  const patch = (params: ImageEditJsonObjectV3) => ({ filters: updateFilter(owner.filters, filter.id, { params }) });
  const adapter: ImageEditorV3Controller = { ...controller,
    updateLayerParams: (_id, params) => controller.updateLayerCommon(owner.id, patch(params)),
    setParameterPreview: (id, _layerId, value) => controller.setParameterPreview(id, owner.id, patch(value as ImageEditJsonObjectV3)),
    commitLayerParamsPreview: (id, _layerId, params) => {
      // A numeric edit can finish before its scheduled preview frame runs.
      const value = patch(params);
      controller.setParameterPreview(id, owner.id, value);
      controller.commitLayerCommonPreview(id, owner.id, value);
    },
  };
  return { layer, controller: adapter };
}

/** Ordinary filter mixing uses the same transient projection and single commit as effect parameters. */
export function imageEditFilterMixPreviewV3(controller: ImageEditorV3Controller, owner: ImageEditLayerV3, filterId: string, previewId: string) {
  const patch = (opacity: number) => ({ filters: updateFilter(owner.filters, filterId, { opacity }) });
  return {
    write: (opacity: number) => controller.setParameterPreview(previewId, owner.id, patch(opacity)),
    finish: (opacity: number) => {
      const value = patch(opacity);
      controller.setParameterPreview(previewId, owner.id, value);
      controller.commitLayerCommonPreview(previewId, owner.id, value);
    },
    cancel: () => controller.clearParameterPreview(previewId),
  };
}

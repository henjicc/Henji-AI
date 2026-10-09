import { imageEditMarkItemSchema, imageEditPreviewOperationsSchema } from './imageEditControlCatalog'
import { createDefaultDiffusionOperationParams, createDefaultVgpuGlowOperationParams, applyDiffusionPresetForSelection, applyVgpuGlowLook, createMarkId, type DiffusionOperationParams, type VgpuGlowOperationParams, type MarkItem } from '@/core/imageEdit'
import { createImageEditAnnotationLayerV3, createImageEditDocumentV3, createImageEditEffectLayerV3, createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditCommandV3 } from '@/core/imageEdit/v3/commandTypes'
import type { ImageEditJsonObjectV3 } from '@/core/imageEdit/v3/layerTypes'
import { composeOrientation } from '@/core/imageEdit/marks/geometry'
import { ImageEditCommandBusV3 } from '../v3/application/imageEditCommandBus'

export interface AssistantImageEditSourceSize { width: number; height: number }

/** 预览只是 V3 命令的输入投影，标注坐标始终使用原图空间。 */
export function buildImageEditDocumentFromControlOperations(values: readonly unknown[], sourceSize: AssistantImageEditSourceSize, existingDocument?: ImageEditDocumentV3): ImageEditDocumentV3 {
  const bus = new ImageEditCommandBusV3(existingDocument ?? createImageEditDocumentV3(sourceSize))
  const operations = imageEditPreviewOperationsSchema.parse(values)
  const dispatch = (command: ImageEditCommandV3): void => { bus.dispatch(command) }
  const base = (): { commandId: string; expectedRevision: number } => ({ commandId: createImageEditIdV3('preview-command'), expectedRevision: bus.getSnapshot().document.revision })
  const addEffect = (id: string, params: ImageEditJsonObjectV3): void => {
    const layer = createImageEditEffectLayerV3(createImageEditIdV3('effect'), id, id, params)
    dispatch({ ...base(), type: 'layer.add', layer, parentId: null, index: bus.getSnapshot().document.layers.length })
  }
  let annotationLayerId: string | null = null
  try {
    for (const operation of operations) {
      const document = bus.getSnapshot().document
      if (operation.kind === 'rotate_cw' || operation.kind === 'rotate_ccw' || operation.kind === 'flip_h' || operation.kind === 'flip_v') {
        let orientation = document.geometry.orientation
        const op = { rotate_cw: 'rotate-cw', rotate_ccw: 'rotate-ccw', flip_h: 'flip-h', flip_v: 'flip-v' } as const
        const turns = operation.kind === 'rotate_cw' || operation.kind === 'rotate_ccw' ? (operation.degrees ?? 90) / 90 : 1
        for (let turn = 0; turn < turns; turn += 1) orientation = composeOrientation(orientation, op[operation.kind])
        dispatch({ ...base(), type: 'document.update-output-geometry', orientation, crop: null })
        continue
      }
      if (operation.kind === 'crop') {
        dispatch({ ...base(), type: 'document.update-output-geometry', orientation: document.geometry.orientation, crop: operation.crop })
        continue
      }
      if (operation.kind === 'blur') {
        addEffect('gaussian_blur', { sigma_fraction_height: operation.sigma_fraction_height ?? .01, axis: operation.axis ?? 'both', edge_mode: operation.edge_mode ?? 'clamp' })
        continue
      }
    if (operation.kind === 'diffusion') {
      const defaults = createDefaultDiffusionOperationParams();
      const hasGlowOnlyOverride = operation.glowExposure !== undefined
        || operation.highlightRolloff !== undefined
        || operation.glowCoreWhite !== undefined;
      const preset = applyDiffusionPresetForSelection(
        defaults,
        operation.mode ?? (hasGlowOnlyOverride ? 'glow' : defaults.mode),
        operation.density ?? defaults.density,
      );
      const hasTintValue = operation.tint?.hue !== undefined
        || operation.tint?.saturation !== undefined
        || operation.tint?.lightness !== undefined;
      const diffusionParams: DiffusionOperationParams = {
        ...preset,
        quality: operation.quality ?? preset.quality,
        strength: operation.strength ?? preset.strength,
        glowRange: operation.glowRange ?? preset.glowRange,
        highlightResponse: operation.highlightResponse ?? preset.highlightResponse,
        softness: operation.softness ?? preset.softness,
        blackRetention: operation.blackRetention ?? preset.blackRetention,
        detailRetention: operation.detailRetention ?? preset.detailRetention,
        colorRetention: operation.colorRetention ?? preset.colorRetention,
        glowExposure: operation.glowExposure ?? preset.glowExposure,
        highlightRolloff: operation.highlightRolloff ?? preset.highlightRolloff,
        glowCoreWhite: operation.glowCoreWhite ?? preset.glowCoreWhite,
        tint: {
          enabled: operation.tint?.enabled ?? (hasTintValue ? true : preset.tint.enabled),
          hue: operation.tint?.hue ?? preset.tint.hue,
          saturation: operation.tint?.saturation ?? preset.tint.saturation,
          lightness: operation.tint?.lightness ?? preset.tint.lightness,
        },
      };
      addEffect('image.diffusion', diffusionParams as unknown as ImageEditJsonObjectV3);
      continue;
    }

    if (operation.kind === 'vgpu_glow') {
      const defaults = createDefaultVgpuGlowOperationParams();
      const preset = applyVgpuGlowLook(operation.look ?? defaults.look);
      const vgpuGlowParams: VgpuGlowOperationParams = {
        ...preset,
        tintEnabled: operation.tintEnabled ?? (operation.tintColor !== undefined ? true : preset.tintEnabled),
        tintColor: operation.tintColor ?? preset.tintColor,
        intensity: operation.intensity ?? preset.intensity,
        radius: operation.radius ?? preset.radius,
        chromaticAberration: operation.chromaticAberration ?? preset.chromaticAberration,
        chromaticChannels: operation.chromaticChannels ?? preset.chromaticChannels,
        sourceThreshold: operation.sourceThreshold ?? preset.sourceThreshold,
        whiteHeat: operation.whiteHeat ?? preset.whiteHeat,
      };
      addEffect('image.vgpu-glow', vgpuGlowParams as unknown as ImageEditJsonObjectV3);
      continue;
    }

      const parsed = imageEditMarkItemSchema.parse(operation.item)
      const item = { ...parsed, id: parsed.id ?? createMarkId() } as MarkItem
      if (!annotationLayerId) {
        const layer = createImageEditAnnotationLayerV3(createImageEditIdV3('annotation-layer'), '标注')
        annotationLayerId = layer.id
        dispatch({ ...base(), type: 'layer.add', layer, parentId: null, index: bus.getSnapshot().document.layers.length })
      }
      const layer = bus.getSnapshot().document.layers.find(candidate => candidate.id === annotationLayerId)
      if (!layer || layer.type !== 'annotation') throw new Error('标注图层不存在')
      dispatch({ ...base(), type: 'annotation.add', layerId: layer.id, annotation: item, index: layer.annotations.length })
    }
    return bus.getSnapshot().document
  } finally { bus.dispose() }
}

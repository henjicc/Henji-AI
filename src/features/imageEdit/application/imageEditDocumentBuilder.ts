import {
  imageEditMarkItemSchema,
  imageEditPreviewOperationsSchema,
  type ImageEditControlOperation,
} from './imageEditControlCatalog';
import {
  createDefaultBlurOperationParams,
  createDefaultDiffusionOperationParams,
  createDefaultVgpuGlowOperationParams,
  createEmptyMarkDoc,
  createImageEditOperation,
  createImageEditDocumentFromMarkDoc,
  createMarkId,
  IMAGE_EDIT_OPERATION_IDS,
  imageEditDocumentToMarkDoc,
  applyDiffusionPresetForSelection,
  applyVgpuGlowLook,
  replaceMarkDocInImageEditDocument,
  upsertImageEditOperation,
  upsertImageEditOperationWithExclusivity,
  type BlurOperationParams,
  type DiffusionOperationParams,
  type ImageEditDocument,
  type ImageEditOperation,
  type MarkItem,
  type VgpuGlowOperationParams,
} from '@/core/imageEdit';
import {
  applyOrientationOpToDoc,
  type OrientationOp,
} from '@/features/imageMark/domain/geometry';
import { MIN_IMAGE_EDIT_CROP_SIZE_PX } from '@/core/imageEdit/constraints';
import { z } from 'zod';

export interface AssistantImageEditSourceSize {
  width: number;
  height: number;
}

const ORIENTATION_OPERATIONS: Record<
  Extract<ImageEditControlOperation['kind'], 'rotate_cw' | 'rotate_ccw' | 'flip_h' | 'flip_v'>,
  OrientationOp
> = {
  rotate_cw: 'rotate-cw',
  rotate_ccw: 'rotate-ccw',
  flip_h: 'flip-h',
  flip_v: 'flip-v',
};

function isOrientationOperation(
  operation: ImageEditControlOperation
): operation is Extract<
  ImageEditControlOperation,
  { kind: 'rotate_cw' | 'rotate_ccw' | 'flip_h' | 'flip_v' }
> {
  return operation.kind === 'rotate_cw'
    || operation.kind === 'rotate_ccw'
    || operation.kind === 'flip_h'
    || operation.kind === 'flip_v';
}

export function buildImageEditDocumentFromControlOperations(
  values: readonly unknown[],
  sourceSize: AssistantImageEditSourceSize,
  existingDocument?: ImageEditDocument
): ImageEditDocument {
  let doc = existingDocument ? imageEditDocumentToMarkDoc(existingDocument) : createEmptyMarkDoc();
  let currentWidth = sourceSize.width;
  let currentHeight = sourceSize.height;
  let blurParams: BlurOperationParams | null = null;
  const exclusiveEffectOperations: ImageEditOperation[] = [];
  const operations = imageEditPreviewOperationsSchema.parse(values);
  const markIds = new Set(doc.items.map((item) => item.id));
  if (doc.orientation.rotate === 90 || doc.orientation.rotate === 270) {
    [currentWidth, currentHeight] = [currentHeight, currentWidth];
  }

  for (const [operationIndex, operation] of operations.entries()) {
    if (isOrientationOperation(operation)) {
      const turns = operation.kind === 'rotate_cw' || operation.kind === 'rotate_ccw'
        ? (operation.degrees ?? 90) / 90
        : 1;
      for (let turn = 0; turn < turns; turn += 1) {
        doc = applyOrientationOpToDoc(
          doc,
          currentWidth,
          currentHeight,
          ORIENTATION_OPERATIONS[operation.kind]
        );
        if (operation.kind === 'rotate_cw' || operation.kind === 'rotate_ccw') {
          [currentWidth, currentHeight] = [currentHeight, currentWidth];
        }
      }
      continue;
    }

    if (operation.kind === 'crop') {
      const crop = operation.crop;
      if (
        crop.width < MIN_IMAGE_EDIT_CROP_SIZE_PX
        || crop.height < MIN_IMAGE_EDIT_CROP_SIZE_PX
        || crop.x < 0
        || crop.y < 0
        || crop.x + crop.width > currentWidth
        || crop.y + crop.height > currentHeight
      ) {
        throw new z.ZodError([{
          code: 'custom',
          path: ['operations', operationIndex, 'crop'],
          message: `裁剪区域无效：当前图片 ${currentWidth}×${currentHeight}；width 和 height 至少为 ${MIN_IMAGE_EDIT_CROP_SIZE_PX}，且必须满足 x ≥ 0、y ≥ 0、x + width ≤ ${currentWidth}、y + height ≤ ${currentHeight}。请按此范围修改 crop。`,
        }]);
      }
      doc = { ...doc, crop };
      continue;
    }

    if (operation.kind === 'blur') {
      const defaults = createDefaultBlurOperationParams();
      blurParams = {
        ...defaults,
        algorithm: operation.algorithm ?? defaults.algorithm,
        strength: operation.strength ?? defaults.strength,
      };
      continue;
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
      exclusiveEffectOperations.push(createImageEditOperation(
        IMAGE_EDIT_OPERATION_IDS.diffusion,
        diffusionParams,
      ));
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
      exclusiveEffectOperations.push(createImageEditOperation(
        IMAGE_EDIT_OPERATION_IDS.vgpuGlow,
        vgpuGlowParams,
      ));
      continue;
    }

    const parsed = imageEditMarkItemSchema.parse(operation.item);
    if (parsed.id !== undefined && markIds.has(parsed.id)) {
      throw new z.ZodError([{
        code: 'custom',
        path: ['operations', operationIndex, 'item', 'id'],
        message: `标注 id 不能重复：${parsed.id}；请删除该 id 让系统自动生成，或改成不同 id。`,
      }]);
    }
    const item = { ...parsed, id: parsed.id ?? createMarkId() } as MarkItem;
    markIds.add(item.id);
    doc = { ...doc, items: [...doc.items, item] };
  }

  const document = existingDocument
    ? replaceMarkDocInImageEditDocument(existingDocument, doc)
    : createImageEditDocumentFromMarkDoc(doc);
  let result = document;
  if (blurParams) {
    result = upsertImageEditOperation(
      result,
      createImageEditOperation(IMAGE_EDIT_OPERATION_IDS.blur, blurParams),
    );
  }
  for (const operation of exclusiveEffectOperations) {
    result = upsertImageEditOperationWithExclusivity(result, operation);
  }
  return result;
}

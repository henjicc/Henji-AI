import { composeAffine } from '../../../imaging/transforms';
import type { ImageEditLayerCommonV3, ImageEditTransformV3 } from '../layerTypes';

export function composeImageEditTransformsV3(a: ImageEditTransformV3, b: ImageEditTransformV3): ImageEditTransformV3 {
  return composeAffine(a,b);
}

export function imageEditLayerMaskTransformV3(layer: ImageEditLayerCommonV3, transient?: ImageEditTransformV3): ImageEditTransformV3 {
  return layer.maskAttachment.linked
    ? composeImageEditTransformsV3(transient ?? layer.transform, layer.maskAttachment.transform)
    : layer.maskAttachment.transform;
}

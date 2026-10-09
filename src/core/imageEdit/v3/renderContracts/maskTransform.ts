import type { ImageEditLayerCommonV3, ImageEditTransformV3 } from '../layerTypes';

export function composeImageEditTransformsV3(a: ImageEditTransformV3, b: ImageEditTransformV3): ImageEditTransformV3 {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
    a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}

export function imageEditLayerMaskTransformV3(layer: ImageEditLayerCommonV3, transient?: ImageEditTransformV3): ImageEditTransformV3 {
  return layer.maskAttachment.linked
    ? composeImageEditTransformsV3(transient ?? layer.transform, layer.maskAttachment.transform)
    : layer.maskAttachment.transform;
}

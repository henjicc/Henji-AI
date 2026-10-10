import {
  composeAffine,
  inverseAffine,
  inverseDeform,
  inverseDeformationBounds,
  mapAffine,
  prepareDeformation,
  deformationSchema,
  type Point,
  type PreparedDeformation,
} from "../../../imaging/transforms";
import {
  createFloat32MaskTile,
  type Float32MaskTile,
  type Float32PremultipliedRgbaTile,
} from "../effects/contracts";
import type { ImageEditRect } from "../tileGeometry";
import type { ImageEditRenderPlanNode } from "../renderPlan";
import {
  resolveImageEditCpuSamplingGridV3,
  type ImageEditCpuSamplingContextV3,
  type ImageEditCpuSamplingTargetV3,
} from "./cpuSamplingGrid";
import { scaleImageEditTransformV3 } from "./affineTransform";

export interface DeformationSampling {
  prepared: PreparedDeformation;
  inverseOuter: readonly number[];
  inverseInner: readonly number[];
  width: number;
  height: number;
  region: ImageEditRect;
}
export function resolveDeformationSampling(
  context: ImageEditCpuSamplingContextV3 & { scaleX?: number; scaleY?: number },
  node: ImageEditRenderPlanNode,
  target: ImageEditCpuSamplingTargetV3,
  output: ImageEditRect,
): DeformationSampling | null {
  const mask = target.kind === "mask",
    value = node.parameters[mask ? "maskDeformation" : "deformation"];
  if (!value) return null;
  const prepared = prepareDeformation(deformationSchema.parse(value)),
    grid = resolveImageEditCpuSamplingGridV3(context, target);
  const scaleX = context.scaleX ?? 1,
    scaleY = context.scaleY ?? scaleX;
  const outer = scaleImageEditTransformV3(
    node.parameters[mask ? "deformationTransform" : "transform"] as number[],
    scaleX,
    scaleY,
  );
  const local = mask
    ? scaleImageEditTransformV3(
        node.parameters.maskLocalTransform as number[],
        scaleX,
        scaleY,
      )
    : [1, 0, 0, 1, 0, 0];
  const inverseOuter = inverseAffine(outer),
    inverseInner = inverseAffine(composeAffine(local, grid.toEvaluation));
  const width = context.size.width,
    height = context.size.height;
  const points: Point[] = [
    [output.x, output.y],
    [output.x + output.width, output.y],
    [output.x, output.y + output.height],
    [output.x + output.width, output.y + output.height],
  ].map((p) => mapAffine(inverseOuter, [p[0], p[1]]));
  const roi = inverseDeformationBounds(
    prepared,
    [
      Math.min(...points.map((p) => p[0])) / width,
      Math.min(...points.map((p) => p[1])) / height,
    ],
    [
      Math.max(...points.map((p) => p[0])) / width,
      Math.max(...points.map((p) => p[1])) / height,
    ],
  );
  const source = roi
    ? [
        [roi.min[0] * width, roi.min[1] * height],
        [roi.max[0] * width, roi.min[1] * height],
        [roi.min[0] * width, roi.max[1] * height],
        [roi.max[0] * width, roi.max[1] * height],
      ].map((p) => mapAffine(inverseInner, [p[0], p[1]]))
    : [];
  const left = source.length
    ? Math.max(
        0,
        Math.min(
          grid.size.width,
          Math.floor(Math.min(...source.map((p) => p[0])) - 0.5),
        ),
      )
    : 0;
  const top = source.length
    ? Math.max(
        0,
        Math.min(
          grid.size.height,
          Math.floor(Math.min(...source.map((p) => p[1])) - 0.5),
        ),
      )
    : 0;
  const right = source.length
    ? Math.max(
        left,
        Math.min(
          grid.size.width,
          Math.ceil(Math.max(...source.map((p) => p[0])) + 0.5),
        ),
      )
    : 0;
  const bottom = source.length
    ? Math.max(
        top,
        Math.min(
          grid.size.height,
          Math.ceil(Math.max(...source.map((p) => p[1])) + 0.5),
        ),
      )
    : 0;
  return {
    prepared,
    inverseOuter,
    inverseInner,
    width,
    height,
    region: { x: left, y: top, width: right - left, height: bottom - top },
  };
}
export function resampleDeformation(
  source: Float32PremultipliedRgbaTile,
  output: ImageEditRect,
  sample: DeformationSampling,
): Float32PremultipliedRgbaTile;
export function resampleDeformation(
  source: Float32MaskTile,
  output: ImageEditRect,
  sample: DeformationSampling,
): Float32MaskTile;
export function resampleDeformation(
  source: Float32MaskTile | Float32PremultipliedRgbaTile,
  output: ImageEditRect,
  sample: DeformationSampling,
): Float32MaskTile | Float32PremultipliedRgbaTile {
  const channels = source.data.length / (source.width * source.height),
    data = new Float32Array(output.width * output.height * channels);
  for (let y = 0; y < output.height; y++)
    for (let x = 0; x < output.width; x++) {
      const p = mapAffine(sample.inverseOuter, [
        output.x + x + 0.5,
        output.y + y + 0.5,
      ]);
      const normalized = inverseDeform(sample.prepared, [
        p[0] / sample.width,
        p[1] / sample.height,
      ]);
      if (!normalized) continue;
      const s = mapAffine(sample.inverseInner, [
        normalized[0] * sample.width,
        normalized[1] * sample.height,
      ]);
      const sx = s[0] - sample.region.x - 0.5,
        sy = s[1] - sample.region.y - 0.5,
        ix = Math.floor(sx),
        iy = Math.floor(sy),
        fx = sx - ix,
        fy = sy - iy;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const xx = ix + dx,
            yy = iy + dy;
          if (xx < 0 || yy < 0 || xx >= source.width || yy >= source.height)
            continue;
          const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
          for (let c = 0; c < channels; c++)
            data[(y * output.width + x) * channels + c] +=
              source.data[(yy * source.width + xx) * channels + c] * weight;
        }
    }
  return channels === 1
    ? createFloat32MaskTile(output.width, output.height, data)
    : {
        ...(source as Float32PremultipliedRgbaTile),
        width: output.width,
        height: output.height,
        data,
      };
}

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { init, type Gpu } from "vgpu/node";
import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from "@/core/imageEdit/v3/documentFactory";
import { compileImageEditRenderPlanV3 } from "@/core/imageEdit/v3/renderPlanCompiler";
import { createBuiltInImageEditRenderNodeRegistry } from "@/core/imageEdit/v3/builtInRenderNodes";
import { executeImageEditCpuRenderRegionPlanV3 } from "@/core/imageEdit/v3/execution/cpuRenderRegionExecutor";
import {
  createFloat32MaskTile,
  createFloat32PremultipliedRgbaTile,
} from "@/core/imageEdit/v3/effects/contracts";
import { createImageEditSparseMaskReferenceV3 } from "@/core/imageEdit/v3/layerTypes";
import {
  identityDeformation,
  type Deformation,
} from "@/core/imaging/transforms";
import type { ImageEditorV3SourceTile } from "@/platform/contracts/imageEditorV3";
import { compileImageEditorGpuRasterSceneV3 } from "../../gpu/imageEditorGpuRasterSceneCompilerV3";
import { ImageEditorGpuRasterCompositorV3 } from "../../gpu/imageEditorGpuRasterCompositorV3";
import { imageEditorGpuSceneTileKeyV3 } from "../../gpu/imageEditorGpuSceneProtocolV3";
const sourceRef = `sha256:${"1".repeat(64)}` as const,
  maskRef = `sha256:${"2".repeat(64)}` as const;
let gpu: Gpu;
beforeAll(async () => {
  gpu = await init();
});
afterAll(() => gpu?.dispose());
const WIDTH = 32,
  HEIGHT = 24;
const perspective: Deformation = {
  kind: "perspective",
  points: [
    [0.1, 0.05],
    [0.85, 0],
    [1, 0.95],
    [0, 1],
  ],
};
const mesh = identityDeformation("mesh"),
  warped: Deformation = {
    ...mesh,
    points: mesh.points.map((p, i) => (i === 4 ? [0.62, 0.4] : p)),
  };
const linear = (v: number): number => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
describe("共享透视与网格：真实GPU对照分块CPU导出", () => {
  it.each([perspective, warped])(
    "$kind 的RGBA、透明边缘、ROI、链接/独立蒙版与缓存身份",
    async (deformation) => {
      const document = createImageEditDocumentV3({
          width: WIDTH,
          height: HEIGHT,
        }),
        layer = createImageEditRasterLayerV3("source", "原像素", sourceRef);
      layer.deformation = deformation;
      layer.transform = [0.9, 0.05, -0.03, 0.9, 1, 1];
      layer.mask = createImageEditSparseMaskReferenceV3("mask");
      layer.mask.tiles = { "0/0/0": maskRef };
      layer.maskAttachment.transform = [1, 0, 0, 1, 2, 0];
      document.layers = [layer];
      const sourceBytes = new Uint8Array(WIDTH * HEIGHT * 4),
        maskBytes = new Uint8Array(WIDTH * HEIGHT);
      for (let y = 0; y < HEIGHT; y++)
        for (let x = 0; x < WIDTH; x++) {
          const i = y * WIDTH + x;
          sourceBytes.set(
            [x * 7, y * 9, 120, x > 1 && x < 30 ? 255 : 128],
            i * 4,
          );
          maskBytes[i] = x < 16 ? 100 : 240;
        }
      const resources = [
        {
          resourceRef: sourceRef,
          byteLength: sourceBytes.byteLength,
          mediaType: "image/png",
        },
        {
          resourceRef: maskRef,
          byteLength: maskBytes.byteLength,
          mediaType: "application/x-henji-mask-tile-v3",
        },
      ];
      const maskRgba = new Uint8Array(WIDTH * HEIGHT * 4);
      for (let i = 0; i < maskBytes.length; i++)
        maskRgba.set([maskBytes[i], maskBytes[i], maskBytes[i], 255], i * 4);
      const compositor = new ImageEditorGpuRasterCompositorV3(gpu),
        uploaded = new Map<string, ReturnType<typeof compositor.uploadTile>>();
      const viewport = {
        stageWidth: WIDTH,
        stageHeight: HEIGHT,
        viewportKey: "warp",
        viewport: {
          documentX: 0,
          documentY: 0,
          width: WIDTH,
          height: HEIGHT,
          zoom: 1,
          devicePixelRatio: 1,
        },
      };
      const tile = (mask: boolean): ImageEditorV3SourceTile => ({
        resourceRef: mask ? maskRef : sourceRef,
        mip: 0,
        tileX: 0,
        tileY: 0,
        originX: 0,
        originY: 0,
        halo: 0,
        width: WIDTH,
        height: HEIGHT,
        channels: 4,
        bitDepth: 8,
        sampleFormat: "uint",
        numericRange: "unorm8",
        byteOrder: "little-endian",
        rowStride: WIDTH * 4,
        colorSpace: "srgb",
        transferFunction: "srgb",
        alphaMode: "straight",
        orientationApplied: true,
        pixels: (mask ? maskRgba : sourceBytes).buffer,
      });
      try {
        const mask = layer.mask;
        for (const linked of [null, true, false]) {
          layer.mask = linked === null ? null : mask;
          layer.maskAttachment.linked = linked ?? true;
          const compiled = compileImageEditorGpuRasterSceneV3(
            document,
            resources,
          );
          if (!compiled.supported) throw new Error(compiled.reason);
          compositor.syncScene(compiled.scene);
          compositor.updateViewport(viewport);
          for (const key of compositor.requiredResourceKeys()) {
            const identity = imageEditorGpuSceneTileKeyV3(key);
            if (!uploaded.has(identity))
              uploaded.set(
                identity,
                compositor.uploadTile(key, tile(key.resourceRef === maskRef)),
              );
          }
          const actual = await compositor.readLinearPixelsForTest(
            (key) => uploaded.get(imageEditorGpuSceneTileKeyV3(key)) ?? null,
          );
          const registry = createBuiltInImageEditRenderNodeRegistry(),
            plan = compileImageEditRenderPlanV3(document, registry, "stable");
          const expected = new Float32Array(actual.length);
          for (const rect of [
            { x: 0, y: 0, width: 16, height: HEIGHT },
            { x: 16, y: 0, width: 16, height: HEIGHT },
          ]) {
            const cpu = await executeImageEditCpuRenderRegionPlanV3(
              plan,
              rect,
              {
                size: { width: WIDTH, height: HEIGHT },
                registry,
                loadRaster: async (_node, region) => {
                  const data = new Float32Array(
                    region.width * region.height * 4,
                  );
                  for (let y = 0; y < region.height; y++)
                    for (let x = 0; x < region.width; x++) {
                      const i = ((region.y + y) * WIDTH + region.x + x) * 4,
                        a = sourceBytes[i + 3] / 255;
                      data.set(
                        [
                          linear(sourceBytes[i]) * a,
                          linear(sourceBytes[i + 1]) * a,
                          linear(sourceBytes[i + 2]) * a,
                          a,
                        ],
                        (y * region.width + x) * 4,
                      );
                    }
                  return createFloat32PremultipliedRgbaTile(
                    region.width,
                    region.height,
                    "linear-light",
                    data,
                  );
                },
                loadMask: async (_mask, _node, region) =>
                  createFloat32MaskTile(
                    region.width,
                    region.height,
                    Float32Array.from(
                      { length: region.width * region.height },
                      (_, i) =>
                        maskBytes[
                          (region.y + Math.floor(i / region.width)) * WIDTH +
                            region.x +
                            (i % region.width)
                        ] / 255,
                    ),
                  ),
                rasterizeAnnotations: async () => {
                  throw new Error("unexpected annotation");
                },
                createTransparent: (region) =>
                  createFloat32PremultipliedRgbaTile(
                    region.width,
                    region.height,
                    "linear-light",
                    new Float32Array(region.width * region.height * 4),
                  ),
              },
            );
            for (let y = 0; y < rect.height; y++)
              expected.set(
                cpu!.data.subarray(
                  y * rect.width * 4,
                  (y + 1) * rect.width * 4,
                ),
                ((rect.y + y) * WIDTH + rect.x) * 4,
              );
          }
          let maximum = 0,
            peak = 0;
          for (let i = 0; i < actual.length; i++)
            if (Math.abs(actual[i] - expected[i]) > maximum) {
              maximum = Math.abs(actual[i] - expected[i]);
              peak = i;
            }
          expect(
            maximum,
            JSON.stringify({
              linked,
              peak,
              x: Math.floor(peak / 4) % WIDTH,
              y: Math.floor(peak / 4 / WIDTH),
              actual: actual[peak],
              expected: expected[peak],
            }),
          ).toBeLessThan(0.001);
          expect(actual.some((value, i) => i % 4 === 3 && value === 0)).toBe(
            true,
          );
          expect(actual.some((value, i) => i % 4 === 3 && value > 0.5)).toBe(
            true,
          );
        }
      } finally {
        for (const texture of uploaded.values()) texture.destroy();
        compositor.dispose();
      }
    },
  );
});

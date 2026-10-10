import { describe, expect, it } from "vitest";
import {
  evaluateTransformSample,
  deformationSchema,
  forwardDeform,
  identityDeformation,
  inverseAffine,
  inverseDeform,
  inverseDeformationBounds,
  mapAffine,
  prepareDeformation,
  resizeAffine,
  rotateAffine,
  type Deformation,
} from "./index";
describe("共享对象空间变换", () => {
  it("透视正逆映射保留直线、对象外透明并拒绝退化/穿越", () => {
    const prepared = prepareDeformation({
      kind: "perspective",
      points: [
        [0.1, 0],
        [0.9, 0.1],
        [1, 1],
        [0, 0.8],
      ],
    });
    for (const p of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0.3, 0.7],
    ] as const) {
      const q = inverseDeform(prepared, forwardDeform(prepared, p));
      expect(q?.[0]).toBeCloseTo(p[0], 10);
      expect(q?.[1]).toBeCloseTo(p[1], 10);
    }
    expect(inverseDeform(prepared, [-1, -1])).toBeNull();
    expect(() =>
      prepareDeformation({
        kind: "perspective",
        points: [
          [0, 0],
          [1, 1],
          [0, 1],
          [1, 0],
        ],
      }),
    ).toThrow();
    expect(
      deformationSchema.safeParse({
        kind: "perspective",
        points: [
          [0, 0],
          [1, 0],
          [1, 0],
          [0, 1],
        ],
      }).success,
    ).toBe(false);
  });
  it("网格对角与共享边无缝，任意网格规模且拒绝折叠与非有限值", () => {
    const base = identityDeformation("mesh", 5, 4),
      deformation: Deformation = {
        ...base,
        points: base.points.map((p, i) =>
          i === 7 ? [p[0] + 0.06, p[1] + 0.04] : p,
        ),
      },
      prepared = prepareDeformation(deformation);
    for (let y = 0; y <= 20; y++)
      for (let x = 0; x <= 20; x++) {
        const p = [x / 20, y / 20] as const,
          q = inverseDeform(prepared, forwardDeform(prepared, p));
        expect(q?.[0]).toBeCloseTo(p[0], 6);
        expect(q?.[1]).toBeCloseTo(p[1], 6);
      }
    expect(() =>
      prepareDeformation({
        ...base,
        points: base.points.map((p, i) => (i === 7 ? [-1, -1] : p)),
      }),
    ).toThrow();
    expect(
      deformationSchema.safeParse({ ...base, points: [[Infinity, 0]] }).success,
    ).toBe(false);
    expect(
      prepareDeformation(identityDeformation("mesh", 40, 40)).triangles,
    ).toHaveLength(39 * 39 * 2);
  });
  it("逆ROI包含穿过内部网格的极值，不只测试输出四角", () => {
    const base = identityDeformation("mesh"),
      prepared = prepareDeformation({
        ...base,
        points: base.points.map((p, i) => (i === 4 ? [0.65, 0.5] : p)),
      });
    const bounds = inverseDeformationBounds(prepared, [0.1, 0.1], [0.9, 0.9]);
    expect(bounds).not.toBeNull();
    for (let y = 0.1; y <= 0.9; y += 0.02)
      for (let x = 0.1; x <= 0.9; x += 0.02) {
        const p = inverseDeform(prepared, [x, y]);
        if (!p) continue;
        expect(p[0]).toBeGreaterThanOrEqual(bounds!.min[0] - 1e-6);
        expect(p[0]).toBeLessThanOrEqual(bounds!.max[0] + 1e-6);
        expect(p[1]).toBeGreaterThanOrEqual(bounds!.min[1] - 1e-6);
        expect(p[1]).toBeLessThanOrEqual(bounds!.max[1] + 1e-6);
      }
  });
  it("缩放保持相对锚点、比例约束和旋转吸附，拒绝奇异矩阵", () => {
    const base = [1, 0, 0, 1, 5, 7] as const,
      next = resizeAffine(base, [0, 0], [100, 50], [205, 107], true);
    expect(mapAffine(next, [0, 0])).toEqual([5, 7]);
    expect(next.slice(0, 4)).toEqual([2, 0, 0, 2]);
    const rotated = rotateAffine(base, [5, 7], [105, 7], [5, 107], true);
    expect(mapAffine(rotated, [0, 0])).toEqual([5, 7]);
    expect(rotated[1]).toBeCloseTo(1);
    expect(() => inverseAffine([0, 0, 0, 0, 0, 0])).toThrow();
  });
});

it("时间样本与控制点进入完整缓存身份，静态与有理帧共用求值器", () => {
  const context = {
    target: { kind: "clip", id: "clip1" },
    sourceVersion: "v1",
    time: { kind: "static" as const },
    referenceGrid: { width: 100, height: 80, pixelAspect: 1 },
    roi: { x: 0, y: 0, width: 100, height: 80 },
    color: {
      workingSpace: "srgb",
      transferFunction: "linear",
      alpha: "premultiplied" as const,
      precision: "float32" as const,
    },
    quality: "final" as const,
  };
  const sample = {
    affine: [1, 0, 0, 1, 0, 0] as const,
    deformation: identityDeformation("mesh"),
  };
  const a = evaluateTransformSample(context, sample),
    b = evaluateTransformSample(
      {
        ...context,
        time: {
          kind: "frame",
          ticks: 12,
          timeBase: [1, 24],
          frameId: "frame12",
        },
      },
      sample,
    );
  expect(a.inverse).toEqual(b.inverse);
  expect(a.cacheIdentity).not.toEqual(b.cacheIdentity);
});

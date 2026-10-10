import { z } from "zod";
import { evaluationCacheIdentity, type EvaluationContext } from "../evaluation";

export type Point = readonly [number, number];
export type Affine = readonly [number, number, number, number, number, number];
/** Object-space ratios; time is resolved by the host before preparing this sample. */
export type Deformation =
  | { kind: "perspective"; points: readonly Point[] }
  | { kind: "mesh"; columns: number; rows: number; points: readonly Point[] };
const point = z.tuple([z.number().finite(), z.number().finite()]);
export const deformationSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("perspective"),
        points: z.array(point).length(4),
      })
      .strict(),
    z
      .object({
        kind: z.literal("mesh"),
        columns: z.number().int().min(2),
        rows: z.number().int().min(2),
        points: z.array(point),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    try {
      prepareDeformation(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "变形无效",
      });
    }
  });

export function mapAffine(m: readonly number[], p: Point): Point {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}
export function inverseAffine(
  m: readonly number[],
  minimumDeterminant = 1e-8,
): Affine {
  const [a, b, c, d, e, f] = m,
    det = a * d - b * c;
  if (
    m.length !== 6 ||
    !m.every(Number.isFinite) ||
    !Number.isFinite(det) ||
    det === 0 ||
    Math.abs(det) < minimumDeterminant
  )
    throw new Error("变换必须可逆");
  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ];
}
export function composeAffine(
  a: readonly number[],
  b: readonly number[],
): Affine {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function translateAffine(m: Affine, delta: Point): Affine {
  return [m[0], m[1], m[2], m[3], m[4] + delta[0], m[5] + delta[1]];
}
export function scaleAffineAtAnchor(
  m: Affine,
  anchor: Point,
  scale: Point,
): Affine {
  const next = composeAffine(m, [
    scale[0],
    0,
    0,
    scale[1],
    anchor[0] * (1 - scale[0]),
    anchor[1] * (1 - scale[1]),
  ]);
  inverseAffine(next);
  return next;
}
export function resizeAffine(
  m: Affine,
  anchor: Point,
  start: Point,
  end: Point,
  proportional: boolean,
): Affine {
  const local = mapAffine(inverseAffine(m), end);
  let sx = (local[0] - anchor[0]) / (start[0] - anchor[0]),
    sy = (local[1] - anchor[1]) / (start[1] - anchor[1]);
  if (proportional) {
    const scale = Math.abs(sx) > Math.abs(sy) ? sx : sy;
    sx = scale;
    sy = scale;
  }
  return scaleAffineAtAnchor(m, anchor, [sx, sy]);
}
export function rotateAffine(
  m: Affine,
  pivot: Point,
  start: Point,
  end: Point,
  snap: boolean,
): Affine {
  let angle =
    Math.atan2(end[1] - pivot[1], end[0] - pivot[0]) -
    Math.atan2(start[1] - pivot[1], start[0] - pivot[0]);
  if (snap) angle = (Math.round(angle / (Math.PI / 12)) * Math.PI) / 12;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return composeAffine(
    [
      c,
      s,
      -s,
      c,
      pivot[0] - c * pivot[0] + s * pivot[1],
      pivot[1] - s * pivot[0] - c * pivot[1],
    ],
    m,
  );
}
const area = (a: Point, b: Point, c: Point): number =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
type Triangle = {
  source: readonly Point[];
  destination: readonly Point[];
  inverse: Affine;
};
export interface PreparedDeformation {
  deformation: Deformation | null;
  triangles: readonly Triangle[];
  matrix: readonly number[];
  inverse: readonly number[];
}
function invert3(m: readonly number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m,
    co = [
      e * i - f * h,
      c * h - b * i,
      b * f - c * e,
      f * g - d * i,
      a * i - c * g,
      c * d - a * f,
      d * h - e * g,
      b * g - a * h,
      a * e - b * d,
    ];
  const det = a * co[0] + b * co[3] + c * co[6];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-8)
    throw new Error("透视控制点不能重合或共线");
  return co.map((v) => v / det);
}
function project(m: readonly number[], p: Point): Point {
  const w = m[6] * p[0] + m[7] * p[1] + m[8];
  return [
    (m[0] * p[0] + m[1] * p[1] + m[2]) / w,
    (m[3] * p[0] + m[4] * p[1] + m[5]) / w,
  ];
}
export function identityDeformation(
  kind: "perspective" | "mesh",
  columns = 3,
  rows = 3,
): Deformation {
  if (kind === "perspective")
    return {
      kind,
      points: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    };
  return {
    kind,
    columns,
    rows,
    points: Array.from(
      { length: columns * rows },
      (_, i) =>
        [
          (i % columns) / (columns - 1),
          Math.floor(i / columns) / (rows - 1),
        ] as Point,
    ),
  };
}
export function prepareDeformation(
  deformation: Deformation | null | undefined,
): PreparedDeformation {
  if (!deformation)
    return { deformation: null, triangles: [], matrix: [], inverse: [] };
  const p = deformation.points;
  if (!p.every((v) => v.length === 2 && v.every(Number.isFinite)))
    throw new Error("控制点必须是有限坐标");
  if (deformation.kind === "perspective") {
    if (
      p.length !== 4 ||
      p.some((v, i) => area(v, p[(i + 1) % 4], p[(i + 2) % 4]) <= 1e-8)
    )
      throw new Error("透视四边形不能折叠或退化");
    const [a, b, c, d] = p,
      dx = b[0] - c[0],
      dy = d[0] - c[0],
      ex = b[1] - c[1],
      ey = d[1] - c[1];
    const rx = a[0] - b[0] + c[0] - d[0],
      ry = a[1] - b[1] + c[1] - d[1],
      det = dx * ey - dy * ex;
    const g = (rx * ey - dy * ry) / det,
      h = (dx * ry - rx * ex) / det;
    const matrix = [
      b[0] - a[0] + g * b[0],
      d[0] - a[0] + h * d[0],
      a[0],
      b[1] - a[1] + g * b[1],
      d[1] - a[1] + h * d[1],
      a[1],
      g,
      h,
      1,
    ];
    if ([1, 1 + g, 1 + h, 1 + g + h].some((v) => v <= 1e-8))
      throw new Error("透视不能越过无穷远平面");
    return { deformation, triangles: [], matrix, inverse: invert3(matrix) };
  }
  const { columns, rows } = deformation;
  if (
    !Number.isSafeInteger(columns) ||
    !Number.isSafeInteger(rows) ||
    columns < 2 ||
    rows < 2 ||
    p.length !== columns * rows
  )
    throw new Error("网格尺寸与控制点数量不一致");
  const source = identityDeformation("mesh", columns, rows).points,
    triangles: Triangle[] = [];
  for (let y = 0; y < rows - 1; y++)
    for (let x = 0; x < columns - 1; x++) {
      const a = y * columns + x,
        b = a + 1,
        c = a + columns,
        d = c + 1;
      for (const ids of [
        [a, b, d],
        [a, d, c],
      ]) {
        const dst = ids.map((i) => p[i]),
          src = ids.map((i) => source[i]);
        if (area(dst[0], dst[1], dst[2]) <= 1e-8)
          throw new Error("网格不能折叠或退化");
        triangles.push({
          source: src,
          destination: dst,
          inverse: inverseAffine([
            dst[1][0] - dst[0][0],
            dst[1][1] - dst[0][1],
            dst[2][0] - dst[0][0],
            dst[2][1] - dst[0][1],
            dst[0][0],
            dst[0][1],
          ]),
        });
      }
    }
  const border = [
    ...Array.from({ length: columns }, (_, i) => i),
    ...Array.from(
      { length: rows - 1 },
      (_, i) => (i + 1) * columns + columns - 1,
    ),
    ...Array.from({ length: columns - 1 }, (_, i) => rows * columns - 2 - i),
    ...Array.from({ length: rows - 2 }, (_, i) => (rows - 2 - i) * columns),
  ];
  for (let i = 0; i < border.length; i++)
    for (let j = i + 2; j < border.length; j++) {
      if (i === 0 && j === border.length - 1) continue;
      const a = p[border[i]],
        b = p[border[(i + 1) % border.length]],
        c = p[border[j]],
        d = p[border[(j + 1) % border.length]];
      if (
        Math.max(a[0], b[0]) < Math.min(c[0], d[0]) ||
        Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
        Math.max(a[1], b[1]) < Math.min(c[1], d[1]) ||
        Math.max(c[1], d[1]) < Math.min(a[1], b[1])
      )
        continue;
      if (
        area(a, b, c) * area(a, b, d) <= 0 &&
        area(c, d, a) * area(c, d, b) <= 0
      )
        throw new Error("网格边界不能自交");
    }
  return { deformation, triangles, matrix: [], inverse: [] };
}
export function inverseDeform(
  prepared: PreparedDeformation,
  p: Point,
): Point | null {
  if (!prepared.deformation) return p;
  if (prepared.deformation.kind === "perspective") {
    const result = project(prepared.inverse, p);
    return result.every(Number.isFinite) &&
      result.every((v) => v >= -1e-6 && v <= 1 + 1e-6)
      ? result
      : null;
  }
  for (const t of prepared.triangles) {
    const [u, v] = mapAffine(t.inverse, p);
    if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6)
      return [
        t.source[0][0] +
          u * (t.source[1][0] - t.source[0][0]) +
          v * (t.source[2][0] - t.source[0][0]),
        t.source[0][1] +
          u * (t.source[1][1] - t.source[0][1]) +
          v * (t.source[2][1] - t.source[0][1]),
      ];
  }
  return null;
}
export function forwardDeform(prepared: PreparedDeformation, p: Point): Point {
  if (!prepared.deformation) return p;
  if (prepared.deformation.kind === "perspective")
    return project(prepared.matrix, p);
  for (const t of prepared.triangles) {
    const [a, b, c] = t.source,
      det = area(a, b, c),
      u = area(a, p, c) / det,
      v = area(a, b, p) / det;
    if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6)
      return [
        t.destination[0][0] +
          u * (t.destination[1][0] - t.destination[0][0]) +
          v * (t.destination[2][0] - t.destination[0][0]),
        t.destination[0][1] +
          u * (t.destination[1][1] - t.destination[0][1]) +
          v * (t.destination[2][1] - t.destination[0][1]),
      ];
  }
  throw new Error("控制点不在对象网格内");
}
/** Conservative inverse ROI: triangle intersections include interior extrema, with a sampling halo. */
export function inverseDeformationBounds(
  prepared: PreparedDeformation,
  min: Point,
  max: Point,
): { min: Point; max: Point } | null {
  if (!prepared.deformation) return { min, max };
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  const include = (p: Point): void => {
    left = Math.min(left, p[0]);
    top = Math.min(top, p[1]);
    right = Math.max(right, p[0]);
    bottom = Math.max(bottom, p[1]);
  };
  const polygons =
    prepared.deformation.kind === "perspective"
      ? [prepared.deformation.points]
      : prepared.triangles.map((t) => t.destination);
  for (let index = 0; index < polygons.length; index++) {
    let clipped = [...polygons[index]];
    for (const [axis, bound, side] of [
      [0, min[0], 1],
      [0, max[0], -1],
      [1, min[1], 1],
      [1, max[1], -1],
    ]) {
      const next: Point[] = [];
      clipped.forEach((a, i) => {
        const b = clipped[(i + 1) % clipped.length],
          insideA = (a[axis] - bound) * side >= 0,
          insideB = (b[axis] - bound) * side >= 0;
        if (insideA) next.push(a);
        if (insideA !== insideB) {
          const f = (bound - a[axis]) / (b[axis] - a[axis]);
          next.push([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])]);
        }
      });
      clipped = next;
    }
    for (const p of clipped) {
      if (prepared.deformation.kind === "perspective")
        include(project(prepared.inverse, p));
      else {
        const t = prepared.triangles[index],
          [u, v] = mapAffine(t.inverse, p);
        include([
          t.source[0][0] +
            u * (t.source[1][0] - t.source[0][0]) +
            v * (t.source[2][0] - t.source[0][0]),
          t.source[0][1] +
            u * (t.source[1][1] - t.source[0][1]) +
            v * (t.source[2][1] - t.source[0][1]),
        ]);
      }
    }
  }
  return Number.isFinite(left)
    ? { min: [left, top], max: [right, bottom] }
    : null;
}

/** Dynamic storage data; no product limit on mesh dimensions. GPU buffer limits remain host responsibilities. */
export function packDeformation(
  prepared: PreparedDeformation,
  width: number,
  height: number,
  local: readonly number[] = [1, 0, 0, 1, 0, 0],
): Float32Array {
  const values = [
    prepared.deformation?.kind === "perspective"
      ? 1
      : prepared.deformation
        ? 2
        : 0,
    width,
    height,
    prepared.triangles.length,
  ];
  const invLocal = inverseAffine(local);
  values.push(...invLocal.slice(0, 4), invLocal[4], invLocal[5], 0, 0);
  if (prepared.deformation?.kind === "perspective") {
    for (let i = 0; i < 3; i++)
      values.push(...prepared.inverse.slice(i * 3, i * 3 + 3), 0);
  } else
    for (const t of prepared.triangles)
      values.push(
        ...t.inverse.slice(0, 4),
        t.inverse[4],
        t.inverse[5],
        0,
        0,
        ...t.source[0],
        ...t.source[1],
        ...t.source[2],
        0,
        0,
      );
  return new Float32Array(values);
}

/** Hosts resolve static/animated controls at this source time; the kernel never reads a playhead. */
export function evaluateTransformSample(
  context: EvaluationContext,
  sample: { affine: Affine; deformation?: Deformation | null },
): { prepared: PreparedDeformation; inverse: Affine; cacheIdentity: string } {
  const inverse = inverseAffine(sample.affine),
    prepared = prepareDeformation(sample.deformation);
  return {
    prepared,
    inverse,
    cacheIdentity: JSON.stringify([
      evaluationCacheIdentity(context),
      sample.affine,
      sample.deformation ?? null,
    ]),
  };
}

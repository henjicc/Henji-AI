import { z } from 'zod'
import { videoEditKeyframesSchema } from './keyframeSchema'
import type { SpatialCamera, SpatialCameraNumericKey, SpatialClipFields } from './spatialTypes'

const finite = z.number().finite()
export const SPATIAL_KEYS = ['depth', 'rotationX', 'rotationY', 'anchorDepth'] as const
/** 只影响三维里怎么呈现、不影响几何与二维画面的片段字段。 */
export const SPACE_SURFACE_KEYS = ['spaceEmission'] as const
export const SPACE_EMISSION_MAX = 10
/** 卡片画面的缓存键里要去掉的字段：它们不改变二维画面，动画时不该让卡片画面每帧重画。 */
export const SPACE_ONLY_FIELDS = Object.fromEntries(SPACE_SURFACE_KEYS.map(key => [key, undefined])) as Record<typeof SPACE_SURFACE_KEYS[number], undefined>
export const SPATIAL_DEFAULT_FSTOP = 5.6
export const SPATIAL_SENSOR_WIDTH_MM = 36
export const SPATIAL_FOCAL_LENGTH_MM = 80
export const spatialClipFields = {
  depth: finite.optional(), rotationX: finite.optional(), rotationY: finite.optional(), anchorDepth: finite.optional(),
  spaceEmission: finite.min(0).max(SPACE_EMISSION_MAX).optional(),
  spatial: z.object({ enabled: z.boolean() }).strict().optional(),
} satisfies Record<keyof SpatialClipFields, z.ZodType>
export const spatialClipSchema = z.object(spatialClipFields).strict()
export const spatialVec3Schema = z.tuple([finite, finite, finite])
export const spatialBoundsSchema = z.object({ min: spatialVec3Schema, max: spatialVec3Schema }).strict()
  .refine(value => value.min.every((number, axis) => number <= value.max[axis]), '包围框 min 不得大于 max。')
export const spatialTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('clip'), clipId: z.string().min(1).max(100) }).strict(),
  z.object({ kind: z.literal('point'), point: spatialVec3Schema }).strict(),
  z.object({ kind: z.literal('bounds'), bounds: spatialBoundsSchema }).strict(),
])
export const spatialFocusSchema = z.union([spatialTargetSchema, z.object({ kind: z.literal('distance'), distance: finite.positive() }).strict()])
const targetComponents = Object.fromEntries(['framing', 'aim', 'focus'].flatMap(target => ['', 'Min', 'Max'].flatMap(bound => ['X', 'Y', 'Z'].map(axis => [`${target}${bound}${axis}`, finite])))) as Record<Exclude<SpatialCameraNumericKey, 'offsetX' | 'offsetY' | 'offsetZ' | 'rotationX' | 'rotationY' | 'rotationZ' | 'perspective' | 'framingHeightFraction' | 'defocus' | 'fStop' | 'focusDistance'>, typeof finite>
/** 数值校验、曲线求值和引用烘焙共用同一字段表。 */
export const spatialCameraNumericSchemas = {
  offsetX: finite, offsetY: finite, offsetZ: finite,
  rotationX: finite, rotationY: finite, rotationZ: finite, perspective: finite,
  framingHeightFraction: finite.positive(), defocus: finite.nonnegative(), fStop: finite.positive(), focusDistance: finite.positive(),
  ...targetComponents,
} satisfies Record<SpatialCameraNumericKey, z.ZodNumber>
export const SPATIAL_CAMERA_NUMERIC_KEYS = Object.keys(spatialCameraNumericSchemas) as SpatialCameraNumericKey[]
const numericCurves = z.partialRecord(z.enum(SPATIAL_CAMERA_NUMERIC_KEYS), videoEditKeyframesSchema).superRefine((curves, ctx) => {
  for (const key of SPATIAL_CAMERA_NUMERIC_KEYS) for (const point of curves[key] ?? []) {
    for (const value of [point.value, ...(point.easeValues ?? [])]) if (!spatialCameraNumericSchemas[key].safeParse(value).success) ctx.addIssue({ code: 'custom', path: [key, point.time], message: `相机 ${key} 关键帧数值无效。` })
  }
})
function hold<T extends z.ZodType>(target: T) {
  return z.array(z.object({ time: finite.int().nonnegative(), value: target.nullable(), interpolation: z.literal('hold') }).strict())
    .refine(points => points.every((point, index) => index === 0 || point.time > points[index - 1].time), '相机绑定时刻须严格递增。')
}
export const spatialCameraFields = {
  offsetX: finite.optional(), offsetY: finite.optional(), offsetZ: finite.optional(),
  rotationX: finite.optional(), rotationY: finite.optional(), rotationZ: finite.optional(), perspective: finite.optional(),
  defocus: finite.nonnegative().optional(), fStop: finite.positive().optional(),
  framing: z.object({ target: spatialTargetSchema, heightFraction: finite.positive() }).strict().optional(),
  aim: spatialTargetSchema.optional(), focus: spatialFocusSchema.optional(), curves: numericCurves.optional(),
  bindings: z.object({ framing: hold(spatialTargetSchema).optional(), aim: hold(spatialTargetSchema).optional(), focus: hold(spatialFocusSchema).optional() }).strict().optional(),
}
export const spatialCameraSchema: z.ZodType<SpatialCamera> = z.object(spatialCameraFields).strict()

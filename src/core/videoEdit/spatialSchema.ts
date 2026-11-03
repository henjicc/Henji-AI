import { z } from 'zod'
import { videoEditKeyframesSchema } from './keyframeSchema'
import type { SpatialCamera, SpatialCameraNumericKey, SpatialClipFields } from './spatialTypes'

const finite = z.number().finite()
export const SPATIAL_KEYS = ['depth', 'rotationX', 'rotationY', 'anchorDepth'] as const
/** 只影响三维里怎么呈现、不影响几何与二维画面、可做关键帧的片段字段。 */
export const SPACE_SURFACE_KEYS = ['spaceEmission', 'spaceThickness'] as const
/** 同上但不做关键帧的三维呈现字段（受光、材质、倒角、阴影）。 */
export const SPACE_SURFACE_SETTINGS = ['spaceLit', 'spaceMaterial', 'spaceBevel', 'spaceCastShadow', 'spaceReceiveShadow'] as const
export const SPACE_EMISSION_MAX = 10
/** 灯光片段（kind 'light'）：平行光、聚光、点光、面光。 */
export const SPACE_LIGHT_KINDS = ['directional', 'spot', 'point', 'area'] as const
export type SpaceLightKind = typeof SPACE_LIGHT_KINDS[number]
export const SPACE_LIGHT_INTENSITY_MAX = 50
/** 灯光片段的字段（不做关键帧的部分）；亮度 lightIntensity 可做关键帧。 */
export const SPACE_LIGHT_SETTINGS = ['lightKind', 'lightColor', 'lightCastShadow', 'lightSoftness', 'lightAngle'] as const
export const SPACE_THICKNESS_MAX = 1
/** 卡片画面的缓存键里要去掉的字段：它们不改变二维画面，动画时不该让卡片画面每帧重画。 */
export const SPACE_ONLY_FIELDS = Object.fromEntries([...SPACE_SURFACE_KEYS, ...SPACE_SURFACE_SETTINGS].map(key => [key, undefined])) as Record<typeof SPACE_SURFACE_KEYS[number] | typeof SPACE_SURFACE_SETTINGS[number], undefined>
const unitInterval = finite.min(0).max(1)
const materialColor = z.string().regex(/^#[0-9a-fA-F]{6}$/)
/**
 * 片段在三维里的材质（判别联合，每种材质自己的参数）：picture 画面（缺省，与今天相同）；matte 磨砂、metal 金属、thin-film 薄膜金属以画面为底色；
 * acrylic 亚克力、glass 实心玻璃按片段轮廓成形、透光（画面不再作颜色）。参数含义与作者的 host.space.material 相同。
 */
export const spaceMaterialSchema = z.discriminatedUnion('preset', [
  z.object({ preset: z.literal('picture') }).strict(),
  z.object({ preset: z.literal('matte'), roughness: unitInterval.optional() }).strict(),
  z.object({ preset: z.literal('metal'), roughness: unitInterval.optional() }).strict(),
  z.object({ preset: z.literal('thin-film'), range: z.tuple([finite.min(0).max(2000), finite.min(0).max(2000)]).optional(), strength: unitInterval.optional(), frequency: finite.positive().max(64).optional() }).strict(),
  z.object({ preset: z.literal('acrylic'), frost: unitInterval.optional(), tint: materialColor.optional() }).strict(),
  z.object({ preset: z.literal('glass'), frost: unitInterval.optional(), dispersion: unitInterval.optional(), tint: materialColor.optional(), absorption: unitInterval.optional() }).strict(),
])
export type SpaceMaterial = z.infer<typeof spaceMaterialSchema>
export const SPATIAL_DEFAULT_FSTOP = 5.6
export const SPATIAL_SENSOR_WIDTH_MM = 36
export const SPATIAL_FOCAL_LENGTH_MM = 80
export const spatialClipFields = {
  depth: finite.optional(), rotationX: finite.optional(), rotationY: finite.optional(), anchorDepth: finite.optional(),
  spaceEmission: finite.min(0).max(SPACE_EMISSION_MAX).optional(),
  spaceThickness: finite.min(0).max(SPACE_THICKNESS_MAX).optional(),
  spaceLit: z.boolean().optional(),
  spaceMaterial: spaceMaterialSchema.optional(),
  spaceBevel: finite.min(0).max(.5).optional(),
  spaceCastShadow: z.boolean().optional(),
  spaceReceiveShadow: z.boolean().optional(),
  lightKind: z.enum(SPACE_LIGHT_KINDS).optional(),
  lightColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  lightIntensity: finite.min(0).max(SPACE_LIGHT_INTENSITY_MAX).optional(),
  lightCastShadow: z.boolean().optional(),
  lightSoftness: finite.min(0).max(1).optional(),
  lightAngle: finite.min(1).max(170).optional(),
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

/**
 * 片段在三维里是否要按“实体”画（受光、非画面材质、有厚度或投下阴影）：受光的按物体处理（受光、整幅景深、色调映射）；
 * 画面材质又不受光的仍是平面画面，只长出厚度或投影。
 */
export function spaceClipIsSolid(clip: { spaceLit?: boolean; spaceMaterial?: SpaceMaterial; spaceThickness?: number; spaceCastShadow?: boolean; curves?: Partial<Record<string, readonly { value: unknown }[]>> }): boolean {
  return clip.spaceLit === true || clip.spaceCastShadow === true || (clip.spaceMaterial !== undefined && clip.spaceMaterial.preset !== 'picture') || (clip.spaceThickness ?? 0) > 0
    || !!clip.curves?.spaceThickness?.some(point => typeof point.value === 'number' && point.value > 0)
}

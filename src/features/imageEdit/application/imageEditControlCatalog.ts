import { z } from 'zod'
import {
  IMAGE_BLUR_ALGORITHMS,
  type ImageBlurAlgorithmId,
} from '../../../core/imageEdit/blurParams'
import {
  MAX_MOSAIC_STRENGTH_PERCENT,
  MIN_MOSAIC_STRENGTH_PERCENT,
} from '../../../core/imageEdit/constraints'

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
const MAX_PEN_POINT_VALUES = 4_096
const hexColorSchema = z.string()
  .regex(HEX_COLOR_PATTERN)
  .describe('颜色格式为井号加六位十六进制字符。')

const markLabelSchema = {
  label: z.string().trim().min(1).max(500).optional(),
  labelFontSize: z.number().finite().min(8).max(1000).optional(),
  labelDx: z.number().finite().optional(),
  labelDy: z.number().finite().optional(),
  labelBackgroundColor: hexColorSchema.optional(),
}

const markStyleSchema = {
  stroke: hexColorSchema,
  lineWidth: z.number().finite().min(1).max(100),
}

const imageEditMarkItemUnionSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1).max(120).optional(), type: z.literal('rect'), x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive(), ...markStyleSchema, ...markLabelSchema }).strict(),
  z.object({ id: z.string().min(1).max(120).optional(), type: z.literal('ellipse'), x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive(), ...markStyleSchema, ...markLabelSchema }).strict(),
  z.object({ id: z.string().min(1).max(120).optional(), type: z.literal('arrow'), points: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]), curveControl: z.tuple([z.number().finite(), z.number().finite()]).optional(), ...markStyleSchema, ...markLabelSchema }).strict(),
  z.object({ id: z.string().min(1).max(120).optional(), type: z.literal('pen'), points: z.array(z.number().finite()).min(4).max(MAX_PEN_POINT_VALUES).refine((points) => points.length % 2 === 0, 'points 必须成对出现'), ...markStyleSchema }).strict(),
  z.object({ id: z.string().min(1).max(120).optional(), type: z.literal('text'), x: z.number().finite(), y: z.number().finite(), text: z.string().max(10_000), color: hexColorSchema, fontSize: z.number().finite().min(10).max(1000), backgroundColor: hexColorSchema.optional() }).strict(),
  z.object({ id: z.string().min(1).max(120).optional(), type: z.literal('number'), x: z.number().finite(), y: z.number().finite(), color: hexColorSchema, fontSize: z.number().finite().min(10).max(1000) }).strict(),
  z.object({ id: z.string().min(1).max(120).optional(), type: z.literal('mosaic'), x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive(), strengthPercent: z.number().finite().min(MIN_MOSAIC_STRENGTH_PERCENT).max(MAX_MOSAIC_STRENGTH_PERCENT).optional(), mode: z.enum(['pixel', 'blur']).optional() }).strict(),
])

const MARK_LABEL_DEPENDENT_FIELDS = [
  'labelFontSize',
  'labelDx',
  'labelDy',
  'labelBackgroundColor',
] as const

export const imageEditMarkItemSchema = imageEditMarkItemUnionSchema.superRefine((item, context) => {
  if (item.type !== 'rect' && item.type !== 'ellipse' && item.type !== 'arrow') return

  const dependentFields = presentKeys(item, MARK_LABEL_DEPENDENT_FIELDS)
  if (item.label === undefined && dependentFields.length > 0) {
    context.addIssue({
      code: 'custom',
      path: [dependentFields[0]],
      message: `参数 ${dependentFields.join('、')} 只有提供非空 label 时才生效；请补充 label，或删除这些参数。`,
    })
  }
  if ((item.labelDx === undefined) !== (item.labelDy === undefined)) {
    context.addIssue({
      code: 'custom',
      path: [item.labelDx === undefined ? 'labelDx' : 'labelDy'],
      message: 'labelDx 与 labelDy 必须同时提供；请补齐另一项，或同时删除两项以使用自动标签位置。',
    })
  }
})

const rotationDegreesSchema = z.number().int().min(0).max(360).refine((degrees) => degrees % 90 === 0, 'degrees 必须是 90 的倍数').optional()
const blurAlgorithmIds = IMAGE_BLUR_ALGORITHMS.map((algorithm) => algorithm.id) as [
  ImageBlurAlgorithmId,
  ...ImageBlurAlgorithmId[],
]
const blurAlgorithmSchema = z.enum(blurAlgorithmIds)
const unitIntervalSchema = z.number().finite().min(0).max(1).describe('取值范围 0～1。')

const diffusionTintSchema = z.object({
  enabled: z.boolean().optional().describe('是否启用柔光着色；省略时，只要提供色相、饱和度或明度就会安全推断为 true。'),
  hue: z.number().finite().min(0).max(360).optional().describe('着色色相，0～360 度；仅在着色启用时生效。'),
  saturation: unitIntervalSchema.optional().describe('着色饱和度；仅在着色启用时生效。'),
  lightness: z.number().finite().min(-1).max(1).optional().describe('着色明度偏移，-1～1；仅在着色启用时生效。'),
}).strict()

const chromaticChannelSchema = z.enum(['red', 'green', 'blue'])
const chromaticChannelsSchema = z.tuple([
  chromaticChannelSchema,
  chromaticChannelSchema,
]).refine(
  ([left, right]) => left !== right,
  'chromaticChannels 必须包含两种不同的 RGB 通道',
).describe('左右两侧的色差通道，必须是两种不同的 RGB 通道。')

const imageEditOperationUnionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rotate_cw').describe('顺时针旋转。'), degrees: rotationDegreesSchema }).strict(),
  z.object({ kind: z.literal('rotate_ccw').describe('逆时针旋转。'), degrees: rotationDegreesSchema }).strict(),
  z.object({ kind: z.literal('flip_h').describe('水平镜像。') }).strict(),
  z.object({ kind: z.literal('flip_v').describe('垂直镜像。') }).strict(),
  z.object({ kind: z.literal('crop').describe('裁剪。'), crop: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().positive(), height: z.number().positive() }).strict() }).strict(),
  z.object({ kind: z.literal('mark').describe('添加结构化标注。'), item: imageEditMarkItemSchema }).strict(),
  z.object({
    kind: z.literal('blur').describe('添加模糊。'),
    algorithm: blurAlgorithmSchema.optional().describe('模糊算法；省略时使用编辑器默认算法。'),
    strength: unitIntervalSchema.optional().describe('模糊强度。'),
  }).strict(),
  z.object({
    kind: z.literal('diffusion').describe('添加黑柔、白柔或数字辉光。'),
    mode: z.enum(['black_mist', 'white_mist', 'glow']).optional().describe('柔光模式。省略且提供辉光专属参数时，安全推断为 glow；否则默认 black_mist。'),
    density: z.enum(['low', 'medium', 'high']).optional().describe('模式预设档位；先应用模式与档位基准，再覆盖显式数值。'),
    quality: z.enum(['realtime', 'high']).optional().describe('渲染质量。'),
    strength: unitIntervalSchema.optional().describe('柔光或辉光强度。'),
    glowRange: unitIntervalSchema.optional().describe('辉光扩散范围。'),
    highlightResponse: unitIntervalSchema.optional().describe('参与扩散的高光响应范围。'),
    softness: unitIntervalSchema.optional().describe('光斑柔和度。'),
    blackRetention: unitIntervalSchema.optional().describe('黑位保持；仅 black_mist 或 white_mist 生效，glow 模式不要提供。'),
    detailRetention: unitIntervalSchema.optional().describe('细节保留；仅 black_mist 或 white_mist 生效，glow 模式不要提供。'),
    colorRetention: unitIntervalSchema.optional().describe('原图色彩保持。'),
    glowExposure: unitIntervalSchema.optional().describe('辉光曝光；仅 glow 模式生效。'),
    highlightRolloff: unitIntervalSchema.optional().describe('高光滚降；仅 glow 模式生效。'),
    glowCoreWhite: unitIntervalSchema.optional().describe('辉光核心白热；仅 glow 模式生效。'),
    tint: diffusionTintSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal('vgpu_glow').describe('添加辉光 Pro。'),
    look: z.enum(['natural', 'dreamy', 'neon']).optional().describe('光感预设；先应用预设，再覆盖显式数值。'),
    tintEnabled: z.boolean().optional().describe('是否用自定义颜色替代光源颜色；省略且提供 tintColor 时安全推断为 true。'),
    tintColor: hexColorSchema.optional().describe('六位十六进制辉光颜色；仅在着色启用时生效。'),
    intensity: unitIntervalSchema.optional().describe('辉光能量。'),
    radius: unitIntervalSchema.optional().describe('辉光扩散半径。'),
    chromaticAberration: unitIntervalSchema.optional().describe('色差强度；0 表示关闭。'),
    chromaticChannels: chromaticChannelsSchema.optional(),
    sourceThreshold: unitIntervalSchema.optional().describe('参与发光的亮源门槛。'),
    whiteHeat: unitIntervalSchema.optional().describe('过曝核心向白色靠拢的程度。'),
  }).strict(),
])

const DIFFUSION_GLOW_ONLY_FIELDS = [
  'glowExposure',
  'highlightRolloff',
  'glowCoreWhite',
] as const
const DIFFUSION_MIST_ONLY_FIELDS = ['blackRetention', 'detailRetention'] as const
const DIFFUSION_TINT_VALUE_FIELDS = ['hue', 'saturation', 'lightness'] as const

function presentKeys<T extends string>(
  value: Partial<Record<T, unknown>>,
  keys: readonly T[],
): T[] {
  return keys.filter((key) => value[key] !== undefined)
}

export const imageEditOperationSchema = imageEditOperationUnionSchema.superRefine((operation, context) => {
  if (operation.kind === 'diffusion') {
    const glowOnlyFields = presentKeys(operation, DIFFUSION_GLOW_ONLY_FIELDS)
    if (operation.mode !== undefined && operation.mode !== 'glow' && glowOnlyFields.length > 0) {
      context.addIssue({
        code: 'custom',
        path: [glowOnlyFields[0]],
        message: `参数 ${glowOnlyFields.join('、')} 只在 diffusion 的 mode="glow" 时生效；请把 mode 改为 "glow"，或删除这些参数。`,
      })
    }

    const mistOnlyFields = presentKeys(operation, DIFFUSION_MIST_ONLY_FIELDS)
    if (operation.mode === undefined && glowOnlyFields.length > 0 && mistOnlyFields.length > 0) {
      context.addIssue({
        code: 'custom',
        path: [mistOnlyFields[0]],
        message: `参数 ${glowOnlyFields.join('、')} 会把未指定的 mode 推断为 "glow"，但 ${mistOnlyFields.join('、')} 只在黑柔/白柔生效；请明确选择一种 mode 并删除另一组专属参数。`,
      })
    }
    if (operation.mode === 'glow' && mistOnlyFields.length > 0) {
      context.addIssue({
        code: 'custom',
        path: [mistOnlyFields[0]],
        message: `参数 ${mistOnlyFields.join('、')} 在 diffusion 的 mode="glow" 下不生效；请改用 "black_mist"/"white_mist"，或删除这些参数。`,
      })
    }

    if (operation.tint?.enabled === false) {
      const tintValueFields = presentKeys(operation.tint, DIFFUSION_TINT_VALUE_FIELDS)
      if (tintValueFields.length > 0) {
        context.addIssue({
          code: 'custom',
          path: ['tint', tintValueFields[0]],
          message: `diffusion.tint.enabled=false 时 ${tintValueFields.join('、')} 不生效；请把 enabled 改为 true，或删除这些着色参数。`,
        })
      }
    }
  }

  if (operation.kind === 'vgpu_glow' && operation.tintEnabled === false && operation.tintColor !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['tintColor'],
      message: 'vgpu_glow.tintEnabled=false 时 tintColor 不生效；请把 tintEnabled 改为 true，或删除 tintColor。',
    })
  }
  if (
    operation.kind === 'vgpu_glow'
    && operation.chromaticChannels !== undefined
    && !(operation.chromaticAberration !== undefined && operation.chromaticAberration > 0)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['chromaticChannels'],
      message: 'chromaticChannels 在色差关闭时不生效；请提供大于 0 的 chromaticAberration，或删除 chromaticChannels。',
    })
  }
})

export const IMAGE_EDIT_PREVIEW_CAPABILITY_METADATA = {
  title: '创建图片编辑预览',
  description: '对明确图片应用几何、标注、模糊、黑柔、白柔、数字辉光或辉光 Pro，生成不覆盖原图的预览。',
  aliases: [
    '编辑素材图片',
    '图片标注预览',
    '矩形标注',
    '文字标注',
    '图片模糊',
    '高斯模糊',
    '黑柔',
    '白柔',
    '数字辉光',
    '辉光 Pro',
    'create image edit preview',
    'annotate image',
  ],
} as const

const SINGLETON_OPERATION_KINDS = ['crop', 'blur', 'diffusion', 'vgpu_glow'] as const

export const imageEditPreviewOperationsSchema = z.array(imageEditOperationSchema)
  .min(1)
  .max(32)
  .superRefine((operations, context) => {
    const firstSingletonIndices = new Map<string, number>()
    const explicitMarkIds = new Map<string, number>()

    operations.forEach((operation, index) => {
      if ((SINGLETON_OPERATION_KINDS as readonly string[]).includes(operation.kind)) {
        const firstIndex = firstSingletonIndices.get(operation.kind)
        if (firstIndex !== undefined) {
          context.addIssue({
            code: 'custom',
            path: [index, 'kind'],
            message: `operations 中 ${operation.kind} 只能出现一次；请只保留最终需要的一项 ${operation.kind}，并删除其余重复项。`,
          })
        } else {
          firstSingletonIndices.set(operation.kind, index)
        }
      }

      if (operation.kind === 'mark' && operation.item.id !== undefined) {
        const firstIndex = explicitMarkIds.get(operation.item.id)
        if (firstIndex !== undefined) {
          context.addIssue({
            code: 'custom',
            path: [index, 'item', 'id'],
            message: `标注 id 不能重复：${operation.item.id}；请删除重复项的 id 让系统自动生成，或改成不同 id。`,
          })
        } else {
          explicitMarkIds.set(operation.item.id, index)
        }
      }
    })

    const diffusionIndex = operations.findIndex((operation) => operation.kind === 'diffusion')
    const vgpuGlowIndex = operations.findIndex((operation) => operation.kind === 'vgpu_glow')
    if (diffusionIndex >= 0 && vgpuGlowIndex >= 0) {
      context.addIssue({
        code: 'custom',
        path: [Math.max(diffusionIndex, vgpuGlowIndex), 'kind'],
        message: 'diffusion 与 vgpu_glow 不能同时使用；请选择并只保留一种光效。',
      })
    }
  })
  .describe('提供 1～32 项图片编辑；朝向命令按输入顺序重映射，mark 按输入顺序叠加，blur 与唯一光效最终按编辑器固定阶段执行。crop、blur、diffusion、vgpu_glow 各最多一项，diffusion 与 vgpu_glow 只能选择一种。每项只能使用列出的 kind 和字段。')

function inputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, {
    target: 'draft-7',
    io: 'input',
  }) as Record<string, unknown>
  const { $schema: _schema, ...result } = generated
  return result
}

export function createImageEditPreviewInputContract<TSource extends z.ZodRawShape>(
  sourceShape: TSource,
) {
  const inputSchema = z.object({
    ...sourceShape,
    operations: imageEditPreviewOperationsSchema,
  }).strict()
  return {
    inputSchema,
    aiInputSchema: inputJsonSchema(inputSchema),
  }
}

export type ImageEditControlOperation = z.infer<typeof imageEditOperationSchema>

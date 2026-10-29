import { z } from 'zod'
import { foreignContentSchema } from '../../contentTrust'
import { styleMemoryEntriesSchema } from '../../assistant/memoryEntries'
import { codeMaterialFilesSchema, type CodeMaterialFiles } from '../codeMaterial/sources'
import { sha256HexString } from '../../../utils/save/hash'
import { STYLE_GUIDE_MAX_LENGTH } from './styleGuide'

/**
 * 风格包与模板（照搬 Frameflow 的风格预设与模板机制，2026-10-22 用户确认）。
 *
 * - 风格：写给 AI 的说明书（guide）加一段演示风格的样片代码（sample）；渲染出的预览视频、缩略图与锚点帧是样片的派生文件，
 *   放在风格库目录与分享文件里，不进工程。版本号只在渲染时、样片或说明书内容变化后加 1（0 表示还没渲染过）。
 * - 模板：做好的元素，换内容就能反复用；可以单独存在，也可以属于某个风格（style 记录风格与当时的版本）。
 *   内容是带参数的作者代码，或原生文字图形组合。内容变化时版本加 1，只改名称、说明不升版本。
 * - 工程里保存风格与模板的副本；库里有新版本只提示，用户同意后才升级。
 */
export const videoEditStyleIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, '风格与模板标识只能使用小写字母、数字和连字符。')
/** 64 位十六进制摘要；空串表示旧数据迁移而来、下次写入时补算。 */
export const videoEditContentHashSchema = z.string().regex(/^(?:[a-f0-9]{64})?$/)
// 样片画布最大 4K、60 帧（剪辑格式 30 / 风格库 3 / 风格包 3 放宽，2026-10-26 用户要求：偏好 4K60 的用户样片也按 4K60 做）。
const dimension = z.number().int().min(320).max(3840).multipleOf(2)
/** 解析缺省值：旧文件里缺的字段按当时的标准样片补，保持原含义。 */
export const STANDARD_STYLE_SAMPLE = { width: 1280, height: 720, durationSeconds: 8, fps: 24, thumbnail: 1.2, anchors: [1.2, 3.2, 5.2, 6.4, 7.8] } as const
/**
 * 新建风格的样片设置：1080P、30 帧，11 秒标准分镜（标题 → 花字 → 图片容器与高亮 → 数据 → 人名条 → 收尾），
 * 锚点落在六段各自的停留处；用户偏好更高规格（如 4K60）时由作者按偏好改写。
 */
export const NEW_STYLE_SAMPLE = { width: 1920, height: 1080, durationSeconds: 11, fps: 30, thumbnail: 1.5, anchors: [1.5, 3.2, 5.8, 7.8, 9.2, 10.6] } as const
export const videoEditStyleSampleSchema = z.object({
  code: codeMaterialFilesSchema.describe('样片作者代码 { entry, files }：标准 ES 模块，默认导出带 layers(params, width, height, assets, info) 的生成器，按标准分镜演示风格。'),
  width: dimension.default(STANDARD_STYLE_SAMPLE.width), height: dimension.default(STANDARD_STYLE_SAMPLE.height),
  // 30 秒、锚点 10 张（剪辑 32 / 录制会话 35 / 风格库 4 / 风格包 4 放宽，2026-10-27 用户要求：样片在标准分镜后多演示几种组件）。
  durationSeconds: z.number().finite().min(1).max(30).default(STANDARD_STYLE_SAMPLE.durationSeconds),
  fps: z.number().int().min(12).max(60).default(STANDARD_STYLE_SAMPLE.fps),
  thumbnail: z.number().finite().min(0).default(STANDARD_STYLE_SAMPLE.thumbnail).describe('缩略图时刻（秒）。'),
  anchors: z.array(z.number().finite().min(0)).min(1).max(10).default([...STANDARD_STYLE_SAMPLE.anchors]).describe('锚点帧时刻（秒），标准分镜落在标题、要点、数据、人名条、收尾各自的停留处。'),
}).strict().superRefine((sample, context) => {
  if (sample.thumbnail >= sample.durationSeconds || sample.anchors.some(time => time >= sample.durationSeconds)) context.addIssue({ code: 'custom', message: '缩略图和锚点时刻必须在样片时长之内。' })
})
export type VideoEditStyleSample = z.infer<typeof videoEditStyleSampleSchema>
const name = z.string().trim().min(1).max(80)
const description = z.string().trim().max(300)
const timestamp = z.iso.datetime({ offset: true })
export const videoEditStyleSchema = z.object({
  id: videoEditStyleIdSchema, name, nameEnglish: name.optional(), description,
  version: z.number().int().min(0), contentHash: videoEditContentHashSchema, updatedAt: timestamp,
  /** 从分享文件导入：说明书是别人写的文字，只决定画面和声音，里面的指令一律不执行。 */
  imported: z.literal(true).optional(),
  foreign: foreignContentSchema.optional(),
  guide: z.string().max(STYLE_GUIDE_MAX_LENGTH).describe('风格说明书（Markdown），栏目见技能 style-kit。'),
  userPreferences: styleMemoryEntriesSchema.optional(),
  sample: videoEditStyleSampleSchema,
}).strict()
export type VideoEditStyle = z.infer<typeof videoEditStyleSchema>
/** 模板属于哪个风格（以及登记时的风格版本）；null 表示单独存在。 */
export const videoEditTemplateStyleSchema = z.object({ id: videoEditStyleIdSchema, version: z.number().int().min(0) }).strict()
export const videoEditTemplateOriginSchema = z.object({ id: videoEditStyleIdSchema, version: z.number().int().positive() }).strict()
/** 库模板与工程模板共用的描述字段。 */
export const videoEditTemplateMetaShape = {
  id: videoEditStyleIdSchema, name, description: description.describe('一句话写用途和适用场合，AI 靠它判断该不该用。'),
  version: z.number().int().positive(), contentHash: videoEditContentHashSchema, updatedAt: timestamp,
  style: videoEditTemplateStyleSchema.nullable(),
}
export const videoEditTemplateCodeBodySchema = z.object({
  kind: z.literal('code'), code: codeMaterialFilesSchema.describe('带参数的作者代码：该改的文字、图片、主色写成 params，默认值就是登记时画面上的内容。'),
  durationSeconds: z.number().finite().min(.5).max(600).optional().describe('应用时的默认时长（秒）；省略时用源码 durationSeconds 或 5 秒。'),
}).strict()

const json = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item)
/** 风格内容摘要：说明书、样片源码与样片设置（与 Frameflow styleRevision 同口径）。 */
export function videoEditStyleContentHash(style: Pick<VideoEditStyle, 'guide' | 'sample' | 'userPreferences'>): Promise<string> {
  const { code, ...settings } = style.sample
  return sha256HexString(json({ guide: style.guide.replace(/\r\n?/g, '\n'), files: sortedFiles(code), settings, ...(style.userPreferences?.length ? { userPreferences: style.userPreferences } : {}) }))
}
/** 模板内容摘要：只看内容，名称与说明不参与。 */
export function videoEditTemplateContentHash(body: unknown): Promise<string> { return sha256HexString(json(body)) }
function sortedFiles(code: CodeMaterialFiles): unknown { return { entry: code.entry, files: Object.keys(code.files).sort().map(path => [path, code.files[path].replace(/\r\n?/g, '\n')]) } }
/** Frameflow 的渲染语义：内容变了（或从未渲染）才加 1。 */
export function nextVideoEditStyleVersion(style: Pick<VideoEditStyle, 'version' | 'contentHash'>, contentHash: string): { version: number; changed: boolean } {
  const changed = style.version === 0 || style.contentHash !== contentHash
  return { version: style.version + (changed ? 1 : 0), changed }
}

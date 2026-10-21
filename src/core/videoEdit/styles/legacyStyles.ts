import { z } from 'zod'
import { codeMaterialFilesSchema, codeSourceTextSchema, normalizeCodeMaterialFiles } from '../codeMaterial/sources'
import { videoEditNativeTemplateContentSchema, type VideoEditNativeTemplateContent } from '../document'
import { TITLE_GRAPHIC_KINDS, titleGraphic, titleGraphicParametersSchema } from '../titleGraphics'
import { parseStyleGuide, composeStyleGuide, styleGuideTemplate, type StyleGuideSection } from './styleGuide'
import { STANDARD_STYLE_SAMPLE, videoEditStyleIdSchema, videoEditStyleSchema, type VideoEditStyle } from './styleSchemas'
import { videoEditTemplateSchema, type VideoEditTemplate } from './templateSchemas'
import { BLANK_STYLE_SAMPLE_SOURCE } from './blankSample'

/*
 * 2026-10-22 之前的“风格说明书 + 参考示例”和“动态图形标题模板”（剪辑内容第 21 版及更早、本机风格库 v3、
 * 本机标题模板 v6、剪辑预设文件 v6）。schema 原样冻结，只供读取旧数据；转换函数把它们映射成新的风格与模板：
 * 旧栏目并入新栏目（不丢内容），参考示例的第一段成为样片、全部示例原文记进“样片与代码”，标题模板成为原生模板。
 */
const LEGACY_SECTIONS = ['定位', '核心理念', '视觉语言', '动效语言', '节奏与剪辑', '文字与字幕', '必须', '避免', '可以自由发挥'] as const
const legacyId = z.string().min(1).max(100)
export const legacyStyleKitExampleSchema = z.object({
  id: legacyId, title: z.string().trim().min(1).max(80),
  note: z.string().trim().max(500).default('').describe('这段示例演示了说明书里的哪几条规矩；示例只示意手法，不是可直接插入的组件。'),
  source: z.union([codeSourceTextSchema, codeMaterialFilesSchema]),
}).strict()
const legacyStyleKitContentSchema = z.object({
  guide: z.string().max(20000).describe(`风格说明书（Markdown）。必须包含二级标题：${LEGACY_SECTIONS.join('、')}；可选“画面生成提示”，也可追加自定义章节。强弱直接写在文字里：必须 / 尽量 / 可以。`),
  examples: z.array(legacyStyleKitExampleSchema).max(6).default([]).describe('参考代码示例：演示手法，供照着写新内容，不原样插入。'),
}).strict()
export const legacyStyleKitSchema = legacyStyleKitContentSchema.safeExtend({ id: legacyId, name: z.string().trim().min(1).max(200), revision: z.number().int().nonnegative().default(0) })
export type LegacyStyleKit = z.infer<typeof legacyStyleKitSchema>

const legacyTitleDefinition = z.object({ kind: z.enum(TITLE_GRAPHIC_KINDS).optional(), content: videoEditNativeTemplateContentSchema.optional(), parameters: titleGraphicParametersSchema }).strict()
export const legacyTitleTemplateSchema = legacyTitleDefinition.extend({ id: legacyId, name: z.string().trim().min(1).max(200) }).refine(value => Boolean(value.kind) !== Boolean(value.content), '请选择内置类型或提供文字图形组合。')
export type LegacyTitleTemplate = z.infer<typeof legacyTitleTemplateSchema>

/** 旧栏目 → 新栏目；同一新栏目收到多段时，每段带上原栏目名，读的人分得清来历。 */
const SECTION_MAP: Record<typeof LEGACY_SECTIONS[number], string> = {
  定位: '定位', 核心理念: '设计原则', 视觉语言: '色彩', 动效语言: '动效', 节奏与剪辑: '镜头与转场',
  文字与字幕: '组件', 必须: '设计原则', 避免: '正反例', 可以自由发挥: '不变量与自由度',
}
const LABEL: Partial<Record<typeof LEGACY_SECTIONS[number], string>> = { 核心理念: '倾向（原“核心理念”）', 必须: '硬约束（原“必须”）', 避免: '不做（原“避免”）', 可以自由发挥: '自由度（原“可以自由发挥”）', 视觉语言: '原“视觉语言”（含配色、字体、版式与质感）' }
const sourceFiles = (source: LegacyStyleKit['examples'][number]['source']) => normalizeCodeMaterialFiles(typeof source === 'string' ? source : source)
export function legacyStyleGuide(kit: Pick<LegacyStyleKit, 'name' | 'guide' | 'examples'>): string {
  const old = parseStyleGuide(kit.guide)
  const merged = new Map<string, string[]>()
  const add = (title: string, text: string): void => { if (text.trim()) merged.set(title, [...merged.get(title) ?? [], text.trim()]) }
  for (const section of old) {
    if (!section.title || !(LEGACY_SECTIONS as readonly string[]).includes(section.title)) continue
    const legacy = section.title as typeof LEGACY_SECTIONS[number]
    const label = LABEL[legacy]
    add(SECTION_MAP[legacy], label ? `**${label}**\n\n${section.body}` : section.body)
  }
  if (kit.examples.length) add('样片与代码', ['原风格的参考示例（只示意手法；第一段已作为样片）：', ...kit.examples.map(example => { const files = sourceFiles(example.source); return `### ${example.title}${example.note ? `\n${example.note}` : ''}\n\n${Object.entries(files.files).map(([path, text]) => `\`${path}\`\n\n\`\`\`js\n${text.trim()}\n\`\`\``).join('\n\n')}` })].join('\n\n'))
  const preface = old.find(section => !section.title)?.body
  const extras = old.filter(section => section.title && !(LEGACY_SECTIONS as readonly string[]).includes(section.title))
  const sections: StyleGuideSection[] = [{ title: '', body: [`# ${kit.name}`, preface].filter(Boolean).join('\n\n') }, ...[...merged].map(([title, parts]) => ({ title, body: parts.join('\n\n') })), ...extras]
  return composeStyleGuide(sections)
}
/** 旧标识若不符合新规则（例如内置占位“builtin:style:blank”），换成同样稳定的小写形式。 */
export function legacyStyleId(id: string): string {
  if (videoEditStyleIdSchema.safeParse(id).success) return id
  const cleaned = id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56)
  return videoEditStyleIdSchema.parse(`legacy-${cleaned || 'style'}`)
}
export function convertLegacyStyleKit(raw: LegacyStyleKit, updatedAt: string): VideoEditStyle {
  const kit = legacyStyleKitSchema.parse(raw)
  const first = kit.examples[0]
  const positioning = parseStyleGuide(kit.guide).find(section => section.title === '定位')?.body.split('\n')[0]?.trim() ?? ''
  return videoEditStyleSchema.parse({
    id: legacyStyleId(kit.id), name: kit.name.slice(0, 80), description: positioning.slice(0, 300),
    version: kit.revision + 1, contentHash: '', updatedAt,
    guide: kit.guide.trim() ? legacyStyleGuide(kit) : styleGuideTemplate(kit.name.slice(0, 80)),
    sample: { ...STANDARD_STYLE_SAMPLE, anchors: [...STANDARD_STYLE_SAMPLE.anchors], code: first ? sourceFiles(first.source) : { entry: 'index.js', files: { 'index.js': BLANK_STYLE_SAMPLE_SOURCE } } },
  })
}
/** 旧标题模板 → 原生模板；“内置类型”按 1080p、30 fps 展开成图形快照，参数作为默认内容保留。 */
export function convertLegacyTitleTemplate(raw: LegacyTitleTemplate, updatedAt: string): VideoEditTemplate {
  const template = legacyTitleTemplateSchema.parse(raw)
  let content: VideoEditNativeTemplateContent
  if (template.content) content = template.content
  else {
    const fps = 30; const frames = Math.max(2, Math.round(template.parameters.durationSeconds * fps))
    content = { width: 1920, height: 1080, fps, clips: [{ name: template.name, kind: 'graphic', graphic: titleGraphic(template.kind!, template.parameters, 1920, 1080, (frames - 1) / fps), track: 0, start: 0, duration: frames, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }] }
  }
  return videoEditTemplateSchema.parse({ id: legacyStyleId(template.id), name: template.name.slice(0, 80), description: template.kind ? `由旧版“${template.name}”标题模板转换的文字图形组合。` : '', version: 1, contentHash: '', updatedAt, style: null, body: { kind: 'native', content } })
}

/** 迁移时间未知：旧数据统一记为风格机制替换当天。 */
export const LEGACY_STYLE_UPDATED_AT = '2026-10-22T00:00:00.000Z'
/** 剪辑内容 21 → 22：工程风格包换成风格副本，序列绑定改名为 styleId；纯函数，不改原输入。 */
export function migrateVideoEditStyles(content: unknown): unknown {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return content
  const next = structuredClone(content) as Record<string, unknown> & { styleKits?: unknown; sequences?: unknown }
  const ids = new Map<string, string>()
  if (Array.isArray(next.styleKits)) {
    const taken = new Set<string>()
    next.styles = next.styleKits.map(kit => {
      const style = convertLegacyStyleKit(kit as LegacyStyleKit, LEGACY_STYLE_UPDATED_AT); let id = style.id
      for (let index = 2; taken.has(id); index++) id = legacyStyleId(`${style.id}-${index}`)
      taken.add(id); ids.set(String((kit as { id?: unknown }).id), id); return { ...style, id }
    })
    if (!(next.styles as unknown[]).length) delete next.styles
  }
  delete next.styleKits
  if (Array.isArray(next.sequences)) next.sequences = next.sequences.map(sequence => {
    if (!sequence || typeof sequence !== 'object') return sequence
    const { styleKitId, ...rest } = sequence as Record<string, unknown>
    return typeof styleKitId === 'string' && ids.has(styleKitId) ? { ...rest, styleId: ids.get(styleKitId) } : rest
  })
  return next
}
/** 录制会话等把整份剪辑文档快照嵌在里面的格式：找到每份 henji-video-project 快照做同一步迁移。 */
export function migrateEmbeddedVideoEditStyles(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(migrateEmbeddedVideoEditStyles)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (record.format === 'henji-video-project') return migrateVideoEditStyles(record)
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, migrateEmbeddedVideoEditStyles(item)]))
}

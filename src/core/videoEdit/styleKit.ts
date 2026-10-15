import { codeMaterialFilesSchema, codeSourceTextSchema } from './codeMaterial/sources'
import { z } from 'zod'

/**
 * A style is a structured prompt for the AI, not a parameter set: one Markdown guide with fixed sections plus a few
 * reference code examples. How binding a rule is lives in its wording (必须 / 尽量 / 可以), never in a separate field.
 * Nothing renders from it automatically; the assistant reads it and creates new content that follows it.
 */
export const STYLE_GUIDE_SECTIONS = [
  { title: '定位', hint: '一句话：这是什么风格，适合什么片子。', required: true },
  { title: '核心理念', hint: '两三条抽象理念，每条写清“怎样算做到了”。', required: true },
  { title: '视觉语言', hint: '配色（可写具体色值和用途）、字体、版式与留白、质感。', required: true },
  { title: '动效语言', hint: '入场、出场、强调怎么动，快慢与停顿，可写具体曲线。', required: true },
  { title: '节奏与剪辑', hint: '镜头时长、切点、转场、音效与配乐。', required: true },
  { title: '文字与字幕', hint: '标题、人名条、强调词、字幕的处理方式。', required: true },
  { title: '必须', hint: '每条一行，不能违反的规矩。', required: true },
  { title: '避免', hint: '每条一行，明确不做的事。', required: true },
  { title: '可以自由发挥', hint: '留给创作的空间，避免每次做得一模一样。', required: true },
  { title: '画面生成提示', hint: '原地生成图片或视频时并入提示词的一两句画面描述；不写就不并入。', required: false },
] as const
export const STYLE_GUIDE_MAX_LENGTH = 20000
export const STYLE_EXAMPLE_LIMIT = 6
const id = z.string().min(1).max(100)

export interface StyleGuideSection { title: string; body: string }
/** `## 标题` starts a section; text before the first heading is kept as a preface. */
export function parseStyleGuide(guide: string): StyleGuideSection[] {
  const sections: StyleGuideSection[] = []; let current: StyleGuideSection | undefined; const preface: string[] = []
  for (const line of guide.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) { current = { title: heading[1].trim(), body: '' }; sections.push(current); continue }
    if (current) current.body += `${line}\n`; else preface.push(line)
  }
  for (const section of sections) section.body = section.body.trim()
  const lead = preface.join('\n').trim()
  return lead ? [{ title: '', body: lead }, ...sections] : sections
}
export function styleGuideSection(guide: string, title: string): string { return parseStyleGuide(guide).find(section => section.title === title)?.body ?? '' }
/** Canonical order: the fixed sections first, then any extra sections the author added, in their own order. */
export function composeStyleGuide(sections: readonly StyleGuideSection[]): string {
  const fixed = STYLE_GUIDE_SECTIONS.map(spec => sections.find(section => section.title === spec.title) ?? { title: spec.title, body: '' })
  const extra = sections.filter(section => section.title && !STYLE_GUIDE_SECTIONS.some(spec => spec.title === section.title))
  return [...fixed, ...extra].filter(section => section.body.trim() || STYLE_GUIDE_SECTIONS.some(spec => spec.required && spec.title === section.title)).map(section => `## ${section.title}\n${section.body.trim()}`).join('\n\n')
}
export function styleGuideTemplate(): string { return STYLE_GUIDE_SECTIONS.filter(spec => spec.required).map(spec => `## ${spec.title}\n`).join('\n') }
/** Missing or empty required sections, in plain language; empty means the guide is complete. */
export function styleGuideProblems(guide: string): string[] {
  const sections = parseStyleGuide(guide)
  return STYLE_GUIDE_SECTIONS.filter(spec => spec.required && !sections.find(section => section.title === spec.title)?.body).map(spec => `“${spec.title}”还没有写`)
}

export const styleKitExampleSchema = z.object({
  id, title: z.string().trim().min(1).max(80),
  note: z.string().trim().max(500).default('').describe('这段示例演示了说明书里的哪几条规矩；示例只示意手法，不是可直接插入的组件。'),
  source: z.union([codeSourceTextSchema, codeMaterialFilesSchema]),
}).strict()
export const styleKitContentSchema = z.object({
  guide: z.string().max(STYLE_GUIDE_MAX_LENGTH).describe(`风格说明书（Markdown）。必须包含二级标题：${STYLE_GUIDE_SECTIONS.filter(spec => spec.required).map(spec => spec.title).join('、')}；可选“画面生成提示”，也可追加自定义章节。强弱直接写在文字里：必须 / 尽量 / 可以。`),
  examples: z.array(styleKitExampleSchema).max(STYLE_EXAMPLE_LIMIT).default([]).describe('参考代码示例：演示手法，供照着写新内容，不原样插入。'),
}).strict().superRefine((value, context) => {
  for (const problem of styleGuideProblems(value.guide)) context.addIssue({ code: 'custom', path: ['guide'], message: `说明书${problem}。` })
  if (new Set(value.examples.map(example => example.id)).size !== value.examples.length) context.addIssue({ code: 'custom', path: ['examples'], message: '示例标识不能重复。' })
})
export const styleKitSchema = styleKitContentSchema.safeExtend({ id, name: z.string().trim().min(1).max(200), revision: z.number().int().nonnegative().default(0) })
export type StyleKit = z.infer<typeof styleKitSchema>
export type StyleKitContent = z.infer<typeof styleKitContentSchema>
export type StyleKitExample = z.infer<typeof styleKitExampleSchema>
export function styleKitContent(kit: StyleKit): StyleKitContent { return { guide: kit.guide, examples: structuredClone(kit.examples) } }

export function resolveVideoEditStyleKit(document: { styleKits?: StyleKit[] }, sequence: { styleKitId?: string }): StyleKit | undefined {
  if (!sequence.styleKitId) return undefined
  const kit = document.styleKits?.find(value => value.id === sequence.styleKitId)
  if (!kit) throw new Error('绑定的风格不存在，请读取本工程风格后重新绑定。')
  return kit
}
/** One-line positioning for lists and summaries. */
export function styleKitSummary(kit: StyleKit): string { return styleGuideSection(kit.guide, '定位').split('\n')[0]?.trim() ?? '' }
/** The sentence that joins image/video prompts when generating in place; empty when the style asks for none. */
export function styleKitGenerationPrompt(kit: StyleKit): string { return styleGuideSection(kit.guide, '画面生成提示').replace(/\s+/g, ' ').trim() }
const sourceText = (source: StyleKitExample['source']): string => typeof source === 'string' ? source : source.files[source.entry] ?? ''
/** The full prompt the assistant works from: guide first, then each example with what it demonstrates. */
export function styleKitBriefing(kit: StyleKit, options: { examples?: boolean } = {}): string {
  const parts = [`# 风格：${kit.name}`, kit.guide.trim()]
  if (options.examples !== false && kit.examples.length) parts.push(['## 参考示例（只示意手法，照着规矩写新内容，不要原样照搬）', ...kit.examples.map(example => `### ${example.title}${example.note ? `\n${example.note}` : ''}\n\`\`\`ts\n${sourceText(example.source).trim()}\n\`\`\``)].join('\n\n'))
  return parts.join('\n\n')
}

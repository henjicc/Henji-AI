import { z } from 'zod'
import { textStyleSchema } from '../../../core/imaging/vectorContent/text'
import { richTextContentSchema } from '../../../core/imaging/vectorContent/schema'
import type { FlexNode, FlexStyle } from './flex'
import type { RichTextContent, TextOptions, TextStyleInput } from './text'

const nonnegative = z.number({ error: '必须为有限非负数' }).finite({ error: '必须为有限非负数' }).min(0, { error: '必须为有限非负数' })
const finite = z.number({ error: '必须为有限数值' }).finite({ error: '必须为有限数值' })
const length = z.union([nonnegative, z.string().regex(/^(?:\d+(?:\.\d*)?|\.\d+)%$/).refine(value => Number.isFinite(Number(value.slice(0, -1)))).transform(value => value as `${number}%`)], { error: '必须为有限非负数或非负百分比（例如 "50%"）' })
const automaticLength = z.union([length, z.literal('auto')], { error: '必须为有限非负数、非负百分比或 "auto"' })
const edges = (value: typeof finite) => z.union([value, z.object({ top: value.optional(), right: value.optional(), bottom: value.optional(), left: value.optional() }).strict()], { error: '必须为合法数值或仅含 top、right、bottom、left 的边距对象' })
const flexStyleShape = {
  width: automaticLength.optional(), height: automaticLength.optional(),
  minWidth: length.optional(), maxWidth: length.optional(), minHeight: length.optional(), maxHeight: length.optional(),
  flexDirection: z.enum(['row', 'column', 'row-reverse', 'column-reverse']).optional(),
  flexWrap: z.enum(['nowrap', 'wrap', 'wrap-reverse']).optional(),
  flexGrow: nonnegative.optional(), flexShrink: nonnegative.optional(), flexBasis: automaticLength.optional(),
  gap: nonnegative.optional(), rowGap: nonnegative.optional(), columnGap: nonnegative.optional(),
  padding: edges(nonnegative).optional(), margin: edges(finite).optional(),
  alignItems: z.enum(['start', 'flex-start', 'center', 'end', 'flex-end', 'stretch']).optional(),
  alignSelf: z.enum(['auto', 'start', 'flex-start', 'center', 'end', 'flex-end', 'stretch']).optional(),
  justifyContent: z.enum(['start', 'flex-start', 'center', 'end', 'flex-end', 'space-between', 'space-around', 'space-evenly']).optional(),
}
const flexStyleSchema = z.object(flexStyleShape).strict() satisfies z.ZodType<FlexStyle>
const sizeSchema = z.object({ width: nonnegative, height: nonnegative, direction: z.enum(['ltr', 'rtl']).optional() }).strict()
const positive = finite.positive({ error: '必须为有限正数' })
const textOptionsSchema = z.object({
  maxWidth: nonnegative.optional(), maxHeight: nonnegative.optional(), maxLines: positive.int().optional(),
  wrapWidth: nonnegative.optional(), wrap: z.enum(['grapheme', 'word', 'none']).optional(),
  fit: z.union([z.literal(false), z.object({
    minFontSize: positive.min(1), maxFontSize: positive.optional(), step: positive.optional(),
    algorithm: z.enum(['grid', 'continuous']).optional(), iterations: positive.int().optional(), trigger: z.enum(['overflow', 'maxLines']).optional(),
  }).strict()], { error: '必须为 false 或合法的 fit 对象；可用字段：minFontSize、maxFontSize、step、algorithm、iterations、trigger' }).optional(),
  anchor: z.object({ x: finite, y: finite, horizontal: finite, vertical: finite }).strict().optional(),
  box: z.object({ width: nonnegative.optional(), height: nonnegative.optional() }).strict().optional(),
  frame: z.object({ width: positive, height: positive }).strict().optional(),
  direction: z.enum(['ltr', 'rtl', 'inherit']).optional(), truncate: z.boolean().optional(), forceGraphemes: z.boolean().optional(),
}).strict() satisfies z.ZodType<TextOptions>
const nodeSchema = z.object({ id: z.string().min(1, { error: 'id 必须为非空字符串' }), style: z.unknown().optional(), children: z.array(z.unknown()).optional(), text: z.unknown().optional() }).strict()
const nodeTextSchema = z.object({ content: z.unknown(), style: z.unknown().optional(), options: z.unknown().optional() }).strict()

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string, fields?: string[]): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const details = result.error.issues.map(issue => {
    const location = issue.path.length ? `.${issue.path.join('.')}` : ''
    const message = issue.code === 'invalid_value' ? `可用值：${issue.values.map(String).join('、')}`
      : issue.code === 'unrecognized_keys' ? `未知字段：${issue.keys.join('、')}${fields && !issue.path.length ? `；可用字段：${fields.join('、')}` : ''}`
        : issue.code === 'invalid_type' ? issue.message.startsWith('必须') ? issue.message : `类型不正确，需要${({ number: '有限数字', string: '字符串', boolean: '布尔值', object: '对象', array: '数组' } as Record<string, string>)[issue.expected] ?? issue.expected}`
          : issue.code === 'too_small' ? `必须${issue.inclusive ? '大于或等于' : '大于'} ${String(issue.minimum)}（${issue.message}）`
        : `值不合法（${issue.message}）`
    return `${label}${location}：${message}`
  })
  throw new Error(details.join('；'))
}

export function parseTextInput(content: string | RichTextContent, style: TextStyleInput): { content: string | RichTextContent; style: z.output<typeof textStyleSchema> } {
  const parsed = typeof content === 'string' ? content : parse(richTextContentSchema, content, '富文本')
  if (typeof parsed !== 'string' && typeof content !== 'string') {
    // 共享排版用源样式身份保留相邻 run 的连写；Zod 深拷贝不能拆散这种身份关系。
    const styles = new Map<TextStyleInput, z.output<typeof textStyleSchema>>()
    parsed.paragraphs.forEach((paragraph, p) => paragraph.runs.forEach((run, r) => {
      const source = content.paragraphs[p].runs[r].style
      const shared = styles.get(source)
      if (shared) run.style = shared
      else styles.set(source, run.style)
    }))
  }
  return {
    content: parsed,
    style: parse(textStyleSchema, style, '文字样式', Object.keys(textStyleSchema.shape)),
  }
}

export function validateTextOptions(options: TextOptions): void {
  parse(textOptionsSchema, options, '文字排版选项', Object.keys(textOptionsSchema.shape))
}

/** 先校验整棵树，避免 JS 作者的非法样式进入 WASM 后被枚举零值或测量回调掩盖。 */
export function validateFlexTree(tree: FlexNode, size: { width: number; height: number; direction?: 'ltr' | 'rtl' }): void {
  parse(sizeSchema, size, '布局尺寸', Object.keys(sizeSchema.shape))
  const visit = (source: FlexNode): void => {
    parse(nodeSchema, source, '布局节点', Object.keys(nodeSchema.shape))
    parse(flexStyleSchema, source.style === undefined ? {} : source.style, `布局框 ${source.id} 的样式`, Object.keys(flexStyleShape))
    if (source.text !== undefined) {
      parse(nodeTextSchema, source.text, `文字框 ${source.id}`, Object.keys(nodeTextSchema.shape))
      parseTextInput(source.text.content, source.text.style === undefined ? {} : source.text.style)
      validateTextOptions(source.text.options === undefined ? {} : source.text.options)
    }
    for (const child of source.children ?? []) visit(child)
  }
  visit(tree)
}

// @vitest-environment node
import { expect, it } from 'vitest'
import { z } from 'zod'
import { commonToolInputSchema, invalidInputMessage } from './inputValidation'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from './builtinApplicationCapabilityRegistry'

const commonFields = Object.keys(commonToolInputSchema.shape)
const clipSchema = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('get_video_edit_clip_pauses')!.inputSchema
const publicClipSchema = { ...z.toJSONSchema(clipSchema, { io: 'input' }), properties: {
  ...z.toJSONSchema(clipSchema, { io: 'input' }).properties,
  ...z.toJSONSchema(commonToolInputSchema, { io: 'input' }).properties,
} }
const accepted = '这个工具接受：clipRef（必填）、range、searchMs、retainedMs。\n通用：includeRevisions、includeEvidence、includeDetails。'
const message = (schema: z.ZodType, input: unknown, publicSchema: Record<string, unknown>) => {
  const parsed = schema.safeParse(input)
  if (parsed.success) throw new Error('测试输入必须无效')
  return invalidInputMessage(parsed.error, publicSchema, input, commonFields)
}

it('缺少必填字段与类型错误分开说明，并列出实际通用选项', () => {
  expect(message(clipSchema, {}, publicClipSchema)).toBe(`INVALID_INPUT:缺少必填参数 clipRef（对象 {kind, id}）。\n${accepted}`)
})

it('类型、枚举、范围与格式约束来自 schema，多个问题逐行列全且不回显输入值', () => {
  const schema = z.object({ limit: z.number().int().min(1).max(100), mode: z.enum(['image', 'chunk']), operationId: z.string().uuid(), count: z.number().min(1).max(100) }).strict()
  expect(message(schema, { limit: '私密值', mode: '秘密', operationId: '秘密', count: 101 }, z.toJSONSchema(schema, { io: 'input' }))).toBe([
    'INVALID_INPUT:limit 应为 1–100 的整数，收到字符串。',
    'mode 应为 以下取值之一：image、chunk，收到字符串。',
    'operationId 应为 字符串（uuid 格式），收到字符串。',
    'count 应为 1–100 的数字，收到数字。',
    '这个工具接受：limit（必填）、mode（必填）、operationId（必填）、count（必填）。',
  ].join('\n'))
})

it('不认识的字段保持原说明，并列出必填与通用字段', () => {
  expect(message(clipSchema, { clipRef: { kind: 'video_edit.clip', id: 'clip' }, foo: 1 }, publicClipSchema)).toBe(`INVALID_INPUT:不认识的参数：foo。\n${accepted}`)
})

it('记忆新增缺基线时说明新条目使用0，项目分区错误指向具体字段', () => {
  const schema = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('organize_assistant_memory')!.inputSchema
  const change = { target: { layer: 'project', ownerId: 'project' }, id: 'brand', entry: { content: '本期品牌色红色。', source: 'assistant', section: 'creative' }, actor: 'assistant', reason: '用户明确要求。' }
  expect(message(schema, { changes: [change] }, z.toJSONSchema(schema, { io: 'input' }))).toContain('新增条目必须为0')
  const result = message(schema, { changes: [{ ...change, expectedRevision: 0 }] }, z.toJSONSchema(schema, { io: 'input' }))
  expect(result).toContain('changes.0.entry.section')
  expect(result).toContain('只有全局记忆需要分区')
})

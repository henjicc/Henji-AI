import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { SessionManager, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { embeddedSelectionSnapshotSchema, type EmbeddedSelectionSnapshot } from '../../../../src/core/assistant/embeddedAgent'
import { estimateContextTokens, fitText, projectText, isSkillResult, SKILL_RESULT_TOKEN_BUDGET } from './contextBudget'

const groups = ['selectedRefs', 'selectedClipRefs', 'targetTrackRefs'] as const
const selectionEntrySchema = z.object({ selectionId: z.string(), selectionSnapshot: embeddedSelectionSnapshotSchema })
const pageSchema = z.object({ reference: z.string(), offset: z.number().int().nonnegative().default(0) }).strict()
const archivedTextSchema = z.object({ resultId: z.string(), fullText: z.record(z.string(), z.string()), skillContent: z.boolean().optional() })
type ToolResult = Awaited<ReturnType<ToolDefinition['execute']>>

/** 原文保存在 Pi 非模型记录中；图像归一化即使替换 details 也不丢失续读内容。 */
export function archiveToolResult(manager: SessionManager, result: ToolResult, skillContent = false): ToolResult {
  const id = randomUUID()
  const fullText: Record<string, string> = {}
  const content = result.content.map((part, index) => {
    if (part.type !== 'text') return part
    const text = projectText(part.text, `tool:${id}:${index}`, skillContent ? SKILL_RESULT_TOKEN_BUDGET : 4000)
    if (text !== part.text) fullText[String(index)] = part.text
    return { ...part, text }
  })
  if (Object.keys(fullText).length) manager.appendCustomEntry('henji-tool-result', { resultId: id, fullText, skillContent })
  return { ...result, content, details: { resultId: id, skillContent, originalDetails: result.details } }
}

export function selectionSummary(id: string, snapshot: EmbeddedSelectionSnapshot): unknown {
  return { capturedAt: snapshot.capturedAt, ...Object.fromEntries(groups.map(group => [group, {
    count: snapshot[group].length, items: snapshot[group].slice(0, 8), hasMore: snapshot[group].length > 8,
    reference: `selection:${id}:${group}`, read: 'read_assistant_context',
  }])) }
}

/** 仅回读当前会话已接收的数据，不触达应用、文件路径、其他会话或新的权限范围。 */
export function contextReader(manager: SessionManager): ToolDefinition {
  return { name: 'read_assistant_context', label: '读取对话资料',
    description: '分页读取本对话结果摘要或发送时选区的 reference。offset 默认 0，随后用返回的 nextOffset 继续到 hasMore=false；选区不会随界面变化。只读既有记录，不重新执行操作。',
    parameters: { type: 'object', properties: { reference: { type: 'string' }, offset: { type: 'integer', minimum: 0 } }, required: ['reference'], additionalProperties: false } as ToolDefinition['parameters'],
    executionMode: 'sequential',
    execute: async (_id, args, signal) => {
      signal?.throwIfAborted()
      const { reference, offset } = pageSchema.parse(args)
      let source: string | string[] | undefined
      let skillContent = false
      for (const entry of manager.getBranch()) {
        if (entry.type === 'custom' && entry.customType === 'henji-tool-result') {
          const archived = archivedTextSchema.safeParse(entry.data)
          if (archived.success) for (const [index, text] of Object.entries(archived.data.fullText)) {
            if (reference === `tool:${archived.data.resultId}:${index}`) { source = text; skillContent = archived.data.skillContent === true }
          }
        }
        if (entry.type === 'custom_message' && entry.customType === 'henji-context') {
          const parsed = selectionEntrySchema.safeParse(entry.details)
          if (parsed.success) for (const group of groups) {
            if (reference === `selection:${parsed.data.selectionId}:${group}`) source = parsed.data.selectionSnapshot[group]
          }
        }
        if (entry.type === 'message' && entry.message.role === 'toolResult') {
          const message = entry.message
          const archived = z.object({ resultId: z.string() }).safeParse(message.details)
          message.content.forEach((part, index) => {
            if (part.type === 'text' && reference === `tool:${archived.success ? archived.data.resultId : message.toolCallId}:${index}` && source === undefined) {
              source = part.text
              skillContent = isSkillResult(message.toolName, message.details)
            }
          })
        }
      }
      if (source === undefined) throw new Error('这份引用不在当前对话中。请使用本对话摘要返回的 reference；不会重新执行原操作。')
      if (offset > source.length) throw new Error(`分页起点超出资料长度（${source.length}），请使用上一页的 nextOffset。`)
      const envelope = (data: string | string[]) => ({ reference, offset, total: source!.length,
        nextOffset: offset + data.length, hasMore: offset + data.length < source!.length, data })
      let data: string | string[]
      if (typeof source === 'string') {
        data = fitText(source.slice(offset), part => estimateContextTokens(JSON.stringify(envelope(part))) <= (skillContent ? SKILL_RESULT_TOKEN_BUDGET : 2000))
      } else {
        data = []
        for (let index = offset; index < source.length; index++) {
          const ref = source[index]
          if (estimateContextTokens(JSON.stringify(envelope([...data, ref]))) > 2000) break
          data.push(ref)
        }
      }
      if (!data.length && offset < source.length) throw new Error('单个选区引用超过分页预算，无法完整返回；请检查引用长度。')
      return archiveToolResult(manager, { content: [{ type: 'text', text: JSON.stringify(envelope(data)) }], details: undefined }, skillContent)
    },
  }
}

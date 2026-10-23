import { z } from 'zod'
import { defineApplicationCapability, capabilityControl } from '../shared/defineApplicationCapability'
import { memoryWriteSchema } from '../../../assistant/memoryOperations'
import { MEMORY_RULES } from '../../../assistant/memoryEntries'
const root = { kind: 'assistant.memory_settings', id: 'singleton' }
const outputSchema = z.object({ resultRef: z.object({ kind: z.literal('assistant.memory_settings'), id: z.literal('singleton') }), changed: z.number().int().nonnegative(), message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string() }).strict() }).strict()
const common = { version: 1, aliases: ['助手记忆'], domain: 'memory', readOnly: false, risk: 'R1' as const, dataClasses: ['C1' as const], permission: 'settings:write' as const, idempotent: false, destructive: false, timeoutMs: 60000, supportsPreview: false, supportsUndo: false, requiredScopes: ['assistant_memory'], producesRefs: [root.kind], outputSchema,
  resolveConcurrencyKey: () => 'assistant:memory', resolveOperationTargets: () => [root], resolveOperationWriteTargets: () => [root],
  control: capabilityControl('execute', [root.kind], { revisionScopes: ['assistant_memory'] }),
  summarize: (output: z.infer<typeof outputSchema>) => output.message,
}
export const revertAssistantMemoryCapability = defineApplicationCapability({ ...common,
  id: 'revert_assistant_memory', title: '撤回记忆修改', description: '根据修改历史中的 historyId 撤回一次修改；撤回本身进入历史。若同一条记忆后来又修改过会拒绝覆盖，先重读合并。关闭记忆时不可用。',
  inputSchema: z.object({ historyId: z.string().min(1) }).strict(),
})
export const organizeAssistantMemoryCapability = defineApplicationCapability({ ...common,
  id: 'organize_assistant_memory', title: '整理记忆', description: `读取三层记忆后合并重复、压缩措辞、删除已明确过时的偏好；只在至少两个不同项目出现相同偏好时提升全局。提供按条目基线生成的 changes，所有改动逐条校验并记历史；不提供 changes 时仅去除完全重复。不要从一次使用推断或把项目事实提升全局。${MEMORY_RULES}`,
  inputSchema: z.object({ changes: z.array(memoryWriteSchema).max(100).optional() }).strict(),
})
export const MEMORY_CAPABILITIES = [revertAssistantMemoryCapability, organizeAssistantMemoryCapability]

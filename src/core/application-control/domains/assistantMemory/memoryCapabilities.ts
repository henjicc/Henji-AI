import { z } from 'zod'
import { defineApplicationCapability, capabilityControl } from '../shared/defineApplicationCapability'
import { memoryWriteSchema } from '../../../assistant/memoryOperations'
import { MEMORY_RULES } from '../../../assistant/memoryEntries'
const root = { kind: 'assistant.memory_settings', id: 'singleton' }
const outputSchema = z.object({ resultRef: z.object({ kind: z.literal('assistant.memory_settings'), id: z.literal('singleton') }), changed: z.number().int().nonnegative(), message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string() }).strict() }).strict()
const common = { version: 1, aliases: ['助手记忆'], domain: 'memory', readOnly: false, dataClasses: ['C1' as const], idempotent: false, destructive: false, timeoutMs: 60000, supportsPreview: false, supportsUndo: false, requiredScopes: ['assistant_memory'], producesRefs: [root.kind], outputSchema,
  resolveConcurrencyKey: () => 'assistant:memory', resolveOperationTargets: () => [root], resolveOperationWriteTargets: () => [root],
  control: capabilityControl('execute', [root.kind], { revisionScopes: ['assistant_memory'] }),
  summarize: (output: z.infer<typeof outputSchema>) => output.message,
}
export const revertAssistantMemoryCapability = defineApplicationCapability({ ...common,
  id: 'revert_assistant_memory', title: '撤回记忆修改', description: '根据修改历史中的 historyId 撤回一次修改；撤回本身进入历史。若同一条记忆后来又修改过会拒绝覆盖，先重读合并。关闭记忆时不可用。',
  inputSchema: z.object({ historyId: z.string().min(1) }).strict(),
})
export const organizeAssistantMemoryCapability = defineApplicationCapability({ ...common,
  id: 'organize_assistant_memory', title: '整理记忆', description: `读取三层记忆后合并重复、压缩措辞、删除已明确过时的偏好；只在至少两个不同项目出现相同偏好时提升全局。提供按条目基线生成的 changes，所有改动逐条校验并记历史；不提供 changes 时仅去除完全重复。普通新增/修改偏好优先用通用集合/属性，不要为单条记忆绕到整理入口。changes 每项必须有 target、id、expectedRevision、entry、actor、reason；新增 expectedRevision=0，修改/删除取原条目 revision。target={layer:"project",ownerId:正式项目ID}（不是文档ID/路径）；项目/风格 entry 禁止 section 与 precedence，全局 entry 必须含 section，actor/source 均为 assistant，删除 entry=null。参数校验失败表示未执行，按报错字段修正后用新 operationId 重试。不要从一次使用推断或把项目事实提升全局。${MEMORY_RULES}`,
  inputSchema: z.object({ changes: z.array(memoryWriteSchema).max(100).optional() }).strict(),
})
export const MEMORY_CAPABILITIES = [revertAssistantMemoryCapability, organizeAssistantMemoryCapability]

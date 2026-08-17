import {
  applicationCapabilityDiscoveryInputSchema,
  applicationCapabilityDiscoveryOutputSchema,
  applicationSchemaReadInputSchema,
  applicationSchemaReadOutputSchema,
} from '../capabilityDiscovery'
import type { ApplicationCapabilityDefinition } from '../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from './defineApplicationCapability'
import {
  CAPABILITY_DISCOVERY_HISTORY_OMITTED_KEYS,
  omitRecordKeys,
  trimScriptApiDuplication,
} from './historyProjection'

const schemaRefAiSchema = {
  type: 'object',
  properties: {
    catalogVersion: { type: 'string' },
    kind: { type: 'string', enum: ['operation'] },
    id: { type: 'string' },
    version: { type: 'integer', minimum: 1 },
    digest: { type: 'string' },
  },
  required: ['catalogVersion', 'kind', 'id', 'version', 'digest'],
  additionalProperties: false,
}

export const discoverApplicationCapabilitiesCapability = defineApplicationCapability({
  id: 'discover_application_capabilities',
  version: 1,
  title: '批量发现应用能力',
  description: '按任务 Facet 一次发现跨领域操作、实体关联、目标界面和稳定输入 schema 引用。',
  domain: 'catalog',
  aliases: ['批量能力发现', '应用控制结构', '发现操作', 'discover capabilities'],
  side: 'backend',
  readOnly: true,
  control: capabilityControl('observe', ['application.capability', 'application.schema']),
  risk: 'R0',
  dataClasses: ['C0'],
  permission: 'catalog:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: [],
  prerequisites: ['已知道本次任务要读写哪些实体类型，或至少能用自然语言描述目标。'],
  acceptsRefs: [],
  producesRefs: ['application.capability', 'application.schema'],
  successEvidence: ['返回可用能力与 scriptApi 投影，或给出明确缺失原因与稳定 schemaRef。'],
  failureRecovery: ['缺失能力时停止换词搜索；根据缺失领域向用户说明，或等待应用升级。'],
  inputSchema: applicationCapabilityDiscoveryInputSchema,
  outputSchema: applicationCapabilityDiscoveryOutputSchema,
  aiInputSchema: {
    type: 'object',
    properties: {
      queries: {
        type: 'array', minItems: 1, maxItems: 8, items: { type: 'string' },
        description: '用自然语言描述本次任务要做的事，一条一个目标',
      },
      domains: {
        type: 'array', maxItems: 8, items: { type: 'string' },
        description: '领域，例如 camera_stage / canvas / settings。这是唯一的硬准入条件',
      },
      entityTypes: {
        type: 'array', maxItems: 24, items: { type: 'string' },
        description: '本次任务要读写的实体类型，形如 camera_stage.object。投影与排序的主信号',
      },
      writes: { type: 'boolean', description: '本轮是否会写入；只读任务填 false 可显著压缩返回体积' },
      cursor: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
    },
    required: ['queries'],
    additionalProperties: false,
  },
  concurrencyKey: 'catalog:discover',
  parallelSafe: true,
  resolveConcurrencyKey: (input) => `catalog:discover:${[...input.domains].sort().join(',')}`,
  summarize: (output) => (
    `返回 ${output.capabilities.length} 项能力`
    + `${output.missing.length > 0 ? '，未命中任何能力' : ''}${output.reused ? '（复用缓存）' : ''}。`
  ),
  /*
   * 发现结果是整次运行里最大的一条工具结果（实测单条 29.9KB = 那次运行对话历史的 38%），
   * 而它体积的大头恰好是**同一轮 `tools` 参数已经发过一遍**的输入 schema。
   * 所以历史投影里把这部分剥掉，读取路径不受影响。
   */
  projectForHistory: (output) => ({
    ...output,
    capabilities: omitRecordKeys(output.capabilities, CAPABILITY_DISCOVERY_HISTORY_OMITTED_KEYS),
    scriptApi: trimScriptApiDuplication(output.scriptApi),
    note: '已租约能力的输入 schema 由本轮 tools 参数与 scriptApi 投影提供，本记录不再重复；'
      + '需要未租约能力的 schema 时用 read_application_schemas 读取。',
  }),
})

export const readApplicationSchemasCapability = defineApplicationCapability({
  id: 'read_application_schemas',
  version: 1,
  title: '读取应用能力结构',
  description: '按稳定 schemaRef 批量读取完整能力输入结构，不依赖目录摘要是否截断。',
  domain: 'catalog',
  aliases: ['读取能力参数', '读取输入结构', 'schemaRef', 'read schemas'],
  side: 'backend',
  readOnly: true,
  control: capabilityControl('observe', ['application.schema']),
  risk: 'R0',
  dataClasses: ['C0'],
  permission: 'catalog:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: [],
  prerequisites: ['schemaRef 必须来自当前目录版本的批量发现结果。'],
  acceptsRefs: ['application.schema'],
  producesRefs: ['application.schema'],
  successEvidence: ['返回 schemaRef 对应的完整 AI 输入 schema，无法解析的引用进入 missing。'],
  failureRecovery: ['目录版本或 digest 不匹配时重新执行一次批量发现，不猜测参数。'],
  inputSchema: applicationSchemaReadInputSchema,
  outputSchema: applicationSchemaReadOutputSchema,
  aiInputSchema: {
    type: 'object',
    properties: {
      refs: { type: 'array', minItems: 1, maxItems: 20, items: schemaRefAiSchema },
    },
    required: ['refs'],
    additionalProperties: false,
  },
  concurrencyKey: 'catalog:schema',
  parallelSafe: true,
  summarize: (output) => `已读取 ${output.documents.length} 份完整能力输入结构。`,
})

export const CAPABILITY_DISCOVERY_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  discoverApplicationCapabilitiesCapability,
  readApplicationSchemasCapability,
]


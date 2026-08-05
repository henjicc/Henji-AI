import {
  APPLICATION_CAPABILITY_DISCOVERY_VERSION,
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
  prerequisites: ['任务已拆分为一个或多个明确 Facet。'],
  acceptsRefs: ['agent.task_facet'],
  producesRefs: ['application.capability', 'application.schema'],
  successEvidence: ['每个 Facet 都返回命中或明确缺失原因，并提供稳定 schemaRef 与发现指纹。'],
  failureRecovery: ['缺失能力时停止换词搜索；根据缺失领域向用户说明，或等待应用升级。'],
  inputSchema: applicationCapabilityDiscoveryInputSchema,
  outputSchema: applicationCapabilityDiscoveryOutputSchema,
  aiInputSchema: {
    type: 'object',
    properties: {
      discoveryVersion: { type: 'string', const: APPLICATION_CAPABILITY_DISCOVERY_VERSION },
      facets: {
        type: 'array',
        minItems: 1,
        maxItems: 16,
        items: {
          type: 'object',
          properties: {
            facetId: { type: 'string' },
            queries: { type: 'array', maxItems: 8, items: { type: 'string' } },
            domains: { type: 'array', maxItems: 8, items: { type: 'string' } },
            entityTypes: { type: 'array', maxItems: 16, items: { type: 'string' } },
            capabilityKinds: {
              type: 'array', maxItems: 6,
              items: { type: 'string', enum: ['observe', 'query', 'plan', 'mutate', 'navigate', 'execute'] },
            },
            targetSurfaceIds: { type: 'array', maxItems: 8, items: { type: 'string' } },
          },
          required: ['facetId'],
          additionalProperties: false,
        },
      },
      cursor: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
    },
    required: ['facets'],
    additionalProperties: false,
  },
  concurrencyKey: 'catalog:discover',
  parallelSafe: true,
  resolveConcurrencyKey: (input) => `catalog:discover:${input.facets.map((facet) => facet.facetId).sort().join(',')}`,
  summarize: (output) => (
    `批量发现 ${output.facets.length} 个 Facet，返回 ${output.capabilities.length} 项能力`
    + `${output.missing.length > 0 ? `，${output.missing.length} 个 Facet 缺失` : ''}${output.reused ? '（复用缓存）' : ''}。`
  ),
  /*
   * 发现结果是整次运行里最大的一条工具结果（实测单条 29.9KB = 那次运行对话历史的 38%），
   * 而它体积的大头恰好是**同一轮 `tools` 参数已经发过一遍**的输入 schema：
   * `capabilities[].schemaRef` 3.7KB + `facets[].schemaRefs` 11.2KB，其中未被租约覆盖、
   * 也就是真正只能靠 `read_application_schemas` 取回的部分只有 12 字节。
   *
   * 所以 schemaRefs 按租约过滤而不是一刀切：已租约的工具模型这轮就拿着完整 schema，
   * 未租约（deferred）的才留下引用，读取路径不受影响。
   */
  projectForHistory: (output) => {
    const leased = new Set(output.leasedToolNames)
    return {
      ...output,
      capabilities: omitRecordKeys(output.capabilities, CAPABILITY_DISCOVERY_HISTORY_OMITTED_KEYS),
      facets: output.facets.map((facet) => ({
        ...facet,
        schemaRefs: facet.schemaRefs.filter((ref) => !leased.has(ref.id)),
      })),
      note: '已租约能力的输入 schema 由本轮 tools 参数提供，本记录不再重复；'
        + 'schemaRefs 只保留尚未租约的候选，需要时用 read_application_schemas 读取。',
    }
  },
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

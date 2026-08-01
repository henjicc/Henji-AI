import {
  APPLICATION_CAPABILITY_DISCOVERY_VERSION,
  applicationCapabilityDiscoveryInputSchema,
  applicationCapabilityDiscoveryOutputSchema,
  applicationSchemaReadInputSchema,
  applicationSchemaReadOutputSchema,
} from '../capabilityDiscovery'
import type { ApplicationCapabilityDefinition } from '../applicationCapabilities'
import { defineApplicationCapability } from './defineApplicationCapability'

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

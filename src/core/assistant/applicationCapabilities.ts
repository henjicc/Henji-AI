import { z } from 'zod'

import type { AgentDataClass, AgentToolRisk } from './toolContracts'

const applicationCapabilityRiskSchema = z.enum(['R0', 'R1', 'R2', 'R3', 'R4'])
const applicationCapabilityDataClassSchema = z.enum(['C0', 'C1', 'C2', 'C3'])

export const APPLICATION_CAPABILITY_CATALOG_VERSION = 'application-capabilities/v1' as const

export const applicationRefSchema = z.object({
  kind: z.string().regex(/^[a-z][a-z0-9_.-]{1,63}$/),
  id: z.string().min(1).max(500),
  revision: z.number().int().nonnegative().optional(),
  label: z.string().min(1).max(200).optional(),
}).strict()
export type ApplicationRef = z.infer<typeof applicationRefSchema>

export const applicationCapabilityDescriptorSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  version: z.number().int().positive(),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(1_000),
  domain: z.string().regex(/^[a-z][a-z0-9_.-]{1,63}$/),
  aliases: z.array(z.string().min(1).max(120)).max(20),
  side: z.enum(['frontend', 'backend']),
  readOnly: z.boolean(),
  risk: applicationCapabilityRiskSchema,
  dataClasses: z.array(applicationCapabilityDataClassSchema).min(1).max(4),
  permission: z.string().min(1).max(120),
  idempotent: z.boolean(),
  destructive: z.boolean(),
  timeoutMs: z.number().int().positive().max(10 * 60 * 1_000),
  supportsPreview: z.boolean(),
  supportsUndo: z.boolean(),
  concurrencyKey: z.string().min(1).max(120),
  requiredScopes: z.array(z.string().min(1).max(120)).max(16),
  availability: z.array(z.string().min(1).max(300)).max(12),
  prerequisites: z.array(z.string().min(1).max(500)).max(12),
  acceptsRefs: z.array(z.string().min(1).max(80)).max(12),
  producesRefs: z.array(z.string().min(1).max(80)).max(12),
  successEvidence: z.array(z.string().min(1).max(500)).min(1).max(12),
  failureRecovery: z.array(z.string().min(1).max(500)).min(1).max(12),
  available: z.boolean().default(true),
}).strict()
export type ApplicationCapabilityDescriptor = z.infer<typeof applicationCapabilityDescriptorSchema>

export interface ApplicationCapabilityDefinition<TInput = unknown, TOutput = unknown>
  extends Omit<ApplicationCapabilityDescriptor, 'available'> {
  inputSchema: z.ZodType<TInput>
  outputSchema: z.ZodType<TOutput>
  aiInputSchema: Record<string, unknown>
}

export class ApplicationCapabilityRegistry {
  private readonly definitions = new Map<string, ApplicationCapabilityDefinition>()

  register<TInput, TOutput>(
    definition: ApplicationCapabilityDefinition<TInput, TOutput>
  ): void {
    const {
      inputSchema,
      outputSchema,
      aiInputSchema,
      ...descriptor
    } = definition
    applicationCapabilityDescriptorSchema.parse({ ...descriptor, available: true })
    if (
      typeof inputSchema?.safeParse !== 'function'
      || typeof outputSchema?.safeParse !== 'function'
      || !aiInputSchema
      || typeof aiInputSchema !== 'object'
    ) {
      throw new Error(`应用能力 schema 无效：${definition.id}`)
    }
    const current = this.definitions.get(definition.id)
    if (current) {
      const reason = current.version === definition.version ? '重复 ID' : '版本冲突'
      throw new Error(`应用能力${reason}：${definition.id}@${current.version}/${definition.version}`)
    }
    this.definitions.set(
      definition.id,
      definition as unknown as ApplicationCapabilityDefinition
    )
  }

  get(id: string): ApplicationCapabilityDefinition | undefined {
    return this.definitions.get(id)
  }

  list(): ApplicationCapabilityDefinition[] {
    return [...this.definitions.values()]
  }

  descriptors(): ApplicationCapabilityDescriptor[] {
    return this.list().map((definition) => {
      const {
        inputSchema: _inputSchema,
        outputSchema: _outputSchema,
        aiInputSchema: _aiInputSchema,
        ...descriptor
      } = definition
      return applicationCapabilityDescriptorSchema.parse({
        ...descriptor,
        available: true,
      })
    })
  }
}

export const applicationCapabilityInvocationSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  version: z.number().int().positive(),
  input: z.unknown(),
  expectedRevisions: z.record(z.string(), z.number().int().nonnegative()).optional(),
}).strict()
export type ApplicationCapabilityInvocation = z.infer<typeof applicationCapabilityInvocationSchema>

export const applicationCapabilitySearchResultSchema = z.object({
  catalogVersion: z.literal(APPLICATION_CAPABILITY_CATALOG_VERSION),
  capabilities: z.array(applicationCapabilityDescriptorSchema),
  addedToolNames: z.array(z.string().min(1)).max(20),
  nextCursor: z.number().int().nonnegative().nullable(),
}).strict()

export interface ApplicationCapabilityCompatibilityInput {
  id: string
  version: number
  title: string
  description: string
  domain: string
  side: 'frontend' | 'backend'
  readOnly: boolean
  risk: AgentToolRisk
  permission: string
  idempotent: boolean
  destructive: boolean
  timeoutMs: number
  supportsPreview: boolean
  supportsUndo: boolean
  requiredScopes: string[]
  availability?: string[]
  concurrencyKey?: string
  prerequisites: string[]
  successEvidence: string[]
  failureRecovery: string[]
  dataClasses?: AgentDataClass[]
  aliases?: string[]
  acceptsRefs?: string[]
  producesRefs?: string[]
}

/** 迁移期把旧 Agent 工具转换成统一能力描述；新能力应直接提供完整定义。 */
export function createCompatibilityCapabilityDescriptor(
  input: ApplicationCapabilityCompatibilityInput
): ApplicationCapabilityDescriptor {
  return applicationCapabilityDescriptorSchema.parse({
    ...input,
    aliases: input.aliases ?? [],
    dataClasses: input.dataClasses ?? ['C0'],
    acceptsRefs: input.acceptsRefs ?? [],
    producesRefs: input.producesRefs ?? [],
    availability: input.availability ?? input.requiredScopes.map((scope) => `${scope} 作用域可用`),
    concurrencyKey: input.concurrencyKey ?? input.domain,
    available: true,
  })
}

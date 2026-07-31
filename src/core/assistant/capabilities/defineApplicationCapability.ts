import { z } from 'zod'

import type {
  ApplicationCapabilityDefinition,
} from '../applicationCapabilities'

type CapabilityDefaults = 'side'
  | 'availability'
  | 'concurrencyKey'
  | 'completionKind'
  | 'parallelSafe'
  | 'prerequisites'
  | 'acceptsRefs'
  | 'producesRefs'
  | 'successEvidence'
  | 'failureRecovery'
  | 'aiInputSchema'

export type ApplicationCapabilitySpec<TInput, TOutput> =
  Omit<ApplicationCapabilityDefinition<TInput, TOutput>, CapabilityDefaults> & {
    side?: 'frontend' | 'backend'
    availability?: string[]
    concurrencyKey?: string
    completionKind?: 'executed' | 'submitted' | 'observed'
    parallelSafe?: boolean
    prerequisites?: string[]
    acceptsRefs?: string[]
    producesRefs?: string[]
    successEvidence?: string[]
    failureRecovery?: string[]
    aiInputSchema?: Record<string, unknown>
  }

function inputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, {
    target: 'draft-7',
    io: 'input',
  }) as Record<string, unknown>
  const { $schema: _schema, ...result } = generated
  return result
}

export function defineApplicationCapability<TInput, TOutput>(
  specification: ApplicationCapabilitySpec<TInput, TOutput>
): ApplicationCapabilityDefinition<TInput, TOutput> {
  return {
    ...specification,
    side: specification.side ?? 'frontend',
    availability: specification.availability
      ?? specification.requiredScopes.map((scope) => `${scope} 作用域可用`),
    concurrencyKey: specification.concurrencyKey ?? specification.domain,
    completionKind: specification.completionKind
      ?? (specification.readOnly ? 'observed' : 'executed'),
    parallelSafe: specification.parallelSafe ?? specification.readOnly,
    prerequisites: specification.prerequisites ?? ['应用宿主已就绪。'],
    acceptsRefs: specification.acceptsRefs ?? [],
    producesRefs: specification.producesRefs ?? [],
    successEvidence: specification.successEvidence
      ?? [`${specification.title}返回通过输出 schema 校验的结果。`],
    failureRecovery: specification.failureRecovery
      ?? ['重新读取当前应用状态或目标引用后再试；禁止猜测实体名称。'],
    aiInputSchema: specification.aiInputSchema ?? inputJsonSchema(specification.inputSchema),
  }
}

export const capabilityRevisionShape = {
  revision: z.number().int().nonnegative(),
  scopeRevisions: z.record(z.string(), z.number().int().nonnegative()),
}

export function capabilityOutputSchema<TShape extends z.ZodRawShape>(
  shape: TShape
): z.ZodObject<TShape & typeof capabilityRevisionShape> {
  return z.object({ ...shape, ...capabilityRevisionShape }).passthrough()
}

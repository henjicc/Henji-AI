import { z } from 'zod'

import type {
  ApplicationCapabilityDefinition,
} from '../applicationCapabilities'
import type { AgentObservedEffect } from '../taskGraph'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function directResultRefs(output: unknown): Array<{ kind: string; id: string }> {
  const record = asRecord(output)
  const refs = Array.isArray(record?.resultRefs) ? record.resultRefs : []
  const result = refs.flatMap((value) => {
    const ref = asRecord(value)
    return typeof ref?.kind === 'string' && typeof ref.id === 'string'
      ? [{ kind: ref.kind, id: ref.id }]
      : []
  })
  for (const key of ['ref', 'sourceRef', 'resultRef']) {
    const ref = asRecord(record?.[key])
    if (typeof ref?.kind === 'string' && typeof ref.id === 'string') {
      result.push({ kind: ref.kind, id: ref.id })
    }
  }
  const surfaceId = record?.surfaceId
  if (typeof surfaceId === 'string' && surfaceId.trim()) {
    result.push({ kind: 'application.surface', id: surfaceId })
  }
  const workspace = record?.workspace ?? record?.workspaceId
  if (typeof workspace === 'string' && workspace.trim()) {
    result.push({
      kind: 'application.surface',
      id: workspace.includes('.') ? workspace : `workspace.${workspace}`,
    })
  }
  return result
}

export function directOnlyObservedEffects<TOutput>(
  control: ApplicationCapabilityDefinition['control']
): (_input: unknown, output: TOutput) => AgentObservedEffect[] {
  return (_input, output) => {
    const targetRefs = directResultRefs(output)
    return control.impacts.map((impact) => ({
      effect: impact.effect,
      entityTypes: impact.entityTypes,
      propertyIds: impact.propertyIds,
      targetRefs,
      count: Math.max(1, targetRefs.length),
      verified: impact.effect === 'observe',
      evidence: [],
    }))
  }
}

export function capabilityControl(
  effect: ApplicationCapabilityDefinition['control']['impacts'][number]['effect'],
  entityTypes: string[],
  options: {
    propertyIds?: string[]
    revisionScopes?: string[]
    verificationRequired?: boolean
    mode?: ApplicationCapabilityDefinition['control']['execution']['mode']
    cancelable?: boolean
    resultState?: ApplicationCapabilityDefinition['control']['execution']['resultState']
    /**
     * 同一次调用真正产生的其他 effect。
     *
     * 一条能力只声明一个 effect 是个隐患：Facet 结算按 effect 对账，声明漏了就永远对不上——
     * 模型做完了活，任务图却停在"未结算"，只能反复重试。发现层排序也按 effect 走，漏声明的
     * 能力会排到无关能力后面。宁可多写一条，也不要让"做了"和"声明会做"对不上。
     */
    alsoImpacts?: {
      effect: ApplicationCapabilityDefinition['control']['impacts'][number]['effect']
      entityTypes: string[]
      propertyIds?: string[]
    }[]
  } = {}
): ApplicationCapabilityDefinition['control'] {
  const revisionScopes = options.revisionScopes ?? []
  return {
    execution: {
      mode: options.mode ?? 'immediate',
      cancelable: options.cancelable ?? false,
      resultState: options.resultState ?? (effect === 'observe' ? 'observed' : 'completed'),
    },
    impacts: [
      {
        effect,
        entityTypes,
        propertyIds: options.propertyIds ?? [],
        revisionScopes,
        verificationRequired: options.verificationRequired ?? !['observe', 'navigate'].includes(effect),
      },
      ...(options.alsoImpacts ?? []).map((impact) => ({
        effect: impact.effect,
        entityTypes: impact.entityTypes,
        propertyIds: impact.propertyIds ?? [],
        revisionScopes,
        verificationRequired: !['observe', 'navigate'].includes(impact.effect),
      })),
    ],
  }
}

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
  | 'verificationContract'

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
    verificationContract?: ApplicationCapabilityDefinition['verificationContract']
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
    verificationContract: specification.verificationContract ?? (
      specification.readOnly || specification.control.impacts.every((impact) => (
        ['observe', 'navigate'].includes(impact.effect)
      ))
        ? undefined
        : {
            kind: 'effect_receipt' as const,
            requireEffects: true,
            requireVerifiedEffects: false,
          }
    ),
    resolveObservedEffects: specification.resolveObservedEffects
      ?? (specification.control.impacts.length > 0
        ? directOnlyObservedEffects<TOutput>(specification.control)
        : undefined),
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

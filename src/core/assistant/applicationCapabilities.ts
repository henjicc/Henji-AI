import { z } from 'zod'

import {
  applicationOperationExecutionSchema,
  applicationOperationImpactSchema,
  applicationRefSchema,
  type ApplicationOperationExecution,
  type ApplicationOperationImpact,
  type ApplicationRef,
} from '../application-control'

import type {
  AgentDataClass,
  AgentToolObservation,
  AgentToolPreview,
} from './toolContracts'
import type { HostScope } from './hostContracts'
import type { AgentObservedEffect } from './taskGraph'
import { AGENT_DISCOVERY_LEASE_TOOL_LIMIT } from './toolBudget'

const applicationCapabilityRiskSchema = z.enum(['R0', 'R1', 'R2', 'R3', 'R4'])
const applicationCapabilityDataClassSchema = z.enum(['C0', 'C1', 'C2', 'C3'])

export const APPLICATION_CAPABILITY_CATALOG_VERSION = 'application-capabilities/v2' as const
export { applicationRefSchema }
export type { ApplicationRef }

export interface ApplicationCapabilityVerificationContract {
  /** 第一版统一以 Gateway 观察到的强类型 Effect Receipt 作为最低可执行验证。 */
  kind: 'effect_receipt'
  /** 写能力必须至少产生一项非 observe/navigate 的真实 Effect。 */
  requireEffects: boolean
  /** 只有领域执行器已经完成正式读回时才可要求；其余由脚本后续正式验证完成。 */
  requireVerifiedEffects: boolean
}

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
  openWorld: z.boolean().optional(),
  retryPolicy: z.object({
    maxRetries: z.number().int().min(0).max(3),
    baseDelayMs: z.number().int().nonnegative().max(30_000),
  }).strict().optional(),
  maxCallsPerRun: z.number().int().positive().optional(),
  available: z.boolean().default(true),
  control: z.object({
    execution: applicationOperationExecutionSchema,
    impacts: z.array(applicationOperationImpactSchema).min(1).max(32),
  }).strict(),
}).strict()
export type ApplicationCapabilityDescriptor = z.infer<typeof applicationCapabilityDescriptorSchema>

export interface ApplicationCapabilityDefinition<TInput = unknown, TOutput = unknown>
  extends Omit<ApplicationCapabilityDescriptor, 'available' | 'control'> {
  inputSchema: z.ZodType<TInput>
  outputSchema: z.ZodType<TOutput>
  aiInputSchema: Record<string, unknown>
  completionKind?: 'executed' | 'submitted' | 'observed'
  parallelSafe?: boolean
  /**
   * 输入决定实际写入领域时，按已通过 schema 的输入解析乐观并发作用域。
   * 典型场景是通用实体动词：它本身属于 application，但一次调用只会修改
   * toolbox、canvas、assets 或 settings 中的一个或几个领域。
   */
  resolveRequiredScopes?(input: TInput): HostScope[]
  resolveConcurrencyKey?(input: TInput): string
  resolveTargetIds?(input: TInput): Record<string, string>
  resolveDataClasses?(output: TOutput): AgentDataClass[]
  summarize?(output: TOutput): string
  /**
   * 结果写入对话历史时的投影。
   *
   * 只影响那条 `role:'tool'` 消息。observation 本体、Effect Ledger、Facet 结算、卸载判定读的
   * 都是完整 output，不受影响；未声明本钩子的能力按原样内联，行为与声明前逐字节一致。
   *
   * 存在的理由：实测一次三维任务里，`discover_application_capabilities` 一条 29.9KB、
   * `describe_application_entities` 一条 15.5KB，两条就吃掉整次运行对话历史的 58%，而里面
   * 占大头的是每轮 `tools` 参数已经带过的输入 schema，以及权限、暴露面、数据分级这些由网关
   * 强制执行、模型压根无法行动的字段。事后再去历史里清理要作废缓存前缀（实测回本需 ~6 轮，
   * 而一次运行只有 ~13 轮），所以只能在写入前就不放进去。
   */
  projectForHistory?(output: TOutput): unknown
  /**
   * 示例调用，渲染进模型看到的工具描述。
   *
   * JSON Schema 表达不了"什么时候该填这个可选字段""嵌套结构长什么样""几个参数之间怎么配合"，
   * 而这些恰恰是模型最容易写错的地方。Anthropic 实测：给工具补上示例调用后，复杂参数场景的
   * 准确率从 72% 升到 90%。
   *
   * 只写**真实可用**的调用：它会被模型当成范本照抄。
   *
   * 类型是 `unknown[]` 而不是 `TInput[]`：示例是给模型看的文档，写的是**模型该发什么**，
   * 而 TInput 是 schema 解析**之后**的类型（默认值全部填好）。用 TInput 会逼着每个示例把
   * propertyIds、targetRefs 这类有默认值的字段全写一遍，示例反而比真实调用还啰嗦。
   */
  inputExamples?: unknown[]
  /**
   * 受控应用程序在调用本能力前必须已经成功执行的能力 ID。
   *
   * 这是机器可读的执行前置，不是给模型看的提示词。程序编译器据此拒绝把“提交生成”
   * 放在“校验生成参数”之前；普通直接工具调用仍由各自现有守卫负责。
   */
  executionPrerequisites?: string[]
  /**
   * 算法型写能力的机器可执行验证下限。注册表会拒绝缺失该契约的写能力；
   * 文本 successEvidence 不能替代它。
   */
  verificationContract?: ApplicationCapabilityVerificationContract
  /**
   * 决定一次已返回结构化结果的调用是否消耗 maxCallsPerRun。
   * 仅用于“零副作用的编译/预检拒绝可安全修正”这类受控入口；默认所有结果都计数。
   */
  countsTowardCallLimit?(output: TOutput): boolean
  preview?(input: TInput): AgentToolPreview
  createUndo?(output: TOutput): AgentToolObservation['undo']
  resolveObservedEffects?(input: TInput, output: TOutput): AgentObservedEffect[]
  control: {
    execution: ApplicationOperationExecution
    impacts: ApplicationOperationImpact[]
  }
}

/**
 * 定义里**不属于描述符**的键，唯一来源。
 *
 * `applicationCapabilityDescriptorSchema` 是 strict 的，任何没被剥掉的键都会让注册当场抛错。
 * 此前 `register()` 和 `descriptors()` 各写一份解构，新增 `projectForHistory` 和 `inputExamples`
 * 时都只改到了其中一处——同一个坑连踩两次。收成一张表，两处共用，就不会再漂移。
 */
const NON_DESCRIPTOR_KEYS = [
  'inputSchema',
  'outputSchema',
  'aiInputSchema',
  'completionKind',
  'parallelSafe',
  'resolveRequiredScopes',
  'resolveConcurrencyKey',
  'resolveTargetIds',
  'resolveDataClasses',
  'summarize',
  'projectForHistory',
  'inputExamples',
  'executionPrerequisites',
  'verificationContract',
  'countsTowardCallLimit',
  'preview',
  'createUndo',
  'resolveObservedEffects',
] as const satisfies readonly (keyof ApplicationCapabilityDefinition)[]

function toDescriptorInput(definition: ApplicationCapabilityDefinition): Record<string, unknown> {
  const removed = new Set<string>(NON_DESCRIPTOR_KEYS)
  return Object.fromEntries(
    Object.entries(definition as unknown as Record<string, unknown>)
      .filter(([key]) => !removed.has(key))
  )
}

export class ApplicationCapabilityRegistry {
  private readonly definitions = new Map<string, ApplicationCapabilityDefinition>()

  register<TInput, TOutput>(
    definition: ApplicationCapabilityDefinition<TInput, TOutput>
  ): void {
    const { inputSchema, outputSchema, aiInputSchema } = definition
    applicationCapabilityDescriptorSchema.parse({
      ...toDescriptorInput(definition as unknown as ApplicationCapabilityDefinition),
      available: true,
    })
    if (
      typeof inputSchema?.safeParse !== 'function'
      || typeof outputSchema?.safeParse !== 'function'
      || !aiInputSchema
      || typeof aiInputSchema !== 'object'
    ) {
      throw new Error(`应用能力 schema 无效：${definition.id}`)
    }
    if (aiInputSchema.additionalProperties !== false) {
      throw new Error(`应用能力 AI schema 必须拒绝未声明字段：${definition.id}`)
    }
    const properties = aiInputSchema.properties
    if (properties && typeof properties === 'object') {
      const forbiddenInputs = ['patch', 'storePatch', 'executeScript', 'script', 'code', 'source']
      const forbidden = forbiddenInputs.find((key) => key in properties)
      if (forbidden && !(definition.id === 'run_henji_script' && forbidden === 'source')) {
        throw new Error(`应用能力禁止任意 Patch 或脚本输入：${definition.id}.${forbidden}`)
      }
    }
    const reportsDirectEffect = definition.control.impacts.some((impact) => (
      impact.effect !== 'observe'
    ))
    if (!definition.readOnly && reportsDirectEffect && typeof definition.resolveObservedEffects !== 'function') {
      throw new Error(`写入或导航能力必须提供结构化 Effect resolver：${definition.id}`)
    }
    const reportsWorldMutation = definition.control.impacts.some((impact) => (
      !['observe', 'navigate'].includes(impact.effect)
    ))
    if (!definition.readOnly && reportsWorldMutation && !definition.verificationContract) {
      throw new Error(`算法写能力必须提供机器可执行 verificationContract：${definition.id}`)
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
      return applicationCapabilityDescriptorSchema.parse({
        ...toDescriptorInput(definition),
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
  leasedToolNames: z.array(z.string().min(1)).max(AGENT_DISCOVERY_LEASE_TOOL_LIMIT),
  deferredCount: z.number().int().nonnegative(),
  nextCursor: z.number().int().nonnegative().nullable(),
}).strict()

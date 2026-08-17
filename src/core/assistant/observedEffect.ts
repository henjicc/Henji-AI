import { z } from 'zod'

/**
 * 世界变化的结构化描述——**观察到的事实**，不是计划。
 *
 * 这些类型从已删除的 `taskGraph.ts` 里抽出来。任务图那套（Facet、requiredEffects、
 * Action Group、结算）是运行前对任务的预测，被整体删除；而"一次调用真的改了什么"
 * 是工具返回的事实，能力定义、脚本解释器、封存与前端展示都靠它，必须留下。
 *
 * 判据很清楚：这个文件里只允许放**执行之后才知道的东西**。任何"执行之前就断言该发生
 * 什么"的结构不属于这里，那正是被删掉的那一套。
 */

/** 单条 Effect 能带的实体类型数量上限。 */
export const AGENT_EFFECT_ENTITY_TYPE_LIMIT = 16

export const agentEffectKindSchema = z.enum([
  'observe',
  'create',
  'update',
  'delete',
  'navigate',
  'execute',
])
export type AgentEffectKind = z.infer<typeof agentEffectKindSchema>

/**
 * 改变了世界的 Effect。`observe` 与 `navigate` 不在其中。
 *
 * 判据是"用户撤销这次运行时有没有东西要还原"：读一遍数据没有，切一次页面也没有——
 * 界面位置由用户自己随时可改，不是助手留下的痕迹。
 */
const MUTATING_EFFECT_KINDS = new Set<AgentEffectKind>(['create', 'update', 'delete', 'execute'])

/**
 * 这条 Effect 是不是真的改了东西。
 *
 * **唯一判别入口**，封存摘要与 CLI 验收必须共用它。分头写 `effect !== 'observe'` 之类的判断
 * 就会漂移，而漂移的方向恰恰是把只读当成写入——实测一次纯只读的工具箱查询（8 段脚本全是
 * `entities.read` / `entities.list`）被封存摘要报成"已完成 14 项应用写入"，
 * 同时让 `--require-verified-write` 这条验收门被一次没有任何写入的运行满足。
 */
export function isMutatingEffect(effect: { effect: AgentEffectKind }): boolean {
  return MUTATING_EFFECT_KINDS.has(effect.effect)
}

/** 能力的动作类别。只用于能力发现的排序与可达性门禁，不参与任何执行判定。 */
export const agentCapabilityKindSchema = z.enum([
  'observe',
  'query',
  'plan',
  'mutate',
  'navigate',
  'execute',
])
export type AgentCapabilityKind = z.infer<typeof agentCapabilityKindSchema>

export const agentEffectTargetSchema = z.object({
  kind: z.string().min(1).max(128),
  id: z.string().min(1).max(500),
}).strict()

export const agentObservedEffectSchema = z.object({
  effect: agentEffectKindSchema,
  entityTypes: z.array(z.string().min(1).max(128)).max(AGENT_EFFECT_ENTITY_TYPE_LIMIT),
  propertyIds: z.array(z.string().min(1).max(128)).max(128),
  targetRefs: z.array(agentEffectTargetSchema).max(128),
  count: z.number().int().min(1).max(256),
  /** 写入后是否有独立的正式状态源读回证据。由解释器逐属性比对后置位。 */
  verified: z.boolean(),
  evidence: z.array(z.string().min(1).max(500)).max(12),
}).strict()
export type AgentObservedEffect = z.infer<typeof agentObservedEffectSchema>

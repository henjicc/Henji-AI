import { z } from 'zod'

import { hostScopeRevisionsSchema } from './hostContracts'
import { AGENT_DISCOVERY_LEASE_TOOL_LIMIT } from './toolBudget'

export const AGENT_WORKING_SUMMARY_VERSION = 'agent-working-summary/v1' as const

/**
 * 工作摘要里单条步骤的文本上限。**构造方必须按这两个数截断，不能只靠 schema 校验兜底。**
 *
 * 它们从字面量提成常量，是因为 schema 与构造方分家踩过一次硬伤：`failActiveStep` 直接拼
 * `${code}: ${message}` 不截断，而拒绝消息为了"能被自我修正"要列出该实体全部可用属性——
 * 三维场景光外观就 24 项，拼出来超过 1000 字符，于是**构造失败记录这一步自己抛 ZodError**，
 * 一次本该可自纠的工具拒绝变成整次运行 RunFailed，连 `ToolFailed` 事件都没发出来。
 * 比原来那句光秃秃的错误码还糟。
 *
 * 成功路径同样中过招：`ToolCompleted.summary` 允许 2000 字符，这里只允许 1000，
 * 一次**成功**的工具调用只要摘要够长就能把运行打死。
 */
export const AGENT_WORKING_STEP_SUMMARY_MAX = 1_000
export const AGENT_WORKING_STEP_EVIDENCE_MAX = 500

export const agentWorkingStepSchema = z.object({
  stepId: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  status: z.enum(['active', 'completed', 'failed']),
  toolName: z.string().min(1).max(200).nullable(),
  toolCategory: z.string().min(1).max(100).nullable(),
  readOnly: z.boolean().nullable(),
  idempotent: z.boolean().nullable(),
  summary: z.string().max(AGENT_WORKING_STEP_SUMMARY_MAX),
  evidence: z.array(z.string().min(1).max(AGENT_WORKING_STEP_EVIDENCE_MAX)).max(8),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
}).strict()
export type AgentWorkingStep = z.infer<typeof agentWorkingStepSchema>

/** 见 `AGENT_WORKING_STEP_SUMMARY_MAX`：构造方必须按它截断，不能靠 schema 抛异常兜底。 */
export const AGENT_WORKING_EVIDENCE_SUMMARY_MAX = 1_000

export const agentWorkingEvidenceSchema = z.object({
  source: z.string().min(1).max(200),
  summary: z.string().min(1).max(AGENT_WORKING_EVIDENCE_SUMMARY_MAX),
  references: z.record(z.string(), z.string().max(500)),
  observedAt: z.string().datetime(),
}).strict()
export type AgentWorkingEvidence = z.infer<typeof agentWorkingEvidenceSchema>

export const agentPendingApprovalSummarySchema = z.object({
  approvalId: z.string().min(1),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  expiresAt: z.string().datetime(),
}).strict()

export const agentWorkingRecoverySchema = z.object({
  mode: z.enum(['none', 'resume_read_only', 'verify_before_write', 'await_user']),
  reason: z.string().max(1_000),
  toolName: z.string().min(1).max(200).nullable(),
  toolCategory: z.string().min(1).max(100).nullable(),
}).strict()
export type AgentWorkingRecovery = z.infer<typeof agentWorkingRecoverySchema>

export const agentWorkingSummarySchema = z.object({
  version: z.literal(AGENT_WORKING_SUMMARY_VERSION),
  goal: z.string().min(1).max(32 * 1024),
  route: z.object({
    intent: z.string().min(1).max(100),
    summary: z.string().min(1).max(500),
    toolDomains: z.array(z.string().min(1).max(100)).max(8),
    /** 见 PlanUpdated.explicitUserIntent：续跑必须拿到与原运行**逐位相同**的授权范围。 */
    explicitUserIntent: z.boolean().default(false),
  }).strict().nullable(),
  planVersion: z.number().int().nonnegative(),
  activeStep: agentWorkingStepSchema.nullable(),
  completedSteps: z.array(agentWorkingStepSchema).max(20),
  failedSteps: z.array(agentWorkingStepSchema).max(10),
  evidence: z.array(agentWorkingEvidenceSchema).max(12),
  pendingApprovals: z.array(agentPendingApprovalSummarySchema).max(4),
  unresolvedItems: z.array(z.string().min(1).max(1_000)).max(10),
  scopeRevisions: hostScopeRevisionsSchema.nullable(),
  artifactRefs: z.array(z.string().min(1).max(500)).max(12),
  attachmentRefs: z.array(z.string().regex(/^asset:[^\s]+$/)).max(8).default([]),
  /*
   * 本次运行已经发放出去的稳定工具租约，扁平一份。
   *
   * 曾经按 Facet 分桶，于是"任务图结算"能把模型正在用的工具收回去——实测模型手里只剩只读
   * 工具，只能回一句"放置对象工具不在本轮可用列表里"。任务图删除后租约的生命周期只由两件
   * **事实**决定：目录版本变了，或者工具真的不可用了。
   */
  toolLeases: z.array(z.string().min(1).max(200)).max(AGENT_DISCOVERY_LEASE_TOOL_LIMIT).default([]),
  toolLeaseCatalogRevision: z.union([
    z.string().min(1).max(200),
    z.number().int().nonnegative(),
  ]).nullable().default(null),
  recovery: agentWorkingRecoverySchema,
  updatedAt: z.string().datetime(),
}).strict()
export type AgentWorkingSummary = z.infer<typeof agentWorkingSummarySchema>

export function createAgentWorkingSummary(goal: string): AgentWorkingSummary {
  return agentWorkingSummarySchema.parse({
    version: AGENT_WORKING_SUMMARY_VERSION,
    goal,
    route: null,
    planVersion: 0,
    activeStep: null,
    completedSteps: [],
    failedSteps: [],
    evidence: [],
    pendingApprovals: [],
    unresolvedItems: [],
    scopeRevisions: null,
    artifactRefs: [],
    attachmentRefs: [],
    toolLeases: [],
    toolLeaseCatalogRevision: null,
    recovery: {
      mode: 'none',
      reason: '',
      toolName: null,
      toolCategory: null,
    },
    updatedAt: new Date().toISOString(),
  })
}

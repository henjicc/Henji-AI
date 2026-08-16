import { z } from 'zod'

import { applicationRefSchema } from '../../application-control'
import type { ApplicationCapabilityDefinition } from '../applicationCapabilities'
import { henjiScriptCheckpointSchema } from '../externalWait'
import { agentObservedEffectSchema } from '../observedEffect'
import { defineApplicationCapability } from './defineApplicationCapability'

export const HENJI_SCRIPT_LANGUAGE = 'henji-ts/v1' as const

export const runHenjiScriptInputSchema = z.object({
  language: z.literal(HENJI_SCRIPT_LANGUAGE),
  summary: z.string().trim().min(1).max(300),
  source: z.string().min(1).max(32 * 1024),
}).strict()

const scriptSourceLocationSchema = z.object({
  line: z.number().int().positive(),
  column: z.number().int().positive(),
}).strict()

export const henjiScriptErrorSchema = z.object({
  code: z.enum([
    'SCRIPT_PARSE_FAILED',
    'SCRIPT_UNSUPPORTED_SYNTAX',
    'SCRIPT_API_NOT_DISCOVERED',
    'SCRIPT_PLAN_REJECTED',
    'SCRIPT_STEP_FAILED',
    'SCRIPT_VERIFICATION_FAILED',
  ]),
  phase: z.enum(['parse', 'compile', 'preflight', 'execute', 'verify']),
  message: z.string().min(1).max(1_000),
  location: scriptSourceLocationSchema.nullable(),
  stepId: z.string().min(1).max(80).nullable(),
}).strict()

export const henjiScriptStepReceiptSchema = z.object({
  stepId: z.string().min(1).max(80),
  api: z.string().min(1).max(120),
  status: z.enum(['completed', 'waiting_external', 'failed']),
  location: scriptSourceLocationSchema,
  resultRefs: z.array(applicationRefSchema).max(64),
  effectCount: z.number().int().nonnegative(),
  summary: z.string().max(500),
}).strict()

export const runHenjiScriptOutputSchema = z.object({
  ok: z.boolean(),
  status: z.enum(['completed', 'waiting_external', 'partial', 'failed']),
  scriptRunRef: z.string().min(1),
  steps: z.array(henjiScriptStepReceiptSchema).max(128),
  resultRefs: z.array(applicationRefSchema).max(128),
  effects: z.array(agentObservedEffectSchema).max(512),
  verification: z.object({
    passed: z.boolean(),
    summary: z.string().max(2_000),
    evidence: z.array(z.string().max(500)).max(24),
  }).strict(),
  error: henjiScriptErrorSchema.nullable(),
  submittedTasks: z.array(z.object({
    toolName: z.literal('create_visible_generation_task'),
    taskId: z.string().min(1).max(300),
    status: z.literal('submitted'),
  }).strict()).max(8).default([]),
  /** 仅供宿主持久化外部等待续跑；历史投影和模型上下文会剔除。 */
  checkpoint: henjiScriptCheckpointSchema.nullable().default(null),
  revision: z.number().int().nonnegative(),
  scopeRevisions: z.record(z.string(), z.number().int().nonnegative()),
}).strict()

export type RunHenjiScriptInput = z.infer<typeof runHenjiScriptInputSchema>
export type RunHenjiScriptOutput = z.infer<typeof runHenjiScriptOutputSchema>

export const runHenjiScriptCapability = defineApplicationCapability({
  id: 'run_henji_script',
  version: 1,
  title: '运行 Henji Script',
  description: '用受限的 TypeScript 风格 Henji Script 一次完成复杂应用操作。只允许调用发现到的 app.entities、app.action、app.recipe 和断言 API；宿主负责能力版本、完整引用、revision、权限、Effect 与正式验证。源码只会被解析为受控语义 IR，绝不会作为 JavaScript 执行。',
  domain: 'application',
  aliases: ['批量自动化', '复杂应用操作', 'Henji Script', 'automation script'],
  side: 'backend',
  readOnly: false,
  // Henji Script 本身只解析受限 IR。编译器会在首项写入前拒绝 R3/R4、
  // destructive、open-world 与 C2/C3 子能力；实际 R1/R2 子步骤仍逐项经过 Gateway。
  // 因此外层风险是“受控本地写入”R1，而不是任意程序执行 R2。
  risk: 'R1',
  dataClasses: ['C1'],
  permission: 'application:script:execute',
  idempotent: false,
  destructive: false,
  timeoutMs: 120_000,
  /*
   * 不设调用次数上限。
   *
   * 这里曾经是 maxCallsPerRun: 1，理由是"多段脚本会改变 revision、重新引入竞态"。但竞态由
   * 网关的 expected-revision 信封逐调用兜住：后一段脚本重新读状态、按当前 revision 提交，
   * 本来就是安全的。上限真正拦下的是**合法的分阶段完成**。
   *
   * 而它的失败模式是灾难性的：把"效率不高"升级成"任务做不完"。更贵的是模型知道有上限之后，
   * 会为了省调用次数反复琢磨怎么一次写完——思考的 token 远比多调一次贵。实测三维场景一次
   * 运行因此烧掉 46 轮、77 万 token，最终 0 个 Effect。
   *
   * "原地打转"该由**事实**来判，而不是由次数这个代理指标：同签名重复调用、无新进展、
   * 连续失败、token 与回合预算都已经在守这件事，且它们不会误伤真正有进展的第二段脚本。
   * 「尽量一段写完」仍然是提示词里的建议——那是引导，不是墙。
   */
  supportsPreview: true,
  supportsUndo: false,
  requiredScopes: [],
  acceptsRefs: [],
  producesRefs: [],
  successEvidence: [
    '返回每个语义步骤的强类型 Effect、完整稳定引用和正式验证摘要。',
    '只有 Effect 与正式状态验证通过后才返回 completed。',
  ],
  failureRecovery: [
    '根据错误中的源码行列修正脚本；编译和预检失败保证没有应用写入。',
    'partial 表示存在无法补偿的真实副作用，必须按 receipt 继续处理。',
  ],
  inputSchema: runHenjiScriptInputSchema,
  outputSchema: runHenjiScriptOutputSchema,
  inputExamples: [{
    language: HENJI_SCRIPT_LANGUAGE,
    summary: '创建球体并做三点浮动动画',
    source: "const result = await app.recipe('camera_stage.state_animation', { projectName: '浮动球', object: { primitiveKind: 'sphere', name: '球' }, samples: [{ time: 0, position: { y: 0 } }, { time: 1, position: { y: 1.5 } }, { time: 2, position: { y: 0 } }], loop: true, play: true });\napp.assert.exists(result.resultRefs);",
  }],
  control: {
    execution: { mode: 'immediate', cancelable: true, resultState: 'completed' },
    impacts: [{
      effect: 'execute', entityTypes: ['application.script'], propertyIds: [],
      revisionScopes: [], verificationRequired: false,
    }],
  },
  resolveConcurrencyKey: () => 'application:henji-script',
  // The approval boundary must bind the same target that the compiler preview exposes.
  // Script contents are bound separately by the approval args digest; this stable target
  // identifies the only interpreter/runtime the approval is authorizing.
  resolveTargetIds: () => ({ script: HENJI_SCRIPT_LANGUAGE }),
  resolveObservedEffects: (_input, output) => output.effects,
  summarize: (output) => output.status === 'completed'
    ? `Henji Script 已完成 ${output.steps.length} 个语义步骤并通过正式验证。`
    : output.status === 'waiting_external'
      ? 'Henji Script 已暂停，正在等待外部生成结果。'
      : `Henji Script ${output.status === 'partial' ? '部分完成' : '执行失败'}：${output.error?.message ?? '未知错误'}`,
  projectForHistory: (output) => ({
    status: output.status,
    ok: output.ok,
    scriptRunRef: output.scriptRunRef,
    steps: output.steps.map(({ stepId, api, status, resultRefs, effectCount }) => ({
      stepId, api, status, resultRefs, effectCount,
    })),
    resultRefs: output.resultRefs,
    effects: output.effects,
    verification: output.verification,
    error: output.error,
  }),
}) satisfies ApplicationCapabilityDefinition<RunHenjiScriptInput, RunHenjiScriptOutput>

export const HENJI_SCRIPT_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  runHenjiScriptCapability,
]


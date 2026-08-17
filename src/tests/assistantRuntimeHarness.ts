/**
 * 剧本驱动的助手运行时 harness：**唯一的替身是 LLM。**
 *
 * ── 为什么需要它 ──
 * 助手注册了 17 个能力域，补齐真机验证要每域 3~8 分钟、烧真实 token，而结果还不稳定
 * （同代码同场景实测回合 4~10、输入 token 5.75 万~19.5 万）。但真机跑挖出的缺陷里，多数
 * 与"模型看不看得懂"无关，属于确定性脚手架：控制流、工具调用、revision、拒绝路径、状态流转。
 * 这些用剧本驱动真运行时就能秒级锁定，不必每次都请模型来跑一遍。
 *
 * ── 边界（改这个文件前先读完）──
 * 真跑，不许替身：
 *   主进程 —— `createBuiltinAgentToolRegistry` 全量注册表、`AgentToolGateway`（schema / 权限 /
 *   revision / 审批 / 动态 availability / Effect Receipt）、`AgentRunner` 状态机、Henji Script
 *   编译器与解释器、脚本租约、能力发现与投影、卸载判定。
 *   渲染层 —— `executeApplicationCapabilityResult` → 反射适配器 → 真 `ApplicationReflectionRegistry`
 *   + `ApplicationControlExecutionEngine` → 各领域执行器 → zustand 真相源。
 *   宿主快照 —— 真 `createHostContextSnapshot()`。
 *
 * 允许的替身**只有四类**，每一类都落在进程边界或外部付费/像素边界上，都不含业务判断：
 *   1. LLM（剧本）
 *   2. IPC 传输（直接函数调用，但强制 JSON 往返，见 `invokeFrontend`）
 *   3. 持久化（AgentRunnerDependencies 里的可选项一律不接）
 *   4. 真实付费生成 API 与真实像素（由具体测试自行处理，harness 不碰）
 *
 * 判据：把替身撤掉后，被测行为的**判断逻辑**有没有任何一条搬进了替身里。JSON 往返、内存
 * artifact store 都不含判断逻辑，合格；一个"返回预设 describe 结果"的假反射注册表含判断逻辑，
 * 不合格——那一刻这一层就变成了漂亮的假绿。
 *
 * ── 本层不证明什么 ──
 * 只证明"如果模型这么做，运行时是对的"，**不证明**"模型会这么做"。后者只有真机跑能回答。
 */
import { AGENT_RUNTIME_SCHEMA_VERSION, type AgentStartRunRequest } from '@/core/assistant/runtimeContracts'
import type { AgentEvent, AgentRunState } from '@/core/assistant/events'
import type { HostContextSnapshot } from '@/core/assistant/hostContracts'
import {
  createHostContextSnapshot,
  retainHostContextTracking,
} from '@/features/assistant/hostContext/hostContext'
import { executeApplicationCapabilityResult } from '@/features/assistant/applicationCapabilities/registry'

import type { ModelStepInput, ModelStepResult } from '@/core/llm/modelStep'

import { createScriptedModelStepExecutor, type ScriptedModelStepAction } from '../../electron/main/services/llm/sdk/scripted-model-step'
import { AgentRunner } from '../../electron/main/services/agent-runtime/runner/runner'
import { AgentToolGateway } from '../../electron/main/services/agent-runtime/tools/gateway'
import { createBuiltinAgentToolRegistry } from '../../electron/main/services/agent-runtime/tools/builtin'
import type { AgentToolRegistry } from '../../electron/main/services/agent-runtime/tools/registry'
import { AgentArtifactStore } from '../../electron/main/services/agent-runtime/context/offload'
import {
  createHenjiScriptService,
  createHenjiScriptTools,
} from '../../electron/main/services/agent-runtime/henji-script/tools'
import type { AgentIntent } from '../../electron/main/services/agent-runtime/context/types'

/** 注册链路的规模下限。跌破说明注册本身出问题了，剧本会在一个空目录上假绿。 */
const MIN_REGISTERED_TOOLS = 60
const MIN_FRONTEND_CAPABILITIES = 40

export interface HarnessModelStep {
  /** 本步的剧本；不含 finish 时由 harness 按有无工具调用自动补。 */
  actions: ScriptedModelStepAction[]
}

export interface AssistantHarnessOptions {
  goal: string
  /** 主模型逐步剧本。跑完最后一步仍未终止时，harness 补一个纯文本收尾步防止空转。 */
  steps: HarnessModelStep[]
  /** 路由步骤返回的意图；默认 general。路由不是本层的被测对象，直接给定。 */
  intent?: AgentIntent
  approvalMode?: AgentStartRunRequest['approvalMode']
  runId?: string
  threadId?: string
  /** 覆盖宿主快照。默认用真实 `createHostContextSnapshot()`，只在需要特定视图态时传。 */
  getHostContext?: () => HostContextSnapshot
  timeoutMs?: number
}

export interface HarnessToolCall {
  toolName: string
  ok: boolean
  summary?: string
  errorCode?: string
  errorMessage?: string
}

export interface AssistantHarnessResult {
  state: AgentRunState
  events: AgentEvent[]
  toolCalls: HarnessToolCall[]
  /** 模型实际被调用的步数（不含路由步）。剧本给多了不算错，但用得比给的少通常意味着提前终止。 */
  modelSteps: number
  registry: AgentToolRegistry
  /** 本次运行是否触发过 artifact 卸载。L-B 里出现它基本等于投影回归。 */
  offloaded: boolean
  /**
   * 运行结束时的宿主快照。
   *
   * 写域用例应当断言对应 scope 的 revision 真的推进了——它是"revision 订阅确实活着"的唯一
   * 可观测证据。订阅没接上时这些数会一直停在 0，而那种状态下任何乐观并发缺陷都撞不出来。
   */
  finalHostContext: HostContextSnapshot
}

function verifiedProfile(): AgentStartRunRequest['profile'] {
  const verifiedAt = new Date().toISOString()
  return {
    id: 'profile-harness',
    name: '剧本 harness',
    primary: { providerId: 'harness', modelId: 'scripted' },
    settings: { timeoutMs: 10_000, maxRetries: 0, maxOutputTokens: 4_000, contextWindowBudget: 64_000 },
    verifications: [{
      providerId: 'harness',
      modelId: 'scripted',
      adapterVersion: 'harness',
      verifiedAt,
      checks: (['text', 'toolCall', 'structuredOutput', 'streaming', 'usage', 'cancel'] as const)
        .map((id) => ({ id, status: 'passed' as const, latencyMs: 1 })),
      totalLatencyMs: 6,
      usage: {
        inputTokens: 1, outputTokens: 1, reasoningTokens: 0,
        cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 2,
      },
      cost: { status: 'unknown' },
    }],
    createdAt: verifiedAt,
    updatedAt: verifiedAt,
  }
}

function harnessRequest(options: AssistantHarnessOptions): AgentStartRunRequest {
  return {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    threadId: options.threadId ?? 'thread-harness',
    goal: options.goal,
    approvalMode: options.approvalMode ?? 'full_access',
    profile: verifiedProfile(),
    models: [{
      providerId: 'harness', modelId: 'scripted', displayName: '剧本模型',
      adapter: 'openai-compatible', enabled: true,
      capabilities: {
        text: true, image: false, video: false, audio: false, streaming: true, toolCall: true,
        parallelTools: false, jsonOutput: true, structuredOutputMode: 'json', reasoning: false,
        sampling: true, contextWindow: 64_000, maxOutputTokens: 4_000, usage: true,
      },
    }],
  }
}

/**
 * 桥到渲染层真实能力执行器。
 *
 * 强制 JSON 往返：生产里这一跳要穿过 IPC（结构化克隆），Map/Set/Date/undefined/循环引用都会在
 * 那里变形或报错。直接传对象引用会把这些损失藏起来，测试绿了、真机照样炸。往返一次让损失变成
 * 真的——它替代的是**传输**，不是任何一条业务判断，所以仍在替身白名单内。
 */
function createFrontendInvoker(
  refreshHostContext: () => void
): Parameters<typeof createBuiltinAgentToolRegistry>[0] {
  return async (operation, context) => {
    const wire = JSON.parse(JSON.stringify(operation)) as typeof operation
    const result = await executeApplicationCapabilityResult(wire.capability, {
      signal: context.signal,
      requestId: context.runId,
      taskId: context.toolCallId,
    })
    // 生产里渲染层把执行后的宿主快照随响应一起推回主进程；这里在同一时机刷新缓存。
    refreshHostContext()
    return JSON.parse(JSON.stringify(result)) as typeof result
  }
}

/**
 * 本层不覆盖 artifact 分页。
 *
 * 分页逻辑住在 SQLite 支持的 `AgentArtifactPersistenceStore`，在这里再实现一份就成了第二套
 * 内核——那正是项目明令禁止的。所以这里直接抛，让"harness 里出现了回读"变成一句说得清的话，
 * 而不是一份悄悄失真的假数据。分页本身由 `persistence/artifact-store.test.ts` 覆盖。
 */
function unsupportedArtifactAccess(): Parameters<typeof createBuiltinAgentToolRegistry>[1] {
  const explain = (): never => {
    throw new Error(
      '[ARTIFACT_NOT_FOUND] harness 不实现 artifact 分页：本层只覆盖内联路径。'
      + '出现回读通常意味着某条工具结果的投影超了卸载阈值，先查投影体积，'
      + '而不是给 harness 补一套分页。'
    )
  }
  return { describe: explain, read: explain }
}

/** 路由步骤的固定应答。路由本身由 router.test.ts 覆盖，这里只让它别挡路。 */
function routerResult(input: ModelStepInput, intent: AgentIntent): ModelStepResult {
  return {
    requestId: input.requestId, runId: input.runId, stepId: input.stepId,
    providerId: input.providerId, modelId: input.modelId,
    text: '', reasoningText: '',
    structuredOutput: { intent, reason: `harness 指定意图 ${intent}`, explicitUserIntent: true },
    toolCalls: [],
    responseMessages: [{ role: 'assistant', content: '' }],
    finishReason: 'stop',
    usage: {
      inputTokens: 1, inputNoCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
      outputTokens: 1, textTokens: 1, reasoningTokens: 0, totalTokens: 2,
    },
    providerMetadataSummary: { harness: ['router'] }, warnings: [], elapsedMs: 1,
  }
}

/** 剧本没写 finish 时按有无工具调用补一个，免得每条用例都抄同一段。 */
function withFinish(actions: ScriptedModelStepAction[]): ScriptedModelStepAction[] {
  if (actions.some((action) => action.type === 'finish')) return actions
  const hasToolCall = actions.some((action) => action.type === 'tool_call')
  return [...actions, { type: 'finish', reason: hasToolCall ? 'tool-calls' : 'stop' }]
}

/** 剧本用尽后的收尾步：给一句最终答复，让运行正常终止而不是空转到预算耗尽。 */
const EXHAUSTED_STEP: ScriptedModelStepAction[] = [
  { type: 'text', value: '剧本已执行完毕。' },
  { type: 'finish', reason: 'stop' },
]

/**
 * 宿主上下文按**生产的传播方式**给出：缓存快照 + 能力执行后刷新。
 *
 * 生产里 `getHostContext(runId)` 读的是 `hostContexts` 这张缓存表，只有当某次主进程工具响应
 * 带回新的 `hostContext` 时才由 `rememberHostContext` 更新（见 utility-proxy-registry）。
 * 每次都返回实时快照看着"更真"，实际是**更假**：脚本解释器的 `revisionCursor` 继承机制
 * 正是为缓存语义存在的，实时快照会让它变成永远多余的一段代码，于是这一层对整类
 * revision 缺陷失明——实测撤掉 `absorbScopeRevisions` 时它一声不吭。
 */
function createHostContextChannel(): {
  get: () => HostContextSnapshot
  refresh: () => void
} {
  let cached = createHostContextSnapshot()
  return {
    get: () => cached,
    refresh: () => { cached = createHostContextSnapshot() },
  }
}

/** 录制产物的形状，由 `npm run assistant:record` 生成。 */
export interface RecordedAssistantScript {
  schemaVersion: 1
  recordedFrom: { runId: string; status: string; goal: string; stepCount: number }
  nonce: string | null
  steps: Array<{ stepId: string; actions: ScriptedModelStepAction[] }>
  warnings: string[]
}

/** 回放时注入的固定唯一名。真机跑仍生成新的随机值，两者互不影响。 */
export const REPLAY_NONCE = 'n0000fx'

/**
 * 把录制产物还原成可回放的剧本与目标。
 *
 * 占位符替换是**整份替换**，包括脚本源码内部——录制当天的时间戳一旦焊进 `projectName`，
 * 回放就会年复一年地创建同一个名字，而真机跑用的是新值，两边从此不是同一个场景。
 *
 * 带未处理告警的录制一律拒绝回放：那种剧本引用着上游步骤的真实产物 id，换个环境必然
 * 指向不存在的东西，而失败会以某个领域错误的形式出现，没人会想到是录制的问题。
 */
export function loadRecordedScript(
  recorded: RecordedAssistantScript,
  nonce: string = REPLAY_NONCE
): { goal: string; steps: HarnessModelStep[] } {
  if (recorded.warnings.length > 0) {
    throw new Error(
      `录制 ${recorded.recordedFrom.runId} 带有未处理的告警，不能直接回放：\n`
      + recorded.warnings.join('\n')
      + '\n把焊死的运行时产物 id 改写成对前序步骤结果的引用，或把这条降级为手写剧本。'
    )
  }
  const substitute = <T,>(value: T): T => (
    JSON.parse(JSON.stringify(value).split('{{nonce}}').join(nonce)) as T
  )
  return {
    goal: substitute(recorded.recordedFrom.goal),
    steps: recorded.steps.map((step) => ({ actions: substitute(step.actions) })),
  }
}

export function buildAssistantHarnessRuntime(options: AssistantHarnessOptions): {
  registry: AgentToolRegistry
  gateway: AgentToolGateway
  getHostContext: () => HostContextSnapshot
  /** 停止 revision 订阅。跑完必须调，否则 store 订阅会跨用例累积。 */
  dispose: () => void
} {
  /*
   * 启动真实的 revision 订阅链路。
   *
   * 生产里这条由 `useAssistantHostBridge` 这个 React hook 持有；harness 里没有 React，
   * 不主动 retain 的后果是**所有 scopeRevisions 永远停在 0**——期望值与实际值恒等，
   * 于是没有任何写入会 CONFLICT，整层对乐观并发彻底失明还一路绿灯。
   * 这不是替身，是把生产本来就有的那段订阅接上。
   */
  const releaseTracking = options.getHostContext ? () => {} : retainHostContextTracking()
  const channel = createHostContextChannel()
  const getHostContext = options.getHostContext ?? channel.get
  const refreshHostContext = options.getHostContext ? () => {} : channel.refresh
  const registry = createBuiltinAgentToolRegistry(
    createFrontendInvoker(refreshHostContext),
    unsupportedArtifactAccess()
  )
  const gateway = new AgentToolGateway({
    registry,
    getHostContext: () => getHostContext(),
    appendPermissionAudit: async () => {},
  })
  const scriptService = createHenjiScriptService(registry)
  for (const tool of createHenjiScriptTools({
    service: scriptService,
    gateway,
    getHostContext: () => getHostContext(),
  })) registry.register(tool)
  return { registry, gateway, getHostContext, dispose: releaseTracking }
}

/**
 * 防空转自检。
 *
 * 与 `capability-reachability.test.ts` 里那句 `expect(capabilities.length).toBeGreaterThan(60)`
 * 同一手法：注册链路一旦断掉（某个 import 失败、某个领域没注册），剧本会在一个几乎空的目录上
 * 一路绿灯跑完，而那正是最需要红的时候。
 */
export function assertHarnessWiring(registry: AgentToolRegistry): void {
  const definitions = registry.allDefinitions()
  const frontendCount = definitions.filter((definition) => definition.side === 'frontend').length
  if (definitions.length < MIN_REGISTERED_TOOLS) {
    throw new Error(
      `harness 注册表只有 ${definitions.length} 个工具（下限 ${MIN_REGISTERED_TOOLS}）：`
      + '注册链路已经断了，此时剧本跑绿没有任何意义。'
    )
  }
  if (frontendCount < MIN_FRONTEND_CAPABILITIES) {
    throw new Error(
      `harness 只桥到 ${frontendCount} 个前端能力（下限 ${MIN_FRONTEND_CAPABILITIES}）：`
      + '渲染层能力注册没加载全，领域执行器多半也没接上。'
    )
  }
  if (!definitions.some((definition) => definition.name === 'run_henji_script')) {
    throw new Error('harness 没注册 run_henji_script：脚本内核没接上，剧本里的脚本步骤会全部落空。')
  }
}

export async function runAssistantHarness(
  options: AssistantHarnessOptions
): Promise<AssistantHarnessResult> {
  const runId = options.runId ?? `harness-${options.goal.slice(0, 12)}-${options.steps.length}`
  const { registry, gateway, getHostContext, dispose } = buildAssistantHarnessRuntime(options)
  assertHarnessWiring(registry)

  const events: AgentEvent[] = []
  const toolCalls: HarnessToolCall[] = []
  let offloaded = false
  let modelSteps = 0

  const artifactStore = new AgentArtifactStore({
    save: () => { offloaded = true },
  })

  let resolveTerminal: (state: AgentRunState) => void = () => undefined
  const terminal = new Promise<AgentRunState>((resolve) => { resolveTerminal = resolve })

  const runner = new AgentRunner({
    runId,
    request: harnessRequest(options),
    dependencies: {
      registry,
      gateway,
      getHostContext: () => getHostContext(),
      artifactStore,
      runModelStep: async (input, emit) => {
        if (input.stepId.startsWith('router:')) {
          return routerResult(input, options.intent ?? 'general')
        }
        const step = options.steps[modelSteps]
        modelSteps += 1
        const actions = step ? withFinish(step.actions) : EXHAUSTED_STEP
        return createScriptedModelStepExecutor(actions)(input, emit)
      },
      cancelModelStep: () => {},
      onEvent: (event) => {
        events.push(event)
        if (event.type === 'ToolCompleted') {
          toolCalls.push({ toolName: event.toolName, ok: true, summary: event.summary })
        }
        if (event.type === 'ToolFailed') {
          toolCalls.push({
            toolName: event.toolName,
            ok: false,
            errorCode: event.error.code,
            errorMessage: event.error.message,
          })
        }
      },
      onTerminal: resolveTerminal,
    },
  })

  runner.start()
  const timeoutMs = options.timeoutMs ?? 20_000
  try {
    const state = await Promise.race([
      terminal,
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(
            `harness 运行超过 ${timeoutMs}ms 仍未终止；剧本多半没让运行走到终态。`
          )),
          timeoutMs
        ).unref?.()
      }),
    ])
    return {
      state, events, toolCalls, modelSteps, registry, offloaded,
      finalHostContext: createHostContextSnapshot(),
    }
  } finally {
    dispose()
  }
}

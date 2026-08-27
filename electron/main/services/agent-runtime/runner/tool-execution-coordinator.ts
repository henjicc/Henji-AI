import type { AgentApprovalRequest, AgentEventInput } from '../../../../../src/core/assistant/events'
import type { HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import type { AgentApprovalMode } from '../../../../../src/core/assistant/runtimeContracts'
import type { ModelStepToolCall } from '@henjicc/ai-sdk'
import type { AgentToolErrorCode, AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { AgentToolCatalogPlanner } from '../context/catalog'
import type { AgentRouteDecision } from '../context/types'
import type { AgentToolGateway } from '../tools/gateway'
import type { AgentToolRegistry } from '../tools/registry'
import type { AgentRecoveryWriteGuard } from './recovery-guard'
import {
  AgentToolCallScheduler,
  type AgentExecutionGuardRejection,
} from './tool-call-scheduler'
import { observationFailure } from './runner-results'
import { createMainLogger } from '../../logging'

const logger = createMainLogger('main.agent_runtime')

interface AgentToolExecutionCoordinatorOptions {
  runId: string
  threadId: string
  approvalMode: AgentApprovalMode
  supportsParallelTools: boolean
  gateway: AgentToolGateway
  registry: AgentToolRegistry
  catalogPlanner: AgentToolCatalogPlanner
  recoveryGuard: AgentRecoveryWriteGuard
  signal: AbortSignal
  waitIfPaused: () => Promise<void>
  throwIfCancelled: () => void
  recordToolCall: (signature: string, write: boolean) => void
  recordProgress: (signature: string) => void
  recordFailure: () => void
  recordSuccess: () => void
  setActiveToolCall: (toolCallId: string | null) => void
  requestApproval: (
    call: ModelStepToolCall,
    approval: AgentApprovalRequest
  ) => Promise<'approve' | 'reject' | 'expired'>
  onObservation: (call: ModelStepToolCall, observation: AgentToolObservation) => void
  emit: (event: AgentEventInput) => void
  onDiscoveredTools: (toolCallId: string, toolNames: string[]) => void
}

export class AgentToolExecutionCoordinator {
  /** 整次运行内已经纠正过的守卫问题，用来区分"第一次被纠正"和"重复犯同一个错"。 */
  private readonly rejectedGuardSignatures = new Set<string>()

  /*
   * 这里曾经有一条 `rejectRepeatedArtifactRead`：同一 artifact 的同一页读过就拒绝，理由是
   * 返回字节逐字节相同、重复取回不可能带来新信息。逻辑没错，但**实测把运行推向了不可恢复**。
   *
   * canvas 场景实测：该守卫触发 12 次 INVALID_INPUT，模型一直重试，最后被 CONSECUTIVE_FAILURES
   * 判死，25 轮 0 Effect——而未加守卫时同一场景 14 轮能完成。原因是模型重复读并不是犯傻：
   * 观察层只留 320 字符预览，对应的 tool 消息可能已被压缩掉，那份内容**确实不在它的上下文里**。
   * 此时拒绝等于把它锁进死路：它要的东西拿不到，又没有别的出口。
   *
   * 真正该修的是过度卸载本身（同一份结果一边内联一边卸载），那已由 formatObservation 与
   * toolMessage 统一为"先裁再判"解决。重复回读是那个病的症状，症状不该用硬拦来治。
   */

  constructor(private readonly options: AgentToolExecutionCoordinatorOptions) {}

  async execute(
    calls: ModelStepToolCall[],
    route: AgentRouteDecision,
    expectedRevisions: Partial<HostScopeRevisions>,
    activeToolNames: ReadonlySet<string>,
    trustedInternalToolNames: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    const rejectGuard = (
      call: ModelStepToolCall,
      decision: string | { code: AgentToolErrorCode; reason: string },
      issueCodes: string[] = []
    ): AgentExecutionGuardRejection => {
      const code = typeof decision === 'string' ? 'RECOVERY_VERIFICATION_REQUIRED' : decision.code
      const reason = typeof decision === 'string' ? decision : decision.reason
      // 同一工具 + 同一问题第一次出现时只算纠正；模型没听懂再犯才计入连续失败预算。
      const signature = `${call.toolName}:${code}:${issueCodes.join(',')}`
      const contractCorrection = !this.rejectedGuardSignatures.has(signature)
      this.rejectedGuardSignatures.add(signature)
      logger.warn('Agent 执行守卫拒绝工具', {
        event: 'agent_runtime.execution_guard.rejected',
        requestId: this.options.runId,
        taskId: call.toolCallId,
        context: { toolName: call.toolName, errorCode: code, issueCodes, contractCorrection },
      })
      return { code, reason, contractCorrection }
    }
    const scheduler = new AgentToolCallScheduler({
      runId: this.options.runId,
      threadId: this.options.threadId,
      approvalMode: this.options.approvalMode,
      supportsParallelTools: this.options.supportsParallelTools,
      gateway: this.options.gateway,
      registry: this.options.registry,
      catalogPlanner: this.options.catalogPlanner,
      activeToolNames,
      trustedInternalToolNames,
      signal: this.options.signal,
      waitIfPaused: this.options.waitIfPaused,
      throwIfCancelled: this.options.throwIfCancelled,
      recordToolCall: this.options.recordToolCall,
      recordProgress: this.options.recordProgress,
      recordFailure: this.options.recordFailure,
      recordSuccess: this.options.recordSuccess,
      setActiveToolCall: this.options.setActiveToolCall,
      requestApproval: this.options.requestApproval,
      onObservation: this.options.onObservation,
      emit: this.options.emit,
      onDiscoveredTools: this.options.onDiscoveredTools,
      /*
       * 只剩一条守卫：上一次写入结果未知时，先查真实状态再写。
       *
       * 这里以前还站着任务图：`ACTION_PLAN_REQUIRED`（本轮写入数比图里声明的 Effect 多就拒）
       * 和 `tracker.validate`（调用对不上任何 Facet 就拒）。两条判的都是"模型做的事和运行前
       * 那张猜出来的图对不对得上"，而不是"这次调用安不安全"。安全由 Gateway、权限、审批和
       * expected-revision 信封负责，它们一条没动。
       *
       * 续跑调用不参与：它是宿主对已通过完整预检、已持久化 IR 的确定性恢复，每个内部步骤仍
       * 会重新经过 Gateway。
       */
      executionGuard: (call) => {
        if (call.toolName === 'resume_henji_script') return null
        const recoveryReason = this.options.recoveryGuard.validate(call)
        return recoveryReason ? rejectGuard(call, recoveryReason) : null
      },
      onOutcome: (call, observation) => {
        const failure = observationFailure(observation)
        const metadata = this.options.registry.executionMetadata(call.toolName, call.input)
        if (failure
          && metadata?.readOnly === false
          && ['TIMEOUT', 'EXECUTION_FAILED', 'CANCELLED'].includes(failure.code)) {
          this.options.recoveryGuard.activateUnknownWrite(call, metadata.category ?? null)
        }
      },
    })
    try {
      // 授权位来自路由的显式判定，不再从 intent 字符串反推：intent 是给提示词与评测用的
      // 分类标签，把它当权限位用意味着标签取值一变，R1 写工具的自动放行范围就静默改变。
      await scheduler.execute(calls, route.explicitUserIntent, expectedRevisions)
    } finally {
      this.options.setActiveToolCall(null)
    }
  }
}




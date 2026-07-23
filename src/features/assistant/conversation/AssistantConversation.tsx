import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AlertCircle, Bot, BrainCircuit, FileArchive, UserRound } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

import { UiButton } from '@/components/ui'
import {
  createEmptyPromptDocument,
  createPlainTextPromptDocument,
  type PromptDocumentV1,
} from '@/core/inputs/promptDocument'

import { useAgentRun } from '../hooks/useAgentRun'
import {
  openAssistantCanvasResult,
  openAssistantGenerationResult,
} from '../results/openAssistantResult'
import { useAssistantUiStore } from '../store/assistantUiStore'
import { ApprovalCard } from './ApprovalCard'
import { AssistantComposer } from './AssistantComposer'
import { RunStatusBar } from './RunStatusBar'
import { selectPendingApproval, selectToolActivities } from './agentRunReducer'
import { ToolActivityCard } from './ToolActivityCard'

const terminalStatuses = new Set(['completed', 'failed', 'cancelled'])
const deferredBlockStyle: CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 96px',
}

export function AssistantConversation(): JSX.Element {
  const run = useAgentRun()
  const [document, setDocument] = useState<PromptDocumentV1>(() => createEmptyPromptDocument())
  const [resultError, setResultError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingHandledRef = useRef<string | null>(null)
  const activeRunId = useAssistantUiStore((state) => state.activeRunId)
  const currentGoal = useAssistantUiStore((state) => state.currentGoal)
  const pendingGoal = useAssistantUiStore((state) => state.pendingGoal)
  const setPendingGoal = useAssistantUiStore((state) => state.setPendingGoal)
  const runState = run.view.runState
  const busy = Boolean(activeRunId && (!runState || !terminalStatuses.has(runState.status)))

  useEffect(() => {
    if (!pendingGoal) {
      pendingHandledRef.current = null
      return
    }
    if (pendingHandledRef.current === pendingGoal) return
    pendingHandledRef.current = pendingGoal
    setDocument(createPlainTextPromptDocument(pendingGoal))
    setPendingGoal(null)
    if (!busy) {
      void run.start(pendingGoal).then((started) => {
        if (started) setDocument(createEmptyPromptDocument())
      })
    }
  }, [busy, pendingGoal, run, setPendingGoal])

  const tools = useMemo(() => selectToolActivities(run.view.events), [run.view.events])
  const approval = useMemo(() => selectPendingApproval(run.view.events), [run.view.events])
  const plan = useMemo(() => [...run.view.events].reverse().find((event) => event.type === 'PlanUpdated'), [run.view.events])
  const latestModelStep = useMemo(() => [...run.view.events].reverse().find((event) => event.type === 'ModelStarted'), [run.view.events])
  const streamedText = useMemo(() => {
    if (!latestModelStep || latestModelStep.type !== 'ModelStarted') return ''
    return run.view.events.flatMap((event) => (
      event.type === 'ModelDelta' && event.stepId === latestModelStep.stepId ? [event.text] : []
    )).join('')
  }, [latestModelStep, run.view.events])
  const artifacts = useMemo(() => run.view.events.filter((event) => event.type === 'ArtifactOffloaded'), [run.view.events])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [approval, artifacts.length, runState?.status, streamedText, tools.length])

  const submit = (goal: string): void => {
    void run.start(goal).then((started) => {
      if (started) setDocument(createEmptyPromptDocument())
    })
  }

  const openTask = (taskId: string): void => {
    setResultError(null)
    void openAssistantGenerationResult(taskId).then((opened) => {
      if (!opened) setResultError(`任务 ${taskId} 当前不存在或被筛选隐藏；你可以切到生成工作区后重新查找。`)
    })
  }

  const openNode = (projectId: string, nodeId: string): void => {
    setResultError(null)
    void openAssistantCanvasResult(projectId, nodeId).then((opened) => {
      if (!opened) setResultError(`节点 ${nodeId} 当前无法定位；项目可能已删除或画布尚未准备完成。`)
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app">
      {runState ? (
        <RunStatusBar
          state={runState}
          events={run.view.events}
          onPause={() => void run.pause()}
          onResume={() => void run.resume()}
          onCancel={() => void run.cancel()}
          onRefresh={() => void run.refresh()}
        />
      ) : null}

      <div ref={scrollRef} className="ui-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4">
        {!runState && !currentGoal ? (
          <div className="flex min-h-full flex-col items-center justify-center px-8 text-center">
            <div className="rounded-2xl border border-accent/30 bg-accent/10 p-3 text-accent shadow-lg">
              <BrainCircuit className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-sm font-medium text-text-dark">让助手操作工作台</h2>
            <p className="mt-2 text-xs leading-5 text-text-muted">
              可以切换工作区、查模型、创建可见生成任务、编排画布节点，或基于脱敏日志诊断错误。所有动作都经过受控工具网关。
            </p>
          </div>
        ) : null}

        {currentGoal ? (
          <section style={deferredBlockStyle} className="ml-7 rounded-xl border border-border-dark bg-layer p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-text-muted"><UserRound className="h-3.5 w-3.5" />你的目标</div>
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-text-dark">{currentGoal}</p>
          </section>
        ) : null}

        {plan?.type === 'PlanUpdated' ? (
          <section style={deferredBlockStyle} className="rounded-xl border border-accent/25 bg-accent/5 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-accent"><BrainCircuit className="h-3.5 w-3.5" />执行计划</div>
            <p className="mt-1.5 text-xs leading-5 text-text-muted">{plan.summary}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {plan.toolDomains.map((domain) => <span key={domain} className="rounded border border-border-dark bg-surface-dark px-1.5 py-0.5 text-[10px] text-text-muted">{domain}</span>)}
            </div>
          </section>
        ) : null}

        {tools.map((tool) => (
          <ToolActivityCard
            key={tool.toolCallId}
            activity={tool}
            onOpenTask={openTask}
            onOpenNode={openNode}
          />
        ))}

        {approval ? <ApprovalCard approval={approval} onDecision={(decision) => void run.respondApproval(approval.approvalId, decision)} /> : null}

        {artifacts.map((artifact) => artifact.type === 'ArtifactOffloaded' ? (
          <section key={artifact.eventId} style={deferredBlockStyle} className="flex items-start gap-2 rounded-xl border border-border-dark bg-surface-dark p-3 text-xs text-text-muted">
            <FileArchive className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0"><div>大结果已安全卸载</div><div className="mt-1 truncate text-[10px]">{artifact.artifactRef} · {artifact.originalBytes.toLocaleString()} bytes</div></div>
          </section>
        ) : null)}

        {streamedText && runState && !terminalStatuses.has(runState.status) ? (
          <section style={deferredBlockStyle} className="mr-7 rounded-xl border border-border-dark bg-panel p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-text-muted"><Bot className="h-3.5 w-3.5" />回应生成中</div>
            <div className="break-words text-sm leading-6 text-text-dark"><ReactMarkdown>{streamedText}</ReactMarkdown></div>
          </section>
        ) : null}

        {runState?.finalText ? (
          <section style={deferredBlockStyle} className="mr-7 rounded-xl border border-border-dark bg-panel p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-text-muted"><Bot className="h-3.5 w-3.5" />助手</div>
            <div className="break-words text-sm leading-6 text-text-dark [&_a]:text-accent [&_code]:rounded [&_code]:bg-layer [&_code]:px-1 [&_ul]:list-disc [&_ul]:pl-5"><ReactMarkdown>{runState.finalText}</ReactMarkdown></div>
          </section>
        ) : null}

        {runState?.error ? (
          <section style={deferredBlockStyle} className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
            <div className="flex items-center gap-1.5 font-medium"><AlertCircle className="h-4 w-4" />{runState.error.code}</div>
            <p className="mt-1.5 leading-5">{runState.error.message}</p>
          </section>
        ) : null}

        {run.view.actionError || resultError ? (
          <section style={deferredBlockStyle} className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
            <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span className="leading-5">{run.view.actionError ?? resultError}</span></div>
            <UiButton type="button" size="sm" variant="ghost" onClick={() => { run.clearActionError(); setResultError(null) }} className="mt-2 h-7 px-2">知道了</UiButton>
          </section>
        ) : null}

        {run.view.connection === 'recovering' ? <div className="text-center text-[11px] text-text-muted">正在恢复运行事件…</div> : null}
      </div>

      <AssistantComposer
        value={document}
        onChange={setDocument}
        onSubmit={submit}
        disabled={busy}
        submitting={run.submitting}
      />
    </div>
  )
}

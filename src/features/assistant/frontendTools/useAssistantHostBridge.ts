import { useEffect } from 'react'

import {
  acknowledgeFrontendTool,
  completeFrontendTool,
  onFrontendToolCancel,
  onFrontendToolRequest,
  publishHostContext,
  reportGenerationTaskStatus,
} from '@/commands/assistant'
import {
  AGENT_CONTRACT_VERSION,
  frontendToolRequestSchema,
  frontendToolResultSchema,
  getFrontendToolOperationName,
  type FrontendToolRequest,
  type FrontendToolResult,
  type ApplicationCapabilityResult,
} from '@/core/assistant/hostContracts'
import { createLogger } from '@/core/logging'
import { registerVisibleGenerationStatusReporter } from '@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand'

import {
  createHostContextSnapshot,
  getRendererSessionId,
  retainHostContextTracking,
  subscribeHostContext,
} from '../hostContext/hostContext'
const logger = createLogger('features.assistant.frontend_tools')

// 应用能力处理器依赖画布、3D 镜头和素材服务，仅在首次执行时加载。
const loadApplicationCapabilityRegistry = (): Promise<typeof import('../applicationCapabilities/registry')> =>
  import('../applicationCapabilities/registry')

const completedLimit = 300

export function useAssistantHostBridge(uiReady: boolean): void {
  useEffect(() => registerVisibleGenerationStatusReporter(reportGenerationTaskStatus), [])
  useEffect(() => {
    const disposeTracking = retainHostContextTracking()
    let publishQueued = false
    let disposed = false

    const publish = (): void => {
      if (publishQueued || disposed) return
      publishQueued = true
      queueMicrotask(() => {
        publishQueued = false
        if (disposed) return
        void publishHostContext(createHostContextSnapshot(uiReady)).catch((error) => {
          logger.error('发布宿主上下文失败', error, { event: 'assistant.host_context.publish.failed' })
        })
      })
    }

    const unsubscribeContext = subscribeHostContext(publish)
    publish()
    return () => {
      disposed = true
      unsubscribeContext()
      disposeTracking()
    }
  }, [uiReady])

  useEffect(() => {
    const active = new Map<string, AbortController>()
    const completedByCall = new Map<string, FrontendToolResult>()
    const completedByKey = new Map<string, ApplicationCapabilityResult>()

    const trimCompleted = (): void => {
      while (completedByCall.size > completedLimit) {
        const key = completedByCall.keys().next().value
        if (typeof key === 'string') completedByCall.delete(key)
      }
      while (completedByKey.size > completedLimit) {
        const key = completedByKey.keys().next().value
        if (typeof key === 'string') completedByKey.delete(key)
      }
    }

    const sendResult = async (
      request: FrontendToolRequest,
      result: ApplicationCapabilityResult
    ): Promise<void> => {
      const payload = frontendToolResultSchema.parse({
        schemaVersion: AGENT_CONTRACT_VERSION,
        runId: request.runId,
        toolCallId: request.toolCallId,
        callId: request.callId,
        idempotencyKey: request.idempotencyKey,
        rendererSessionId: getRendererSessionId(),
        completedAt: new Date().toISOString(),
        result,
      })
      completedByCall.set(request.callId, payload)
      completedByKey.set(request.idempotencyKey, result)
      trimCompleted()
      await completeFrontendTool(payload)
    }

    const handleRequest = (rawRequest: FrontendToolRequest): void => {
      void (async () => {
        let request: FrontendToolRequest
        try {
          request = frontendToolRequestSchema.parse(rawRequest)
        } catch (error) {
          logger.error('前端工具请求校验失败', error, { event: 'assistant.frontend_tool.validation.failed' })
          return
        }

        try {
          await acknowledgeFrontendTool({
            schemaVersion: AGENT_CONTRACT_VERSION,
            callId: request.callId,
            rendererSessionId: getRendererSessionId(),
            acknowledgedAt: new Date().toISOString(),
          })
        } catch (error) {
          logger.error('前端工具请求认领失败', error, {
            event: 'assistant.frontend_tool.ack.failed',
            requestId: request.runId,
            taskId: request.toolCallId,
          })
          return
        }

        const completed = completedByCall.get(request.callId)
        if (completed) {
          await completeFrontendTool(completed)
          return
        }
        const idempotentResult = completedByKey.get(request.idempotencyKey)
        if (idempotentResult) {
          await sendResult(request, idempotentResult)
          return
        }
        if (active.has(request.callId)) return

        if (request.deadline <= Date.now()) {
          await sendResult(request, {
            ok: false,
            error: { code: 'DEADLINE_EXCEEDED', message: '前端工具请求已超过截止时间', recoverable: true },
          })
          return
        }

        const controller = new AbortController()
        active.set(request.callId, controller)
        const operationName = getFrontendToolOperationName(request.operation)
        logger.info('前端工具执行开始', {
          event: 'assistant.frontend_tool.start',
          requestId: request.runId,
          taskId: request.toolCallId,
          command: operationName,
        })
        try {
          const { executeApplicationCapabilityResult } = await loadApplicationCapabilityRegistry()
          const result = await executeApplicationCapabilityResult(
            request.operation.capability,
            controller.signal
          )
          await sendResult(request, result)
          logger.info('前端工具执行完成', {
            event: result.ok ? 'assistant.frontend_tool.completed' : 'assistant.frontend_tool.failed',
            requestId: request.runId,
            taskId: request.toolCallId,
            command: operationName,
          })
        } catch (error) {
          logger.error('前端工具结果回传失败', error, {
            event: 'assistant.frontend_tool.result.failed',
            requestId: request.runId,
            taskId: request.toolCallId,
          })
        } finally {
          active.delete(request.callId)
        }
      })()
    }

    const disposeRequest = onFrontendToolRequest(handleRequest)
    const disposeCancel = onFrontendToolCancel(({ callId }) => active.get(callId)?.abort())
    return () => {
      disposeRequest()
      disposeCancel()
      for (const controller of active.values()) controller.abort()
      active.clear()
    }
  }, [])
}

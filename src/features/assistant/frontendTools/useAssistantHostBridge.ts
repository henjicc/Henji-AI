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

import { FrontendToolExecutionCoordinator } from './executionCoordinator'

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
    const coordinator = new FrontendToolExecutionCoordinator({
      rendererSessionId: getRendererSessionId(),
      acknowledge: (request, executionPreparation) => acknowledgeFrontendTool({
        schemaVersion: AGENT_CONTRACT_VERSION, callId: request.callId,
        rendererSessionId: getRendererSessionId(), acknowledgedAt: new Date().toISOString(),
        ...(executionPreparation ? { executionPreparation } : {}),
      }),
      complete: completeFrontendTool,
      execute: async (request, context) => {
        const { executeApplicationCapabilityResult } = await loadApplicationCapabilityRegistry()
        return executeApplicationCapabilityResult(request.operation.capability, context)
      },
      reportError: (error, request, stage) => logger.error('前端操作或回执暂未完成', error, {
        event: `assistant.frontend_tool.${stage}.failed`, requestId: request.runId, taskId: request.toolCallId,
      }),
    })
    const disposeRequest = onFrontendToolRequest((request) => {
      void coordinator.receive(request).catch((error) => logger.error('前端工具请求处理失败', error, {
        event: 'assistant.frontend_tool.request.failed', requestId: request.runId, taskId: request.toolCallId,
      }))
    })
    const disposeCancel = onFrontendToolCancel(({ callId }) => coordinator.cancel(callId))
    return () => {
      disposeRequest()
      disposeCancel()
      coordinator.dispose()
    }
  }, [])
}

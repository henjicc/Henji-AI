import type { AiRuntimeTrace } from '@/core/types'
import type { TestModeTraceRecord } from '@/utils/testMode'

interface ApiTraceViewerProps {
  traceRecord: TestModeTraceRecord
  compact?: boolean
}

function stringifyTraceJson(value: DynamicValue): string {
  return JSON.stringify(value ?? null, null, 2)
}

function getRequestDisplayValue(trace: AiRuntimeTrace): DynamicValue {
  if (trace.requestBody !== undefined) {
    return trace.requestBody
  }

  return {
    note: '该请求没有 JSON body，通常是轮询或 GET 请求。',
    taskId: trace.taskId ?? null
  }
}

export function ApiTraceViewer({ traceRecord, compact = false }: ApiTraceViewerProps): JSX.Element {
  const { model, prompt, timestamp, trace, type } = traceRecord
  const blockClassName = compact
    ? 'max-h-56 overflow-y-auto rounded-lg border border-border-dark/50 bg-black/40 p-3 text-2xs text-gray-200'
    : 'max-h-72 overflow-y-auto rounded-lg border border-border-dark/50 bg-black/40 p-3 text-xs text-gray-200'

  return (
    <div className="space-y-3">
      <div className="grid gap-2 text-xs text-gray-300 md:grid-cols-2">
        <div><span className="text-gray-500">模型：</span>{model}</div>
        <div><span className="text-gray-500">类型：</span>{type ?? '-'}</div>
        <div><span className="text-gray-500">Provider：</span>{trace.providerId}</div>
        <div><span className="text-gray-500">阶段：</span>{trace.phase}</div>
        <div><span className="text-gray-500">方法：</span>{trace.method}</div>
        <div><span className="text-gray-500">路由：</span>{trace.route}</div>
        <div><span className="text-gray-500">Request ID：</span>{trace.requestId}</div>
        <div><span className="text-gray-500">Task ID：</span>{trace.taskId ?? '-'}</div>
        <div className="md:col-span-2">
          <span className="text-gray-500">时间：</span>
          {new Date(timestamp).toLocaleString('zh-CN')}
        </div>
        {prompt && (
          <div className="md:col-span-2 break-all">
            <span className="text-gray-500">提示词：</span>
            {prompt}
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 text-2xs font-medium uppercase tracking-[0.14em] text-yellow-500">
          最终实际请求 JSON
        </div>
        <pre className={blockClassName}>
          {stringifyTraceJson(getRequestDisplayValue(trace))}
        </pre>
      </div>

      <div>
        <div className="mb-2 text-2xs font-medium uppercase tracking-[0.14em] text-emerald-400">
          API 实际响应 JSON
        </div>
        <pre className={blockClassName}>
          {stringifyTraceJson(trace.responseBody)}
        </pre>
      </div>
    </div>
  )
}

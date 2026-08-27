import { createMainLogger } from '../../logging'
import {
  modelCapabilitySmokeRequestSchema,
  type CapabilitySmokeCheck,
  type CapabilitySmokeCheckId,
  type ModelCapabilitySmokeRequest,
  type ModelCapabilitySmokeResult,
} from '../../../../../src/core/llm/capabilitySmoke'
import {
  cancelModelStepTask,
  parseModelProviderError,
  resolveModelStepProviderAdapter,
  runModelStep,
  type ModelStepInput,
  type ModelStepResult,
  type ModelStepUsage,
} from '@henjicc/ai-sdk'
import { sdkRuntimeContext } from '../../ai-runtime/sdk-runtime'

export const MODEL_STEP_ADAPTER_VERSION = 'ai@6.0.234/openai-compatible@2.0.62'
const logger = createMainLogger('main.llm_capability_smoke')

const emptyUsage: ModelStepUsage = {
  inputTokens: null,
  inputNoCacheTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  outputTokens: null,
  textTokens: null,
  reasoningTokens: null,
  totalTokens: null,
}

function extractErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.match(/\[([^\]]+)]/)?.[1] ?? 'unknown_error'
}

/**
 * 取消有两种合法表示，走哪条是**竞态**，不是能力差异。
 *
 * 探测在 30ms 后取消请求。定时器在请求派发前触发，runtime 抛 `[task_cancelled]`；派发后
 * 触发，中止信号进到供应商调用里，抛的是 `[provider_error]{category:"cancelled"}`。
 * 快的网关更容易落到后一条。
 *
 * 旧实现只认前一种，于是同一份代码在 deepseek 上过、在 mimo 上挂——实测 mimo-v2.5-pro 其余
 * 五项全过，只因这一项被判失败，主模型就被整个判为不可用。这是本地判定太窄，不是模型不支持。
 */
function isCancellationError(error: unknown): boolean {
  return extractErrorCode(error) === 'task_cancelled'
    || parseModelProviderError(error)?.category === 'cancelled'
}

function addNullable(left: number | null, right: number | null): number | null {
  if (left === null && right === null) return null
  return (left ?? 0) + (right ?? 0)
}

function mergeUsage(left: ModelStepUsage, right: ModelStepUsage): ModelStepUsage {
  return {
    inputTokens: addNullable(left.inputTokens, right.inputTokens),
    inputNoCacheTokens: addNullable(left.inputNoCacheTokens, right.inputNoCacheTokens),
    cacheReadTokens: addNullable(left.cacheReadTokens, right.cacheReadTokens),
    cacheWriteTokens: addNullable(left.cacheWriteTokens, right.cacheWriteTokens),
    outputTokens: addNullable(left.outputTokens, right.outputTokens),
    textTokens: addNullable(left.textTokens, right.textTokens),
    reasoningTokens: addNullable(left.reasoningTokens, right.reasoningTokens),
    totalTokens: addNullable(left.totalTokens, right.totalTokens),
  }
}

function createStepInput(
  request: ModelCapabilitySmokeRequest,
  checkId: CapabilitySmokeCheckId,
  patch: Pick<ModelStepInput, 'messages' | 'tools' | 'output'>
): ModelStepInput {
  return {
    requestId: `${request.requestId}:${checkId}`,
    runId: request.requestId,
    stepId: `capability-${checkId}`,
    providerId: request.providerId,
    modelId: request.modelId,
    adapter: request.adapter,
    apiProtocol: request.apiProtocol,
    baseUrl: request.baseUrl,
    messages: patch.messages,
    tools: patch.tools,
    output: patch.output,
    capabilities: {
      image: false,
      video: false,
      audio: false,
      streaming: true,
      toolCall: true,
      parallelTools: true,
      structuredOutputMode: request.structuredOutputMode,
      reasoning: request.reasoning?.enabled === true,
      sampling: false,
      usage: true,
    },
    reasoning: request.reasoning,
    settings: { maxOutputTokens: 64, maxRetries: 0, timeoutMs: 30_000 },
  }
}

async function runCheck(
  id: CapabilitySmokeCheckId,
  operation: () => Promise<boolean>
): Promise<CapabilitySmokeCheck> {
  const startedAt = Date.now()
  try {
    const passed = await operation()
    return {
      id,
      status: passed ? 'passed' : 'failed',
      latencyMs: Date.now() - startedAt,
      errorCode: passed ? undefined : 'unexpected_response',
    }
  } catch (error) {
    return { id, status: 'failed', latencyMs: Date.now() - startedAt, errorCode: extractErrorCode(error) }
  }
}

export async function verifyModelCapabilities(rawRequest: ModelCapabilitySmokeRequest): Promise<ModelCapabilitySmokeResult> {
  const request = modelCapabilitySmokeRequestSchema.parse(rawRequest)
  const startedAt = Date.now()
  let aggregateUsage = emptyUsage
  const checks: CapabilitySmokeCheck[] = []

  const protocol = request.apiProtocol ?? 'openai-compatible'
  const protocolModalities = new Set(resolveModelStepProviderAdapter(protocol).supportedInputModalities)
  for (const modality of ['image', 'video', 'audio'] as const) {
    const declared = request.declaredInputModalities?.[modality] === true
    checks.push({
      id: modality,
      status: declared && !protocolModalities.has(modality) ? 'failed' : 'skipped',
      latencyMs: 0,
      errorCode: !declared
        ? 'not_declared'
        : protocolModalities.has(modality)
          ? 'manual_declaration_only'
          : 'unsupported_provider_modality',
    })
  }

  logger.info('模型能力验证开始', {
    event: 'llm_capability_smoke.run.start',
    requestId: request.requestId,
    providerId: request.providerId,
    modelId: request.modelId,
  })

  let textResult: ModelStepResult | null = null
  let textDeltaCount = 0
  checks.push(await runCheck('text', async () => {
    textResult = await runModelStep(createStepInput(request, 'text', {
      messages: [{ role: 'user', content: '只回复 OK' }],
      output: { mode: 'text' },
    }), event => { if (event.type === 'TextDelta') textDeltaCount += 1 }, sdkRuntimeContext)
    aggregateUsage = mergeUsage(aggregateUsage, textResult.usage)
    return textResult.text.trim().length > 0
  }))
  const observedTextResult = textResult as ModelStepResult | null
  checks.push({
    id: 'streaming',
    status: textDeltaCount > 0 ? 'passed' : 'failed',
    latencyMs: observedTextResult?.elapsedMs ?? 0,
    errorCode: textDeltaCount > 0 ? undefined : 'no_text_delta',
  })
  checks.push({
    id: 'usage',
    status: observedTextResult?.usage.totalTokens != null ? 'passed' : 'failed',
    latencyMs: observedTextResult?.elapsedMs ?? 0,
    errorCode: observedTextResult?.usage.totalTokens != null ? undefined : 'usage_missing',
  })

  checks.push(await runCheck('toolCall', async () => {
    const result = await runModelStep(createStepInput(request, 'toolCall', {
      messages: [{ role: 'user', content: '调用 capability_probe 工具，并传入 value="ok"' }],
      tools: [{
        name: 'capability_probe',
        description: '验证工具调用能力',
        inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
      }],
      output: { mode: 'text' },
    }), () => undefined, sdkRuntimeContext)
    aggregateUsage = mergeUsage(aggregateUsage, result.usage)
    return result.toolCalls.some(call => call.toolName === 'capability_probe')
  }))

  checks.push(await runCheck('structuredOutput', async () => {
    const result = await runModelStep(createStepInput(request, 'structuredOutput', {
      messages: [{ role: 'user', content: '只返回 JSON 对象：{"ok":true}' }],
      output: {
        mode: 'object',
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      },
    }), () => undefined, sdkRuntimeContext)
    aggregateUsage = mergeUsage(aggregateUsage, result.usage)
    return typeof result.structuredOutput === 'object' && result.structuredOutput !== null
  }))

  checks.push(await runCheck('cancel', async () => {
    const input = createStepInput(request, 'cancel', {
      messages: [{ role: 'user', content: '回复一个词' }],
      output: { mode: 'text' },
    })
    const timer = setTimeout(() => cancelModelStepTask(input.requestId), 30)
    try {
      await runModelStep(input, () => undefined, sdkRuntimeContext)
      return false
    } catch (error) {
      return isCancellationError(error)
    } finally {
      clearTimeout(timer)
    }
  }))

  const result: ModelCapabilitySmokeResult = {
    providerId: request.providerId,
    modelId: request.modelId,
    adapterVersion: MODEL_STEP_ADAPTER_VERSION,
    verifiedAt: new Date().toISOString(),
    checks,
    totalLatencyMs: Date.now() - startedAt,
    usage: {
      inputTokens: aggregateUsage.inputTokens,
      outputTokens: aggregateUsage.outputTokens,
      reasoningTokens: aggregateUsage.reasoningTokens,
      cacheReadTokens: aggregateUsage.cacheReadTokens,
      cacheWriteTokens: aggregateUsage.cacheWriteTokens,
      totalTokens: aggregateUsage.totalTokens,
    },
    cost: { status: 'unknown' },
  }

  const failedChecks = result.checks.filter(check => check.status === 'failed')
  const logContext = {
    totalLatencyMs: result.totalLatencyMs,
    checks: result.checks.map(check => ({ id: check.id, status: check.status, errorCode: check.errorCode })),
    usage: result.usage,
    costStatus: result.cost.status,
  }
  const logMeta = {
    requestId: request.requestId,
    providerId: request.providerId,
    modelId: request.modelId,
    context: logContext,
  }
  if (failedChecks.length > 0) {
    logger.warn('模型能力验证存在失败项', { event: 'llm_capability_smoke.run.failed', ...logMeta })
  } else {
    logger.info('模型能力验证完成', { event: 'llm_capability_smoke.run.completed', ...logMeta })
  }
  return result
}

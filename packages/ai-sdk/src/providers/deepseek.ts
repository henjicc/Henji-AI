import { AiRuntimeError } from '../runtime/AiRuntimeError'
import type { ProviderContinuePollingInput, ProviderExecutionInput, ProviderExecutionResult } from '../types/runtime'
import { executeOpenAiCompatibleSpeech } from './openai-speech'

export const DEEPSEEK_API_BASE = 'https://api.deepseek.com'

/**
 * DeepSeek 语音合成：POST /v1/tools/tts 同步返回 WAV 二进制，错误时返回 OpenAI 兼容错误体。
 * 合成中途失败时连接会提前断开，读取响应体会抛错，不会当作成功结果。
 */
export async function execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
  return executeOpenAiCompatibleSpeech('DeepSeek', DEEPSEEK_API_BASE, input, 'wav')
}

export async function continuePolling(_input: ProviderContinuePollingInput): Promise<ProviderExecutionResult> {
  throw new AiRuntimeError('unsupported_provider', 'DeepSeek speech response is synchronous')
}

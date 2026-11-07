import { AiRuntimeError } from '../runtime/AiRuntimeError'
import type { ProviderContinuePollingInput, ProviderExecutionInput, ProviderExecutionResult } from '../types/runtime'
import { executeOpenAiCompatibleSpeech } from './openai-speech'

// 与 Groq LLM、语音识别共用同一 OpenAI 兼容前缀和同一把 `groq` 密钥。
const BASE_URL = 'https://api.groq.com/openai'

export async function execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
  return executeOpenAiCompatibleSpeech('Groq', BASE_URL, input, 'wav')
}

export async function continuePolling(_input: ProviderContinuePollingInput): Promise<ProviderExecutionResult> {
  throw new AiRuntimeError('unsupported_provider', 'Groq speech response is synchronous')
}

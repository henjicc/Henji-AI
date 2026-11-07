import { AiRuntimeError } from '../runtime/AiRuntimeError'
import type { ProviderContinuePollingInput, ProviderExecutionInput, ProviderExecutionResult } from '../types/runtime'
import { executeOpenAiCompatibleSpeech } from './openai-speech'

const BASE_URL = 'https://api.siliconflow.cn'

export async function execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
  return executeOpenAiCompatibleSpeech('SiliconFlow', BASE_URL, input, 'mp3')
}

export async function continuePolling(_input: ProviderContinuePollingInput): Promise<ProviderExecutionResult> {
  throw new AiRuntimeError('unsupported_provider', 'SiliconFlow speech response is synchronous')
}

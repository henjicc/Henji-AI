import { AiRuntimeError } from '../errors'
import type { ProviderContinuePollingInput, ProviderExecutionInput, ProviderExecutionResult } from '../types'
import * as apimart from './apimart'
import * as fal from './fal'
import * as kie from './kie'
import * as modelscope from './modelscope'
import * as ppio from './ppio'

export async function executeGenerate(
  providerId: string,
  input: ProviderExecutionInput
): Promise<ProviderExecutionResult> {
  switch (providerId) {
    case 'apimart':
      return await apimart.execute(input)
    case 'ppio':
      return await ppio.execute(input)
    case 'kie':
      return await kie.execute(input)
    case 'modelscope':
      return await modelscope.execute(input)
    case 'fal':
      return await fal.execute(input)
    default:
      throw new AiRuntimeError('unsupported_provider', `Unsupported provider: ${providerId}`)
  }
}

export async function executeContinuePolling(
  providerId: string,
  input: ProviderContinuePollingInput
): Promise<ProviderExecutionResult> {
  switch (providerId) {
    case 'apimart':
      return await apimart.continuePolling(input)
    case 'ppio':
      return await ppio.continuePolling(input)
    case 'kie':
      return await kie.continuePolling(input)
    case 'modelscope':
      return await modelscope.continuePolling(input)
    case 'fal':
      return await fal.continuePolling(input)
    default:
      throw new AiRuntimeError('unsupported_provider', `Unsupported provider: ${providerId}`)
  }
}

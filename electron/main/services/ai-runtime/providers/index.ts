import { AiRuntimeError } from '../errors'
import type { ProviderContinuePollingInput, ProviderExecutionInput, ProviderExecutionResult } from '../types'
import * as apimart from './apimart'
import * as bailian from './bailian'
import * as fal from './fal'
import * as grsai from './grsai'
import * as kie from './kie'
import * as modelscope from './modelscope'
import * as ppio from './ppio'
import * as volcengine from './volcengine'

export async function executeGenerate(
  providerId: string,
  input: ProviderExecutionInput
): Promise<ProviderExecutionResult> {
  switch (providerId) {
    case 'apimart':
      return await apimart.execute(input)
    case 'bailian':
      return await bailian.execute(input)
    case 'volcengine':
      return await volcengine.execute(input)
    case 'ppio':
      return await ppio.execute(input)
    case 'kie':
      return await kie.execute(input)
    case 'modelscope':
      return await modelscope.execute(input)
    case 'fal':
      return await fal.execute(input)
    case 'grsai':
      return await grsai.execute(input)
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
    case 'bailian':
      return await bailian.continuePolling(input)
    case 'volcengine':
      return await volcengine.continuePolling(input)
    case 'ppio':
      return await ppio.continuePolling(input)
    case 'kie':
      return await kie.continuePolling(input)
    case 'modelscope':
      return await modelscope.continuePolling(input)
    case 'fal':
      return await fal.continuePolling(input)
    case 'grsai':
      return await grsai.continuePolling(input)
    default:
      throw new AiRuntimeError('unsupported_provider', `Unsupported provider: ${providerId}`)
  }
}

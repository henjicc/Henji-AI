import type {
  ProviderContinuePollingInput,
  ProviderExecutionInput,
  ProviderExecutionResult,
} from '../types/runtime'

/** 单个生成供应商的执行协议；不包含目录或宿主状态。 */
export interface ProviderAdapter {
  execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult>
  continuePolling(input: ProviderContinuePollingInput): Promise<ProviderExecutionResult>
}

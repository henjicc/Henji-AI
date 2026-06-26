import { invoke } from '@tauri-apps/api/core'
import type {
  AiContinuePollingRequestDto,
  AiGenerateRequestDto,
  AiGenerateResponseDto,
  AiGetProgressEstimateRequestDto,
  AiProgressEstimateDto,
  AiRecordProgressSampleRequestDto,
  AiRecordProgressSampleResponseDto,
  AiRuntimePlatform,
  ProviderKeyStatusDto,
} from '@/platform/contracts/aiRuntime'

export function createTauriAiRuntime(): AiRuntimePlatform {
  return {
    async setProviderApiKey(providerId, apiKey) {
      await invoke('ai_set_provider_api_key', { providerId, apiKey })
    },
    async removeProviderApiKey(providerId) {
      await invoke('ai_remove_provider_api_key', { providerId })
    },
    async getProviderApiKey(providerId) {
      return await invoke<string | null>('ai_get_provider_api_key', { providerId })
    },
    async getProviderKeyStatus() {
      return await invoke<ProviderKeyStatusDto[]>('ai_get_provider_key_status')
    },
    async generate(request: AiGenerateRequestDto) {
      return await invoke<AiGenerateResponseDto>('ai_generate', { request })
    },
    async continuePolling(request: AiContinuePollingRequestDto) {
      return await invoke<AiGenerateResponseDto>('ai_continue_polling', { request })
    },
    async cancelTask(taskId) {
      await invoke('ai_cancel_task', { taskId })
    },
    async reloadModelManifest() {
      return await invoke<number>('ai_reload_model_manifest')
    },
    async getProgressEstimate(request: AiGetProgressEstimateRequestDto) {
      return await invoke<AiProgressEstimateDto>('ai_get_progress_estimate', { request })
    },
    async recordProgressSample(request: AiRecordProgressSampleRequestDto) {
      return await invoke<AiRecordProgressSampleResponseDto>('ai_record_progress_sample', { request })
    },
  }
}

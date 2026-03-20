import { createLogger } from '@/core/logging'
import { useSettingsStore } from '@/stores/settingsStore'

const logger = createLogger('services.upload.UploadService')

export type UploadProviderType = 'fal' | 'kie' | 'bizyair'

/**
 * UploadService now keeps only upload strategy settings for UI.
 *
 * Real upload execution has moved to Rust backend runtime.
 */
export class UploadService {
  private static instance: UploadService
  private constructor() {}

  static getInstance(): UploadService {
    if (!UploadService.instance) {
      UploadService.instance = new UploadService()
    }
    return UploadService.instance
  }

  setProvider(type: UploadProviderType): void {
    useSettingsStore.getState().setUploadProvider(type)
    logger.info('[UploadService]', `Provider set to ${type}`)
  }

  setFallbackEnabled(enabled: boolean): void {
    useSettingsStore.getState().setUploadFallbackEnabled(enabled)
    logger.info('[UploadService]', `Fallback enabled: ${enabled}`)
  }

  getCurrentProvider(): UploadProviderType {
    return useSettingsStore.getState().uploadProvider
  }

  isFallbackEnabled(): boolean {
    return useSettingsStore.getState().uploadFallbackEnabled
  }

  async uploadFile(_file: File | Blob | string, _filename?: string): Promise<string> {
    throw new Error('Upload execution moved to backend runtime')
  }

  async uploadFiles(_files: (File | Blob | string)[]): Promise<string[]> {
    throw new Error('Upload execution moved to backend runtime')
  }
}


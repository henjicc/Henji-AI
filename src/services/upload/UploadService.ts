import { logInfo } from '../../utils/errorLogger'

export type UploadProviderType = 'fal' | 'kie' | 'bizyair'

/**
 * UploadService now keeps only upload strategy settings for UI.
 *
 * Real upload execution has moved to Rust backend runtime.
 */
export class UploadService {
  private static instance: UploadService

  private currentProvider: UploadProviderType = 'bizyair'

  private fallbackEnabled = true

  private constructor() {
    const savedProvider = localStorage.getItem('general_upload_provider') as UploadProviderType | null
    if (savedProvider && ['fal', 'kie', 'bizyair'].includes(savedProvider)) {
      this.currentProvider = savedProvider
    }

    const savedFallback = localStorage.getItem('general_upload_fallback')
    if (savedFallback !== null) {
      this.fallbackEnabled = savedFallback !== 'false'
    }
  }

  static getInstance(): UploadService {
    if (!UploadService.instance) {
      UploadService.instance = new UploadService()
    }
    return UploadService.instance
  }

  setProvider(type: UploadProviderType): void {
    this.currentProvider = type
    localStorage.setItem('general_upload_provider', type)
    logInfo('[UploadService]', `Provider set to ${type}`)
  }

  setFallbackEnabled(enabled: boolean): void {
    this.fallbackEnabled = enabled
    localStorage.setItem('general_upload_fallback', String(enabled))
    logInfo('[UploadService]', `Fallback enabled: ${enabled}`)
  }

  getCurrentProvider(): UploadProviderType {
    return this.currentProvider
  }

  isFallbackEnabled(): boolean {
    return this.fallbackEnabled
  }

  async uploadFile(_file: File | Blob | string, _filename?: string): Promise<string> {
    throw new Error('Upload execution moved to backend runtime')
  }

  async uploadFiles(_files: (File | Blob | string)[]): Promise<string[]> {
    throw new Error('Upload execution moved to backend runtime')
  }
}

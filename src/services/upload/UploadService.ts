import { UploadProvider } from './providers/BaseUploadProvider'
import { FalUploadProvider } from './providers/FalUploadProvider'
import { KieUploadProvider } from './providers/KieUploadProvider'
import { BizyAirUploadProvider } from './providers/BizyAirUploadProvider'
import { logInfo, logError } from '../../utils/errorLogger'

export type UploadProviderType = 'fal' | 'kie' | 'bizyair'

export class UploadService {
    private static instance: UploadService
    private providers: Map<UploadProviderType, UploadProvider> = new Map()
    private currentProvider: UploadProviderType = 'bizyair'
    private fallbackEnabled: boolean = true

    private constructor() {
        this.providers.set('fal', new FalUploadProvider())
        this.providers.set('kie', new KieUploadProvider())
        this.providers.set('bizyair', new BizyAirUploadProvider())

        // 从 localStorage 加载配置
        const savedProvider = localStorage.getItem('general_upload_provider') as UploadProviderType
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

    setProvider(type: UploadProviderType) {
        if (this.providers.has(type)) {
            this.currentProvider = type
            localStorage.setItem('general_upload_provider', type)
            logInfo('[UploadService]', `Provider set to ${type}`)
        }
    }

    setFallbackEnabled(enabled: boolean) {
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

    private getFallbackCandidates(): UploadProviderType[] {
        // 定义优先顺序
        const priority: UploadProviderType[] = ['bizyair', 'kie', 'fal']
        // 过滤掉当前的，剩下的按优先级尝试
        return priority.filter(p => p !== this.currentProvider)
    }

    /**
     * 上传单个文件，带自动回退机制
     */
    async uploadFile(file: File | Blob | string, filename?: string): Promise<string> {
        const primaryProvider = this.providers.get(this.currentProvider)

        // 1. 尝试首选提供商
        if (primaryProvider && primaryProvider.isAvailable()) {
            try {
                return await primaryProvider.upload(file, filename)
            } catch (error) {
                logError(`[UploadService] Primary provider ${primaryProvider.name} failed:`, error)
                if (!this.fallbackEnabled) {
                    throw error
                }
            }
        } else {
            logInfo(`[UploadService]`, `Primary provider ${this.currentProvider} not available/configured`)
            if (!this.fallbackEnabled) {
                throw new Error(`Upload provider ${this.currentProvider} is not configured`)
            }
        }

        // 2. 尝试回退
        logInfo('[UploadService]', 'Attempting fallback for single file...')
        const fallbackTypes = this.getFallbackCandidates()

        for (const type of fallbackTypes) {
            const provider = this.providers.get(type)
            if (provider && provider.isAvailable()) {
                try {
                    logInfo(`[UploadService]`, `Trying fallback provider: ${provider.name}`)
                    const result = await provider.upload(file, filename)
                    logInfo(`[UploadService]`, `Fallback to ${provider.name} successful`)
                    return result
                } catch (error) {
                    logError(`[UploadService] Fallback provider ${provider.name} failed:`, error)
                }
            }
        }

        throw new Error('All configured upload providers failed')
    }

    /**
     * 批量上传文件，带自动回退机制
     */
    async uploadFiles(files: (File | Blob | string)[]): Promise<string[]> {
        if (files.length === 0) return []

        const primaryProvider = this.providers.get(this.currentProvider)

        // 1. 尝试首选提供商
        if (primaryProvider && primaryProvider.isAvailable()) {
            try {
                return await primaryProvider.uploadMultiple(files)
            } catch (error) {
                logError(`[UploadService] Batch upload failed with primary provider ${primaryProvider.name}:`, error)
                if (!this.fallbackEnabled) {
                    throw error
                }
            }
        } else {
            if (!this.fallbackEnabled) {
                throw new Error(`Upload provider ${this.currentProvider} is not configured`)
            }
        }

        // 2. 尝试回退
        logInfo('[UploadService]', 'Attempting fallback for batch upload...')
        const fallbackTypes = this.getFallbackCandidates()

        for (const type of fallbackTypes) {
            const provider = this.providers.get(type)
            if (provider && provider.isAvailable()) {
                try {
                    logInfo(`[UploadService]`, `Trying fallback provider: ${provider.name}`)
                    const results = await provider.uploadMultiple(files)
                    logInfo(`[UploadService]`, `Fallback to ${provider.name} successful`)
                    return results
                } catch (error) {
                    logError(`[UploadService] Fallback provider ${provider.name} failed:`, error)
                }
            }
        }

        throw new Error('All configured upload providers failed for batch upload')
    }
}

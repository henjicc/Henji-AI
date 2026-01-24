import { registry } from '@/core/ModelRegistry'

/**
 * 进度配置类型
 */
export interface ProgressConfig {
    /** 进度类型 */
    type: 'polling' | 'time' | 'none'
    /** 预期轮询次数（仅 polling 类型） */
    expectedPolls?: number
    /** 预期耗时（毫秒，仅 time 类型） */
    expectedDuration?: number
}

/**
 * 获取指定模型的进度配置
 * 
 * @param modelId 模型ID
 * @returns 进度配置对象
 * 
 * @example
 * ```typescript
 * const config = getProgressConfig('vidu-q1')
 * // { type: 'polling', expectedPolls: 60 }
 * 
 * const config2 = getProgressConfig('seedream-4.0')
 * // { type: 'time', expectedDuration: 20000 }
 * ```
 */
export function getProgressConfig(modelId: string): ProgressConfig {
    const model = registry.getModel(modelId)
    if (!model) {
        return {
            type: 'polling',
            expectedPolls: 40
        }
    }

    const progress = model.meta.progress

    if (progress?.mode === 'time') {
        return {
            type: 'time',
            expectedDuration: progress.baseDurationMs
        }
    }

    if (progress?.mode === 'polling') {
        return {
            type: 'polling',
            expectedPolls: progress.baseAttempts
        }
    }

    if (model.meta.polling) {
        return {
            type: 'polling',
            expectedPolls: model.meta.polling.expectedAttempts || model.meta.polling.maxAttempts
        }
    }

    return {
        type: 'polling',
        expectedPolls: 40
    }
}

/**
 * 获取预期轮询次数（仅用于轮询类型）
 * 
 * @param modelId 模型ID
 * @returns 预期轮询次数
 */
export function getExpectedPolls(modelId: string): number {
    const config = getProgressConfig(modelId)
    return config.expectedPolls || 40
}

/**
 * 获取预期耗时（仅用于时间类型）
 * 
 * @param modelId 模型ID
 * @returns 预期耗时（毫秒）
 */
export function getExpectedDuration(modelId: string): number {
    const config = getProgressConfig(modelId)
    return config.expectedDuration || 20000
}

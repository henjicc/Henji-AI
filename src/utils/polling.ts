import { calculateProgress } from './progress'

/**
 * 通用轮询配置
 */
export interface PollingOptions<T> {
    /** 检查函数：返回当前状态和可能的结果 */
    checkFn: () => Promise<{ status: string; result?: T }>
    /** 判断是否完成 */
    isComplete: (status: string) => boolean
    /** 判断是否失败 */
    isFailed: (status: string) => boolean
    /** 进度回调 */
    onProgress?: (progress: number, status: string) => void
    /** 轮询间隔（毫秒） */
    interval?: number
    /** 最大轮询次数 */
    maxAttempts?: number
    /** 预期轮询次数（用于进度计算） */
    estimatedAttempts?: number
}

/**
 * 通用轮询函数
 * 
 * @example
 * ```typescript
 * const result = await pollUntilComplete({
 *   checkFn: () => this.checkStatus(taskId),
 *   isComplete: (s) => s === 'COMPLETED',
 *   isFailed: (s) => s === 'FAILED',
 *   onProgress: (p) => console.log(`Progress: ${p}%`),
 *   interval: 3000,
 *   estimatedAttempts: 40
 * })
 * ```
 */
export async function pollUntilComplete<T>(
    options: PollingOptions<T>
): Promise<T> {
    const {
        checkFn,
        isComplete,
        isFailed,
        onProgress,
        interval = 1000,
        maxAttempts = 120,
        estimatedAttempts = 40
    } = options

    let attempts = 0

    while (attempts < maxAttempts) {
        const { status, result } = await checkFn()

        // 计算进度（使用统一的渐近式算法）
        const progress = calculateProgress(attempts, estimatedAttempts)

        if (onProgress) {
            onProgress(progress, status)
        }

        if (isComplete(status)) {
            if (!result) {
                throw new Error('Task completed but no result returned')
            }
            return result
        }

        if (isFailed(status)) {
            throw new Error(`Task failed with status: ${status}`)
        }

        await new Promise(resolve => setTimeout(resolve, interval))
        attempts++
    }

    throw new Error('Polling timeout')
}

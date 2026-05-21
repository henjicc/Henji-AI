/**
 * 任务队列管理器
 * 实现并发控制，允许同时执行多个生成任务
 */

export interface QueuedTask {
    id: string
    providerId?: string
    execute: () => Promise<void>
    onStart?: () => void
    onComplete?: () => void
    onError?: (error: Error) => void
}

class TaskQueueManager {
    private queue: QueuedTask[] = []
    private running: Map<string, string> = new Map()
    private maxConcurrency: number = 2

    constructor() {
        // 从 localStorage 加载保存的并发设置
        const saved = localStorage.getItem('max_concurrent_tasks')
        if (saved) {
            const value = parseInt(saved, 10)
            if (!isNaN(value) && value >= 1 && value <= 10) {
                this.maxConcurrency = value
            }
        }
    }

    /**
     * 设置最大并发数
     */
    setMaxConcurrency(value: number): void {
        this.maxConcurrency = Math.max(1, Math.min(10, value))
        // 设置变更后立即尝试处理队列（可能有新的槽位可用）
        this.processQueue()
    }

    /**
     * 获取当前最大并发数
     */
    getMaxConcurrency(): number {
        return this.maxConcurrency
    }

    /**
     * 将任务加入队列
     * @returns 是否立即开始执行（true）或进入排队（false）
     */
    enqueue(task: QueuedTask): boolean {
        this.queue.push(task)
        this.processQueue()
        return this.isRunning(task.id)
    }

    /**
     * 处理队列，启动可以执行的任务
     * @returns 是否有任务开始执行
     */
    private processQueue(): boolean {
        let started = false

        while (this.queue.length > 0) {
            const taskIndex = this.queue.findIndex((item) => this.hasAvailableSlot(item.providerId))
            if (taskIndex < 0) break

            const [task] = this.queue.splice(taskIndex, 1)
            if (!task) break

            const providerKey = this.resolveProviderKey(task.providerId)
            this.running.set(task.id, providerKey)
            started = true

            // 通知任务开始
            if (task.onStart) {
                task.onStart()
            }

            // 执行任务
            task.execute()
                .then(() => {
                    this.running.delete(task.id)
                    if (task.onComplete) {
                        task.onComplete()
                    }
                    // 任务完成后继续处理队列
                    this.processQueue()
                })
                .catch((error) => {
                    this.running.delete(task.id)
                    if (task.onError) {
                        task.onError(error instanceof Error ? error : new Error(String(error)))
                    }
                    // 即使出错也继续处理队列
                    this.processQueue()
                })
        }

        return started
    }

    private resolveProviderKey(providerId: string | undefined): string {
        const trimmed = providerId?.trim()
        return trimmed && trimmed.length > 0 ? trimmed : '__unknown_provider__'
    }

    private getRunningCountForProvider(providerId: string | undefined): number {
        const providerKey = this.resolveProviderKey(providerId)
        let count = 0
        for (const runningProvider of this.running.values()) {
            if (runningProvider === providerKey) {
                count += 1
            }
        }
        return count
    }

    /**
     * 获取正在运行的任务数量
     */
    getRunningCount(): number {
        return this.running.size
    }

    /**
     * 获取排队等待的任务数量
     */
    getQueuedCount(): number {
        return this.queue.length
    }

    /**
     * 检查是否有可用的执行槽位
     */
    hasAvailableSlot(providerId?: string): boolean {
        return this.getRunningCountForProvider(providerId) < this.maxConcurrency
    }

    /**
     * 检查指定任务是否正在运行
     */
    isRunning(taskId: string): boolean {
        return this.running.has(taskId)
    }

    /**
     * 检查指定任务是否在队列中等待
     */
    isQueued(taskId: string): boolean {
        return this.queue.some(t => t.id === taskId)
    }

    /**
     * 从队列中移除指定任务（如果还未开始执行）
     * @returns 是否成功移除
     */
    removeFromQueue(taskId: string): boolean {
        const index = this.queue.findIndex(t => t.id === taskId)
        if (index !== -1) {
            this.queue.splice(index, 1)
            return true
        }
        return false
    }

    /**
     * 清空队列中的所有等待任务
     */
    clearQueue(): void {
        this.queue = []
    }
}

// 导出单例实例
export const taskQueueManager = new TaskQueueManager()

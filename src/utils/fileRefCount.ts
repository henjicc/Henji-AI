// 使用 App.tsx 中的 GenerationTask 类型
export interface Task {
    id: string
    uploadedFilePaths?: string[]
    // 其他字段在此处不需要，因为我们只关心 uploadedFilePaths
}

import { Preset } from '../types/preset'

/**
 * 统计文件引用计数
 * @param filePath 文件路径
 * @param tasks 所有历史记录
 * @param presets 所有预设
 * @returns 引用计数
 */
export function getFileRefCount(
    filePath: string,
    tasks: Task[],
    presets: Preset[]
): number {
    let count = 0

    // 统计历史记录中的引用
    for (const task of tasks) {
        if (task.uploadedFilePaths?.includes(filePath)) {
            count++
        }
    }

    // 统计预设中的引用
    for (const preset of presets) {
        if (preset.images?.filePaths?.includes(filePath)) {
            count++
        }
    }

    return count
}

/**
 * 获取所有文件的引用计数映射
 * @param tasks 所有历史记录
 * @param presets 所有预设
 * @returns 文件路径 -> 引用计数的映射
 */
export function getAllFileRefCounts(
    tasks: Task[],
    presets: Preset[]
): Map<string, number> {
    const refCounts = new Map<string, number>()

    // 统计历史记录中的文件
    for (const task of tasks) {
        if (task.uploadedFilePaths) {
            for (const filePath of task.uploadedFilePaths) {
                refCounts.set(filePath, (refCounts.get(filePath) || 0) + 1)
            }
        }
    }

    // 统计预设中的文件
    for (const preset of presets) {
        if (preset.images?.filePaths) {
            for (const filePath of preset.images.filePaths) {
                refCounts.set(filePath, (refCounts.get(filePath) || 0) + 1)
            }
        }
    }

    return refCounts
}

/**
 * 检查文件是否可以安全删除
 * @param filePath 文件路径
 * @param tasks 所有历史记录
 * @param presets 所有预设
 * @param excludeTaskId 要排除的任务ID（即将被删除的任务）
 * @returns 是否可以删除
 */
export function canDeleteFile(
    filePath: string,
    tasks: Task[],
    presets: Preset[],
    excludeTaskId?: string
): boolean {
    // 过滤掉即将被删除的任务
    const activeTasks = excludeTaskId
        ? tasks.filter(t => t.id !== excludeTaskId)
        : tasks

    const refCount = getFileRefCount(filePath, activeTasks, presets)
    return refCount === 0
}

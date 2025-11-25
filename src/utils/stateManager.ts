/**
 * 通用状态管理器
 * 用于预设系统的自动化状态保存和恢复
 */

export interface StateSetter<T = any> {
    (value: T): void
}

export interface StateDescriptor<T = any> {
    get: () => T
    set: StateSetter<T>
}

export type StateMap = Record<string, StateDescriptor>

/**
 * 从状态映射中提取当前值
 */
export function captureState(stateMap: StateMap): Record<string, any> {
    const captured: Record<string, any> = {}

    for (const [key, descriptor] of Object.entries(stateMap)) {
        try {
            captured[key] = descriptor.get()
        } catch (error) {
            console.warn(`Failed to capture state for "${key}":`, error)
        }
    }

    return captured
}

/**
 * 将保存的状态恢复到状态映射
 */
export function restoreState(stateMap: StateMap, savedState: Record<string, any>): void {
    for (const [key, value] of Object.entries(savedState)) {
        const descriptor = stateMap[key]

        if (!descriptor) {
            console.warn(`No state descriptor found for "${key}", skipping...`)
            continue
        }

        try {
            // 只恢复有效值（不是undefined/null）
            if (value !== undefined && value !== null) {
                descriptor.set(value)
            }
        } catch (error) {
            console.warn(`Failed to restore state for "${key}":`, error)
        }
    }
}

/**
 * 按分类组织状态映射
 */
export interface CategorizedStateMap {
    common?: StateMap
    image?: StateMap
    video?: StateMap
    audio?: StateMap
    [category: string]: StateMap | undefined
}

/**
 * 从分类状态映射中提取当前值
 */
export function captureCategorizedState(
    categorizedMap: CategorizedStateMap,
    categories?: string[]
): Record<string, any> {
    const result: Record<string, any> = {}

    const targetCategories = categories || Object.keys(categorizedMap)

    for (const category of targetCategories) {
        const stateMap = categorizedMap[category]
        if (stateMap) {
            result[category] = captureState(stateMap)
        }
    }

    return result
}

/**
 * 将保存的分类状态恢复
 */
export function restoreCategorizedState(
    categorizedMap: CategorizedStateMap,
    savedState: Record<string, any>
): void {
    for (const [category, categoryState] of Object.entries(savedState)) {
        const stateMap = categorizedMap[category]
        if (stateMap && typeof categoryState === 'object') {
            restoreState(stateMap, categoryState)
        }
    }
}

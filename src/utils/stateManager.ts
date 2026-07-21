import { createLogger } from '@/core/logging'

const logger = createLogger('utils.stateManager')

/**
 * 通用状态管理器
 * 用于预设系统的自动化状态保存和恢复
 */
export interface StateSetter<T = DynamicValue> {
    (value: T): void
}

export interface StateDescriptor<T = DynamicValue> {
    get: () => T
    set: StateSetter<T>
}

export type StateMap = Record<string, StateDescriptor>

/**
 * 从状态映射中提取当前值
 */
export function captureState(stateMap: StateMap): DynamicValueMap {
    const captured: DynamicValueMap = {}

    for (const [key, descriptor] of Object.entries(stateMap)) {
        try {
            captured[key] = descriptor.get()
        } catch (error) {
            logger.warn(`Failed to capture state for "${key}":`, error)
        }
    }

    return captured
}

/**
 * 将保存的状态恢复到状态映射
 */
export function restoreState(stateMap: StateMap, savedState: DynamicValueMap): void {
    for (const [key, value] of Object.entries(savedState)) {
        const descriptor = stateMap[key]

        if (!descriptor) {
            logger.warn(`No state descriptor found for "${key}", skipping...`, {})
            continue
        }

        try {
            // 只恢复有效值（不是undefined/null）
            if (value !== undefined && value !== null) {
                descriptor.set(value)
            }
        } catch (error) {
            logger.warn(`Failed to restore state for "${key}":`, error)
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
): DynamicValueMap {
    const result: DynamicValueMap = {}

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
    savedState: DynamicValueMap
): void {
    for (const [category, categoryState] of Object.entries(savedState)) {
        const stateMap = categorizedMap[category]
        if (stateMap && typeof categoryState === 'object') {
            restoreState(stateMap, categoryState)
        }
    }
}


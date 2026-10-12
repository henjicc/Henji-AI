import { createLogger } from '@/core/logging'
import { Preset, PresetSaveMode } from '../types/preset'
import { presetService } from '@/services/presets/PresetService'
import type { Preset as StoredPreset } from '@/core/types/Preset'
import type { PromptDocumentV1, PromptMediaBinding } from '@/core/inputs/promptDocument'

const logger = createLogger('utils.preset')

// The panel is a projection of the existing SQLite preset service, not a second library.
function toPanelPreset(record: StoredPreset): Preset {
    const data = record.params as Partial<Preset>
    return {
        ...data,
        id: record.id,
        name: record.name,
        createdAt: new Date(record.createdAt).getTime(),
        updatedAt: new Date(record.updatedAt).getTime(),
        prompt: typeof data.prompt === 'string' ? data.prompt : typeof record.params.input === 'string' ? record.params.input : '',
        saveMode: data.saveMode ?? 'full',
        params: data.params ?? record.params,
    }
}

export async function loadPresets(): Promise<Preset[]> {
    try {
        return (await presetService.getPresets()).map(toPanelPreset)
    } catch (error) {
        logger.error('加载预设失败，未修改原库', { event: 'presets.read.failed', error })
        throw error
    }
}

// 创建新预设
export async function createPreset(
    name: string,
    prompt: string,
    saveMode: PresetSaveMode,
    options?: {
        images?: string[]
        imageFilePaths?: string[]
        promptDocument?: PromptDocumentV1
        promptMediaBindings?: PromptMediaBinding[]
        model?: { provider: string; modelId: string; type: 'image' | 'video' | 'audio' }

        params?: Preset['params']
    }
): Promise<Preset> {
    await loadPresets()

    const newPreset: Omit<Preset, 'id'> = {
        name,
        prompt,
        saveMode,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...(options?.promptDocument ? { promptDocument: options.promptDocument } : {}),
        ...(options?.promptMediaBindings?.length
            ? { promptMediaBindings: options.promptMediaBindings }
            : {}),
    }

    // 根据保存模式添加可选数据
    if (saveMode === 'prompt-image' || saveMode === 'full') {
        if ((options?.images?.length ?? 0) > 0 || (options?.imageFilePaths?.length ?? 0) > 0) {
            newPreset.images = {
                ...(options?.images?.length ? { dataUrls: options.images } : {}),
                ...(options?.imageFilePaths?.length ? { filePaths: options.imageFilePaths } : {}),
            }
        }
    }

    if (saveMode === 'full') {
        if (options?.model) {
            newPreset.model = options.model
        }
        if (options?.params) {
            newPreset.params = options.params
        }
    }

    const { name: storedName, createdAt: _createdAt, updatedAt: _updatedAt, ...params } = newPreset
    const created = await presetService.createPreset({ name: storedName, modelId: options?.model?.modelId, params })
    return toPanelPreset(created)
}

// SQLite mutations affect only the selected row; a failed read never becomes an empty-library write.
export async function deletePreset(id: string): Promise<void> {
    await presetService.deletePreset(id)
}

export async function renamePreset(id: string, newName: string): Promise<void> {
    await presetService.updatePreset(id, { name: newName })
}

export async function updatePreset(id: string, updates: Partial<Preset>): Promise<void> {
    const stored = await presetService.getPresetById(id)
    if (!stored) return
    const { id: _id, name, createdAt: _createdAt, updatedAt: _updatedAt, ...params } = { ...toPanelPreset(stored), ...updates }
    await presetService.updatePreset(id, { name, params })
}

// 格式化时间为 "刚刚"、"5分钟前" 等
export function formatTimeAgo(timestamp: number): string {
    const now = Date.now()
    const diff = now - timestamp

    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (seconds < 60) return '刚刚'
    if (minutes < 60) return `${minutes}分钟前`
    if (hours < 24) return `${hours}小时前`
    if (days < 7) return `${days}天前`

    const date = new Date(timestamp)
    return `${date.getMonth() + 1}-${date.getDate()}`
}

// 格式化完整日期
export function formatDate(timestamp: number): string {
    const date = new Date(timestamp)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')

    return `${year}-${month}-${day} ${hours}:${minutes}`
}

import { Preset, PresetSaveMode } from '../types/preset'
import { readJsonFromAppData, writeJsonToAppData } from './save'
import { logError, logWarning, logInfo } from '../utils/errorLogger'

const PRESETS_FILE = 'presets.json'

// 生成 UUID
function generateId(): string {
    return `preset_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

// 读取所有预设
export async function loadPresets(): Promise<Preset[]> {
    try {
        const presets = await readJsonFromAppData<Preset[]>(PRESETS_FILE)
        return presets || []
    } catch (error) {
        logError('加载预设失败:', error)
        return []
    }
}

// 保存预设列表
async function savePresets(presets: Preset[]): Promise<void> {
    try {
        await writeJsonToAppData(PRESETS_FILE, presets)
    } catch (error) {
        logError('保存预设失败:', error)
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
        model?: { provider: string; modelId: string; type: 'image' | 'video' | 'audio' }
        params?: Preset['params']
    }
): Promise<Preset> {
    const presets = await loadPresets()

    const newPreset: Preset = {
        id: generateId(),
        name,
        prompt,
        saveMode,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    }

    // 根据保存模式添加可选数据
    if (saveMode === 'prompt-image' || saveMode === 'full') {
        if (options?.images && options.images.length > 0) {
            newPreset.images = {
                dataUrls: options.images
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

    presets.push(newPreset)
    await savePresets(presets)

    return newPreset
}

// 删除预设
export async function deletePreset(id: string): Promise<void> {
    const presets = await loadPresets()
    const filtered = presets.filter(p => p.id !== id)
    await savePresets(filtered)
}

// 重命名预设
export async function renamePreset(id: string, newName: string): Promise<void> {
    const presets = await loadPresets()
    const preset = presets.find(p => p.id === id)
    if (preset) {
        preset.name = newName
        preset.updatedAt = Date.now()
        await savePresets(presets)
    }
}

// 更新预设
export async function updatePreset(id: string, updates: Partial<Preset>): Promise<void> {
    const presets = await loadPresets()
    const preset = presets.find(p => p.id === id)
    if (preset) {
        Object.assign(preset, updates)
        preset.updatedAt = Date.now()
        await savePresets(presets)
    }
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

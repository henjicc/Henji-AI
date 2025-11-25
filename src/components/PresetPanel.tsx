import React, { useState, useEffect } from 'react'
import { Preset, PresetSaveMode } from '../types/preset'
import { loadPresets, createPreset, formatTimeAgo } from '../utils/preset'
import PanelTrigger from './ui/PanelTrigger'

interface PresetPanelProps {
    // 获取当前所有状态（用于保存）
    getCurrentState: () => Record<string, any>

    // 加载预设的回调（接收参数Record，由父组件处理恢复）
    onLoadPreset: (params: Record<string, any>) => void

    // 是否禁用
    disabled?: boolean
}

const PresetPanel: React.FC<PresetPanelProps> = ({
    getCurrentState,
    onLoadPreset,
    disabled
}) => {
    const [presets, setPresets] = useState<Preset[]>([])
    const [isSaving, setIsSaving] = useState(false)
    const [saveMode, setSaveMode] = useState<PresetSaveMode | null>(null)
    const [presetName, setPresetName] = useState('')

    // 加载预设列表
    useEffect(() => {
        loadPresetsData()
    }, [])

    const loadPresetsData = async () => {
        const data = await loadPresets()
        setPresets(data)
    }

    // 快速保存预设
    const handleQuickSave = async (mode: PresetSaveMode) => {
        const state = getCurrentState()
        if (!state.input?.trim()) {
            alert('提示词不能为空')
            return
        }

        setSaveMode(mode)
        // 生成默认名称
        const now = new Date()
        const defaultName = `预设_${now.getMonth() + 1}-${now.getDate()}_${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
        setPresetName(defaultName)
        setIsSaving(true)
    }

    // 确认保存
    const handleConfirmSave = async () => {
        if (!presetName.trim() || !saveMode) return

        try {
            const state = getCurrentState()

            // 直接保存所有参数(核心改进：完全通用，无需手动列举)
            await createPreset(
                presetName,
                state.input || '',  // 提示词
                saveMode,
                {
                    params: state  // 所有参数统一保存
                }
            )

            // 重新加载列表
            await loadPresetsData()

            // 重置状态
            setIsSaving(false)
            setSaveMode(null)
            setPresetName('')

            // 不再弹窗提示，体验更流畅
        } catch (error) {
            console.error('保存预设失败:', error)
            alert('保存预设失败')
        }
    }

    // 取消保存
    const handleCancelSave = () => {
        setIsSaving(false)
        setSaveMode(null)
        setPresetName('')
    }

    return (
        <PanelTrigger
            display="预设"
            disabled={disabled}
            className="w-auto"
            buttonClassName="px-4 py-2 bg-zinc-700/50 hover:bg-zinc-600/50 backdrop-blur-lg rounded-lg transition-all duration-300 border border-zinc-700/50 flex items-center text-sm"
            panelWidth={420}
            alignment="aboveCenter"
            stableHeight={true}
            zIndex={1001}
            closeOnPanelClick={(target) => {
                // 如果点击的是预设项，关闭面板
                // 如果正在保存，不关闭面板
                if (isSaving) return false
                return !!(target as HTMLElement).closest('[data-preset-item]')
            }}
            renderPanel={() => (
                <div className="p-4 h-full flex flex-col max-h-[500px]">
                    {/* 顶部区域：快速保存或输入名称 */}
                    <div className="mb-4 space-y-2">
                        <div className="text-xs text-zinc-400 mb-2">
                            {isSaving ? '输入名称以保存' : '快速保存'}
                        </div>

                        <div className="h-[60px] relative">
                            {/* 输入名称区域 */}
                            <div
                                className={`absolute inset-0 flex gap-2 items-center h-full transition-all duration-300 ${isSaving ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none scale-95'
                                    }`}
                            >
                                <input
                                    type="text"
                                    value={presetName}
                                    onChange={(e) => setPresetName(e.target.value)}
                                    placeholder="输入预设名称"
                                    className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-[#007eff]/60 focus:border-[#007eff] transition-all duration-300 text-white placeholder-zinc-500 text-sm"
                                    // 只有在显示时才自动聚焦，避免未显示时抢焦点
                                    ref={(input) => {
                                        if (isSaving && input) {
                                            // 简单的延时聚焦，确保动画开始后聚焦
                                            setTimeout(() => input.focus(), 50)
                                        }
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            handleConfirmSave()
                                        } else if (e.key === 'Escape') {
                                            handleCancelSave()
                                        }
                                    }}
                                />
                                <button
                                    onClick={handleConfirmSave}
                                    disabled={!presetName.trim()}
                                    className="px-3 py-2 bg-[#007eff] hover:bg-[#006add] text-white rounded-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed text-xs whitespace-nowrap"
                                >
                                    确定
                                </button>
                                <button
                                    onClick={handleCancelSave}
                                    className="px-3 py-2 bg-zinc-700/50 hover:bg-zinc-600/50 text-white rounded-lg transition-all duration-300 text-xs whitespace-nowrap"
                                >
                                    取消
                                </button>
                            </div>

                            {/* 快速保存按钮区域 */}
                            <div
                                className={`absolute inset-0 grid grid-cols-3 gap-2 h-full transition-all duration-300 ${!isSaving ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none scale-95'
                                    }`}
                            >
                                <button
                                    onClick={() => handleQuickSave('prompt')}
                                    className="px-3 py-2 bg-zinc-700/50 hover:bg-zinc-600/50 rounded-lg transition-all duration-300 text-xs flex flex-col items-center gap-1 justify-center"
                                    title="仅保存提示词和模型"
                                >
                                    <span className="text-base">💾</span>
                                    <span>仅提示词</span>
                                </button>
                                <button
                                    onClick={() => handleQuickSave('prompt-image')}
                                    className="px-3 py-2 bg-zinc-700/50 hover:bg-zinc-600/50 rounded-lg transition-all duration-300 text-xs flex flex-col items-center gap-1 justify-center"
                                    title="保存提示词、图片和模型"
                                >
                                    <span className="text-base">📦</span>
                                    <span>提示+图片</span>
                                </button>
                                <button
                                    onClick={() => handleQuickSave('full')}
                                    className="px-3 py-2 bg-zinc-700/50 hover:bg-zinc-600/50 rounded-lg transition-all duration-300 text-xs flex flex-col items-center gap-1 justify-center"
                                    title="保存完整配置"
                                >
                                    <span className="text-base">🔧</span>
                                    <span>完整配置</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* 分割线 */}
                    <div className="h-px bg-zinc-700/50 my-3"></div>

                    {/* 预设列表 */}
                    <div className="flex-1 overflow-y-auto">
                        <div className="text-xs text-zinc-400 mb-2 flex items-center justify-between">
                            <span>我的预设 ({presets.length})</span>
                        </div>

                        {presets.length === 0 ? (
                            <div className="text-center text-zinc-500 text-sm py-8">
                                暂无预设，快速保存一个吧！
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {presets.map(preset => (
                                    <div
                                        key={preset.id}
                                        data-preset-item
                                        onClick={() => {
                                            // 加载预设参数
                                            if (preset.params) {
                                                onLoadPreset(preset.params)
                                            }
                                        }}
                                        className="px-3 py-2.5 bg-zinc-700/40 hover:bg-zinc-700/60 rounded-lg border border-zinc-700/50 cursor-pointer transition-colors duration-200"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                {/* 模式图标 */}
                                                <span className="text-sm">
                                                    {preset.saveMode === 'prompt' && '💾'}
                                                    {preset.saveMode === 'prompt-image' && '📦'}
                                                    {preset.saveMode === 'full' && '🔧'}
                                                </span>
                                                <span className="text-sm font-medium truncate max-w-[200px]">{preset.name}</span>
                                            </div>
                                            {/* 时间戳 */}
                                            <span className="text-xs text-zinc-500">
                                                {formatTimeAgo(preset.updatedAt)}
                                            </span>
                                        </div>
                                        {/* 预览信息 */}
                                        <div className="mt-1 text-xs text-zinc-500 truncate">
                                            {preset.prompt.substring(0, 50)}{preset.prompt.length > 50 ? '...' : ''}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        />
    )
}

export default PresetPanel

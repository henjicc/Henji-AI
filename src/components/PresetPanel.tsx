import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Preset, PresetSaveMode } from '../types/preset'
import { loadPresets, createPreset, deletePreset, formatTimeAgo } from '../utils/preset'
import { canDeleteFile } from '../utils/fileRefCount'
import { readJsonFromAppData } from '../utils/save'
import { remove } from '@tauri-apps/plugin-fs'
import PanelTrigger from './ui/PanelTrigger'
import { logError, logInfo } from '../utils/errorLogger'
import { useI18n } from '@/hooks/useI18n'

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
    const { t } = useI18n()
    const [presets, setPresets] = useState<Preset[]>([])
    const [isSaving, setIsSaving] = useState(false)
    const [saveMode, setSaveMode] = useState<PresetSaveMode | null>(null)
    const [presetName, setPresetName] = useState('')
    const [deletingPresetId, setDeletingPresetId] = useState<string | null>(null)
    const [deleteButtonRect, setDeleteButtonRect] = useState<DOMRect | null>(null)
    const [deletingClosing, setDeletingClosing] = useState(false)
    const [deletingAppearing, setDeletingAppearing] = useState(false)

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
            alert(t('ui:input.required'))
            return
        }

        setSaveMode(mode)
        // 生成默认名称
        const now = new Date()
        const defaultName = t('ui:presets.defaultName', {
            month: now.getMonth() + 1,
            day: now.getDate(),
            hour: now.getHours(),
            minute: String(now.getMinutes()).padStart(2, '0')
        })
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
            logError('保存预设失败:', error)
            alert(t('ui:presets.alerts.saveFailed'))
        }
    }

    // 取消保存
    const handleCancelSave = () => {
        setIsSaving(false)
        setSaveMode(null)
        setPresetName('')
    }

    // 删除预设 - 显示确认弹窗
    const handleDeleteClick = (presetId: string, e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation()
        const rect = e.currentTarget.getBoundingClientRect()
        setDeleteButtonRect(rect)
        setDeletingPresetId(presetId)
        setDeletingAppearing(false)
        // 下一帧触发淡入
        requestAnimationFrame(() => setDeletingAppearing(true))
    }

    // 确认删除预设
    const handleConfirmDelete = async () => {
        if (!deletingPresetId) return

        const preset = presets.find(p => p.id === deletingPresetId)
        if (!preset) return

        try {
            // 收集预设引用的文件
            const presetFiles = preset.images?.filePaths || []

            // 删除预设
            await deletePreset(deletingPresetId)

            // 重新加载预设列表
            const updatedPresets = await loadPresets()
            setPresets(updatedPresets)

            // 检查并删除无引用的文件
            if (presetFiles.length > 0) {
                // 加载所有历史记录
                const tasks = await readJsonFromAppData('Henji-AI/history.json') || []

                for (const filePath of presetFiles) {
                    // 检查文件是否还被其他预设或历史记录引用
                    const canDelete = canDeleteFile(filePath, tasks, updatedPresets)

                    if (canDelete) {
                        try {
                            await remove(filePath)
                            logInfo('[PresetPanel] 删除无引用文件:', filePath)
                        } catch (error) {
                            logError('[PresetPanel] 删除文件失败:', { data: [filePath, error] })
                        }
                    } else {
                        logInfo('[PresetPanel] 保留文件(仍有引用):', filePath)
                    }
                }
            }
        } catch (error) {
            logError('删除预设失败:', error)
            alert(t('ui:presets.alerts.deleteFailed'))
        } finally {
            setDeletingClosing(true)
            setTimeout(() => {
                setDeletingPresetId(null)
                setDeletingClosing(false)
            }, 200)
        }
    }

    // 监听外部点击，关闭确认弹窗
    useEffect(() => {
        if (!deletingPresetId) return

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement
            // 检查是否点击在确认弹窗内
            const clickedInDialog = target.closest('.delete-confirm-dialog')
            // 检查是否点击在预设面板内
            const clickedInPanel = target.closest('[data-panel-trigger-button]') || target.closest('[data-preset-item]')

            if (!clickedInDialog && !clickedInPanel) {
                // 点击在外部，先关闭确认弹窗
                setDeletingClosing(true)
                setTimeout(() => {
                    setDeletingPresetId(null)
                    setDeletingClosing(false)
                    setDeletingAppearing(false)
                }, 200)
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [deletingPresetId])

    return (
        <PanelTrigger
            display={t('ui:presets.label')}
            disabled={disabled}
            className="w-auto"
            buttonClassName="px-4 py-2 bg-zinc-700/50 hover:bg-zinc-600/50 backdrop-blur-lg rounded-lg transition-all duration-300 border border-zinc-700/50 flex items-center text-sm"
            panelWidth={420}
            alignment="aboveCenter"
            stableHeight={true}
            closeOnPanelClick={(target) => {
                // 如果删除确认弹窗打开，不关闭面板
                if (deletingPresetId) return false
                // 如果正在保存，不关闭面板
                if (isSaving) return false
                // 检查是否点击了预设项（用于加载预设）
                const presetItem = (target as HTMLElement).closest('[data-preset-item]')
                return !!presetItem
            }}
            renderPanel={() => (
                <div className="p-4 h-full flex flex-col max-h-[500px]">
                    {/* 顶部区域：快速保存或输入名称 */}
                    <div className="mb-4 space-y-2">
                        <div className="text-xs text-zinc-400 mb-2">
                            {isSaving ? t('ui:presets.inputNameToSave') : t('ui:presets.quickSave')}
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
                                    placeholder={t('ui:presets.placeholders.name')}
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
                                    {t('common:confirm')}
                                </button>
                                <button
                                    onClick={handleCancelSave}
                                    className="px-3 py-2 bg-zinc-700/50 hover:bg-zinc-600/50 text-white rounded-lg transition-all duration-300 text-xs whitespace-nowrap"
                                >
                                    {t('common:cancel')}
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
                                    title={t('ui:presets.saveMode.prompt.title')}
                                >
                                    <span className="text-base">💾</span>
                                    <span>{t('ui:presets.saveMode.prompt.label')}</span>
                                </button>
                                <button
                                    onClick={() => handleQuickSave('prompt-image')}
                                    className="px-3 py-2 bg-zinc-700/50 hover:bg-zinc-600/50 rounded-lg transition-all duration-300 text-xs flex flex-col items-center gap-1 justify-center"
                                    title={t('ui:presets.saveMode.promptImage.title')}
                                >
                                    <span className="text-base">📦</span>
                                    <span>{t('ui:presets.saveMode.promptImage.label')}</span>
                                </button>
                                <button
                                    onClick={() => handleQuickSave('full')}
                                    className="px-3 py-2 bg-zinc-700/50 hover:bg-zinc-600/50 rounded-lg transition-all duration-300 text-xs flex flex-col items-center gap-1 justify-center"
                                    title={t('ui:presets.saveMode.full.title')}
                                >
                                    <span className="text-base">🔧</span>
                                    <span>{t('ui:presets.saveMode.full.label')}</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* 分割线 */}
                    <div className="h-px bg-zinc-700/50 my-3"></div>

                    {/* 预设列表 */}
                    <div className="flex-1 overflow-y-auto">
                        <div className="text-xs text-zinc-400 mb-2 flex items-center justify-between">
                            <span>{t('ui:presets.myPresets', { count: presets.length })}</span>
                        </div>

                        {presets.length === 0 ? (
                            <div className="text-center text-zinc-500 text-sm py-8">
                                {t('ui:presets.empty')}
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
                                        className="px-3 py-2.5 bg-zinc-700/40 hover:bg-zinc-700/60 rounded-lg border border-zinc-700/50 cursor-pointer transition-colors duration-200 group relative"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                                {/* 模式图标 */}
                                                <span className="text-sm flex-shrink-0">
                                                    {preset.saveMode === 'prompt' && '💾'}
                                                    {preset.saveMode === 'prompt-image' && '📦'}
                                                    {preset.saveMode === 'full' && '🔧'}
                                                </span>
                                                <span className="text-sm font-medium truncate">{preset.name}</span>
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                {/* 时间戳 */}
                                                <span className="text-xs text-zinc-500">
                                                    {formatTimeAgo(preset.updatedAt)}
                                                </span>
                                                {/* 删除按钮 */}
                                                <button
                                                    onClick={(e) => handleDeleteClick(preset.id, e)}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-all duration-200"
                                                    title={t('ui:presets.deleteTitle')}
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                        {/* 预览信息 */}
                                        <div className="mt-1 text-xs text-zinc-500 truncate">
                                            {preset.prompt.substring(0, 50)}{preset.prompt.length > 50 ? '...' : ''}
                                        </div>

                                        {/* 删除确认弹窗 - 使用 portal 渲染到 body */}
                                        {deletingPresetId === preset.id && deleteButtonRect && createPortal(
                                            <div
                                                className={`fixed z-[9999] transition-opacity duration-200 ${deletingClosing ? 'opacity-0' : (deletingAppearing ? 'opacity-100' : 'opacity-0')
                                                    }`}
                                                style={{
                                                    left: `${deleteButtonRect.right - 200}px`,
                                                    top: `${deleteButtonRect.top - 80}px`
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                                onMouseDown={(e) => e.stopPropagation()}
                                            >
                                                <div className="delete-confirm-dialog bg-zinc-800/95 backdrop-blur-xl border border-zinc-700/50 rounded-lg shadow-2xl p-3 w-[200px]">
                                                    <div className="text-sm text-white mb-3">
                                                        {t('ui:presets.confirmDelete')}
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                handleConfirmDelete()
                                                            }}
                                                            onMouseDown={(e) => e.stopPropagation()}
                                                            className="flex-1 px-3 py-1.5 bg-red-600/80 hover:bg-red-600 rounded text-xs text-white transition-colors duration-200"
                                                        >
                                                            {t('common:delete')}
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                setDeletingClosing(true)
                                                                setTimeout(() => {
                                                                    setDeletingPresetId(null)
                                                                    setDeletingClosing(false)
                                                                }, 200)
                                                            }}
                                                            onMouseDown={(e) => e.stopPropagation()}
                                                            className="flex-1 px-3 py-1.5 bg-zinc-700/80 hover:bg-zinc-600 rounded text-xs text-white transition-colors duration-200"
                                                        >
                                                            {t('common:cancel')}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>,
                                            document.body
                                        )}
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

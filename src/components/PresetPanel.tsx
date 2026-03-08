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
import { UiButton, UiIconButton, UiInput, UiOptionButton, UiPanel } from '@/components/ui'
interface PresetPanelProps {
    getCurrentState: () => Record<string, any>
    onLoadPreset: (params: Record<string, any>) => void
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
    useEffect(() => {
        loadPresetsData()
    }, [])
    const loadPresetsData = async () => {
        const data = await loadPresets()
        setPresets(data)
    }
    const handleQuickSave = async (mode: PresetSaveMode) => {
        const state = getCurrentState()
        if (!state.input?.trim()) {
            alert(t('ui:input.required'))
            return
        }
        setSaveMode(mode)
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
    const handleConfirmSave = async () => {
        if (!presetName.trim() || !saveMode) return
        try {
            const state = getCurrentState()
            await createPreset(
                presetName,
                state.input || '',  // 提示词
                saveMode,
                {
                    params: state  // 所有参数统一保存
                }
            )
            await loadPresetsData()
            setIsSaving(false)
            setSaveMode(null)
            setPresetName('')
        } catch (error) {
            logError('保存预设失败:', error)
            alert(t('ui:presets.alerts.saveFailed'))
        }
    }
    const handleCancelSave = () => {
        setIsSaving(false)
        setSaveMode(null)
        setPresetName('')
    }
    const handleDeleteClick = (presetId: string, e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation()
        const rect = e.currentTarget.getBoundingClientRect()
        setDeleteButtonRect(rect)
        setDeletingPresetId(presetId)
        setDeletingAppearing(false)
        requestAnimationFrame(() => setDeletingAppearing(true))
    }
    const handleConfirmDelete = async () => {
        if (!deletingPresetId) return
        const preset = presets.find(p => p.id === deletingPresetId)
        if (!preset) return
        try {
            const presetFiles = preset.images?.filePaths || []
            await deletePreset(deletingPresetId)
            const updatedPresets = await loadPresets()
            setPresets(updatedPresets)
            if (presetFiles.length > 0) {
                const tasks = await readJsonFromAppData('Henji-AI/history.json') || []
                for (const filePath of presetFiles) {
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
    useEffect(() => {
        if (!deletingPresetId) return
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement
            const clickedInDialog = target.closest('.delete-confirm-dialog')
            const clickedInPanel = target.closest('[data-panel-trigger-button]') || target.closest('[data-preset-item]')
            if (!clickedInDialog && !clickedInPanel) {
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
                if (deletingPresetId) return false
                if (isSaving) return false
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
                                <UiInput
                                    value={presetName}
                                    onChange={(e) => setPresetName(e.target.value)}
                                    placeholder={t('ui:presets.placeholders.name')}
                                    className="flex-1"
                                    ref={(input) => {
                                        if (isSaving && input) {
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
                                <UiButton
                                    type="button"
                                    size="sm"
                                    variant="primary"
                                    onClick={handleConfirmSave}
                                    disabled={!presetName.trim()}
                                    className="whitespace-nowrap"
                                >
                                    {t('common:confirm')}
                                </UiButton>
                                <UiButton
                                    type="button"
                                    size="sm"
                                    variant="muted"
                                    onClick={handleCancelSave}
                                    className="whitespace-nowrap"
                                >
                                    {t('common:cancel')}
                                </UiButton>
                            </div>
                            {/* 快速保存按钮区域 */}
                            <div
                                className={`absolute inset-0 grid grid-cols-3 gap-2 h-full transition-all duration-300 ${!isSaving ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none scale-95'
                                    }`}
                            >
                                <UiOptionButton
                                    type="button"
                                    active={false}
                                    onClick={() => handleQuickSave('prompt')}
                                    className="h-full w-full flex-col justify-center gap-1 px-3 py-2 text-xs"
                                    title={t('ui:presets.saveMode.prompt.title')}
                                >
                                    <span className="text-base">💾</span>
                                    <span>{t('ui:presets.saveMode.prompt.label')}</span>
                                </UiOptionButton>
                                <UiOptionButton
                                    type="button"
                                    active={false}
                                    onClick={() => handleQuickSave('prompt-image')}
                                    className="h-full w-full flex-col justify-center gap-1 px-3 py-2 text-xs"
                                    title={t('ui:presets.saveMode.promptImage.title')}
                                >
                                    <span className="text-base">📦</span>
                                    <span>{t('ui:presets.saveMode.promptImage.label')}</span>
                                </UiOptionButton>
                                <UiOptionButton
                                    type="button"
                                    active={false}
                                    onClick={() => handleQuickSave('full')}
                                    className="h-full w-full flex-col justify-center gap-1 px-3 py-2 text-xs"
                                    title={t('ui:presets.saveMode.full.title')}
                                >
                                    <span className="text-base">🔧</span>
                                    <span>{t('ui:presets.saveMode.full.label')}</span>
                                </UiOptionButton>
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
                                                <UiIconButton
                                                    type="button"
                                                    onClick={(e) => handleDeleteClick(preset.id, e)}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    className="h-7 w-7 border-transparent bg-transparent opacity-0 transition-all duration-200 group-hover:opacity-100 hover:bg-red-500/20"
                                                    title={t('ui:presets.deleteTitle')}
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </UiIconButton>
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
                                                <UiPanel className="delete-confirm-dialog w-[200px] p-3">
                                                    <div className="text-sm text-white mb-3">
                                                        {t('ui:presets.confirmDelete')}
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <UiButton
                                                            type="button"
                                                            size="sm"
                                                            variant="primary"
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                handleConfirmDelete()
                                                            }}
                                                            onMouseDown={(e) => e.stopPropagation()}
                                                            className="h-8 flex-1 bg-red-600/80 hover:bg-red-600"
                                                        >
                                                            {t('common:delete')}
                                                        </UiButton>
                                                        <UiButton
                                                            type="button"
                                                            size="sm"
                                                            variant="muted"
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                setDeletingClosing(true)
                                                                setTimeout(() => {
                                                                    setDeletingPresetId(null)
                                                                    setDeletingClosing(false)
                                                                }, 200)
                                                            }}
                                                            onMouseDown={(e) => e.stopPropagation()}
                                                            className="h-8 flex-1"
                                                        >
                                                            {t('common:cancel')}
                                                        </UiButton>
                                                    </div>
                                                </UiPanel>
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

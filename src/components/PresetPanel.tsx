import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { createLogger } from '@/core/logging'
import React, { useState, useEffect, useCallback } from 'react'
import { Preset, PresetSaveMode } from '../types/preset'
import { loadPresets, createPreset, deletePreset, formatTimeAgo } from '../utils/preset'
import PanelTrigger from './ui/PanelTrigger'
import { useI18n } from '@/hooks/useI18n'
import { UiButton, UiEmpty, UiIconButton, UiInput, UiOptionButton } from '@/components/ui'
import { showAlertDialog } from '@/stores/alertDialogStore'
import { useNotification } from '@/contexts/NotificationContext'
import type { PromptDocumentV1, PromptMediaBinding } from '@/core/inputs/promptDocument'
import { BookMarked, Images, SlidersHorizontal, Trash2, Type } from 'lucide-react'

const logger = createLogger('components.PresetPanel')

interface PresetPanelState {
    input: string
    promptDocument: PromptDocumentV1
    promptMediaBindings: PromptMediaBinding[]
    uploadedImages: string[]
    uploadedFilePaths: string[]
    params: DynamicValueMap
}

interface PresetPanelProps {
    getCurrentState: () => PresetPanelState
    onLoadPreset: (preset: Preset) => void
    disabled?: boolean
}
const PresetPanel: React.FC<PresetPanelProps> = ({
    getCurrentState,
    onLoadPreset,
    disabled
}) => {
    const { t } = useI18n()
    const { showNotification } = useNotification()
    const [presets, setPresets] = useState<Preset[]>([])
    const [isSaving, setIsSaving] = useState(false)
    const [saveMode, setSaveMode] = useState<PresetSaveMode | null>(null)
    const [presetName, setPresetName] = useState('')
    // 删除确认是预设面板里的子浮层（共享 PanelTrigger，任务 5.9）：在它里面点击不会关掉预设面板
    const [deletingPresetId, setDeletingPresetId] = useState<string | null>(null)
    const loadPresetsData = useCallback(async (): Promise<void> => {
        const data = await loadPresets()
        setPresets(data)
    }, [])
    useEffect(() => {
        void loadPresetsData().catch(error => {
            logger.error('读取预设失败，原库已保留', { event: 'presets.read.failed', error })
            showAlertDialog({
                title: t('common:error'),
                message: t('ui:presets.alerts.loadFailed'),
                type: 'error',
            })
        })
    }, [loadPresetsData, t])
    const handleQuickSave = async (mode: PresetSaveMode) => {
        const state = getCurrentState()
        const input = state.input
        if (!input.trim()) {
            showNotification(t('ui:input.required'), 'error')
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
            const input = state.input
            await createPreset(
                presetName,
                input,  // 提示词
                saveMode,
                {
                    images: state.uploadedImages,
                    imageFilePaths: state.uploadedFilePaths,
                    promptDocument: state.promptDocument,
                    promptMediaBindings: state.promptMediaBindings,
                    params: { ...state.params, input },
                }
            )
            await loadPresetsData()
            setIsSaving(false)
            setSaveMode(null)
            setPresetName('')
        } catch (error) {
            logger.error('保存预设失败:', error)
            showAlertDialog({
                title: t('common:error'),
                message: t('ui:presets.alerts.saveFailed'),
                type: 'error',
                detail: error instanceof Error ? error.message : String(error),
            })
        }
    }
    const handleCancelSave = () => {
        setIsSaving(false)
        setSaveMode(null)
        setPresetName('')
    }
    const handleConfirmDelete = async () => {
        if (!deletingPresetId) return
        const preset = presets.find(p => p.id === deletingPresetId)
        if (!preset) return
        try {
            await deletePreset(deletingPresetId)
            const updatedPresets = await loadPresets()
            setPresets(updatedPresets)
            // A preset does not own its media. Other documents and unsaved canvases
            // may still reference these files; deletion only removes the preset row.
        } catch (error) {
            logger.error('删除预设失败:', error)
            showAlertDialog({
                title: t('common:error'),
                message: t('ui:presets.alerts.deleteFailed'),
                type: 'error',
                detail: error instanceof Error ? error.message : String(error),
            })
        } finally {
            setDeletingPresetId(null)
        }
    }
    return (
        <PanelTrigger
            disabled={disabled}
            className="w-auto"
            panelSize="wide"
            alignment="aboveCenter"
            stableHeight={true}
            closeOnPanelClick={(target) => {
                if (deletingPresetId) return false
                if (isSaving) return false
                const element = target as HTMLElement
                // 点删除按钮是打开确认，不是选用预设
                if (element.closest('[data-preset-delete]')) return false
                return !!element.closest('[data-preset-item]')
            }}
            renderPanel={() => (
                // 浮层按内容定宽（重要记录 021）：快速保存区是叠放的绝对定位块、预设说明会截断，没有固有宽度，这里声明 420
                <div className="p-4 h-full w-[26.25rem] max-w-full flex flex-col max-h-[var(--trigger-panel-max-height)]">
                    {/* 顶部区域：快速保存或输入名称 */}
                    <div className="mb-4 space-y-2">
                        <div className="text-xs text-text2 mb-2">
                            {isSaving ? t('ui:presets.inputNameToSave') : t('ui:presets.quickSave')}
                        </div>
                        <div className="h-[60px] relative">
                            {/* 输入名称区域 */}
                            <div
                                className={`absolute inset-0 flex gap-2 items-center h-full transition-[opacity,transform] duration-240 ${isSaving ? 'opacity-100 z-raised' : 'opacity-0 z-base pointer-events-none scale-95'
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
                                    variant="primary"
                                    onClick={handleConfirmSave}
                                    disabled={!presetName.trim()}
                                >
                                    {t('common:confirm')}
                                </UiButton>
                                <UiButton
                                    type="button"
                                    variant="secondary"
                                    onClick={handleCancelSave}
                                >
                                    {t('common:cancel')}
                                </UiButton>
                            </div>
                            {/* 快速保存按钮区域 */}
                            <div
                                className={`absolute inset-0 grid grid-cols-3 gap-2 h-full transition-[opacity,transform] duration-240 ${!isSaving ? 'opacity-100 z-raised' : 'opacity-0 z-base pointer-events-none scale-95'
                                    }`}
                            >
                                <UiOptionButton
                                    type="button"
                                    variant="grid"
                                    active={false}
                                    onClick={() => handleQuickSave('prompt')}
                                    size="sm"
                                    className="h-full w-full flex-col justify-center gap-1"
                                    tooltip={t('ui:presets.saveMode.prompt.title')}
                                >
                                    <Type aria-hidden="true" className={`${UI_ICON_SIZE_CLASS.md} text-text2`} />
                                    <span>{t('ui:presets.saveMode.prompt.label')}</span>
                                </UiOptionButton>
                                <UiOptionButton
                                    type="button"
                                    variant="grid"
                                    active={false}
                                    onClick={() => handleQuickSave('prompt-image')}
                                    size="sm"
                                    className="h-full w-full flex-col justify-center gap-1"
                                    tooltip={t('ui:presets.saveMode.promptImage.title')}
                                >
                                    <Images aria-hidden="true" className={`${UI_ICON_SIZE_CLASS.md} text-text2`} />
                                    <span>{t('ui:presets.saveMode.promptImage.label')}</span>
                                </UiOptionButton>
                                <UiOptionButton
                                    type="button"
                                    variant="grid"
                                    active={false}
                                    onClick={() => handleQuickSave('full')}
                                    size="sm"
                                    className="h-full w-full flex-col justify-center gap-1"
                                    tooltip={t('ui:presets.saveMode.full.title')}
                                >
                                    <SlidersHorizontal aria-hidden="true" className={`${UI_ICON_SIZE_CLASS.md} text-text2`} />
                                    <span>{t('ui:presets.saveMode.full.label')}</span>
                                </UiOptionButton>
                            </div>
                        </div>
                    </div>
                    {/* 分割线 */}
                    <div className="my-3 h-px bg-line"></div>
                    {/* 预设列表 */}
                    <div className="flex-1 overflow-y-auto">
                        <div className="text-xs text-text2 mb-2 flex items-center justify-between">
                            <span>{t('ui:presets.myPresets', { count: presets.length })}</span>
                        </div>
                        {presets.length === 0 ? (
                            <UiEmpty size="sm" title={t('ui:presets.empty')} />
                        ) : (
                            <div>
                                {presets.map(preset => (
                                    <div
                                        key={preset.id}
                                        data-preset-item
                                        onClick={() => {
                                            onLoadPreset(preset)
                                        }}
                                        className="group relative cursor-pointer border-b border-line/60 px-3 py-3 first:pt-0 last:border-b-0 last:pb-0 transition-colors duration-120 hover:bg-hover"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                                {/* 模式图标 */}
                                                {preset.saveMode === 'prompt' && <Type aria-hidden="true" className={`${UI_ICON_SIZE_CLASS.sm} shrink-0 text-text3`} />}
                                                {preset.saveMode === 'prompt-image' && <Images aria-hidden="true" className={`${UI_ICON_SIZE_CLASS.sm} shrink-0 text-text3`} />}
                                                {preset.saveMode === 'full' && <SlidersHorizontal aria-hidden="true" className={`${UI_ICON_SIZE_CLASS.sm} shrink-0 text-text3`} />}
                                                <span className="text-sm font-medium truncate">{preset.name}</span>
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                {/* 时间戳 */}
                                                <span className="text-xs text-text3">
                                                    {formatTimeAgo(preset.updatedAt)}
                                                </span>
                                                {/* 删除按钮与确认浮层 */}
                                                <PanelTrigger
                                                    className="flex"
                                                    open={deletingPresetId === preset.id}
                                                    onOpenChange={(open) => setDeletingPresetId((current) => open ? preset.id : (current === preset.id ? null : current))}
                                                    panelSize="menu"
                                                    panelPadding="content"
                                                    alignment="aboveCenter"
                                                    gap={8}
                                                    renderPanel={() => (
                                                        // 浮层经 portal 挂到 body，但 React 事件仍沿组件树冒泡：拦下，避免触发“选用预设”
                                                        <div onClick={(e) => e.stopPropagation()}>
                                                            <div className="mb-3 text-13 text-text1">
                                                                {t('ui:presets.confirmDelete')}
                                                            </div>
                                                            <div className="flex gap-2">
                                                                <UiButton
                                                                    type="button"
                                                                    variant="dangerSolid"
                                                                    onClick={() => { void handleConfirmDelete() }}
                                                                    className="flex-1"
                                                                >
                                                                    {t('common:delete')}
                                                                </UiButton>
                                                                <UiButton
                                                                    type="button"
                                                                    variant="secondary"
                                                                    onClick={() => setDeletingPresetId(null)}
                                                                    className="flex-1"
                                                                >
                                                                    {t('common:cancel')}
                                                                </UiButton>
                                                            </div>
                                                        </div>
                                                    )}
                                                >
                                                    {({ open }) => (
                                                        <UiIconButton
                                                            type="button"
                                                            tone="danger"
                                                            data-preset-delete
                                                            data-panel-trigger-button
                                                            aria-expanded={open}
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                setDeletingPresetId(open ? null : preset.id)
                                                            }}
                                                            className={`transition-opacity duration-180 group-hover:opacity-100 focus-visible:opacity-100 ${open ? 'opacity-100' : 'opacity-0'}`}
                                                            tooltip={t('ui:presets.deleteTitle')}
                                                        >
                                                            <Trash2  />
                                                        </UiIconButton>
                                                    )}
                                                </PanelTrigger>
                                            </div>
                                        </div>
                                        {/* 预览信息 */}
                                        <div className="mt-1 text-xs text-text3 truncate">
                                            {preset.prompt.substring(0, 50)}{preset.prompt.length > 50 ? '...' : ''}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        >
            {/* 底栏寸土寸金：只放图标，名称在悬停说明里 */}
            {({ open, togglePanel }) => (
                <UiIconButton
                    aria-label={t('ui:presets.label')}
                    tooltip={t('ui:presets.label')}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    on={open}
                    disabled={disabled}
                    onClick={togglePanel}
                    data-panel-trigger-button
                >
                    <BookMarked />
                </UiIconButton>
            )}
        </PanelTrigger>
    )
}
export default PresetPanel

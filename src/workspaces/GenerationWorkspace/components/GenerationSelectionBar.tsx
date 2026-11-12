import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, FileArchive, Folder, FolderOpen, FolderPlus, MoreHorizontal, Trash2, X } from 'lucide-react'
import { Dropdown, UiButton, UiError, UiIconButton, UiModal, UiOptionButton, UiOverflowRow, UI_FIELD_PADDING_CLASS, UI_TEXT_META_CLASS } from '@/components/ui'
import PanelTrigger from '@/components/ui/PanelTrigger'
import { ICON_DOWNLOAD, ICON_WORKSPACE_CANVAS, ICON_WORKSPACE_VIDEO_EDIT, UI_ICON_SIZE } from '@/core/theme/icons'
import { useI18n } from '@/hooks/useI18n'
import { QUICK_DOWNLOAD_SETTING_SPECS, readLocalStorageSettings } from '@/hooks/useLocalStorageSetting'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProjectStore } from '@/stores/projectStore'
import { getDocumentOperations } from '@/features/documents'
import { listVideoEditSendDestinations } from '@/features/videoEdit/application/videoEditResultSend'
import type { LucideIcon } from 'lucide-react'
import type { useResultBatchActions } from '../hooks/useResultBatchActions'

type BatchActions = ReturnType<typeof useResultBatchActions>

interface Destination { id: string; name: string }

/** 选一个画布或剪辑作为去处：默认当前打开的那一份。 */
function DestinationDialog({ title, label, emptyTitle, confirmLabel, load, onConfirm, onClose }: {
  title: string
  label: string
  emptyTitle: string
  confirmLabel: string
  load: () => Promise<{ options: Destination[]; current?: string | null }>
  onConfirm: (destination: Destination) => void
  onClose: () => void
}): JSX.Element {
  const { t } = useI18n()
  const [options, setOptions] = useState<Destination[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    void load().then(({ options: values, current }) => {
      if (!live) return
      setOptions(values)
      setSelected(values.find(value => value.id === current)?.id ?? values[0]?.id ?? '')
    }).catch(cause => { if (live) setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [load])
  const destination = options.find(option => option.id === selected)
  return (
    <UiModal isOpen title={title} onClose={onClose}
      footer={<>
        <UiButton onClick={onClose}>{t('common:cancel')}</UiButton>
        <UiButton variant="primary" disabled={!destination} disabledReason={destination ? undefined : emptyTitle}
          onClick={() => { if (destination) { onConfirm(destination); onClose() } }}>{confirmLabel}</UiButton>
      </>}>
      <Dropdown label={label} value={selected} disabled={loading || options.length === 0} options={options.map(option => ({ value: option.id, label: option.name }))} onSelect={setSelected} />
      {!loading && options.length === 0 && !error && <UiError title={emptyTitle} message="" />}
      {error && <UiError title={error} message="" />}
    </UiModal>
  )
}

const loadCanvases = async (): Promise<{ options: Destination[]; current: string | null }> => ({
  options: (await getDocumentOperations().listDocuments({ kind: 'canvas', includeDrafts: true, includeMissing: false })).map(document => ({ id: document.id, name: document.name })),
  current: useProjectStore.getState().currentProjectId,
})
const loadVideoEdits = async (): Promise<{ options: Destination[] }> => ({ options: await listVideoEditSendDestinations() })

function MenuItem({ icon: Icon, label, title, danger, disabled, disabledReason, onSelect }: { icon: LucideIcon; label: string; title?: string; danger?: boolean; disabled?: boolean; disabledReason?: string; onSelect: () => void }): JSX.Element {
  return (
    <UiOptionButton type="button" variant="menu" size="sm" role="menuitem" className="w-full gap-2" tooltip={title} disabled={disabled} disabledReason={disabledReason} onClick={onSelect}>
      <span className={`flex min-w-0 flex-1 items-center gap-2 ${danger && !disabled ? 'text-danger-text' : ''}`}><Icon size={UI_ICON_SIZE.sm} /><span className="min-w-0 flex-1 truncate">{label}</span></span>
    </UiOptionButton>
  )
}

/**
 * 多选时的命令带：同一条带原地换内容，不另起一行（设计稿“生成历史多选”）。
 * 左端退出与计数，右端批量动作：同一组动作同档，全部静默（命令带里只有唯一主动作才铺底）；
 * “下载”最常用所以排第一，放不下从右往左收进“更多”。
 */
export function GenerationSelectionBar({ count, allSelected, onExit, onSelectAll, onClear, actions }: {
  count: number
  allSelected: boolean
  onExit: () => void
  onSelectAll: () => void
  onClear: () => void
  actions: BatchActions
}): JSX.Element {
  const { t } = useI18n()
  const presetPaths = useSettingsStore(state => state.downloadPresetPaths)
  const [dialog, setDialog] = useState<'canvas' | 'video_edit' | null>(null)
  const empty = count === 0
  const busy = actions.running !== null
  const emptyReason = empty ? t('ui:generationSelection.emptyReason') : busy ? t('ui:generationSelection.busyReason') : undefined
  const deleteReason = emptyReason ?? (actions.canDelete ? undefined : t('ui:generationSelection.deletePartial'))

  const renderDownloadMenu = (): ReactNode => {
    const quick = readLocalStorageSettings(QUICK_DOWNLOAD_SETTING_SPECS)
    const quickPath = quick.enableQuickDownload ? quick.quickDownloadPath.trim() : ''
    const presets = presetPaths.map(path => path.trim()).filter(Boolean)
    return (
      <div className="flex flex-col gap-0.5" role="menu" aria-label={t('ui:generationSelection.download')}>
        <MenuItem icon={FolderOpen} label={t('ui:generationSelection.toFolder')} onSelect={() => void actions.exportToFolder()} />
        <MenuItem icon={FileArchive} label={t('ui:generationSelection.toZip')} onSelect={() => void actions.exportToZip()} />
        {quickPath && <>
          <span className={`${UI_FIELD_PADDING_CLASS.sm} pb-0.5 pt-1.5 ${UI_TEXT_META_CLASS}`}>{t('ui:generationSelection.quickFolder')}</span>
          <MenuItem icon={Folder} label={quickPath} title={quickPath} onSelect={() => void actions.exportToFolder(quickPath)} />
        </>}
        {presets.length > 0 && <>
          <span className={`${UI_FIELD_PADDING_CLASS.sm} pb-0.5 pt-1.5 ${UI_TEXT_META_CLASS}`}>{t('ui:generationSelection.presetFolders')}</span>
          {presets.map(path => <MenuItem key={path} icon={Folder} label={path} title={path} onSelect={() => void actions.exportToFolder(path)} />)}
        </>}
      </div>
    )
  }

  const secondary: Array<{ id: string; icon: LucideIcon; label: string; danger?: boolean; reason?: string; onSelect: () => void }> = [
    { id: 'collect', icon: FolderPlus, label: t('ui:generationSelection.collect'), reason: emptyReason, onSelect: () => void actions.collect() },
    { id: 'canvas', icon: ICON_WORKSPACE_CANVAS, label: t('ui:generationSelection.toCanvas'), reason: emptyReason, onSelect: () => setDialog('canvas') },
    { id: 'video_edit', icon: ICON_WORKSPACE_VIDEO_EDIT, label: t('ui:generationSelection.toVideoEdit'), reason: emptyReason, onSelect: () => setDialog('video_edit') },
    { id: 'delete', icon: Trash2, label: t('ui:generationSelection.delete'), danger: true, reason: deleteReason, onSelect: () => void actions.deleteSelected() },
  ]

  return (
    <div className="flex h-10 min-w-0 flex-1 items-center gap-1">
      <UiIconButton tooltip={t('ui:generationSelection.exit')} onClick={onExit}><X /></UiIconButton>
      <span className="shrink-0 whitespace-nowrap px-1 font-medium tabular-nums text-text1">{t('ui:generationSelection.count', { count })}</span>
      <UiButton className="shrink-0" onClick={allSelected ? onClear : onSelectAll}>
        {allSelected ? t('ui:generationSelection.clear') : t('ui:generationSelection.selectAll')}
      </UiButton>
      <UiOverflowRow
        className="ml-auto min-w-0 justify-end gap-1"
        items={[
          {
            id: 'download', priority: 100, pinned: true,
            node: (
              <PanelTrigger panelSize="menu" panelPadding="menu" closeOnPanelClick disabled={Boolean(emptyReason)} renderPanel={renderDownloadMenu}>
                {({ open, togglePanel }) => (
                  <UiButton aria-haspopup="menu" aria-expanded={open} disabled={Boolean(emptyReason)} disabledReason={emptyReason} loading={actions.running === 'export'} onClick={togglePanel}>
                    <ICON_DOWNLOAD />{t('ui:generationSelection.download')}<ChevronDown />
                  </UiButton>
                )}
              </PanelTrigger>
            ),
          },
          ...secondary.map((action, index) => ({
            id: action.id,
            priority: secondary.length - index,
            node: action.danger
              ? <UiIconButton tone="danger" tooltip={action.label} disabled={Boolean(action.reason)} disabledReason={action.reason} onClick={action.onSelect}><action.icon /></UiIconButton>
              : <UiButton disabled={Boolean(action.reason)} disabledReason={action.reason} loading={actions.running === action.id} onClick={action.onSelect}><action.icon />{action.label}</UiButton>,
          })),
        ]}
        renderOverflow={(hiddenIds) => (
          <PanelTrigger panelSize="menu" panelPadding="menu" closeOnPanelClick renderPanel={() => (
            <div className="flex flex-col gap-0.5" role="menu">
              {secondary.filter(action => hiddenIds.includes(action.id)).map(action => (
                <MenuItem key={action.id} icon={action.icon} label={action.label} danger={action.danger} disabled={Boolean(action.reason)} disabledReason={action.reason} onSelect={action.onSelect} />
              ))}
            </div>
          )}>
            {({ open, togglePanel }) => <UiIconButton tooltip={t('ui:workspaceFilters.moreActions')} aria-haspopup="menu" aria-expanded={open} data-panel-trigger-button onClick={togglePanel}><MoreHorizontal /></UiIconButton>}
          </PanelTrigger>
        )}
      />
      {dialog === 'canvas' && (
        <DestinationDialog title={t('ui:generationSelection.canvasTitle', { count })} label={t('ui:generationSelection.canvasLabel')} emptyTitle={t('ui:generationSelection.canvasEmpty')}
          confirmLabel={t('ui:generationSelection.place')} load={loadCanvases} onConfirm={destination => void actions.sendToCanvas(destination.id, destination.name)} onClose={() => setDialog(null)} />
      )}
      {dialog === 'video_edit' && (
        <DestinationDialog title={t('ui:generationSelection.videoEditTitle', { count })} label={t('ui:generationSelection.videoEditLabel')} emptyTitle={t('ui:generationSelection.videoEditEmpty')}
          confirmLabel={t('ui:generationSelection.send')} load={loadVideoEdits} onConfirm={destination => void actions.sendToVideoEdit(destination.id, destination.name)} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}

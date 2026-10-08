import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { PanelTrigger, UiButton, UiError, UiIconButton, UiOptionButton, UiToolbar } from '@/components/ui'
import { useNotification } from '@/contexts/NotificationContext'
import { videoEditUserErrorMessage } from './application/videoEditUserError'
import { subscribeVideoEditImportCompletion } from './application/videoEditImportTask'
import { VideoEditImportProgress } from './panels/VideoEditImportProgress'
import { VideoEditProjectsPage } from './VideoEditProjectsPage'
import { ChevronDown, ChevronLeft, Download, FolderInput, FolderOpen, Keyboard, Redo2, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Z_LAYERS } from '@/core/theme/zLayers'
import type { DockviewApi } from 'dockview-react'
import { activeVideoEditInstance, collectVideoEditMedia, createVideoEditProject, findActiveVideoEditSequence, leaveVideoEditProject, listVideoEditInstances, openVideoEditProject, openVideoEditProjectFolder, subscribeVideoEdit, subscribeVideoEditView, videoEditViewRevision, videoEditRevision, focusVideoEdit, focusVideoEditPanel, videoEditExportRange, type VideoEditInstance } from './application/videoEditService'
import { videoEditFrameTimecode } from '@/core/videoEdit/timecode'
import { cancelVideoEditExport, videoEditExportTask } from './application/videoEditExport'
import { VideoEditDock } from './layout/VideoEditDock'
import { VideoEditLayoutMenu } from './layout/VideoEditDockChrome'
import { isUiInspectionActive } from '@/platform/runtime'
import { useSettingsStore } from '@/stores/settingsStore'
import { captureVideoEditCommandContext, executeVideoEditCommand, videoEditCommandState } from './application/videoEditCommands'
import { videoEditKeyboardCommand } from './application/videoEditKeyboard'
import { VideoEditShortcutDialog } from './panels/VideoEditShortcutSettings'
import { timelineCommandPresentation } from './timeline/timelineCommandPresentation'
import type { VideoEditCommandId } from '@/core/videoEdit/commands'
import { collectVideoEditOutput } from './application/videoEditOutputs'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { openAssetLibrary } from '@/stores/navigationStore'
import { openDialog } from '@/platform/desktopApi'
import { getDocumentOperations } from '@/features/documents/documentOperations'
import { elementOfEventTarget } from '@/utils/crossRealmDom'
import { closeVideoEditAudioDialog, useVideoEditAudioDialog } from './application/videoEditAudioDialogs'
import { VideoEditAudioGainDialog } from './panels/VideoEditAudioGainDialog'
import { VideoEditExportDialog } from './panels/VideoEditExportDialog'
import { VideoEditFontWarnings } from './panels/VideoEditFontWarnings'
import { videoEditCommittedDocument } from './application/videoEditService'

/** Shift+1…5（Premiere 默认）切到的面板；切换后键盘焦点也进入该面板，后续快捷键按它的作用域生效。 */
const FOCUS_COMMANDS: Partial<Record<VideoEditCommandId, 'project' | 'source' | 'timeline' | 'program' | 'effects'>> = { focus_project: 'project', focus_source: 'source', focus_timeline: 'timeline', focus_program: 'program', focus_effects: 'effects' }
function focusPanelElement(panel: string): void {
  requestAnimationFrame(() => {
    const element = document.querySelector<HTMLElement>(`[data-video-edit-panel="${panel}"]`)
    if (!element) return
    const target = element.querySelector<HTMLElement>('[data-video-edit-timeline-viewport],[tabindex="0"]') ?? element
    if (target === element && !element.hasAttribute('tabindex')) element.tabIndex = -1
    target.focus({ preventScroll: true })
  })
}
/** `（Premiere 默认）：最大化光标下的面板组，已有最大化时还原。 */
function toggleMaximizedGroup(api: DockviewApi | null, hovered: Element | null): void {
  if (!api) return
  if (api.hasMaximizedGroup()) { api.exitMaximizedGroup(); return }
  const group = (hovered && api.groups.find(value => value.element.contains(hovered))) || api.activeGroup
  group?.api.maximize()
}

/**
 * 剪辑命令带（界面重设计 3.5，设计稿 VideoEdit）：一条带。左端关闭项目、项目名菜单与序列规格；右端撤销/重做、
 * 面板布局，唯一一条分隔线后是成片收录与唯一主动作“导出”。拆分、删除、文字移入时间线工具栏。
 */
function VideoEditToolbar({ instance, api, run, onNotice }: { instance: VideoEditInstance; api: DockviewApi | null; run: (operation: () => unknown | Promise<unknown>) => void; onNotice: (message: string) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const { t } = useTranslation('ui')
  const sequence = findActiveVideoEditSequence(instance); const projectId = instance.document.id
  const task = videoEditExportTask(projectId)
  const marked = instance.inFrame !== null || instance.outFrame !== null ? (() => { try { return videoEditExportRange(instance) } catch { return undefined } })() : undefined
  const [collecting, setCollecting] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const libraryId = useAssetLibraryStore(state => state.libraryId)
  const shortcuts = useSettingsStore(state => state.videoEditShortcuts)
  const context = captureVideoEditCommandContext(projectId, 'timeline', { includeClipboard: false })
  const presentation = (id: VideoEditCommandId) => timelineCommandPresentation(context, id, shortcuts)
  const command = (id: VideoEditCommandId): void => { const current = captureVideoEditCommandContext(projectId, 'timeline'); run(() => executeVideoEditCommand(current, id)) }
  const undo = presentation('undo'); const redo = presentation('redo'); const exporting = presentation('export')
  const others = listVideoEditInstances().filter(item => item !== instance)
  return <UiToolbar variant="command" trailing={<>
    {marked && <span className="mr-1 text-xs tabular-nums text-text3" data-video-edit-export-range>导出范围 {videoEditFrameTimecode(marked.startFrame, sequence!.fps)}–{videoEditFrameTimecode(marked.endFrame - 1, sequence!.fps)}</span>}
    <UiIconButton aria-label="撤销" title={undo.tooltip} disabled={!undo.enabled} onClick={() => command('undo')}><Undo2 size={16} /></UiIconButton>
    <UiIconButton aria-label="重做" title={redo.tooltip} disabled={!redo.enabled} onClick={() => command('redo')}><Redo2 size={16} /></UiIconButton>
    <VideoEditLayoutMenu api={api} />
    <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line" />
    {task?.state === 'completed' && task.output && <UiButton disabled={collecting} onClick={() => run(async () => {
      setCollecting(true)
      try {
        const asset = await collectVideoEditOutput(task.output!, libraryId ? { libraryId } : {})
        if (activeVideoEditInstance() === instance) { useAssetLibraryStore.getState().setSelectedAsset(asset); openAssetLibrary('floating') }
      } finally { setCollecting(false) }
    })}>{collecting ? '正在收录成片…' : '成片加入资产库'}</UiButton>}
    {task?.state === 'running' && <UiButton onClick={() => cancelVideoEditExport(projectId)}>取消导出 {Math.round(task.progress * 100)}%</UiButton>}
    <UiButton variant="primary" aria-label="导出视频" title={exporting.tooltip} disabled={!exporting.enabled} onClick={() => command('export')}><Download size={15} />导出</UiButton>
  </>}>
    <UiIconButton size="lg" aria-label={t('videoEditProject.back')} title={t('videoEditProject.back')} onClick={() => run(() => leaveVideoEditProject(projectId))}><ChevronLeft size={18} /></UiIconButton>
    <PanelTrigger panelWidth={220} zIndex={Z_LAYERS.dropdown} closeOnPanelClick panelPadding="menu" renderPanel={() => <div className="flex flex-col gap-1">
      <UiOptionButton variant="menu" size="sm" className="gap-2" onClick={() => run(async () => {
        const result = await collectVideoEditMedia(projectId)
        const files = result.missing ? t('videoEditProject.collectMissing', { count: result.missing }) : result.copiedFiles ? t('videoEditProject.collectDone', { count: result.copiedFiles }) : result.copiedDocuments ? '' : t('videoEditProject.collectNone')
        onNotice([files, result.copiedDocuments ? t('videoEditProject.collectDocuments', { count: result.copiedDocuments }) : ''].filter(Boolean).join(' '))
      })}><FolderInput size={14} />{t('videoEditProject.collect')}</UiOptionButton>
      <UiOptionButton variant="menu" size="sm" className="gap-2" onClick={() => run(() => getDocumentOperations().revealDocument(instance.session.target))}><FolderOpen size={14} />{t('videoEditProject.revealProject')}</UiOptionButton>
      <UiOptionButton variant="menu" size="sm" className="gap-2" onClick={() => setShortcutsOpen(true)}><Keyboard size={14} />{t('videoEditProject.shortcuts')}</UiOptionButton>
      {others.map(item => <UiOptionButton key={item.document.id} variant="menu" size="sm" className="min-w-0" onClick={() => focusVideoEdit(item.document.id)}><span className="truncate" data-observation-sensitive>{t('videoEditProject.switchTo', { name: item.document.name })}</span></UiOptionButton>)}
    </div>}>
      {({ open, togglePanel }) => <UiButton size="sm" className="min-w-0 max-w-56" aria-label={t('videoEditProject.menu', { name: instance.document.name })} aria-expanded={open} data-panel-trigger-button onClick={togglePanel}>
        <span className="truncate" data-observation-sensitive>{instance.document.name}</span><ChevronDown size={14} className="shrink-0 text-text3" />
      </UiButton>}
    </PanelTrigger>
    {sequence && <span className="shrink-0 truncate text-xs tabular-nums text-text3">{sequence.width} × {sequence.height} · {Number(sequence.fps.toFixed(3))} fps</span>}
    <VideoEditShortcutDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
  </UiToolbar>
}

export default function VideoEditApp(): React.ReactElement {
  useEffect(() => { if (isUiInspectionActive()) void import('./engine/videoEditCodeProbe') }, [])
  useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  const instance = activeVideoEditInstance()
  // 操作失败与普通提示：从画面上方浮现、自动淡出，不占面板空间（用户反馈：底部状态带出现后空间不恢复）
  const { showNotification } = useNotification()
  const [dockApi, setDockApi] = useState<DockviewApi | null>(null)
  // The project's own save status is shown once and clears itself when the retry succeeds.
  const onError = useCallback((reason: unknown): void => { if ((reason instanceof Error || reason instanceof DOMException) && reason.name === 'AbortError') return; const message = videoEditUserErrorMessage(reason); if (message !== activeVideoEditInstance()?.error) showNotification(message, 'error') }, [showNotification])
  const onNotice = useCallback((message: string | null): void => { if (message) showNotification(message, 'success') }, [showNotification])
  useEffect(() => subscribeVideoEditImportCompletion((_projectId, imported, skipped) => { if (skipped) onNotice(`已导入 ${imported.toLocaleString()} 个文件，跳过 ${skipped.toLocaleString()} 个`) }), [onNotice])
  const run = (operation: () => unknown | Promise<unknown>): void => { void Promise.resolve().then(operation).catch(onError) }
  const chooseProjectFolder = async (): Promise<void> => {
    const selected = await openDialog({ directory: true, multiple: false })
    const folder = Array.isArray(selected) ? selected[0] : selected
    if (folder) await openVideoEditProjectFolder(folder)
  }
  const projectId = instance?.document.id
  const audioDialog = useVideoEditAudioDialog(projectId)
  const focusPanel = (target: EventTarget | null): void => {
    const panel = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-video-edit-panel]')?.dataset.videoEditPanel : undefined
    if (projectId && panel && ['timeline', 'program', 'source', 'project', 'effects', 'content', 'lumetri'].includes(panel) && panel !== instance?.activePanel) focusVideoEditPanel(projectId, panel as NonNullable<typeof instance>['activePanel'])
  }
  const shortcuts = useSettingsStore(state => state.videoEditShortcuts)
  const hovered = useRef<Element | null>(null)
  return <div className="relative flex h-full min-h-0 flex-col bg-window text-text1" onFocusCapture={event => focusPanel(event.target)} onPointerDownCapture={event => focusPanel(event.target)} onPointerMoveCapture={event => { hovered.current = elementOfEventTarget(event.target) }} onKeyDown={event => {
    const binding = videoEditKeyboardCommand({ ...event.nativeEvent, code: event.code, key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey, repeat: event.repeat, isComposing: event.nativeEvent.isComposing, defaultPrevented: event.defaultPrevented, target: event.target }, instance?.activePanel ?? 'global', shortcuts)
    if (!binding) return
    if (binding.id === 'maximize_panel') { event.preventDefault(); event.stopPropagation(); toggleMaximizedGroup(dockApi, hovered.current); return }
    const context = captureVideoEditCommandContext(projectId, binding.scope)
    if (!videoEditCommandState(context, binding.id).enabled) return
    event.preventDefault(); event.stopPropagation()
    const panel = FOCUS_COMMANDS[binding.id]
    run(async () => { await executeVideoEditCommand(context, binding.id); if (panel) focusPanelElement(panel) })
  }}>
    {instance ? <>
      <VideoEditImportProgress projectId={instance.document.id} />
      <VideoEditToolbar instance={instance} api={dockApi} run={run} onNotice={onNotice} />
      <VideoEditFontWarnings document={videoEditCommittedDocument(instance)} />
      <div className="min-h-0 flex-1" aria-label="剪辑面板工作区"><VideoEditDock instance={instance} onError={onError} onApiChange={setDockApi} /></div>
    </> : <div className="min-h-0 flex-1">
      {/* 剪辑页 = 项目列表（作品索引）；打开项目 = 打开它的主剪辑 */}
      <VideoEditProjectsPage
        onCreate={() => run(createVideoEditProject)}
        onOpenFolder={() => run(chooseProjectFolder)}
        onOpen={project => run(() => openVideoEditProject(project))}
      />
    </div>}
    {/* 剪辑自身的保存失败要一直提示到重试成功：浮在底部中间，不占面板空间 */}
    {audioDialog?.kind === 'gain' && <VideoEditAudioGainDialog key={audioDialog.target.sequenceId + audioDialog.target.clipIds.join(':')} target={audioDialog.target} onClose={closeVideoEditAudioDialog} />}
    {audioDialog?.kind === 'export' && <VideoEditExportDialog key={audioDialog.projectId} projectId={audioDialog.projectId} onClose={closeVideoEditAudioDialog} />}
    {instance?.error && <div className="pointer-events-none absolute bottom-3 left-1/2 z-sticky -translate-x-1/2"><div className="pointer-events-auto max-w-xl rounded-full bg-panel px-4 py-1.5 shadow-panel"><UiError size="xs" align="start" message={instance.error} /></div></div>}
  </div>
}

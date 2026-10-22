import { UiInlineStatus } from '@/components/ui'
import { UI_INLINE_GAP_CLASS } from '@/components/ui/styleTokens'
import { notificationMessage } from '@/i18n/notifications'
import { ApplicationOperationReviewBanner } from '@/features/application-control'
import { useShallow } from 'zustand/react/shallow'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DockviewApi } from 'dockview-react'
import { ArrowLeft, Download, Redo2, Search } from 'lucide-react'

import { UiButton, UiIconButton, UiToolbar } from '@/components/ui'
import type { AudioEditAsrModel } from '@/platform/contracts/audioEdit'
import type { AudioEditProcessorDescriptor, AudioEditProjectDocument, AudioEditTask, AudioEditRange } from '@/core/audioEdit/types'
import type { DocumentSummary } from '@/core/documents/types'
import { ICON_TOOL_AUDIO_EDIT } from '@/core/theme/icons'
import { DocumentLibraryPage } from '@/features/documents/DocumentLibraryPage'
import { returnFromEmbedded, useEmbeddedHost } from '@/features/documents/embeddedDocuments'
import { useNotification } from '@/contexts/NotificationContext'
import { openAssistant } from '@/features/assistant/store/assistantUiStore'
import { getPlatform } from '@/platform/runtime'
import { saveDialog } from '@/platform/desktopApi'
import { useAudioEditPreview } from './preview/useAudioEditPreview'
import { calculatePreviewGain } from './preview/previewGain'
import { AudioEditPlaybackModeSwitch, type AudioEditDelivery } from './AudioEditPlaybackModeSwitch'
import { AudioEditViewSettings } from './AudioEditViewSettings'
import { AudioEditUndoButton } from './AudioEditUndoButton'
import { compileAudioEditXmlTimeline } from '@/core/audioEdit/xml'
import { AudioEditFileMenu, AudioEditTextEditor } from './AudioEditTextTools'
import { useAudioEditTextSearch } from './useAudioEditTextSearch'
import { useAudioEditSilencePreview } from './preview/useAudioEditSilencePreview'
import { useSettingsStore } from '@/stores/settingsStore'
import { UI_SCALE_MODES } from '@/core/theme/uiScale'
import { useAudioEditStore } from './store/audioEditStore'
import { AudioWaveToolbar } from './spectral/AudioWaveWorkspace'
import { audioWaveActions, useAudioWaveEditor } from './spectral/audioWaveEditorState'
import { AudioEditDock } from './workspace/AudioEditDock'
import { AudioEditLayoutMenu } from './workspace/AudioEditLayoutMenu'
import { AudioEditWorkspaceContext, type AudioEditDeliveryFormat, type AudioEditWorkspace } from './workspace/audioEditWorkspaceContext'

import { applyAudioEditSuggestion, audioEditSuggestionStates, DEFAULT_AUDIO_EDIT_VIEW_SETTINGS, dismissAudioEditSuggestion, editAudioEditRange, setAudioEditBlocks } from '@/core/audioEdit/edits'
import { editAudioEditProject, flushAudioEditProject } from './application/audioEditProjectInstances'
import { AudioEditLeaveCancelledError, importAudioEditMedia, leaveAudioEditEditor, openAudioEditDocument, pickAudioEditMedia, renameAudioEditDocument } from './application/audioEditDocumentService'
import { VideoEditSendMenu } from '@/features/videoEdit/panels/VideoEditSendMenu'
import { videoEditDocumentRef } from '@/features/videoEdit/application/videoEditSourceRefs'
import { exportAudioEdit, relinkAudioEdit } from './application/audioEditApplicationService'

function formatTime(frames: number, sampleRate: number): string {
  const seconds = Math.max(0, frames / Math.max(1, sampleRate))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, '0')}`
}

/** 列表卡片元信息：素材类型与时长（来自作品索引里的摘要）。 */
function describeAudioEditDocument(document: DocumentSummary): string | undefined {
  const seconds = Number(document.summary.durationSeconds)
  const type = document.summary.mediaType === 'video' ? '视频' : document.summary.mediaType === 'audio' ? '音频' : null
  if (!type) return '尚未导入素材'
  if (!Number.isFinite(seconds)) return type
  const whole = Math.max(0, Math.floor(seconds))
  return `${type} · ${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export interface AudioEditAppProps { onBack?: () => void }

export default function AudioEditApp({ onBack }: AudioEditAppProps): JSX.Element {
  const { showNotification } = useNotification()
  const state = useAudioEditStore(useShallow((state) => ({
    project: state.project,
    selectedBlockIds: state.selectedBlockIds,
    busy: state.busy,
    future: state.future,
    past: state.past,
    redo: state.redo,
    undo: state.undo,
    saveError: state.saveError,
    setBlocksIncluded: state.setBlocksIncluded,
    setReferenceScript: state.setReferenceScript,
    setSelectedBlockIds: state.setSelectedBlockIds,
    setVstEnabled: state.setVstEnabled,
  })))
  const { project, selectedBlockIds } = state
  useEffect(() => { if (project?.id) openAssistant() }, [project?.id])
  const [asrModels, setAsrModels] = useState<AudioEditAsrModel[]>([])
  const [processors, setProcessors] = useState<AudioEditProcessorDescriptor[]>([])
  const [busy, setBusy] = useState(false)
  const textSearch = useAudioEditTextSearch(project)
  const deliveryProject = useRef(project)
  deliveryProject.current = project
  const source = project?.source
  const transcript = project?.transcript
  const cuts = project?.cuts
  const xmlFrameRate = project?.xmlFrameRate
  const deliveryInput = useMemo(() => source && transcript ? { source, transcript, cuts, xmlFrameRate } : null, [source, transcript, cuts, xmlFrameRate])
  const delivery = useMemo<AudioEditDelivery>(() => {
    if (!deliveryInput) return { timeline: null, error: '' }
    try { return { timeline: compileAudioEditXmlTimeline({ ...deliveryProject.current!, ...deliveryInput }), error: '' } }
    catch (error) { return { timeline: null, error: error instanceof Error ? error.message : '无法交付 XML' } }
  }, [deliveryInput])
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<AudioEditTask[]>([])
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([])
  const [format, setFormat] = useState<AudioEditDeliveryFormat>('xml')
  const [withSrt, setWithSrt] = useState(false)
  const [withRx, setWithRx] = useState(false)
  const [waveSelection, setWaveSelection] = useState<AudioEditRange | null>(null)
  const waveEditor = useAudioWaveEditor(project ?? undefined)
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false)
  const [dockApi, setDockApi] = useState<DockviewApi | null>(null)
  const editorRoot = useRef<HTMLDivElement>(null)
  const [selectionOnly, setSelectionOnly] = useState(false)
  const [sourceError, setSourceError] = useState('')
  const disabled = busy || state.busy
  const selectedBlocks = useMemo(() => { const selected = new Set(selectedBlockIds); return project?.transcript.filter((block) => selected.has(block.id)) ?? [] }, [project?.transcript, selectedBlockIds])
  const range = selectionOnly ? waveSelection ?? (selectedBlocks.length ? { startFrame: Math.min(...selectedBlocks.map((block) => block.startFrame)), endFrame: Math.max(...selectedBlocks.map((block) => block.endFrame)) } : undefined) : undefined
  const silencePreview = useAudioEditSilencePreview(project, range, Boolean(project) && !disabled && !sourceError)
  const normalizationGain = useMemo(() => calculatePreviewGain(waveformPeaks), [waveformPeaks])
  const { togglePlayback, seekSourceFrame } = useAudioEditPreview(project, normalizationGain)
  const notifyError = useCallback((error: unknown) => showNotification(error instanceof Error ? error.message : notificationMessage('operationFailed'), 'error'), [showNotification])
  const run = useCallback(async (operation: () => Promise<unknown>) => {
    setBusy(true)
    try { await operation() } catch (error) { notifyError(error) } finally { setBusy(false) }
  }, [notifyError])
  // 列表由通用文档页取数（DocumentLibraryPage）；这里只读编辑器要用的识别模型与声音处理器
  useEffect(() => {
    const api = getPlatform().audioEdit
    void Promise.all([api.listAsrModels().then(setAsrModels), api.listProcessors().then(setProcessors)]).catch(notifyError)
  }, [notifyError])
  const projectId = project?.id
  const setSelectedBlockIds = state.setSelectedBlockIds
  useEffect(() => { setWaveSelection(null); setSelectionOnly(false); setEditingBlockId(null) }, [projectId])
  // 文字稿里选中的词（或查找命中）同步成波形上的选区，编辑器跟着翻到那里。
  const navigateToFrame = useCallback((frame: number) => {
    seekSourceFrame(frame)
    const view = waveEditor.view
    if (frame < view.start || frame >= view.end) {
      const length = view.end - view.start
      const start = Math.max(0, Math.min((project?.source.durationFrames ?? 0) - length, frame - length * 0.2))
      waveEditor.setView({ start, end: start + length })
    }
  }, [seekSourceFrame, waveEditor, project?.source.durationFrames])
  useEffect(() => {
    if (!selectedBlocks.length) return
    setWaveSelection({ startFrame: Math.min(...selectedBlocks.map((block) => block.startFrame)), endFrame: Math.max(...selectedBlocks.map((block) => block.endFrame)) })
  }, [selectedBlocks])
  useEffect(() => {
    const match = textSearch.currentMatch
    if (!match) return
    const block = project?.transcript.find((item) => item.id === match.blockIds[0])
    if (block) { navigateToFrame(block.startFrame); setSelectedBlockIds(match.blockIds) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- follow the search cursor only
  }, [textSearch.currentMatch, textSearch.navigationKey])
  useEffect(() => {
    const element = editorRoot.current
    if (!element) return
    let lastZoom = 0
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || (event.target instanceof Element && event.target.closest('[data-audio-spectral-editor]'))) return
      event.preventDefault()
      if (Date.now() - lastZoom < 150) return
      lastZoom = Date.now()
      const modes = UI_SCALE_MODES.filter((mode) => mode !== 'auto')
      const current = Number(document.documentElement.dataset.uiScale ?? 100)
      const index = modes.findIndex((value) => Number(value) >= current)
      useSettingsStore.getState().setUiScaleMode(modes[Math.max(0, Math.min(modes.length - 1, (index < 0 ? modes.length - 1 : index) + (event.deltaY < 0 ? 1 : -1)))])
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [projectId])
  const waveformPath = project?.source.audioPath
  const waveformSeconds = project ? project.source.durationFrames / project.source.sampleRate : 0
  useEffect(() => {
    let disposed = false
    setWaveformPeaks([]); setSourceError('')
    if (!projectId || !waveformPath) return
    void getPlatform().audioEdit.verifySource(projectId).catch((error: unknown) => {
      if (!disposed) setSourceError(error instanceof Error ? error.message : '素材不可用')
    })
    void getPlatform().audioEdit.extractWaveform(waveformPath, Math.max(1600, Math.min(360000, Math.ceil(waveformSeconds * 50)))).then((waveform) => {
      if (!disposed) setWaveformPeaks(waveform.peak)
    }).catch((error: unknown) => { if (!disposed) notifyError(error) })
    return () => { disposed = true }
  }, [projectId, waveformPath, waveformSeconds, notifyError])
  useEffect(() => {
    if (!projectId) { setTasks([]); return }
    let disposed = false
    const update = () => void getPlatform().audioEdit.listTasks(projectId).then((items) => { if (!disposed) setTasks(items) }).catch(notifyError)
    update()
    const timer = window.setInterval(update, 1500)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [projectId, notifyError])
  // 返回列表：草稿走“保存 / 不保存 / 取消”，取消留在编辑器
  // 从剪辑里打开的音频（嵌入模式）离开后回到剪辑；其余回到列表
  const embeddedHost = useEmbeddedHost(project?.id)
  const leave = () => run(async () => { if (project) await returnFromEmbedded(project.id, leaveAudioEditEditor); else await leaveAudioEditEditor() })
  // 新建 = 导入音频或视频，导入即建草稿（离开时起名）
  const importMedia = () => run(async () => {
    const sourcePath = await pickAudioEditMedia()
    if (sourcePath) await importAudioEditMedia(sourcePath)
  })
  const openDocument = (document: { id: string; path?: string }) => run(async () => {
    try { await openAudioEditDocument(document) } catch (error) { if (!(error instanceof AudioEditLeaveCancelledError)) throw error }
  })
  const exportProject = () => run(async () => {
    if (!project) return
    const targetPath = await saveDialog({ defaultPath: `${project.name.replace(/\.[^.]+$/, '')}-剪辑.${format}`, filters: [{ name: format === 'xml' ? 'Final Cut Pro 7 XML' : 'WAV 音频', extensions: [format] }] })
    if (!targetPath) return
    const result = await exportAudioEdit({ projectId: project.id, targetPath, format, includeProcessing: withRx, ...(withSrt ? { subtitleTargetPath: targetPath.replace(/\.[^.]+$/, '') + '.srt' } : {}) })
    showNotification(notificationMessage('audioExported', { format: format.toUpperCase(), duration: formatTime(result.durationFrames, project.source.sampleRate) }))
  })
  if (!project) {
    // 列表整页是通用文档页（3.3）：取数、筛选、草稿区与右键操作（重命名、移到项目、创建副本、删除等）都由通用组件负责
    return (
      <DocumentLibraryPage
        kind="audio_edit"
        title="音频编辑"
        onBack={onBack}
        backLabel="返回工具"
        icon={ICON_TOOL_AUDIO_EDIT}
        describe={describeAudioEditDocument}
        busy={disabled}
        labels={{ emptyDescription: '导入音频或视频，在波形和频谱上精修、修掉杂音，或压缩停顿、清理语气词，再导出或交给剪辑。直接引用原素材，不改原文件。' }}
        create={{ kind: 'direct', onCreate: () => void importMedia() }}
        onOpen={(document) => openDocument({ id: document.id, path: document.path })}
      />
    )
  }
  const update = (patch: Partial<AudioEditProjectDocument>) => {
    try { editAudioEditProject(project.id, (current) => ({ ...current, ...patch })) } catch (error) { notifyError(error) }
  }
  const editingBlock = project.transcript.find((block) => block.id === editingBlockId)
  const deleteBlock = (id: string) => {
    try { editAudioEditProject(project.id, (current) => setAudioEditBlocks(current, [id], false)) } catch (error) { notifyError(error) }
  }
  const resolveSuggestions = (ids: string[], apply: boolean) => {
    try {
      const wanted = new Set(ids)
      let count = 0
      editAudioEditProject(project.id, (current) => {
        const states = audioEditSuggestionStates(current)
        const eligible = current.suggestions.filter((item) => wanted.has(item.id) && states.get(item.id) === 'available')
        const selected = new Set(eligible.map((item) => item.id))
        const next = apply
          ? eligible.reduce((draft, item) => applyAudioEditSuggestion(draft, item.id), current)
          : eligible.reduce((draft, item) => dismissAudioEditSuggestion(draft, item.id), current)
        count = next.suggestions.filter((item) => selected.has(item.id) && item.status === (apply ? 'applied' : 'dismissed')).length
        return count ? next : current
      })
      showNotification(count ? notificationMessage(apply ? 'audioCuesProcessed' : 'audioCuesHidden', { count }) : notificationMessage('audioCuesUnchanged'))
    } catch (error) { notifyError(error) }
  }
  const editSelection = (mode: 'delete' | 'mute' | 'restore') => {
    if (!waveSelection || disabled) return
    try {
      editAudioEditProject(project.id, (current) => editAudioEditRange(current, waveSelection, mode))
      // 删除后那段声音不在了，清掉选区让删除标记露出来；静音、恢复保留选区（与 Audition 一致），方便接着操作。
      if (mode === 'delete') { setWaveSelection(null); setSelectedBlockIds([]) }
    } catch (error) { notifyError(error) }
  }
  const waveActions = audioWaveActions(project, (action) => void run(action))
  const relinkSource = () => run(async () => {
    const path = await pickAudioEditMedia('原始素材')
    if (path) { await relinkAudioEdit(project.id, path); setSourceError(''); showNotification(notificationMessage('audioRelinked')) }
  })
  const runningTasks = tasks.filter((task) => task.state === 'running' && (task.kind !== 'silence' || state.busy))
  const workspace: AudioEditWorkspace = {
    project, disabled, sourceError, run, notifyError, notify: (message) => showNotification(message), update,
    history: { past: state.past, future: state.future, undo: state.undo, redo: state.redo },
    textSearch, wave: waveEditor, waveActions, waveSelection,
    setWaveSelection: (next) => { setWaveSelection(next); if (selectedBlockIds.length) setSelectedBlockIds([]) },
    editSelection, seek: seekSourceFrame, navigateToFrame, togglePlayback, delivery,
    silencePreview: { ranges: silencePreview.ranges, pending: silencePreview.pending, ...(silencePreview.error ? { error: silencePreview.error } : {}) },
    selectionOnly, setSelectionOnly, processRange: range, selectedBlocks, selectedBlockIds, setSelectedBlockIds,
    setBlocksIncluded: state.setBlocksIncluded, setReferenceScript: state.setReferenceScript, setVstEnabled: state.setVstEnabled,
    editBlock: setEditingBlockId, deleteBlock, resolveSuggestions, asrModels, processors, tasks,
    deliveryFormat: format, setDeliveryFormat: setFormat, withSrt, setWithSrt, withProcessing: withRx, setWithProcessing: setWithRx,
    openViewSettings: () => setViewSettingsOpen(true),
  }
  return <div ref={editorRoot} className="flex h-full min-h-0 flex-col bg-window" onKeyDown={(event) => {
    if ((event.ctrlKey || event.metaKey) && ['f', 'h'].includes(event.key.toLowerCase())) { event.preventDefault(); textSearch.open(event.key.toLowerCase() === 'h'); dockApi?.getPanel('transcript')?.api.setActive(); return }
    if (event.target instanceof HTMLElement && (event.target.closest('input,textarea,[contenteditable="true"]'))) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) state.redo(); else state.undo() }
  }}>
    <ApplicationOperationReviewBanner documentId={project.id} domain="audio_edit" label="音频" />
    <UiToolbar
      variant="command"
      center={<div className={`flex items-center ${UI_INLINE_GAP_CLASS.group}`}><AudioEditPlaybackModeSwitch delivery={delivery} /></div>}
      centerLayout="fit"
      subordinate={<AudioWaveToolbar editor={waveEditor} selection={waveSelection} disabled={disabled} actions={waveActions} onEditSelection={editSelection} />}
      trailing={<>
        {runningTasks.map((task) => <span key={task.requestId} role="status" className="flex items-center gap-1">
          <span className="text-xs tabular-nums text-text2">正在处理{task.progress === undefined ? '…' : ` ${Math.round(task.progress * 100)}%`}</span>
          <UiButton size="md" onClick={() => void run(() => getPlatform().audioEdit.cancelTask(task.requestId))}>取消</UiButton>
        </span>)}
        {state.saveError && <span className="flex items-center gap-1">
          <UiInlineStatus role="alert" className="max-w-48 truncate" tooltip={state.saveError}>保存失败，修改仍保留</UiInlineStatus>
          <UiButton size="md" onClick={() => void run(() => flushAudioEditProject(project.id))}>重试保存</UiButton>
        </span>}
        {!state.saveError && sourceError && <span className="flex items-center gap-1">
          <UiInlineStatus role="alert" className="max-w-48 truncate" tooltip={sourceError}>{sourceError}</UiInlineStatus>
          <UiButton size="md" disabled={disabled} onClick={() => void relinkSource()}>重新定位</UiButton>
        </span>}
        <UiIconButton size="md" aria-label="查找与替换" on={textSearch.isOpen} aria-expanded={textSearch.isOpen} tooltip={textSearch.isOpen ? '关闭查找替换' : '查找与替换 · Ctrl+F'} onClick={() => { if (textSearch.isOpen) textSearch.close(); else { textSearch.open(); dockApi?.getPanel('transcript')?.api.setActive() } }}><Search /></UiIconButton>
        <AudioEditUndoButton key={project.id} project={project} canUndo={Boolean(state.past.length)} disabled={disabled} onUndo={state.undo} onError={notifyError} onRestored={() => { state.setSelectedBlockIds([]); setWaveSelection(null); showNotification(notificationMessage('audioUndoAll')) }} />
        <UiIconButton size="md" disabled={disabled || !state.future.length} onClick={state.redo} aria-label="重做" tooltip="重做"><Redo2 /></UiIconButton>
        <AudioEditLayoutMenu api={dockApi} />
        {/* 一条带只有这一条分隔线：左侧是编辑工具，右侧是交付动作 */}
        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line" />
        <VideoEditSendMenu mediaKind="audio" disabled={disabled || Boolean(sourceError)} notify={showNotification} resolveSource={async () => ({ type: 'document', docRef: await videoEditDocumentRef(project.id), includeProcessing: withRx })} />
        <UiButton variant="primary" disabled={disabled || Boolean(sourceError)} onClick={() => void exportProject()}><Download className="mr-1.5" />导出</UiButton>
      </>}
    >
      {embeddedHost
        ? <UiButton onClick={() => void leave()}><ArrowLeft />{`返回剪辑 · ${embeddedHost.label}`}</UiButton>
        : <UiIconButton size="md" onClick={() => void leave()} aria-label="返回音频列表" tooltip="返回音频列表"><ArrowLeft /></UiIconButton>}
      <AudioEditFileMenu key={project.id} name={project.name} disabled={disabled} onRename={(name) => void run(() => renameAudioEditDocument(project.id, name))} onRelink={() => void relinkSource()} />
    </UiToolbar>
    <AudioEditWorkspaceContext.Provider value={workspace}>
      <div className="min-h-0 flex-1"><AudioEditDock onReady={setDockApi} /></div>
    </AudioEditWorkspaceContext.Provider>
    <AudioEditViewSettings open={viewSettingsOpen} onClose={() => setViewSettingsOpen(false)} value={project.viewSettings ?? DEFAULT_AUDIO_EDIT_VIEW_SETTINGS} onChange={(viewSettings) => update({ viewSettings })} />
    {editingBlock && <AudioEditTextEditor key={editingBlock.id} block={editingBlock} disabled={disabled} onClose={() => setEditingBlockId(null)} onSave={(text) => {
      try { editAudioEditProject(project.id, (current) => ({ ...current, transcript: current.transcript.map((block) => block.id === editingBlock.id ? { ...block, text } : block) })); setEditingBlockId(null) } catch (error) { notifyError(error) }
    }} />}
  </div>
}

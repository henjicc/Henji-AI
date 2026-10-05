import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import {
  ArrowLeft,
  Download,
  FileAudio,
  Lock,
  LockOpen,
  Redo2,
  RotateCcw,
  Sparkles,
  Search,
  Trash2,
} from 'lucide-react'

import {
  UI_TEXT_PANEL_TITLE_CLASS,
  UI_TEXT_SECONDARY_CLASS,
  UI_TEXT_META_CLASS,
  Dropdown,
  UiButton,
  UiChipButton,
  UiEmpty,
  UiFormRow,
  UiGroup,
  UiIconButton,
  UiSwitch,
  UiTextArea,
  UiTextToken,
  UiToolbar,
  UiRangeInput,
} from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import type { AudioEditAsrModel } from '@/platform/contracts/audioEdit'
import type { AudioEditProcessorDescriptor, AudioEditProjectDocument, AudioEditTask, AudioEditRange } from '@/core/audioEdit/types'
import type { DocumentSummary } from '@/core/documents/types'
import { ICON_TOOL_AUDIO_EDIT } from '@/core/theme/icons'
import { DocumentLibraryPage } from '@/features/documents/DocumentLibraryPage'
import { useNotification } from '@/contexts/NotificationContext'
import { openAssistant } from '@/features/assistant/store/assistantUiStore'
import { getPlatform } from '@/platform/runtime'
import { openDialog, readTextFile, saveDialog } from '@/platform/desktopApi'
import { useAudioEditPreview } from './preview/useAudioEditPreview'
import { calculatePreviewGain } from './preview/previewGain'
import { AudioEditPlaybackModeSwitch, AudioEditTimeline, type AudioEditDelivery } from './AudioEditTimeline'
import { AudioEditDisclosure } from './AudioEditDisclosure'
import { AudioEditViewSettings } from './AudioEditViewSettings'
import { AudioEditSuggestions } from './AudioEditSuggestions'
import { AudioEditUndoButton } from './AudioEditUndoButton'
import { buildAudioEditCaptionGroups } from '@/core/audioEdit/captions'
import { normalizeAudioEditFiller } from '@/core/audioEdit/analysis'
import { compileAudioEditXmlTimeline } from '@/core/audioEdit/xml'
import { AudioEditFileMenu, AudioEditFindReplace, AudioEditMatchedText, AudioEditTextEditor } from './AudioEditTextTools'
import { useAudioEditTextSearch, type AudioEditTextSearch } from './useAudioEditTextSearch'
import { useAudioEditSilencePreview } from './preview/useAudioEditSilencePreview'
import { useSettingsStore } from '@/stores/settingsStore'
import { UI_SCALE_MODES } from '@/core/theme/uiScale'
import { useAudioEditPlaybackStore } from './store/audioEditPlaybackStore'
import { useAudioEditStore } from './store/audioEditStore'

import { applyAudioEditSuggestion, audioEditSuggestionStates, dismissAudioEditSuggestion, DEFAULT_AUDIO_EDIT_SETTINGS, DEFAULT_AUDIO_EDIT_VIEW_SETTINGS, editAudioEditRange, setAudioEditBlocks } from '@/core/audioEdit/edits'
import { editAudioEditProject, flushAudioEditProject } from './application/audioEditProjectInstances'
import { AudioEditLeaveCancelledError, importAudioEditMedia, leaveAudioEditEditor, openAudioEditDocument, pickAudioEditMedia, renameAudioEditDocument } from './application/audioEditDocumentService'
import { VideoEditSendMenu } from '@/features/videoEdit/panels/VideoEditSendMenu'
import { compressAudioEditSilence, cleanProjectAudioEditFillers, transcribeAudioEdit, exportAudioEdit, relinkAudioEdit, prepareAudioEditProcessing, quickProcessAudioEdit } from './application/audioEditApplicationService'

function formatTime(frames: number, sampleRate: number): string {
  const seconds = Math.max(0, frames / Math.max(1, sampleRate))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, '0')}`
}

function Transcript({
  project,
  onSeek,
  onEdit,
  onDelete,
  disabled,
  search,
}: {
  project: AudioEditProjectDocument
  onSeek: (frame: number) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  disabled: boolean
  search: AudioEditTextSearch
}) {
  const activeBlockId = useAudioEditPlaybackStore((state) => state.activeBlockId)
  const mode = useAudioEditPlaybackStore((state) => state.mode)
  const selected = useAudioEditStore((state) => state.selectedBlockIds)
  const setSelected = useAudioEditStore((state) => state.setSelectedBlockIds)
  const listRef = useRef<VirtuosoHandle | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const followPausedUntilRef = useRef(0)
  const transcript = project.transcript
  const viewSettings = project.viewSettings ?? DEFAULT_AUDIO_EDIT_VIEW_SETTINGS
  const batchSettings = project.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS
  const fillers = useMemo(() => new Set(batchSettings.fillers.map(normalizeAudioEditFiller)), [batchSettings.fillers])
  const pauseFrames = batchSettings.silenceThresholdMs / 1000 * project.source.sampleRate
  const rows = useMemo(() => {
    if (transcript.some((block) => block.captionBreakAfter !== undefined)) return buildAudioEditCaptionGroups(transcript, project.source.sampleRate).map((group) => group.blocks)
    const next: typeof transcript[] = []
    for (let index = 0; index < transcript.length; index += 64) {
      next.push(transcript.slice(index, index + 64))
    }
    return next
  }, [transcript, project.source.sampleRate])
  const rowByBlock = useMemo(() => new Map(rows.flatMap((row, index) => row.map((block) => [block.id, index] as const))), [rows])
  const activeRow = useMemo(() => {
    if (!activeBlockId) return -1
    return rowByBlock.get(activeBlockId) ?? -1
  }, [activeBlockId, rowByBlock])

  useEffect(() => {
    if (search.currentMatch || activeRow < 0 || Date.now() < followPausedUntilRef.current) return
    listRef.current?.scrollIntoView({ index: activeRow, behavior: 'smooth', done: () => undefined })
  }, [activeRow, activeBlockId, search.currentMatch])

  useEffect(() => {
    const id = search.currentMatch?.blockIds[0]
    const index = id ? rowByBlock.get(id) ?? -1 : -1
    if (index < 0) return
    let disposed = false
    const reveal = () => {
      if (disposed) return
      containerRef.current?.querySelector('[data-audio-search-current="true"]')?.scrollIntoView({ block: 'center', inline: 'nearest' })
    }
    if (containerRef.current?.querySelector('[data-audio-search-current="true"]')) reveal()
    else listRef.current?.scrollIntoView({ index, behavior: 'auto', done: () => { requestAnimationFrame(reveal) } })
    return () => { disposed = true }
  }, [search.navigationKey, search.currentMatch, rowByBlock])

  return (
    <div
      ref={containerRef}
      className="h-full"
      style={{ paddingLeft: viewSettings.sidePadding, paddingRight: viewSettings.sidePadding, fontSize: viewSettings.textSize }}
      onPointerDown={() => { followPausedUntilRef.current = Date.now() + 2500 }}
      onWheel={() => { followPausedUntilRef.current = Date.now() + 2500 }}
      onTouchMove={() => { followPausedUntilRef.current = Date.now() + 2500 }}
    >
      {project.transcript.length === 0 ? (
        <UiEmpty
          className="h-full"
          icon={<FileAudio size={40} strokeWidth={1.5} aria-hidden="true" />}
          title="等待转写"
          description="在右栏开始转写，得到可逐词剪辑的时间戳文本。"
        />
      ) : (
        <Virtuoso
          ref={listRef}
          className="h-full"
          data={rows}
          increaseViewportBy={320}
          components={{ Header: TranscriptEdge, Footer: TranscriptEdge }}
          itemContent={(_, row) => (
            <div className="mx-auto max-w-3xl pb-6">
              <div className="mb-1 font-mono text-xs tabular-nums text-text3">{formatTime(row[0]?.startFrame ?? 0, project.source.sampleRate)}</div>
              <p className="m-0 leading-loose">
                {row.map((block, index) => {
                  const isActive = !search.fragments.has(block.id) && activeBlockId === block.id && (mode === 'source' || block.included)
                  const isSelected = selected.includes(block.id)
                  const previous = index > 0 ? row[index - 1] : null
                  const pause = previous ? block.startFrame - previous.endFrame : 0
                  return (
                    <Fragment key={block.id}>
                      {previous && pause >= pauseFrames ? (
                        <span aria-hidden="true" title="停顿" className="mx-1 inline-block rounded bg-raised px-1.5 align-middle font-mono text-2xs leading-5 text-text3">{(pause / project.source.sampleRate).toFixed(1)}s</span>
                      ) : null}
                      <UiTextToken
                        data-audio-word={block.id}
                        aria-current={isActive ? 'true' : undefined}
                        current={isActive}
                        selected={isSelected}
                        excluded={!block.included}
                        flagged={block.included && fillers.has(normalizeAudioEditFiller(block.text))}
                        disabled={disabled}
                        onDoubleClick={() => onEdit(block.id)}
                        onContextMenu={(event) => { event.preventDefault(); setSelected([block.id]); onDelete(block.id) }}
                        onClick={(event) => {
                          if (event.shiftKey) {
                            const anchor = transcript.findIndex((item) => item.id === selected[0])
                            const target = transcript.indexOf(block)
                            setSelected(transcript.slice(Math.min(anchor < 0 ? target : anchor, target), Math.max(anchor, target) + 1).map((item) => item.id))
                            return
                          }
                          setSelected([block.id])
                          if (block.included || mode === 'source') onSeek(block.startFrame)
                        }}
                        title="单击选中，双击编辑，右键删除声音"
                      >
                        {block.locked ? <Lock role="img" aria-label="已锁定" className="mr-0.5 inline h-[0.75em] w-[0.75em] align-baseline text-text3" /> : null}
                        <AudioEditMatchedText block={block} search={search} />
                      </UiTextToken>
                    </Fragment>
                  )
                })}
              </p>
            </div>
          )}
        />
      )}
    </div>
  )
}

/** 滑杆行标签：名称 + 当前读数（读数用等宽数字，拖动时不跳宽）。 */
function RangeLabel({ name, value }: { name: string; value: string }): JSX.Element {
  return <span className="flex items-baseline justify-between gap-2"><span>{name}</span><span className="tabular-nums text-text3">{value}</span></span>
}

/** 逐字稿首尾留白（虚拟列表内部，避免外层 padding 把滚动条也推进来）。 */
function TranscriptEdge(): JSX.Element {
  return <div className="h-8" />
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
  const state = useAudioEditStore()
  const { project, selectedBlockIds } = state
  useEffect(() => { if (project?.id) openAssistant() }, [project?.id])
  const [asrModels, setAsrModels] = useState<AudioEditAsrModel[]>([])
  const [processors, setProcessors] = useState<AudioEditProcessorDescriptor[]>([])
  const [busy, setBusy] = useState(false)
  const textSearch = useAudioEditTextSearch(project)
  const delivery = useMemo<AudioEditDelivery>(() => {
    if (!project) return { timeline: null, error: '' }
    try { return { timeline: compileAudioEditXmlTimeline(project), error: '' } }
    catch (error) { return { timeline: null, error: error instanceof Error ? error.message : '无法交付 XML' } }
  }, [project])
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null)
  const [navigationTarget, setNavigationTarget] = useState<{ frame: number } | null>(null)
  const [tasks, setTasks] = useState<AudioEditTask[]>([])
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([])
  const [format, setFormat] = useState<'xml' | 'wav'>('xml')
  const [withSrt, setWithSrt] = useState(false)
  const [withRx, setWithRx] = useState(false)
  const [waveSelection, setWaveSelection] = useState<AudioEditRange | null>(null)
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false)
  const editorRoot = useRef<HTMLDivElement>(null)
  const [selectionOnly, setSelectionOnly] = useState(false)
  const [sourceError, setSourceError] = useState('')
  const disabled = busy || state.busy
  const selectedBlocks = project?.transcript.filter((block) => selectedBlockIds.includes(block.id)) ?? []
  const range = selectionOnly ? waveSelection ?? (selectedBlocks.length ? { startFrame: Math.min(...selectedBlocks.map((block) => block.startFrame)), endFrame: Math.max(...selectedBlocks.map((block) => block.endFrame)) } : undefined) : undefined
  const silencePreview = useAudioEditSilencePreview(project, range, Boolean(project) && !disabled && !sourceError)
  const normalizationGain = useMemo(() => calculatePreviewGain(waveformPeaks), [waveformPeaks])
  const { togglePlayback, seekSourceFrame } = useAudioEditPreview(project, normalizationGain)
  const navigateToFrame = (frame: number) => { setNavigationTarget({ frame }); seekSourceFrame(frame) }
  const notifyError = useCallback((error: unknown) => showNotification(error instanceof Error ? error.message : '操作失败，请重试', 'error'), [showNotification])
  const run = useCallback(async (operation: () => Promise<unknown>) => {
    setBusy(true)
    try { await operation() } catch (error) { notifyError(error) } finally { setBusy(false) }
  }, [notifyError])
  // 口播列表由通用文档页取数（DocumentLibraryPage）；这里只读编辑器要用的识别模型与声音处理器
  useEffect(() => {
    const api = getPlatform().audioEdit
    void Promise.all([api.listAsrModels().then(setAsrModels), api.listProcessors().then(setProcessors)]).catch(notifyError)
  }, [notifyError])
  const projectId = project?.id
  const setSelectedBlockIds = state.setSelectedBlockIds
  useEffect(() => { setWaveSelection(null); setSelectionOnly(false); setEditingBlockId(null); setNavigationTarget(null) }, [projectId])
  useEffect(() => {
    const match = textSearch.currentMatch
    if (!match) return
    const block = project?.transcript.find((item) => item.id === match.blockIds[0])
    if (block) { setNavigationTarget({ frame: block.startFrame }); setSelectedBlockIds(match.blockIds) }
  }, [textSearch.currentMatch, textSearch.navigationKey, project?.transcript, setSelectedBlockIds])
  useEffect(() => {
    const element = editorRoot.current
    if (!element) return
    let lastZoom = 0
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || (event.target instanceof Element && event.target.closest('[data-audio-timeline]'))) return
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
  const leave = () => run(async () => { await leaveAudioEditEditor() })
  // 新建口播 = 导入音频或视频，导入即建草稿（离开时起名）
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
    showNotification(`已导出${format === 'xml' ? ' XML' : ' WAV'}，交付时长 ${formatTime(result.durationFrames, project.source.sampleRate)}`)
  })
  if (!project) {
    // 列表整页是通用文档页（3.3）：取数、筛选、草稿区与右键操作（重命名、移到项目、创建副本、删除等）都由通用组件负责
    return (
      <DocumentLibraryPage
        kind="audio_edit"
        title="口播剪辑"
        description="用文字和波形剪辑，再交给专业剪辑软件"
        onBack={onBack}
        backLabel="返回工具"
        icon={ICON_TOOL_AUDIO_EDIT}
        describe={describeAudioEditDocument}
        busy={disabled}
        labels={{ emptyDescription: '导入音频或视频，压缩停顿、清理语气词，再导出到 Premiere 或达芬奇继续编辑。口播直接引用原素材。' }}
        create={{ kind: 'direct', onCreate: () => void importMedia() }}
        onOpen={(document) => openDocument({ id: document.id, path: document.path })}
      />
    )
  }
  const settings = project.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS
  const update = (patch: Partial<AudioEditProjectDocument>) => {
    try { editAudioEditProject(project.id, (current) => ({ ...current, ...patch })) } catch (error) { notifyError(error) }
  }
  const configuredAsr = asrModels.some((model) => model.configured && model.timestamps)
  const plugins = processors.filter((item) => item.available && item.semanticRole)
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
      showNotification(count ? `${apply ? '已处理' : '已隐藏'} ${count} 处，可整批撤销` : '这些线索已处理或失效，没有新增修改')
    } catch (error) { notifyError(error) }
  }
  const editSelection = (mode: 'delete' | 'mute' | 'restore') => {
    if (!waveSelection || disabled) return
    try { editAudioEditProject(project.id, (current) => editAudioEditRange(current, waveSelection, mode)) } catch (error) { notifyError(error) }
  }
  const relinkSource = () => run(async () => {
    const path = await pickAudioEditMedia('原始素材')
    if (path) { await relinkAudioEdit(project.id, path); setSourceError(''); showNotification('原素材已重新定位') }
  })
  const runningTasks = tasks.filter((task) => task.state === 'running' && (task.kind !== 'silence' || state.busy))
  const transcriptionInterrupted = tasks.some((task) => task.kind === 'transcription' && ['failed', 'cancelled'].includes(task.state)) && !project.transcript.length
  const selectedSeconds = selectedBlocks.reduce((total, block) => total + Math.max(0, block.endFrame - block.startFrame), 0) / project.source.sampleRate
  const enabledCuts = (project.cuts ?? []).filter((cut) => cut.enabled)
  const allLocked = selectedBlocks.length > 0 && selectedBlocks.every((block) => block.locked)
  return <div ref={editorRoot} className="flex h-full min-h-0 flex-col bg-window" onKeyDown={(event) => {
    if ((event.ctrlKey || event.metaKey) && ['f', 'h'].includes(event.key.toLowerCase())) { event.preventDefault(); textSearch.open(event.key.toLowerCase() === 'h'); return }
    if (event.target instanceof HTMLElement && (event.target.closest('input,textarea,[contenteditable="true"]'))) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) state.redo(); else state.undo() }
  }}>
    <UiToolbar
      variant="command"
      center={<AudioEditPlaybackModeSwitch delivery={delivery} />}
      centerLayout="fit"
      subordinate={textSearch.isOpen ? <AudioEditFindReplace search={textSearch} disabled={disabled} /> : undefined}
      trailing={<>
        {runningTasks.map((task) => <span key={task.requestId} role="status" className="flex items-center gap-1">
          <span className="text-xs tabular-nums text-text2">正在处理{task.progress === undefined ? '…' : ` ${Math.round(task.progress * 100)}%`}</span>
          <UiButton size="sm" onClick={() => void run(() => getPlatform().audioEdit.cancelTask(task.requestId))}>取消</UiButton>
        </span>)}
        {state.saveError && <span className="flex items-center gap-1">
          <span role="alert" className="max-w-48 truncate text-xs text-danger-text" title={state.saveError}>保存失败，修改仍保留</span>
          <UiButton size="sm" onClick={() => void run(() => flushAudioEditProject(project.id))}>重试保存</UiButton>
        </span>}
        {!state.saveError && sourceError && <span className="flex items-center gap-1">
          <span role="alert" className="max-w-48 truncate text-xs text-danger-text" title={sourceError}>{sourceError}</span>
          <UiButton size="sm" disabled={disabled} onClick={() => void relinkSource()}>重新定位</UiButton>
        </span>}
        <UiIconButton size="lg" aria-label="查找与替换" on={textSearch.isOpen} aria-expanded={textSearch.isOpen} title={textSearch.isOpen ? '关闭查找替换' : '查找与替换 · Ctrl+F'} onClick={() => textSearch.isOpen ? textSearch.close() : textSearch.open()}><Search size={16} /></UiIconButton>
        <AudioEditUndoButton key={project.id} project={project} canUndo={Boolean(state.past.length)} disabled={disabled} onUndo={state.undo} onError={notifyError} onRestored={() => { state.setSelectedBlockIds([]); setWaveSelection(null); showNotification('已撤销全部剪辑修改；可再次撤销以恢复操作前状态') }} />
        <UiIconButton size="lg" disabled={disabled || !state.future.length} onClick={state.redo} aria-label="重做" title="重做"><Redo2 size={16} /></UiIconButton>
        {/* 一条带只有这一条分隔线：左侧是编辑工具，右侧是交付动作 */}
        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line" />
        <VideoEditSendMenu mediaKind="audio" disabled={disabled || Boolean(sourceError)} notify={showNotification} resolveSource={() => ({ kind: 'audio_edit.project', projectId: project.id, includeProcessing: withRx })} />
        <UiButton variant="primary" disabled={disabled || Boolean(sourceError)} onClick={() => void exportProject()}><Download size={15} className="mr-1.5" />导出</UiButton>
      </>}
    >
      <UiIconButton size="lg" onClick={() => void leave()} aria-label="返回口播列表" title="返回口播列表"><ArrowLeft size={16} /></UiIconButton>
      <AudioEditFileMenu key={project.id} name={project.name} disabled={disabled} onRename={(name) => void run(() => renameAudioEditDocument(project.id, name))} onRelink={() => void relinkSource()} />
    </UiToolbar>
    <div className="flex min-h-0 flex-1">
      <main className="min-h-0 min-w-0 flex-1"><Transcript project={project} onSeek={navigateToFrame} onEdit={setEditingBlockId} onDelete={deleteBlock} disabled={disabled} search={textSearch} /></main>
      <aside aria-label="处理" className="w-64 shrink-0 overflow-y-auto border-l border-gap bg-panel p-4 xl:w-72">
        <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-5">
          {!project.transcript.length && <section className="flex flex-col gap-2.5">
            <h2 className={UI_TEXT_PANEL_TITLE_CLASS}>语音识别</h2>
            <p className={`leading-normal ${UI_TEXT_SECONDARY_CLASS}`}>{transcriptionInterrupted ? '上次转写未完成，可先恢复原任务。' : '无须转写也可压缩停顿。识别按配置的模型计费。'}</p>
            {transcriptionInterrupted
              ? <UiButton variant="secondary" className="w-full" onClick={() => void run(() => transcribeAudioEdit({ projectId: project.id }))}>恢复转写</UiButton>
              : <UiButton variant="secondary" className="w-full" disabled={!configuredAsr || Boolean(sourceError)} onClick={() => void run(async () => { await transcribeAudioEdit({ projectId: project.id }); showNotification('转写完成，剪辑粒度以实际时间戳为准') })}>开始转写</UiButton>}
          </section>}
          <section className="flex flex-col gap-2.5">
            <h2 className={UI_TEXT_PANEL_TITLE_CLASS}>一键处理</h2>
            <p className={`leading-normal ${UI_TEXT_SECONDARY_CLASS}`}>压缩停顿、清理语气词。黄色区域预览将要删除的声音，处理后仍可逐词调整。</p>
            <UiButton variant="secondary" className="w-full gap-1.5" disabled={Boolean(sourceError)} onClick={() => void run(async () => { const result = await quickProcessAudioEdit(project.id, range); showNotification(`已处理停顿和所选语气词，缩短 ${(result.shortenedMs / 1000).toFixed(2)} 秒，可整批撤销`) })}><Sparkles size={15} />快速处理</UiButton>
          </section>
          <UiGroup divided titleTone="compact" gap="none">
            <AudioEditDisclosure title="自定义处理参数" value={`停顿 ≥ ${settings.silenceThresholdMs} 毫秒`}>
              <UiFormRow label="仅处理选区" density="compact" inline><UiSwitch aria-label="仅处理选区" checked={selectionOnly} disabled={!selectedBlocks.length && !waveSelection} onCheckedChange={setSelectionOnly} /></UiFormRow>
              <UiFormRow label={<RangeLabel name="最短停顿" value={`${settings.silenceThresholdMs} 毫秒`} />} density="compact"><UiRangeInput aria-label="最短停顿" min={100} max={3000} step={50} value={settings.silenceThresholdMs} onChange={(event) => { const value = Number(event.target.value); update({ batchSettings: { ...settings, silenceThresholdMs: value, retainedSilenceMs: Math.min(settings.retainedSilenceMs, value - 50) } }) }} /></UiFormRow>
              <UiFormRow label={<RangeLabel name="保留时长" value={`${settings.retainedSilenceMs} 毫秒`} />} density="compact"><UiRangeInput aria-label="保留时长" min={0} max={settings.silenceThresholdMs - 50} step={50} value={settings.retainedSilenceMs} onChange={(event) => update({ batchSettings: { ...settings, retainedSilenceMs: Number(event.target.value) } })} /></UiFormRow>
              <UiFormRow label={<RangeLabel name="静音阈值" value={`${settings.noiseDb} dB`} />} density="compact"><UiRangeInput aria-label="静音阈值" min={-80} max={-10} step={1} value={settings.noiseDb} onChange={(event) => update({ batchSettings: { ...settings, noiseDb: Number(event.target.value) } })} /></UiFormRow>
              <UiFormRow label="包括片头片尾" density="compact" inline><UiSwitch aria-label="包括片头片尾" checked={settings.trimEdges} onCheckedChange={(value) => update({ batchSettings: { ...settings, trimEdges: value } })} /></UiFormRow>
              <UiButton variant="secondary" className="w-full" disabled={Boolean(sourceError)} onClick={() => void run(async () => { const result = await compressAudioEditSilence(project.id, range); showNotification(`处理 ${result.count} 处停顿，缩短 ${(result.shortenedMs / 1000).toFixed(2)} 秒`) })}>压缩停顿</UiButton>
              <p className={UI_TEXT_META_CLASS}>选择需要清理的词类；可能有语义的词默认保留。</p>
              <div role="group" aria-label="语气词" className="flex flex-wrap gap-1">{['嗯', '呃', '额', '那个', '就是', '啊'].map((word) => <UiChipButton key={word} size="sm" active={settings.fillers.includes(word)} aria-pressed={settings.fillers.includes(word)} onClick={() => update({ batchSettings: { ...settings, fillers: settings.fillers.includes(word) ? settings.fillers.filter((value) => value !== word) : [...settings.fillers, word] } })}>{word}</UiChipButton>)}</div>
              <UiButton variant="secondary" className="w-full" onClick={() => void run(async () => showNotification(`清理 ${await cleanProjectAudioEditFillers(project.id, range)} 处语气词，可撤销或逐处恢复`))}>清理语气词</UiButton>
            </AudioEditDisclosure>
            {enabledCuts.length > 0 && <AudioEditDisclosure title="已处理区间" value={`${enabledCuts.length} 处`}>
              <div className="flex flex-col">{enabledCuts.map((cut) => <div key={cut.id} className="flex items-center justify-between gap-2">
                <UiButton size="sm" className="font-mono tabular-nums" onClick={() => seekSourceFrame(Math.max(0, cut.startFrame - project.source.sampleRate))}>{formatTime(cut.startFrame, project.source.sampleRate)} · {cut.mode === 'mute' ? '静音' : '删除'}</UiButton>
                <UiButton size="sm" onClick={() => update({ cuts: project.cuts?.map((item) => item.id === cut.id ? { ...item, enabled: false } : item) })}>恢复</UiButton>
              </div>)}</div>
            </AudioEditDisclosure>}
            <AudioEditSuggestions project={project} onSeek={navigateToFrame} onResolve={resolveSuggestions} />
            <AudioEditDisclosure title="参考逐字稿" value={project.referenceScript?.trim() ? '已填写' : '未使用'}>
              <UiTextArea rows={4} placeholder="用于对齐内容，不替代真实识别文本" value={project.referenceScript} onChange={(event) => state.setReferenceScript(event.target.value)} />
              <UiButton className="self-start" onClick={() => void run(async () => { const value = await openDialog({ multiple: false, filters: [{ name: '文本', extensions: ['txt', 'md'] }] }); const path = Array.isArray(value) ? value[0] : value; if (path) state.setReferenceScript(await readTextFile(path)) })}>导入参考稿</UiButton>
            </AudioEditDisclosure>
            <AudioEditDisclosure title="声音处理" value={project.vstEnabled ? '试听已启用' : '关闭'}>
              <UiFormRow label="剪后试听启用" density="compact" inline><UiSwitch aria-label="剪后试听启用" checked={project.vstEnabled} disabled={!plugins.length} onCheckedChange={(value) => void run(async () => { if (value) await prepareAudioEditProcessing(project.id, crypto.randomUUID()); state.setVstEnabled(value) })} /></UiFormRow>
              {!plugins.length && <p className={UI_TEXT_META_CLASS}>未发现兼容插件，可继续基础剪辑。</p>}
              {plugins.map((plugin) => { const entry = project.processorChain?.find((item) => item.id === plugin.id); return <div key={plugin.id} className="flex flex-col gap-2"><UiFormRow label={plugin.name} density="compact" inline><UiSwitch aria-label={plugin.name} checked={Boolean(entry?.enabled)} onCheckedChange={(enabled) => update({ vstEnabled: false, processorChain: [...(project.processorChain ?? []).filter((item) => item.id !== plugin.id).map((item) => processors.find((p) => p.id === item.id)?.semanticRole === plugin.semanticRole ? { ...item, enabled: false } : item), { id: plugin.id, enabled, parameters: entry?.parameters ?? {} }] })} /></UiFormRow>{entry?.enabled && plugin.parameters?.map((parameter) => <UiFormRow key={parameter.id} label={parameter.name} density="compact" inline><NumberInput ariaLabel={parameter.name} size="sm" min={0} max={1} step={0.01} precision={2} widthClassName="w-20" align="right" commitOnChange value={entry.parameters[parameter.name] ?? parameter.normalizedValue} onChange={(next) => update({ vstEnabled: false, processorChain: project.processorChain?.map((item) => item.id === plugin.id ? { ...item, parameters: { ...item.parameters, [parameter.name]: next } } : item) })} /></UiFormRow>)}</div> })}
              <p className={UI_TEXT_META_CLASS}>配方随项目保存。更改后重新启用试听；切换到原始试听可旁路对比。</p>
            </AudioEditDisclosure>
            <AudioEditDisclosure title="交付设置" value={format === 'xml' ? 'XML' : 'WAV'}>
              <UiFormRow label="导出格式" density="compact">
                <Dropdown<'xml' | 'wav'> ariaLabel="导出格式" size="sm" className="w-full" minWidthStrategy="none" value={format} display={format === 'xml' ? 'XML · 继续剪辑' : 'WAV · 剪后音频'}
                  options={[{ label: 'XML · 继续剪辑', value: 'xml' }, { label: 'WAV · 剪后音频', value: 'wav' }]} onSelect={setFormat} />
              </UiFormRow>
              {project.source.mediaType === 'audio' && format === 'xml' && <UiFormRow label="XML 帧率" density="compact">
                <Dropdown<number> ariaLabel="XML 帧率" size="sm" className="w-full" minWidthStrategy="none" value={project.xmlFrameRate?.numerator ?? 25} display={`${project.xmlFrameRate?.numerator ?? 25} fps`}
                  options={[24, 25, 30, 50, 60].map((fps) => ({ label: `${fps} fps`, value: fps }))} onSelect={(fps) => update({ xmlFrameRate: { numerator: fps, denominator: 1 } })} />
              </UiFormRow>}
              <UiFormRow label="附带 SRT 字幕" density="compact" inline><UiSwitch aria-label="附带 SRT 字幕" checked={withSrt} onCheckedChange={setWithSrt} /></UiFormRow>
              <UiFormRow label="包含声音处理" density="compact" inline><UiSwitch aria-label="包含声音处理" checked={withRx} disabled={!plugins.length} onCheckedChange={setWithRx} /></UiFormRow>
              <p className={UI_TEXT_META_CLASS}>{withRx ? '同时保存全长处理音轨，XML 引用该音轨。' : 'XML 直接引用原文件；切点按视频帧向外对齐。XML 交付试听可核对差异。'}</p>
            </AudioEditDisclosure>
          </UiGroup>
          {selectedBlocks.length > 0 && <UiGroup divided titleTone="compact">
            <div className="text-xs tabular-nums text-text3">已选 {selectedBlocks.length} 个词 · {selectedSeconds.toFixed(1)} 秒</div>
            <div className="-mx-2 flex flex-wrap gap-0.5">
              <UiButton size="sm" variant="danger" onClick={() => state.setBlocksIncluded(selectedBlockIds, false)}><Trash2 size={14} className="mr-1" />删除声音</UiButton>
              <UiButton size="sm" onClick={() => state.setBlocksIncluded(selectedBlockIds, true)}><RotateCcw size={14} className="mr-1" />恢复</UiButton>
              <UiButton size="sm" onClick={() => update({ transcript: project.transcript.map((block) => selectedBlockIds.includes(block.id) ? { ...block, locked: !allLocked } : block) })}>{allLocked ? <LockOpen size={14} className="mr-1" /> : <Lock size={14} className="mr-1" />}{allLocked ? '解锁' : '锁定'}</UiButton>
            </div>
          </UiGroup>}
        </fieldset>
      </aside>
    </div>
    <AudioEditTimeline project={project} delivery={delivery} onSeek={seekSourceFrame} onToggle={togglePlayback} selection={waveSelection} onSelection={setWaveSelection} onEditSelection={editSelection} previewRanges={silencePreview.ranges} previewPending={silencePreview.pending} previewError={silencePreview.error} disabled={disabled} onSettings={() => setViewSettingsOpen(true)} selectedBlockIds={selectedBlockIds} onSelectBlock={(id) => { state.setSelectedBlockIds([id]); const block = project.transcript.find((item) => item.id === id); if (block) navigateToFrame(block.startFrame) }} onEditBlock={setEditingBlockId} onDeleteBlock={deleteBlock} navigationTarget={navigationTarget} textSearch={textSearch} />
    <AudioEditViewSettings open={viewSettingsOpen} onClose={() => setViewSettingsOpen(false)} value={project.viewSettings ?? DEFAULT_AUDIO_EDIT_VIEW_SETTINGS} onChange={(viewSettings) => update({ viewSettings })} />
    {editingBlock && <AudioEditTextEditor key={editingBlock.id} block={editingBlock} disabled={disabled} onClose={() => setEditingBlockId(null)} onSave={(text) => {
      try { editAudioEditProject(project.id, (current) => ({ ...current, transcript: current.transcript.map((block) => block.id === editingBlock.id ? { ...block, text } : block) })); setEditingBlockId(null) } catch (error) { notifyError(error) }
    }} />}
  </div>
}

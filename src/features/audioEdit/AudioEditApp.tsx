import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import {
  ArrowLeft,
  Download,
  FileAudio,
  Redo2,
  Sparkles,
  Search,
} from 'lucide-react'

import {
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiIconButton,
  UiSwitch,
  UiTextArea,
  UiInput,
  UiSelect,
  UiRangeInput,
} from '@/components/ui'
import type { AudioEditAsrModel } from '@/platform/contracts/audioEdit'
import type { AudioEditProcessorDescriptor, AudioEditProjectDocument, AudioEditProjectSummary, AudioEditTask, AudioEditRange } from '@/core/audioEdit/types'
import { useNotification } from '@/contexts/NotificationContext'
import { openAssistant } from '@/features/assistant/store/assistantUiStore'
import { getPlatform } from '@/platform/runtime'
import { basename, openDialog, readTextFile, saveDialog } from '@/platform/desktopApi'
import { useAudioEditPreview } from './preview/useAudioEditPreview'
import { calculatePreviewGain } from './preview/previewGain'
import { AudioEditTimeline } from './AudioEditTimeline'
import { AudioEditHome } from './AudioEditHome'
import { AudioEditViewSettings } from './AudioEditViewSettings'
import { AudioEditSuggestions } from './AudioEditSuggestions'
import { AudioEditUndoButton } from './AudioEditUndoButton'
import { buildAudioEditCaptionGroups } from '@/core/audioEdit/captions'
import { AudioEditFindReplace, AudioEditMatchedText, AudioEditTextEditor, AudioEditTitle } from './AudioEditTextTools'
import { useAudioEditTextSearch, type AudioEditTextSearch } from './useAudioEditTextSearch'
import { useAudioEditSilencePreview } from './preview/useAudioEditSilencePreview'
import { useSettingsStore } from '@/stores/settingsStore'
import { UI_SCALE_MODES } from '@/core/theme/uiScale'
import { useAudioEditPlaybackStore } from './store/audioEditPlaybackStore'
import { useAudioEditStore } from './store/audioEditStore'

import { applyAudioEditSuggestion, audioEditSuggestionStates, dismissAudioEditSuggestion, DEFAULT_AUDIO_EDIT_SETTINGS, DEFAULT_AUDIO_EDIT_VIEW_SETTINGS, editAudioEditRange, setAudioEditBlocks } from '@/core/audioEdit/edits'
import { editAudioEditProject, flushAudioEditProject, loadAudioEditProject } from './application/audioEditProjectInstances'
import { compressAudioEditSilence, cleanProjectAudioEditFillers, transcribeAudioEdit, exportAudioEdit, relinkAudioEdit, deleteAudioEdit, prepareAudioEditProcessing, quickProcessAudioEdit } from './application/audioEditApplicationService'

const MEDIA_EXTENSIONS = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'mp4', 'mov', 'mkv', 'webm']

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
      className="h-full py-6"
      style={{ paddingLeft: viewSettings.sidePadding, paddingRight: viewSettings.sidePadding, fontSize: viewSettings.textSize }}
      onPointerDown={() => { followPausedUntilRef.current = Date.now() + 2500 }}
      onWheel={() => { followPausedUntilRef.current = Date.now() + 2500 }}
      onTouchMove={() => { followPausedUntilRef.current = Date.now() + 2500 }}
    >
      {project.transcript.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <FileAudio className="h-10 w-10 text-text-muted" />
          <div className={UI_TEXT_LABEL_CLASS}>等待转写</div>
          <div className={UI_TEXT_META_CLASS}>选择已配置的语音识别模型，获得可剪辑的时间戳文本。</div>
        </div>
      ) : (
        <Virtuoso
          ref={listRef}
          className="h-full"
          data={rows}
          increaseViewportBy={320}
          itemContent={(_, row) => (
            <div className="pb-3 leading-loose">
              {row.map((block) => {
                const isActive = !search.fragments.has(block.id) && activeBlockId === block.id && (mode === 'source' || block.included)
                const isSelected = selected.includes(block.id)
                return (
                  <UiButton
                    key={block.id}
                    data-audio-word={block.id}
                    aria-current={isActive ? 'true' : undefined}
                    variant="plain"
                    size="sm"
                    style={{ fontSize: 'inherit', lineHeight: 'inherit', padding: '0 0.1em', minHeight: 0 }}
                    className={`inline h-auto rounded-lg font-normal ${
                      isActive
                        ? `!bg-accent text-white ${block.included ? '' : 'line-through'}`
                        : !block.included
                          ? '!border-transparent !bg-transparent text-text-muted line-through opacity-55'
                          : isSelected
                            ? '!bg-layer text-text-dark ring-1 ring-accent'
                            : '!border-transparent !bg-transparent text-text-dark hover:!bg-layer'
                    }`}
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
                    {block.locked ? '🔒 ' : ''}<AudioEditMatchedText block={block} search={search} />
                  </UiButton>
                )
              })}
            </div>
          )}
        />
      )}
    </div>
  )
}

export interface AudioEditAppProps { onBack?: () => void }

export default function AudioEditApp({ onBack }: AudioEditAppProps): JSX.Element {
  const { showNotification } = useNotification()
  const state = useAudioEditStore()
  const { project, setProject, selectedBlockIds } = state
  useEffect(() => { if (project?.id) openAssistant() }, [project?.id])
  const [projects, setProjects] = useState<AudioEditProjectSummary[]>([])
  const [asrModels, setAsrModels] = useState<AudioEditAsrModel[]>([])
  const [processors, setProcessors] = useState<AudioEditProcessorDescriptor[]>([])
  const [busy, setBusy] = useState(false)
  const [homeLoading, setHomeLoading] = useState(true)
  const [homeLoadFailed, setHomeLoadFailed] = useState(false)
  const textSearch = useAudioEditTextSearch(project)
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
  const [confirmDelete, setConfirmDelete] = useState(false)
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
  const refreshHome = useCallback(async () => {
    const api = getPlatform().audioEdit
    setHomeLoading(true); setHomeLoadFailed(false)
    await Promise.all([
      api.listProjects().then(setProjects).catch((error: unknown) => {
        setHomeLoadFailed(true)
        throw error
      }).finally(() => setHomeLoading(false)),
      api.listAsrModels().then(setAsrModels),
      api.listProcessors().then(setProcessors),
    ])
  }, [])
  useEffect(() => { void refreshHome().catch(notifyError) }, [refreshHome, notifyError])
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
    setWaveformPeaks([]); setSourceError(''); setConfirmDelete(false)
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
  const leave = () => run(async () => {
    if (project) await flushAudioEditProject(project.id)
    setProject(null); await refreshHome()
  })
  const importMedia = () => run(async () => {
    const selected = await openDialog({ multiple: false, filters: [{ name: '音频或视频', extensions: MEDIA_EXTENSIONS }] })
    const sourcePath = Array.isArray(selected) ? selected[0] : selected
    if (sourcePath) setProject(await getPlatform().audioEdit.createProject({ sourcePath, name: basename(sourcePath) }))
  })
  const assistant = () => {
    if (!project) return
    openAssistant()
  }
  const exportProject = () => run(async () => {
    if (!project) return
    const targetPath = await saveDialog({ defaultPath: `${project.name.replace(/\.[^.]+$/, '')}-剪辑.${format}`, filters: [{ name: format === 'xml' ? 'Final Cut Pro 7 XML' : 'WAV 音频', extensions: [format] }] })
    if (!targetPath) return
    const result = await exportAudioEdit({ projectId: project.id, targetPath, format, includeProcessing: withRx, ...(withSrt ? { subtitleTargetPath: targetPath.replace(/\.[^.]+$/, '') + '.srt' } : {}) })
    showNotification(`已导出${format === 'xml' ? ' XML' : ' WAV'}，交付时长 ${formatTime(result.durationFrames, project.source.sampleRate)}`)
  })
  if (!project) {
    return <AudioEditHome projects={projects} loading={homeLoading} loadFailed={homeLoadFailed} disabled={disabled} onBack={onBack} onImport={() => void importMedia()} onRetry={() => void run(refreshHome)} onOpen={(id) => void run(async () => setProject((await loadAudioEditProject(id)).document))} />
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
  return <div ref={editorRoot} className="flex h-full min-h-0 flex-col bg-app" onKeyDown={(event) => {
    if ((event.ctrlKey || event.metaKey) && ['f', 'h'].includes(event.key.toLowerCase())) { event.preventDefault(); textSearch.open(event.key.toLowerCase() === 'h'); return }
    if (event.target instanceof HTMLElement && (event.target.closest('input,textarea,[contenteditable="true"]'))) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) state.redo(); else state.undo() }
  }}>
    <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border-dark px-3 py-2">
      <UiIconButton appearance="hover-only" showBorder={false} className="h-8 w-8" onClick={() => void leave()} title="返回工程列表"><ArrowLeft size={16} /></UiIconButton>
      <AudioEditTitle key={project.id} name={project.name} disabled={disabled} onChange={(name) => update({ name })} />
      <UiIconButton appearance="hover-only" showBorder={false} aria-label="查找与替换" aria-expanded={textSearch.isOpen} title={textSearch.isOpen ? '关闭查找替换' : '查找与替换 · Ctrl+F'} onClick={() => textSearch.isOpen ? textSearch.close() : textSearch.open()}><Search size={16} /></UiIconButton>
      <AudioEditUndoButton key={project.id} project={project} canUndo={Boolean(state.past.length)} disabled={disabled} onUndo={state.undo} onError={notifyError} onRestored={() => { state.setSelectedBlockIds([]); setWaveSelection(null); showNotification('已撤销全部剪辑修改；可再次撤销以恢复操作前状态') }} />
      <UiIconButton appearance="hover-only" showBorder={false} disabled={disabled || !state.future.length} onClick={state.redo} title="重做"><Redo2 size={16} /></UiIconButton>
      <UiButton variant="plain" size="sm" onClick={assistant}><Sparkles size={15} className="mr-1" />智能助手</UiButton>
      <UiButton variant="primary" size="sm" disabled={disabled || Boolean(sourceError)} onClick={() => void exportProject()}><Download size={15} className="mr-1" />导出</UiButton>
    </div>
    {(state.saveError || sourceError) && <div role="alert" className="flex items-center gap-3 border-b border-border-dark px-4 py-2 text-sm text-text-dark"><span>{state.saveError ? `保存失败，修改仍保留：${state.saveError}` : sourceError}</span>{state.saveError && <UiButton size="sm" variant="plain" onClick={() => void run(() => flushAudioEditProject(project.id))}>重试保存</UiButton>}</div>}
    {tasks.filter((task) => task.state === 'running' && (task.kind !== 'silence' || state.busy)).map((task) => <div key={task.requestId} role="status" className="flex items-center gap-3 px-4 py-2 text-sm text-text-muted"><span>正在处理{task.progress === undefined ? '…' : ` ${Math.round(task.progress * 100)}%`}</span><UiButton size="sm" variant="plain" onClick={() => void run(() => getPlatform().audioEdit.cancelTask(task.requestId))}>取消</UiButton></div>)}
    {tasks.some((task) => task.kind === 'transcription' && ['failed', 'cancelled'].includes(task.state)) && !project.transcript.length && <div className="flex items-center gap-3 px-4 py-2 text-sm text-text-muted"><span>上次转写未完成，优先查询原任务。</span><UiButton size="sm" variant="plain" disabled={disabled} onClick={() => void run(() => transcribeAudioEdit({ projectId: project.id }))}>恢复转写</UiButton></div>}
    {textSearch.isOpen && <AudioEditFindReplace search={textSearch} disabled={disabled} />}
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_17rem]">
      <main className="flex min-h-0 flex-col border-r border-border-dark">
        <div className="min-h-0 flex-1"><Transcript project={project} onSeek={navigateToFrame} onEdit={setEditingBlockId} onDelete={deleteBlock} disabled={disabled} search={textSearch} /></div>
      </main>
      <aside className="min-h-0 overflow-y-auto p-4">
        <fieldset disabled={disabled} className="min-w-0 space-y-6">
          {!project.transcript.length && <section><div className={`mb-2 ${UI_TEXT_LABEL_CLASS}`}>语音识别</div><UiButton variant="primary" size="sm" disabled={!configuredAsr || Boolean(sourceError)} onClick={() => void run(async () => { await transcribeAudioEdit({ projectId: project.id }); showNotification('转写完成，剪辑粒度以实际时间戳为准') })}>开始转写</UiButton><div className={`mt-2 ${UI_TEXT_META_CLASS}`}>无须转写也可压缩停顿。识别按配置的模型计费。</div></section>}
          <section className="space-y-3">
            <UiButton variant="primary" className="w-full gap-2" disabled={Boolean(sourceError)} onClick={() => void run(async () => { const result = await quickProcessAudioEdit(project.id, range); showNotification(`已处理停顿和所选语气词，缩短 ${(result.shortenedMs / 1000).toFixed(2)} 秒，可整批撤销`) })}><Sparkles size={16} />快速处理</UiButton>
            <p className={UI_TEXT_META_CLASS}>压缩停顿、清理语气词。黄色区域预览将要删除的声音，可继续手工调整。</p>
            <details className="space-y-3"><summary className="cursor-pointer text-sm text-text-muted">自定义处理参数</summary>
            <label className="flex items-center justify-between gap-2 text-sm text-text-muted">仅处理选区<UiSwitch checked={selectionOnly} disabled={!selectedBlocks.length && !waveSelection} onCheckedChange={setSelectionOnly} /></label>
            <label className="block text-sm text-text-muted">最短停顿 · {settings.silenceThresholdMs} 毫秒<UiRangeInput aria-label="最短停顿" min={100} max={3000} step={50} value={settings.silenceThresholdMs} onChange={(event) => { const value = Number(event.target.value); update({ batchSettings: { ...settings, silenceThresholdMs: value, retainedSilenceMs: Math.min(settings.retainedSilenceMs, value - 50) } }) }} /></label>
            <label className="block text-sm text-text-muted">保留时长 · {settings.retainedSilenceMs} 毫秒<UiRangeInput aria-label="保留时长" min={0} max={settings.silenceThresholdMs - 50} step={50} value={settings.retainedSilenceMs} onChange={(event) => update({ batchSettings: { ...settings, retainedSilenceMs: Number(event.target.value) } })} /></label>
            <label className="block text-sm text-text-muted">静音阈值 · {settings.noiseDb} dB<UiRangeInput aria-label="静音阈值" min={-80} max={-10} step={1} value={settings.noiseDb} onChange={(event) => update({ batchSettings: { ...settings, noiseDb: Number(event.target.value) } })} /></label>
            <label className="flex items-center justify-between gap-2 text-sm text-text-muted">包括片头片尾<UiSwitch checked={settings.trimEdges} onCheckedChange={(value) => update({ batchSettings: { ...settings, trimEdges: value } })} /></label>
            <UiButton variant="plain" size="sm" className="w-full" disabled={Boolean(sourceError)} onClick={() => void run(async () => { const result = await compressAudioEditSilence(project.id, range); showNotification(`处理 ${result.count} 处停顿，缩短 ${(result.shortenedMs / 1000).toFixed(2)} 秒`) })}>压缩停顿</UiButton>
            <div className={UI_TEXT_META_CLASS}>选择需要清理的词类；可能有语义的词默认保留。</div>
            <div className="flex flex-wrap gap-1">{['嗯', '呃', '额', '那个', '就是', '啊'].map((word) => <UiButton key={word} variant={settings.fillers.includes(word) ? 'muted' : 'plain'} size="sm" onClick={() => update({ batchSettings: { ...settings, fillers: settings.fillers.includes(word) ? settings.fillers.filter((value) => value !== word) : [...settings.fillers, word] } })}>{word}</UiButton>)}</div>
            <UiButton variant="plain" size="sm" className="w-full" onClick={() => void run(async () => showNotification(`清理 ${await cleanProjectAudioEditFillers(project.id, range)} 处语气词，可撤销或逐处恢复`))}>清理语气词</UiButton>
            </details>
          </section>
          {selectedBlocks.length > 0 && <section className="space-y-2"><div className={UI_TEXT_LABEL_CLASS}>已选 {selectedBlocks.length} 个词块</div><div className="flex flex-wrap gap-1">
            <UiButton size="sm" variant="plain" onClick={() => state.setBlocksIncluded(selectedBlockIds, false)}>删除声音</UiButton><UiButton size="sm" variant="plain" onClick={() => state.setBlocksIncluded(selectedBlockIds, true)}>恢复</UiButton>
            <UiButton size="sm" variant="plain" onClick={() => update({ transcript: project.transcript.map((block) => selectedBlockIds.includes(block.id) ? { ...block, locked: !selectedBlocks.every((item) => item.locked) } : block) })}>{selectedBlocks.every((block) => block.locked) ? '解锁' : '锁定'}</UiButton>
          </div></section>}
          {(project.cuts ?? []).some((cut) => cut.enabled) && <details><summary className="cursor-pointer text-sm text-text-muted">已处理区间</summary>{(project.cuts ?? []).filter((cut) => cut.enabled).map((cut) => <div key={cut.id} className="flex items-center justify-between gap-2 text-sm text-text-muted"><UiButton size="sm" variant="plain" onClick={() => seekSourceFrame(Math.max(0, cut.startFrame - project.source.sampleRate))}>{formatTime(cut.startFrame, project.source.sampleRate)} · {cut.mode === 'mute' ? '静音' : '删除'}</UiButton><UiButton size="sm" variant="plain" onClick={() => update({ cuts: project.cuts?.map((item) => item.id === cut.id ? { ...item, enabled: false } : item) })}>恢复</UiButton></div>)}</details>}
          <AudioEditSuggestions project={project} onSeek={navigateToFrame} onResolve={resolveSuggestions} />
          <details className="space-y-3"><summary className="cursor-pointer text-sm text-text-muted">参考逐字稿</summary><UiTextArea rows={4} placeholder="用于对齐内容，不替代真实识别文本" value={project.referenceScript} onChange={(event) => state.setReferenceScript(event.target.value)} /><UiButton size="sm" variant="plain" onClick={() => void run(async () => { const value = await openDialog({ multiple: false, filters: [{ name: '文本', extensions: ['txt', 'md'] }] }); const path = Array.isArray(value) ? value[0] : value; if (path) state.setReferenceScript(await readTextFile(path)) })}>导入参考稿</UiButton></details>
          <details className="space-y-3"><summary className="cursor-pointer text-sm text-text-muted">RX 声音处理</summary><label className="flex items-center justify-between text-sm text-text-muted">剪后试听启用<UiSwitch checked={project.vstEnabled} disabled={!plugins.length} onCheckedChange={(value) => void run(async () => { if (value) await prepareAudioEditProcessing(project.id, crypto.randomUUID()); state.setVstEnabled(value) })} /></label>{!plugins.length && <div className={UI_TEXT_META_CLASS}>未发现兼容插件，可继续基础剪辑。</div>}
            {plugins.map((plugin) => { const entry = project.processorChain?.find((item) => item.id === plugin.id); return <div key={plugin.id} className="space-y-2"><label className="flex items-center justify-between gap-2 text-sm text-text-dark">{plugin.name}<UiSwitch checked={Boolean(entry?.enabled)} onCheckedChange={(enabled) => update({ vstEnabled: false, processorChain: [...(project.processorChain ?? []).filter((item) => item.id !== plugin.id).map((item) => processors.find((p) => p.id === item.id)?.semanticRole === plugin.semanticRole ? { ...item, enabled: false } : item), { id: plugin.id, enabled, parameters: entry?.parameters ?? {} }] })} /></label>{entry?.enabled && plugin.parameters?.map((parameter) => <label key={parameter.id} className="block text-xs text-text-muted">{parameter.name}<UiInput type="number" min={0} max={1} step={0.01} value={entry.parameters[parameter.name] ?? parameter.normalizedValue} onChange={(event) => update({ vstEnabled: false, processorChain: project.processorChain?.map((item) => item.id === plugin.id ? { ...item, parameters: { ...item.parameters, [parameter.name]: Number(event.target.value) } } : item) })} /></label>)}</div> })}<div className={UI_TEXT_META_CLASS}>配方随工程保存。更改后重新启用试听；切换到原始试听可旁路对比。</div>
          </details>
          <details className="space-y-3"><summary className="cursor-pointer text-sm text-text-muted">交付设置</summary><UiSelect aria-label="导出格式" value={format} onChange={(event) => setFormat(event.target.value as 'xml' | 'wav')}><option value="xml">XML · 继续剪辑</option><option value="wav">WAV · 剪后音频</option></UiSelect>
            {project.source.mediaType === 'audio' && format === 'xml' && <label className="block text-sm text-text-muted">XML 帧率<UiSelect value={project.xmlFrameRate?.numerator ?? 25} onChange={(event) => update({ xmlFrameRate: { numerator: Number(event.target.value), denominator: 1 } })}>{[24, 25, 30, 50, 60].map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}</UiSelect></label>}
            <label className="flex items-center justify-between text-sm text-text-muted">附带 SRT 字幕<UiSwitch checked={withSrt} onCheckedChange={setWithSrt} /></label><label className="flex items-center justify-between text-sm text-text-muted">包含声音处理<UiSwitch checked={withRx} disabled={!plugins.length} onCheckedChange={setWithRx} /></label><div className={UI_TEXT_META_CLASS}>{withRx ? '同时保存全长处理音轨，XML 引用该音轨。' : 'XML 直接引用原文件；切点按视频帧向外对齐。XML 交付试听可核对差异。'}</div>
          </details>
          <section className="space-y-2"><UiButton size="sm" variant="plain" onClick={() => void run(async () => { const value = await openDialog({ multiple: false, filters: [{ name: '原始素材', extensions: MEDIA_EXTENSIONS }] }); const path = Array.isArray(value) ? value[0] : value; if (path) { await relinkAudioEdit(project.id, path); setSourceError(''); showNotification('原素材已重新定位') } })}>重新定位原素材</UiButton><UiButton size="sm" variant="plain" onClick={() => setConfirmDelete(!confirmDelete)}>删除工程</UiButton>{confirmDelete && <div className={UI_TEXT_META_CLASS}>仅删除工程和缓存，原素材保持不变。<UiButton size="sm" variant="plain" onClick={() => void run(async () => { await deleteAudioEdit(project.id); setProject(null); await refreshHome() })}>确认删除</UiButton></div>}</section>
        </fieldset>
      </aside>
    </div>
    <AudioEditTimeline project={project} peaks={waveformPeaks} onSeek={seekSourceFrame} onToggle={togglePlayback} selection={waveSelection} onSelection={setWaveSelection} onEditSelection={editSelection} previewRanges={silencePreview.ranges} previewPending={silencePreview.pending} previewError={silencePreview.error} disabled={disabled} onSettings={() => setViewSettingsOpen(true)} selectedBlockIds={selectedBlockIds} onSelectBlock={(id) => { state.setSelectedBlockIds([id]); const block = project.transcript.find((item) => item.id === id); if (block) navigateToFrame(block.startFrame) }} onEditBlock={setEditingBlockId} onDeleteBlock={deleteBlock} navigationTarget={navigationTarget} textSearch={textSearch} />
    <AudioEditViewSettings open={viewSettingsOpen} onClose={() => setViewSettingsOpen(false)} value={project.viewSettings ?? DEFAULT_AUDIO_EDIT_VIEW_SETTINGS} onChange={(viewSettings) => update({ viewSettings })} />
    {editingBlock && <AudioEditTextEditor key={editingBlock.id} block={editingBlock} disabled={disabled} onClose={() => setEditingBlockId(null)} onSave={(text) => {
      try { editAudioEditProject(project.id, (current) => ({ ...current, transcript: current.transcript.map((block) => block.id === editingBlock.id ? { ...block, text } : block) })); setEditingBlockId(null) } catch (error) { notifyError(error) }
    }} />}
  </div>
}

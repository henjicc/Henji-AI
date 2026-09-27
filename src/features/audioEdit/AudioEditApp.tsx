import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import {
  ArrowLeft,
  Check,
  Download,
  FileAudio,
  Redo2,
  Sparkles,
  Undo2,
  X,
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
} from '@/components/ui'
import type { AudioEditAsrModel } from '@/platform/contracts/audioEdit'
import type { AudioEditProcessorDescriptor, AudioEditProjectDocument, AudioEditProjectSummary, AudioEditTask } from '@/core/audioEdit/types'
import { useNotification } from '@/contexts/NotificationContext'
import { openAssistant } from '@/features/assistant/store/assistantUiStore'
import { createHostContextSnapshot } from '@/features/application-control/hostContext/hostContext'
import { getPlatform } from '@/platform/runtime'
import { basename, openDialog, readTextFile, saveDialog } from '@/platform/desktopApi'
import { useAudioEditPreview } from './preview/useAudioEditPreview'
import { calculatePreviewGain } from './preview/previewGain'
import { AudioEditTimeline } from './AudioEditTimeline'
import { AudioEditHome } from './AudioEditHome'
import { useAudioEditPlaybackStore } from './store/audioEditPlaybackStore'
import { useAudioEditStore } from './store/audioEditStore'

import { DEFAULT_AUDIO_EDIT_SETTINGS } from '@/core/audioEdit/edits'
import { editAudioEditProject, flushAudioEditProject, loadAudioEditProject } from './application/audioEditProjectInstances'
import { compressAudioEditSilence, cleanProjectAudioEditFillers, transcribeAudioEdit, exportAudioEdit, relinkAudioEdit, deleteAudioEdit, prepareAudioEditProcessing } from './application/audioEditApplicationService'

const MEDIA_EXTENSIONS = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'mp4', 'mov', 'mkv', 'webm']

function formatTime(frames: number, sampleRate: number): string {
  const seconds = Math.max(0, frames / Math.max(1, sampleRate))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, '0')}`
}

function Transcript({
  project,
  onSeek,
}: {
  project: AudioEditProjectDocument
  onSeek: (frame: number) => void
}) {
  const activeBlockId = useAudioEditPlaybackStore((state) => state.activeBlockId)
  const mode = useAudioEditPlaybackStore((state) => state.mode)
  const toggleBlock = useAudioEditStore((state) => state.toggleBlock)
  const selected = useAudioEditStore((state) => state.selectedBlockIds)
  const setSelected = useAudioEditStore((state) => state.setSelectedBlockIds)
  const listRef = useRef<VirtuosoHandle | null>(null)
  const followPausedUntilRef = useRef(0)
  const transcript = project.transcript
  const rows = useMemo(() => {
    const next: typeof transcript[] = []
    for (let index = 0; index < transcript.length; index += 64) {
      next.push(transcript.slice(index, index + 64))
    }
    return next
  }, [transcript])
  const activeRow = useMemo(() => {
    if (!activeBlockId) return -1
    const index = project.transcript.findIndex((block) => block.id === activeBlockId)
    return index < 0 ? -1 : Math.floor(index / 64)
  }, [activeBlockId, project.transcript])

  useEffect(() => {
    if (activeRow < 0 || Date.now() < followPausedUntilRef.current) return
    listRef.current?.scrollIntoView({ index: activeRow, behavior: 'smooth', done: () => undefined })
  }, [activeRow, activeBlockId])

  return (
    <div
      className="h-full px-8 py-7"
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
            <div className="mx-auto max-w-4xl pb-3 text-lg leading-[2.15]">
              {row.map((block) => {
                const isActive = activeBlockId === block.id && (mode === 'source' || block.included)
                const isSelected = selected.includes(block.id)
                return (
                  <UiButton
                    key={block.id}
                    data-audio-word={block.id}
                    aria-current={isActive ? 'true' : undefined}
                    variant="ghost"
                    size="sm"
                    className={`mx-0.5 inline min-h-8 h-auto rounded-md px-1.5 py-1 text-lg font-normal leading-relaxed ${
                      isActive
                        ? `!bg-accent text-white ${block.included ? '' : 'line-through'}`
                        : !block.included
                          ? '!border-transparent !bg-transparent text-text-muted line-through opacity-55'
                          : isSelected
                            ? '!bg-layer text-text-dark ring-1 ring-accent'
                            : '!border-transparent !bg-transparent text-text-dark hover:!bg-layer'
                    }`}
                    disabled={useAudioEditStore.getState().busy}
                    onDoubleClick={() => toggleBlock(block.id)}
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
                    title="单击定位，双击删除或恢复"
                  >
                    {block.locked ? '🔒 ' : ''}{block.text}
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
  const [projects, setProjects] = useState<AudioEditProjectSummary[]>([])
  const [asrModels, setAsrModels] = useState<AudioEditAsrModel[]>([])
  const [processors, setProcessors] = useState<AudioEditProcessorDescriptor[]>([])
  const [busy, setBusy] = useState(false)
  const [homeLoading, setHomeLoading] = useState(true)
  const [homeLoadFailed, setHomeLoadFailed] = useState(false)
  const [search, setSearch] = useState('')
  const [tasks, setTasks] = useState<AudioEditTask[]>([])
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([])
  const [format, setFormat] = useState<'xml' | 'wav'>('xml')
  const [withSrt, setWithSrt] = useState(false)
  const [withRx, setWithRx] = useState(false)
  const [cutStart, setCutStart] = useState('0')
  const [cutEnd, setCutEnd] = useState('1')
  const [selectionOnly, setSelectionOnly] = useState(false)
  const [sourceError, setSourceError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const disabled = busy || state.busy
  const normalizationGain = useMemo(() => calculatePreviewGain(waveformPeaks), [waveformPeaks])
  const { togglePlayback, seekSourceFrame } = useAudioEditPreview(project, normalizationGain)
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
    const context = createHostContextSnapshot()
    openAssistant(`请处理当前口播工程的重复口播。工程引用：${JSON.stringify({ kind: 'audio_edit.project', id: project.id })}。读取真实转写和参考稿进行内容对齐，明确重复重录只保留最佳版本，通过词块保留属性提交实际剪辑；锁定内容不能修改，不确定的内容保留并说明。参考稿不能替代识别文本，不要重新转写或导出。最后回读实际结果。`, { autoSend: true, context: JSON.stringify({ workspace: context.workspace, project: context.project, surface: context.surface }) })
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
  const selectedBlocks = project.transcript.filter((block) => selectedBlockIds.includes(block.id))
  const range = selectionOnly && selectedBlocks.length ? { startFrame: Math.min(...selectedBlocks.map((block) => block.startFrame)), endFrame: Math.max(...selectedBlocks.map((block) => block.endFrame)) } : undefined
  const configuredAsr = asrModels.some((model) => model.configured && model.timestamps)
  const plugins = processors.filter((item) => item.available && item.semanticRole)
  const selectedBlock = selectedBlocks.length === 1 ? selectedBlocks[0] : null
  return <div className="flex h-full min-h-0 flex-col bg-app">
    <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border-dark px-3 py-2">
      <UiIconButton className="h-8 w-8" onClick={() => void leave()} title="返回工程列表"><ArrowLeft size={16} /></UiIconButton>
      <UiInput aria-label="工程名" className="min-w-0 flex-1" value={project.name} disabled={disabled} onChange={(event) => update({ name: event.target.value })} />
      <UiIconButton disabled={disabled || !state.past.length} onClick={state.undo} title="撤销"><Undo2 size={16} /></UiIconButton>
      <UiIconButton disabled={disabled || !state.future.length} onClick={state.redo} title="重做"><Redo2 size={16} /></UiIconButton>
      <UiButton variant="ghost" size="sm" disabled={disabled || !project.transcript.length} onClick={assistant}><Sparkles size={15} className="mr-1" />处理重复口播</UiButton>
      <UiButton variant="primary" size="sm" disabled={disabled || Boolean(sourceError)} onClick={() => void exportProject()}><Download size={15} className="mr-1" />导出</UiButton>
    </div>
    {(state.saveError || sourceError) && <div role="alert" className="flex items-center gap-3 border-b border-border-dark px-4 py-2 text-sm text-text-dark"><span>{state.saveError ? `保存失败，修改仍保留：${state.saveError}` : sourceError}</span>{state.saveError && <UiButton size="sm" variant="ghost" onClick={() => void run(() => flushAudioEditProject(project.id))}>重试保存</UiButton>}</div>}
    {tasks.filter((task) => task.state === 'running').map((task) => <div key={task.requestId} role="status" className="flex items-center gap-3 px-4 py-2 text-sm text-text-muted"><span>正在处理{task.progress === undefined ? '…' : ` ${Math.round(task.progress * 100)}%`}</span><UiButton size="sm" variant="ghost" onClick={() => void run(() => getPlatform().audioEdit.cancelTask(task.requestId))}>取消</UiButton></div>)}
    {tasks.some((task) => task.kind === 'transcription' && ['failed', 'cancelled'].includes(task.state)) && !project.transcript.length && <div className="flex items-center gap-3 px-4 py-2 text-sm text-text-muted"><span>上次转写未完成，优先查询原任务。</span><UiButton size="sm" variant="ghost" disabled={disabled} onClick={() => void run(() => transcribeAudioEdit({ projectId: project.id }))}>恢复转写</UiButton></div>}
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_20rem]">
      <main className="flex min-h-0 flex-col border-r border-border-dark">
        <div className="flex gap-2 px-6 pt-3"><UiInput aria-label="搜索转写" placeholder="查找转写内容" value={search} onChange={(event) => setSearch(event.target.value)} /><UiButton className="shrink-0 whitespace-nowrap" variant="ghost" size="sm" onClick={() => { const matches = project.transcript.filter((block) => search && block.text.includes(search)); state.setSelectedBlockIds(matches.map((block) => block.id)); if (matches[0]) seekSourceFrame(matches[0].startFrame) }}>查找</UiButton></div>
        <div className="min-h-0 flex-1"><Transcript project={project} onSeek={seekSourceFrame} /></div>
      </main>
      <aside className="min-h-0 overflow-y-auto p-4">
        <fieldset disabled={disabled} className="min-w-0 space-y-6">
          {!project.transcript.length && <section><div className={`mb-2 ${UI_TEXT_LABEL_CLASS}`}>语音识别</div><UiButton variant="primary" size="sm" disabled={!configuredAsr || Boolean(sourceError)} onClick={() => void run(async () => { await transcribeAudioEdit({ projectId: project.id }); showNotification('转写完成，剪辑粒度以实际时间戳为准') })}>开始转写</UiButton><div className={`mt-2 ${UI_TEXT_META_CLASS}`}>无须转写也可压缩停顿。识别按配置的模型计费。</div></section>}
          <section className="space-y-2"><div className={UI_TEXT_LABEL_CLASS}>快速剪辑</div>
            <label className="flex items-center justify-between gap-2 text-sm text-text-muted">仅处理选区<UiSwitch checked={selectionOnly} disabled={!selectedBlocks.length} onCheckedChange={setSelectionOnly} /></label>
            <label className="block text-sm text-text-muted">最短停顿（毫秒）<UiInput type="number" min={100} max={10000} value={settings.silenceThresholdMs} onChange={(event) => update({ batchSettings: { ...settings, silenceThresholdMs: Number(event.target.value) } })} /></label>
            <label className="block text-sm text-text-muted">保留时长（毫秒）<UiInput type="number" min={0} max={5000} value={settings.retainedSilenceMs} onChange={(event) => update({ batchSettings: { ...settings, retainedSilenceMs: Number(event.target.value) } })} /></label>
            <label className="block text-sm text-text-muted">静音阈值（dB）<UiInput type="number" min={-80} max={-10} value={settings.noiseDb} onChange={(event) => update({ batchSettings: { ...settings, noiseDb: Number(event.target.value) } })} /></label>
            <label className="flex items-center justify-between gap-2 text-sm text-text-muted">包括片头片尾<UiSwitch checked={settings.trimEdges} onCheckedChange={(value) => update({ batchSettings: { ...settings, trimEdges: value } })} /></label>
            <UiButton variant="muted" size="sm" className="w-full" disabled={Boolean(sourceError)} onClick={() => void run(async () => { const result = await compressAudioEditSilence(project.id, range); showNotification(`处理 ${result.count} 处停顿，缩短 ${(result.shortenedMs / 1000).toFixed(2)} 秒`) })}>压缩停顿</UiButton>
            <div className={UI_TEXT_META_CLASS}>选择需要清理的词类；可能有语义的词默认保留。</div>
            <div className="flex flex-wrap gap-1">{['嗯', '呃', '额', '那个', '就是', '啊'].map((word) => <UiButton key={word} variant={settings.fillers.includes(word) ? 'muted' : 'ghost'} size="sm" onClick={() => update({ batchSettings: { ...settings, fillers: settings.fillers.includes(word) ? settings.fillers.filter((value) => value !== word) : [...settings.fillers, word] } })}>{word}</UiButton>)}</div>
            <UiButton variant="muted" size="sm" className="w-full" onClick={() => void run(async () => showNotification(`清理 ${await cleanProjectAudioEditFillers(project.id, range)} 处语气词，可撤销或逐处恢复`))}>清理语气词</UiButton>
          </section>
          {selectedBlocks.length > 0 && <section className="space-y-2"><div className={UI_TEXT_LABEL_CLASS}>已选 {selectedBlocks.length} 个词块</div><div className="flex flex-wrap gap-1">
            <UiButton size="sm" variant="ghost" onClick={() => state.setBlocksIncluded(selectedBlockIds, false)}>删除声音</UiButton><UiButton size="sm" variant="ghost" onClick={() => state.setBlocksIncluded(selectedBlockIds, true)}>恢复</UiButton>
            <UiButton size="sm" variant="ghost" onClick={() => update({ transcript: project.transcript.map((block) => selectedBlockIds.includes(block.id) ? { ...block, locked: !selectedBlocks.every((item) => item.locked) } : block) })}>{selectedBlocks.every((block) => block.locked) ? '解锁' : '锁定'}</UiButton>
          </div>{selectedBlock && <label className="block text-sm text-text-muted">校正字幕（不改变声音）<UiInput value={selectedBlock.text} disabled={selectedBlock.locked} onChange={(event) => update({ transcript: project.transcript.map((block) => block.id === selectedBlock.id ? { ...block, text: event.target.value } : block) })} /></label>}</section>}
          <section className="space-y-2"><div className={UI_TEXT_LABEL_CLASS}>手工裁切声音</div><div className="flex gap-2"><label className="min-w-0 text-sm text-text-muted">开始（秒）<UiInput type="number" min={0} step={0.01} value={cutStart} onChange={(event) => setCutStart(event.target.value)} /></label><label className="min-w-0 text-sm text-text-muted">结束（秒）<UiInput type="number" min={0} step={0.01} value={cutEnd} onChange={(event) => setCutEnd(event.target.value)} /></label></div><UiButton size="sm" variant="muted" onClick={() => update({ cuts: [...(project.cuts ?? []), { id: crypto.randomUUID(), startFrame: Math.round(Number(cutStart) * project.source.sampleRate), endFrame: Math.round(Number(cutEnd) * project.source.sampleRate), enabled: true, reason: 'manual' }] })}>删除此段声音</UiButton><div className={UI_TEXT_META_CLASS}>可裁切没有文字的区间；锁定内容受保护。</div></section>
          {(project.cuts ?? []).filter((cut) => cut.enabled).length > 0 && <section><div className={UI_TEXT_LABEL_CLASS}>已裁切区间</div>{(project.cuts ?? []).filter((cut) => cut.enabled).map((cut) => <div key={cut.id} className="flex items-center justify-between gap-2 text-sm text-text-muted"><UiButton size="sm" variant="ghost" onClick={() => seekSourceFrame(Math.max(0, cut.startFrame - project.source.sampleRate))}>{formatTime(cut.startFrame, project.source.sampleRate)} · 试听切点</UiButton><UiButton size="sm" variant="ghost" onClick={() => update({ cuts: project.cuts?.map((item) => item.id === cut.id ? { ...item, enabled: false } : item) })}>恢复</UiButton></div>)}</section>}
          <section><div className={`mb-2 ${UI_TEXT_LABEL_CLASS}`}>待审建议</div>{project.suggestions.filter((item) => item.status === 'pending').map((item) => <div key={item.id} className="mb-2 rounded-lg border border-border-dark p-3"><div className="text-sm text-text-dark">{item.title}</div><div className={UI_TEXT_META_CLASS}>{item.detail}</div><div className="mt-2 flex gap-2"><UiButton size="sm" variant="ghost" onClick={() => state.applySuggestion(item.id)}><Check size={13} />应用</UiButton><UiButton size="sm" variant="ghost" onClick={() => state.dismissSuggestion(item.id)}><X size={13} />忽略</UiButton></div></div>)}</section>
          <section><div className={`mb-2 ${UI_TEXT_LABEL_CLASS}`}>参考逐字稿</div><UiTextArea rows={4} placeholder="用于对齐内容，不替代真实识别文本" value={project.referenceScript} onChange={(event) => state.setReferenceScript(event.target.value)} /><UiButton size="sm" variant="ghost" onClick={() => void run(async () => { const value = await openDialog({ multiple: false, filters: [{ name: '文本', extensions: ['txt', 'md'] }] }); const path = Array.isArray(value) ? value[0] : value; if (path) state.setReferenceScript(await readTextFile(path)) })}>导入参考稿</UiButton></section>
          <section className="space-y-2"><div className={UI_TEXT_LABEL_CLASS}>RX 声音处理</div><label className="flex items-center justify-between text-sm text-text-muted">剪后试听启用<UiSwitch checked={project.vstEnabled} disabled={!plugins.length} onCheckedChange={(value) => void run(async () => { if (value) await prepareAudioEditProcessing(project.id, crypto.randomUUID()); state.setVstEnabled(value) })} /></label>{!plugins.length && <div className={UI_TEXT_META_CLASS}>未发现兼容插件，可继续基础剪辑。</div>}
            {plugins.map((plugin) => { const entry = project.processorChain?.find((item) => item.id === plugin.id); return <div key={plugin.id} className="space-y-2"><label className="flex items-center justify-between gap-2 text-sm text-text-dark">{plugin.name}<UiSwitch checked={Boolean(entry?.enabled)} onCheckedChange={(enabled) => update({ vstEnabled: false, processorChain: [...(project.processorChain ?? []).filter((item) => item.id !== plugin.id).map((item) => processors.find((p) => p.id === item.id)?.semanticRole === plugin.semanticRole ? { ...item, enabled: false } : item), { id: plugin.id, enabled, parameters: entry?.parameters ?? {} }] })} /></label>{entry?.enabled && plugin.parameters?.map((parameter) => <label key={parameter.id} className="block text-xs text-text-muted">{parameter.name}<UiInput type="number" min={0} max={1} step={0.01} value={entry.parameters[parameter.name] ?? parameter.normalizedValue} onChange={(event) => update({ vstEnabled: false, processorChain: project.processorChain?.map((item) => item.id === plugin.id ? { ...item, parameters: { ...item.parameters, [parameter.name]: Number(event.target.value) } } : item) })} /></label>)}</div> })}<div className={UI_TEXT_META_CLASS}>配方随工程保存。更改后重新启用试听；切换到原始试听可旁路对比。</div>
          </section>
          <section className="space-y-2"><div className={UI_TEXT_LABEL_CLASS}>交付设置</div><UiSelect aria-label="导出格式" value={format} onChange={(event) => setFormat(event.target.value as 'xml' | 'wav')}><option value="xml">XML · 继续剪辑</option><option value="wav">WAV · 剪后音频</option></UiSelect>
            {project.source.mediaType === 'audio' && format === 'xml' && <label className="block text-sm text-text-muted">XML 帧率<UiSelect value={project.xmlFrameRate?.numerator ?? 25} onChange={(event) => update({ xmlFrameRate: { numerator: Number(event.target.value), denominator: 1 } })}>{[24, 25, 30, 50, 60].map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}</UiSelect></label>}
            <label className="flex items-center justify-between text-sm text-text-muted">附带 SRT 字幕<UiSwitch checked={withSrt} onCheckedChange={setWithSrt} /></label><label className="flex items-center justify-between text-sm text-text-muted">包含声音处理<UiSwitch checked={withRx} disabled={!plugins.length} onCheckedChange={setWithRx} /></label><div className={UI_TEXT_META_CLASS}>{withRx ? '同时保存全长处理音轨，XML 引用该音轨。' : 'XML 直接引用原文件；切点按视频帧向外对齐。XML 交付试听可核对差异。'}</div>
          </section>
          <section className="space-y-2"><UiButton size="sm" variant="ghost" onClick={() => void run(async () => { const value = await openDialog({ multiple: false, filters: [{ name: '原始素材', extensions: MEDIA_EXTENSIONS }] }); const path = Array.isArray(value) ? value[0] : value; if (path) { await relinkAudioEdit(project.id, path); setSourceError(''); showNotification('原素材已重新定位') } })}>重新定位原素材</UiButton><UiButton size="sm" variant="ghost" onClick={() => setConfirmDelete(!confirmDelete)}>删除工程</UiButton>{confirmDelete && <div className={UI_TEXT_META_CLASS}>仅删除工程和缓存，原素材保持不变。<UiButton size="sm" variant="ghost" onClick={() => void run(async () => { await deleteAudioEdit(project.id); setProject(null); await refreshHome() })}>确认删除</UiButton></div>}</section>
        </fieldset>
      </aside>
    </div>
    <AudioEditTimeline project={project} peaks={waveformPeaks} onSeek={seekSourceFrame} onToggle={togglePlayback} />
  </div>
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import {
  ArrowLeft,
  Check,
  Download,
  FileAudio,
  FolderOpen,
  Pause,
  Play,
  Redo2,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react'

import {
  UI_TEXT_BODY_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiIconButton,
  UiLoading,
  UiOptionButton,
  UiPageHeader,
  UiRangeInput,
  UiRegion,
  UiSwitch,
  UiTextArea,
} from '@/components/ui'
import { buildAudioEditTimeline, editedDurationFrames } from '@/core/audioEdit/timeline'
import type { AudioEditAsrModel } from '@/platform/contracts/audioEdit'
import type { AudioEditProcessorDescriptor, AudioEditProjectDocument, AudioEditProjectSummary } from '@/core/audioEdit/types'
import { useNotification } from '@/contexts/NotificationContext'
import { openAssistant } from '@/features/assistant/store/assistantUiStore'
import { getPlatform } from '@/platform/runtime'
import { basename, openDialog, readTextFile, saveDialog } from '@/platform/desktopApi'
import { useAudioEditPreview } from './preview/useAudioEditPreview'
import { useAudioEditPlaybackStore } from './store/audioEditPlaybackStore'
import { useAudioEditStore } from './store/audioEditStore'

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
  const rows = useMemo(() => {
    const next: typeof project.transcript[] = []
    for (let index = 0; index < project.transcript.length; index += 64) {
      next.push(project.transcript.slice(index, index + 64))
    }
    return next
  }, [project])
  const activeRow = useMemo(() => {
    if (!activeBlockId) return -1
    const index = project.transcript.findIndex((block) => block.id === activeBlockId)
    return index < 0 ? -1 : Math.floor(index / 64)
  }, [activeBlockId, project.transcript])

  useEffect(() => {
    if (activeRow < 0 || Date.now() < followPausedUntilRef.current) return
    listRef.current?.scrollIntoView({ index: activeRow, behavior: 'smooth', done: () => undefined })
  }, [activeRow])

  return (
    <div
      className="h-full px-8 py-7"
      onPointerDown={() => { followPausedUntilRef.current = Date.now() + 2500 }}
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
          isScrolling={(scrolling) => {
            if (scrolling) followPausedUntilRef.current = Date.now() + 2500
          }}
          itemContent={(_, row) => (
            <div className="mx-auto max-w-4xl pb-3 text-lg leading-[2.15]">
              {row.map((block) => {
                const isActive = activeBlockId === block.id && (mode === 'source' || block.included)
                const isSelected = selected.includes(block.id)
                return (
                  <UiButton
                    key={block.id}
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
                    onDoubleClick={() => toggleBlock(block.id)}
                    onClick={(event) => {
                      if (event.shiftKey) {
                        setSelected(isSelected ? selected.filter((id) => id !== block.id) : [...selected, block.id])
                        return
                      }
                      setSelected([block.id])
                      if (block.included || mode === 'source') onSeek(block.startFrame)
                    }}
                    title="单击定位，双击删除或恢复"
                  >
                    {block.text}
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

function Timeline({ project, peaks }: { project: AudioEditProjectDocument; peaks: number[] }) {
  const sourceFrame = useAudioEditPlaybackStore((state) => state.sourceFrame)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const spans = useMemo(() => buildAudioEditTimeline(project.source.durationFrames, project.transcript), [project])
  const displayPeaks = useMemo(() => {
    if (peaks.length === 0) return []
    const target = Math.max(64, Math.min(800, Math.floor(width / 3) || 360))
    const sampled = Array.from({ length: Math.min(target, peaks.length) }, (_, index) => {
      const start = Math.floor(index * peaks.length / target)
      const end = Math.max(start + 1, Math.floor((index + 1) * peaks.length / target))
      return Math.max(...peaks.slice(start, end))
    })
    const sorted = [...sampled].sort((left, right) => left - right)
    const reference = sorted[Math.floor((sorted.length - 1) * 0.95)] || 1
    return sampled.map((peak) => Math.min(1, peak / reference))
  }, [peaks, width])
  const percent = project.source.durationFrames > 0 ? sourceFrame / project.source.durationFrames * 100 : 0
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={containerRef} className="relative h-[clamp(5rem,11vh,9rem)] overflow-hidden rounded-lg border border-border-dark bg-bg-dark">
      <div className="absolute inset-y-0 left-0 bg-layer" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      <div className="absolute inset-0 flex items-center gap-px px-1 py-2">
        {displayPeaks.map((peak, index) => {
          const frame = (index + 0.5) / displayPeaks.length * project.source.durationFrames
          const retained = spans.some((span) => frame >= span.sourceStartFrame && frame < span.sourceEndFrame)
          return <div key={index} className={`min-w-0 flex-1 rounded-sm ${retained ? 'bg-accent' : 'bg-text-muted opacity-35'}`} style={{ height: `${Math.max(4, peak * 100)}%` }} />
        })}
      </div>
      <div className="absolute inset-y-0 w-px bg-white" style={{ left: `${percent}%` }} />
    </div>
  )
}

export interface AudioEditAppProps { onBack?: () => void }

export default function AudioEditApp({ onBack }: AudioEditAppProps): JSX.Element {
  const { showNotification } = useNotification()
  const project = useAudioEditStore((state) => state.project)
  const setProject = useAudioEditStore((state) => state.setProject)
  const acceptSavedRevision = useAudioEditStore((state) => state.acceptSavedRevision)
  const past = useAudioEditStore((state) => state.past)
  const future = useAudioEditStore((state) => state.future)
  const undo = useAudioEditStore((state) => state.undo)
  const redo = useAudioEditStore((state) => state.redo)
  const setBlocksIncluded = useAudioEditStore((state) => state.setBlocksIncluded)
  const selectedBlockIds = useAudioEditStore((state) => state.selectedBlockIds)
  const setReferenceScript = useAudioEditStore((state) => state.setReferenceScript)
  const setVstEnabled = useAudioEditStore((state) => state.setVstEnabled)
  const applySuggestion = useAudioEditStore((state) => state.applySuggestion)
  const dismissSuggestion = useAudioEditStore((state) => state.dismissSuggestion)
  const mode = useAudioEditPlaybackStore((state) => state.mode)
  const playing = useAudioEditPlaybackStore((state) => state.playing)
  const preparing = useAudioEditPlaybackStore((state) => state.preparing)
  const previewReady = useAudioEditPlaybackStore((state) => state.ready)
  const previewError = useAudioEditPlaybackStore((state) => state.error)
  const outputFrame = useAudioEditPlaybackStore((state) => state.outputFrame)
  const setMode = useAudioEditPlaybackStore((state) => state.setMode)
  const [projects, setProjects] = useState<AudioEditProjectSummary[]>([])
  const [asrModels, setAsrModels] = useState<AudioEditAsrModel[]>([])
  const [processors, setProcessors] = useState<AudioEditProcessorDescriptor[]>([])
  const [busy, setBusy] = useState<'import' | 'transcribe' | 'export' | null>(null)
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([])
  const waveformProjectId = project?.id
  const waveformAudioPath = project?.source.audioPath
  const saveSequenceRef = useRef(0)
  const savedContentRef = useRef('')
  const saveInFlightRef = useRef(false)
  const { timeline, togglePlayback, seekSourceFrame } = useAudioEditPreview(project)

  const refreshHome = useCallback(async () => {
    const platform = getPlatform().audioEdit
    const [nextProjects, nextModels, nextProcessors] = await Promise.all([
      platform.listProjects(), platform.listAsrModels(), platform.listProcessors(),
    ])
    setProjects(nextProjects)
    setAsrModels(nextModels)
    setProcessors(nextProcessors)
  }, [])

  useEffect(() => { void refreshHome() }, [refreshHome])

  useEffect(() => {
    if (!waveformProjectId || !waveformAudioPath) {
      setWaveformPeaks([])
      return
    }
    let cancelled = false
    void getPlatform().audioEdit.extractWaveform(waveformAudioPath, 1600).then((waveform) => {
      if (!cancelled) setWaveformPeaks(waveform.peak)
    }).catch(() => {
      if (!cancelled) setWaveformPeaks([])
    })
    return () => { cancelled = true }
  }, [waveformAudioPath, waveformProjectId])

  useEffect(() => {
    if (!project) return
    const content = JSON.stringify({
      transcript: project.transcript,
      suggestions: project.suggestions,
      referenceScript: project.referenceScript,
      vstEnabled: project.vstEnabled,
    })
    if (content === savedContentRef.current) return
    if (saveInFlightRef.current) return
    const sequence = ++saveSequenceRef.current
    const timer = window.setTimeout(() => {
      saveInFlightRef.current = true
      void getPlatform().audioEdit.saveProject(project).then((saved) => {
        if (sequence === saveSequenceRef.current) {
          savedContentRef.current = content
          acceptSavedRevision(saved.id, saved.revision)
        }
      }).catch(() => showNotification('工程保存失败，请重试', 'error')).finally(() => {
        saveInFlightRef.current = false
        const latest = useAudioEditStore.getState().project
        if (latest && latest.id === project.id) acceptSavedRevision(latest.id, latest.revision)
      })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [acceptSavedRevision, project, showNotification])

  const importMedia = useCallback(async () => {
    const selected = await openDialog({ multiple: false, filters: [{ name: '音频或视频', extensions: MEDIA_EXTENSIONS }] })
    const sourcePath = Array.isArray(selected) ? selected[0] : selected
    if (!sourcePath) return
    setBusy('import')
    try {
      setProject(await getPlatform().audioEdit.createProject({ sourcePath, name: basename(sourcePath) }))
    } catch (error) {
      showNotification(error instanceof Error ? error.message : '导入失败', 'error')
    } finally {
      setBusy(null)
    }
  }, [setProject, showNotification])

  const transcribe = useCallback(async () => {
    if (!project) return
    setBusy('transcribe')
    try {
      const result = await getPlatform().audioEdit.transcribe({ projectId: project.id })
      setProject(result.project)
      showNotification(result.granularity === 'word' ? '转写完成，可逐词剪辑' : '转写完成，当前模型提供句段时间戳')
    } catch (error) {
      showNotification(error instanceof Error ? error.message : '转写失败', 'error')
    } finally {
      setBusy(null)
    }
  }, [project, setProject, showNotification])

  const exportProject = useCallback(async () => {
    if (!project) return
    const audioTargetPath = await saveDialog({
      defaultPath: `${project.name.replace(/\.[^.]+$/, '')}-成片.wav`,
      filters: [{ name: 'WAV 音频', extensions: ['wav'] }],
    })
    if (!audioTargetPath) return
    setBusy('export')
    try {
      const subtitleTargetPath = audioTargetPath.replace(/\.wav$/i, '.srt')
      await getPlatform().audioEdit.exportProject({ projectId: project.id, audioTargetPath, subtitleTargetPath })
      showNotification('音频与字幕已导出')
    } catch (error) {
      showNotification(error instanceof Error ? error.message : '导出失败', 'error')
    } finally {
      setBusy(null)
    }
  }, [project, showNotification])

  if (!project) {
    return (
      <div className="flex h-full flex-col overflow-y-auto bg-app p-6">
        <UiRegion maxWidthClassName="max-w-6xl" className="mx-auto w-full">
          <UiPageHeader title="口播剪辑" description="导入一段口播，用文字完成非破坏性剪辑" onBack={onBack} backLabel="返回工具箱" />
          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
            <UiOptionButton variant="card" className="h-40 flex-col items-start justify-center gap-3 p-6" onClick={() => void importMedia()} disabled={busy !== null}>
              <FolderOpen className="h-7 w-7 text-text-muted" />
              <span className={UI_TEXT_LABEL_CLASS}>{busy === 'import' ? '正在导入…' : '导入音频或视频'}</span>
              <span className={UI_TEXT_META_CLASS}>原文件不会被修改；视频首版仅处理音轨。</span>
            </UiOptionButton>
            {projects.slice(0, 5).map((item) => (
              <UiOptionButton key={item.id} variant="card" className="h-40 flex-col items-start justify-center gap-2 p-6" onClick={() => void getPlatform().audioEdit.getProject(item.id).then(setProject)}>
                <FileAudio className="h-6 w-6 text-text-muted" />
                <span className={UI_TEXT_LABEL_CLASS}>{item.name}</span>
                <span className={UI_TEXT_META_CLASS}>{formatTime(item.durationFrames, item.sampleRate)} · 继续编辑</span>
              </UiOptionButton>
            ))}
          </div>
        </UiRegion>
      </div>
    )
  }

  const duration = mode === 'edited' ? editedDurationFrames(timeline) : project.source.durationFrames
  const configuredAsr = asrModels.some((model) => model.configured && model.timestamps)
  const compatibleProcessors = processors.filter((processor) => processor.available && processor.semanticRole)
  const pendingSuggestions = project.suggestions.filter((suggestion) => suggestion.status === 'pending')

  return (
    <div className="flex h-full min-h-0 flex-col bg-app">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border-dark px-3">
        <UiIconButton showBorder={false} appearance="hover-only" className="h-8 w-8" onClick={() => { setProject(null); void refreshHome() }} title="返回工程列表"><ArrowLeft size={16} /></UiIconButton>
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-text-dark">{project.name}</div>
        <UiIconButton showBorder={false} appearance="hover-only" className="h-8 w-8" disabled={past.length === 0} onClick={undo} title="撤销"><Undo2 size={16} /></UiIconButton>
        <UiIconButton showBorder={false} appearance="hover-only" className="h-8 w-8" disabled={future.length === 0} onClick={redo} title="重做"><Redo2 size={16} /></UiIconButton>
        <UiButton variant="ghost" size="sm" onClick={() => openAssistant(`请优化口播剪辑工程 ${project.id}。先读取转写和建议，再说明理由并通过 audio_edit 领域修改。`)}><Sparkles size={15} className="mr-1.5" />智能优化</UiButton>
        <UiButton variant="primary" size="sm" disabled={busy !== null || project.transcript.length === 0} onClick={() => void exportProject()}><Download size={15} className="mr-1.5" />{busy === 'export' ? '导出中…' : '导出'}</UiButton>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_19rem]">
        <main className="min-h-0 border-r border-border-dark">
          {busy === 'transcribe' ? <UiLoading message="正在识别口播并生成时间戳…" className="h-full" /> : <Transcript project={project} onSeek={seekSourceFrame} />}
        </main>
        <aside className="min-h-0 overflow-y-auto p-4">
          {project.transcript.length === 0 && (
            <section className="mb-6">
              <div className={`mb-2 ${UI_TEXT_LABEL_CLASS}`}>语音识别</div>
              <div className={`mb-3 leading-relaxed ${UI_TEXT_META_CLASS}`}>{configuredAsr ? '将自动选择支持时间戳的已配置模型。' : '没有找到已配置且支持时间戳的模型。'}</div>
              <UiButton variant="primary" size="sm" className="w-full" disabled={!configuredAsr || busy !== null} onClick={() => void transcribe()}>{busy === 'transcribe' ? '识别中…' : '开始转写'}</UiButton>
            </section>
          )}
          {selectedBlockIds.length > 0 && (
            <section className="mb-6">
              <div className={`mb-2 ${UI_TEXT_LABEL_CLASS}`}>已选 {selectedBlockIds.length} 个词块</div>
              <div className="flex gap-2">
                <UiButton variant="ghost" size="sm" className="flex-1" onClick={() => setBlocksIncluded(selectedBlockIds, false)}>删除</UiButton>
                <UiButton variant="ghost" size="sm" className="flex-1" onClick={() => setBlocksIncluded(selectedBlockIds, true)}>恢复</UiButton>
              </div>
            </section>
          )}
          <section className="mb-6">
            <div className={`mb-2 ${UI_TEXT_LABEL_CLASS}`}>剪辑建议</div>
            {pendingSuggestions.length === 0 ? <div className={UI_TEXT_META_CLASS}>暂无待审建议</div> : pendingSuggestions.map((suggestion) => (
              <div key={suggestion.id} className="mb-2 rounded-lg border border-border-dark p-3">
                <div className="text-sm font-medium text-text-dark">{suggestion.title}</div>
                <div className={`mt-1 leading-relaxed ${UI_TEXT_META_CLASS}`}>{suggestion.detail}</div>
                <div className="mt-2 flex gap-1">
                  <UiButton variant="ghost" size="sm" onClick={() => applySuggestion(suggestion.id)}><Check size={13} className="mr-1" />应用</UiButton>
                  <UiButton variant="ghost" size="sm" onClick={() => dismissSuggestion(suggestion.id)}><X size={13} className="mr-1" />忽略</UiButton>
                </div>
              </div>
            ))}
          </section>
          <section className="mb-6">
            <div className={`mb-2 ${UI_TEXT_LABEL_CLASS}`}>参考逐字稿</div>
            <UiTextArea value={project.referenceScript} rows={6} placeholder="粘贴逐字稿，仅用于识别和内容判断参考" onChange={(event) => setReferenceScript(event.target.value)} />
            <UiButton variant="ghost" size="sm" className="mt-2" onClick={() => void openDialog({ multiple: false, filters: [{ name: '文本', extensions: ['txt', 'md'] }] }).then(async (value) => {
              const path = Array.isArray(value) ? value[0] : value
              if (path) setReferenceScript(await readTextFile(path))
            })}>导入 TXT / Markdown</UiButton>
          </section>
          <section>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className={UI_TEXT_LABEL_CLASS}>VST3 声音处理</div>
                <div className={`mt-1 ${UI_TEXT_META_CLASS}`}>{compatibleProcessors.length > 0 ? `发现 ${compatibleProcessors.length} 个兼容处理器` : '未发现兼容插件，基础剪辑不受影响'}</div>
              </div>
              <UiSwitch checked={project.vstEnabled} disabled={compatibleProcessors.length === 0} onCheckedChange={setVstEnabled} />
            </div>
          </section>
        </aside>
      </div>

      <div className="shrink-0 border-t border-border-dark p-3">
        <div className="mb-2 flex items-center gap-3">
          <UiIconButton className="h-9 w-9" disabled={!previewReady || preparing} onClick={() => void togglePlayback()} title={playing ? '暂停' : '播放'}>{playing ? <Pause size={16} /> : <Play size={16} />}</UiIconButton>
          <UiSwitch appearance="segmented" size="compact" checked={mode === 'source'} offLabel="成片" onLabel="原始" onCheckedChange={(checked) => setMode(checked ? 'source' : 'edited')} />
          <span className={UI_TEXT_BODY_CLASS}>{formatTime(outputFrame, project.source.sampleRate)} / {formatTime(duration, project.source.sampleRate)}</span>
          {preparing && <span className={UI_TEXT_META_CLASS}>正在准备预览…</span>}
          {previewError && <span className="text-sm text-red-400">{previewError}</span>}
          <UiRangeInput className="ml-auto max-w-sm" min={0} max={Math.max(1, duration)} value={Math.min(duration, outputFrame)} onChange={(event) => {
            const frame = Number(event.target.value)
            if (mode === 'source') seekSourceFrame(frame)
            else {
              const span = timeline.find((item) => frame >= item.outputStartFrame && frame <= item.outputEndFrame)
              if (span) seekSourceFrame(span.sourceStartFrame + frame - span.outputStartFrame)
            }
          }} />
        </div>
        <Timeline project={project} peaks={waveformPeaks} />
      </div>
    </div>
  )
}

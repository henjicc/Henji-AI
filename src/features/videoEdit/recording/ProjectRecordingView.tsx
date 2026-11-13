import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Monitor, Pause, Play, Settings2, Square } from 'lucide-react'
import { PanelTrigger, UiButton, UiError, UiFormRow, UiGroup, UiIconButton, UiInput, UiToolbar } from '@/components/ui'
import { UI_PANEL_BODY_HEIGHT_CLASS, UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import { ICON_TOOL_SCREEN_RECORDING } from '@/core/theme/icons'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { contributeAppMenus } from '@/core/appMenu/appMenu'
import type { CaptureSource } from '@/core/screenRecording/contracts'
import { videoEditRecordingLane } from '@/core/videoEdit/recordingLane'
import { createLogger } from '@/core/logging'
import { useSettingsStore } from '@/stores/settingsStore'
import { VideoEditPreview } from '../VideoEditPreview'
import { useVideoEditViewSelector, sameVideoEditViewFields } from '../application/useVideoEditViewSelector'
import { getActiveVideoEditSequence, setVideoEditLayout, setVideoEditView, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { renameVideoEditRecordingBlock, videoEditRecordingTargetAt } from '../application/videoEditRecordingLane'
import { RecordingPictureRows, RecordingSoundRows, RecordingSourcePicker, controlRecording, recordingStopOutcome, orderedScreens, recordingTimeLabel, recordingTracksFromSetup, recordingView, startRecording, subscribeRecording, useRecordingSetupState, type RecordingSetupState } from '@/features/screenRecording'
import { ProjectRecordingLane, type ProjectRecordingTake } from './ProjectRecordingLane'
import { RECORDING_SETTINGS_INLINE_MIN_WIDTH } from './projectRecordingGeometry'

const logger = createLogger('features.videoEdit.recordLayout')
/** 将要录的来源每隔这么久取一张新图当画面预览。 */
const LIVE_PREVIEW_INTERVAL_MS = 2000
const COVER_TOOLTIP = '从指针处开始，盖住后面的内容'
const subscribeWindowResize = (listener: () => void): (() => void) => { window.addEventListener('resize', listener); return () => window.removeEventListener('resize', listener) }
const settingsInline = (): boolean => window.innerWidth >= RECORDING_SETTINGS_INLINE_MIN_WIDTH
/** 菜单里显示全局录制快捷键（CommandOrControl+Shift+F9 → Ctrl+Shift+F9），按键本身由主进程处理。 */
const shortcutLabel = (accelerator: string | null): string | undefined => accelerator?.replace('CommandOrControl', 'Ctrl')

function sourceLabel(source: CaptureSource | undefined, sources: readonly CaptureSource[], screenName: (index: number) => string): string {
  if (!source) return ''
  return source.kind === 'screen' ? screenName(orderedScreens(sources).indexOf(source) + 1) : source.name
}

/**
 * 剪辑的录制样子（项目级录屏，边录边粗剪）：同一条序列只显示一条录屏轨。上半是画面与录制设置，下半是时间轴。
 * 指针在结尾时新的一段接在后面，在某段中间时从指针处覆盖；录制设置与工具里的屏幕录制共用同一套。
 * 命令带的左端与中间的“录制 / 剪辑”由剪辑工作区注入，这里只放录制控制。
 */
export function ProjectRecordingView({ instance, leading, layoutSwitch, onError }: { instance: VideoEditInstance; leading: React.ReactNode; layoutSwitch: React.ReactNode; onError: (error: unknown) => void }): React.ReactElement {
  const { t } = useTranslation('ui')
  // 只在指针跨过块边界、到达结尾或内容与选择变化时重绘（节目画面在里面，不能跟着播放每一帧重绘）；画面角上的时间由 StageLabel 自己订阅。
  useVideoEditViewSelector(() => {
    const current = videoEditRecordingLane(getActiveVideoEditSequence(instance))
    return [videoEditRevision(), instance.selection, current.blocks.find(({ clip }) => instance.frame >= clip.start && instance.frame < clip.start + clip.duration)?.clip.id ?? null, instance.frame >= current.end]
  }, sameVideoEditViewFields)
  const projectId = instance.document.id
  const sequence = getActiveVideoEditSequence(instance)
  const lane = videoEditRecordingLane(sequence)
  const state = useSyncExternalStore(subscribeRecording, recordingView)
  const setup = useRecordingSetupState(onError)
  const inline = useSyncExternalStore(subscribeWindowResize, settingsInline)
  const recordingShortcuts = useSettingsStore(value => value.recordingShortcuts)
  const snapshot = state.snapshot
  const mine = state.destination?.documentId === projectId
  const recordingHere = Boolean(snapshot) && mine
  const elsewhere = (Boolean(snapshot) || state.busy) && !mine
  // 这一次录制落在哪：开始时按指针定下，录制中不再变。
  const started = useRef<{ frame: number; mode: 'append' | 'overwrite'; sessionId?: string } | null>(null)
  const lastFrames = useRef(0)
  const [hoverStart, setHoverStart] = useState(false)
  const run = (work: () => unknown): void => { void Promise.resolve().then(work).catch(onError) }
  // 录制计时每次跳动都会重绘这一屏；节目画面元素保持同一个，不跟着重绘（它自己订阅需要的状态）。
  const preview = useMemo(() => <VideoEditPreview instance={instance} onError={onError} chrome="picture" />, [instance, onError])

  const take: ProjectRecordingTake | null = started.current && (recordingHere || (mine && state.busy)) ? {
    frame: started.current.frame,
    frames: snapshot ? (lastFrames.current = Math.round(snapshot.elapsedMs / 1000 * sequence.fps)) : lastFrames.current,
    saving: !snapshot && lastFrames.current > 0,
  } : null
  // 放进序列后指针停在新的一段的结尾，接着录就接在它后面。
  const wasSaving = useRef(false)
  useEffect(() => {
    const saving = Boolean(started.current) && mine && state.busy && !snapshot && lastFrames.current > 0
    if (wasSaving.current && !saving && !state.busy && started.current) {
      // 按导入回报的实际落点移指针；没放进序列、或改成接在末尾时如实告诉用户。
      const outcome = started.current.sessionId ? recordingStopOutcome(started.current.sessionId) : undefined
      started.current = null
      const placement = outcome?.kind === 'edit' ? outcome.placement : undefined
      if (placement && 'refused' in placement) onError(new Error(`这一段没有放进序列：${placement.refused}素材已进素材库。`))
      else if (placement) {
        if (placement.note) onError(new Error(`${placement.note}。`))
        try { setVideoEditView(projectId, { frame: placement.to, playing: false }) } catch (error) { onError(error) }
      }
    }
    wasSaving.current = saving
  }, [mine, state.busy, snapshot, projectId, onError])

  const atEnd = instance.frame >= lane.end
  const block = lane.blocks.find(({ clip }) => instance.frame >= clip.start && instance.frame < clip.start + clip.duration)
  const selected = lane.blocks.find(({ clip }) => clip.id === instance.selection)
  const source = setup.selected
  const name = sourceLabel(source, setup.sources, index => t('recording.screenNumber', { index }))
  const live = recordingHere || atEnd || !block

  // 指针在结尾时显示将要录的来源：定时取一张新图（不另开采集流），录制中保持最后一张。
  const { refresh } = setup
  useEffect(() => {
    if (!live || recordingHere) return
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(false).catch(() => undefined) }, LIVE_PREVIEW_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [live, recordingHere, refresh])

  const begin = async (): Promise<void> => {
    const target = videoEditRecordingTargetAt(projectId)
    const startedNow = { frame: target.frame, mode: target.mode } as { frame: number; mode: 'append' | 'overwrite'; sessionId?: string }
    started.current = startedNow
    lastFrames.current = 0
    logger.info(target.mode === 'overwrite' ? '从指针处开始录制，覆盖后面的内容' : '开始录制，接在录屏轨末尾', { event: 'recording.project.start', context: { projectId, sequenceId: target.sequenceId, frame: target.frame, mode: target.mode } })
    try {
      // 录制样子只有画面与声音：不录摄像头，也不走快速录制。
      startedNow.sessionId = await startRecording(setup.captureOptions(), { name: `${sequence.name} 第 ${lane.blocks.length + 1} 段`, tracks: recordingTracksFromSetup({ ...setup.setup, camera: false }) }, { documentId: projectId, sequenceId: target.sequenceId, frame: target.frame, placement: target.mode === 'overwrite' ? 'overwrite' : 'end', basis: target.basis })
    } catch (error) {
      started.current = null
      logger.error('录制样子没能开始录制', { event: 'recording.project.start_failed', error, context: { projectId } })
      throw error
    }
  }
  const pause = (): void => { if (snapshot) run(() => controlRecording(snapshot.sessionId, snapshot.phase === 'paused' ? 'resume' : 'pause')) }
  const stop = (): void => { if (snapshot) run(() => controlRecording(snapshot.sessionId, snapshot.phase === 'failed' ? 'cancel' : 'stop')) }
  const startBlocked = lane.problem ?? (elsewhere ? '另一处正在录制，先结束它' : !setup.sourceId ? t('recording.selectSource') : undefined)
  const overwrite = !atEnd

  // 菜单栏：录制相关命令执行与按钮同一份操作；暂停、继续、停止显示全局录制快捷键。
  useEffect(() => contributeAppMenus('videoEditRecording', [{ menu: 'record', label: '录制', order: 100, items: [
    { kind: 'action', id: 'videoEditRecording.start', label: overwrite ? '从指针处开始录制' : '开始录制', disabledReason: recordingHere ? '正在录制' : startBlocked ?? (state.busy ? t('recording.saving') : undefined), run: () => begin().catch(onError) },
    { kind: 'action', id: 'videoEditRecording.pause', label: snapshot?.phase === 'paused' ? t('recording.resume') : t('recording.pause'), shortcut: shortcutLabel(recordingShortcuts.toggle), disabledReason: recordingHere && (snapshot?.phase === 'recording' || snapshot?.phase === 'paused') ? undefined : '还没有开始录制', run: pause },
    { kind: 'action', id: 'videoEditRecording.stop', label: '停止录制', shortcut: shortcutLabel(recordingShortcuts.stop), disabledReason: recordingHere ? undefined : '还没有开始录制', run: stop },
  ] }]))

  const settings = <ProjectRecordingSettings setup={setup} sourceName={name} recording={recordingHere || state.busy} selected={selected ? { id: selected.clip.id, name: selected.clip.name, duration: recordingTimeLabel(selected.clip.duration / sequence.fps * 1000) } : null}
    onRename={(id, value) => run(() => renameVideoEditRecordingBlock(projectId, id, value))} onError={onError} />
  const trailing = recordingHere && snapshot ? <>
    <span className={`mr-3 flex items-center gap-2 text-15 text-text1 ${UI_TEXT_TIMECODE_CLASS}`} data-recording-elapsed><span className="h-2 w-2 rounded-full bg-danger-solid" aria-hidden="true" />{recordingTimeLabel(snapshot.elapsedMs)}</span>
    <UiButton variant="secondary" disabled={snapshot.busy || !(snapshot.phase === 'recording' || snapshot.phase === 'paused')} disabledReason={t('screenRecording.toggleUnavailable')} onClick={pause}>{snapshot.phase === 'paused' ? <Play /> : <Pause />}{snapshot.phase === 'paused' ? t('recording.resume') : t('recording.pause')}</UiButton>
    <UiButton variant="dangerSolid" className="ml-1.5" disabled={state.busy} disabledReason={t('recording.saving')} onClick={stop}><Square />停止</UiButton>
  </> : <>
    {!inline && <PanelTrigger panelSize="compact" panelPadding="content" alignment="bottomRight" zIndex={Z_LAYERS.dropdown} renderPanel={() => settings}>
      {({ open, togglePanel }) => <UiIconButton aria-label="录制设置" tooltip="录制设置" aria-expanded={open} data-panel-trigger-button onClick={togglePanel}><Settings2 /></UiIconButton>}
    </PanelTrigger>}
    <span onMouseEnter={() => setHoverStart(true)} onMouseLeave={() => setHoverStart(false)} className="flex">
      <UiButton variant="primary" loading={state.busy && mine} disabled={Boolean(startBlocked) || state.busy} disabledReason={startBlocked ?? t('recording.saving')} tooltip={overwrite ? COVER_TOOLTIP : undefined} onClick={() => run(begin)}><ICON_TOOL_SCREEN_RECORDING />{t('recording.start')}</UiButton>
    </span>
  </>

  const stageLabel = recordingHere ? <><span className="h-1.5 w-1.5 rounded-full bg-danger-solid" aria-hidden="true" />{name}<span className="text-on-media/70">录制中</span></>
    : live ? <><Monitor className="h-3 w-3" aria-hidden="true" />{name}<span className="text-on-media/70">实时画面</span></>
    : block ? <>{block.clip.name}<BlockTime instance={instance} start={block.clip.start} fps={sequence.fps} /></> : null

  return <div className="flex min-h-0 flex-1 flex-col" data-video-edit-layout="record">
    <UiToolbar variant="command" center={layoutSwitch} centerLayout="fit" trailing={trailing} barProps={{ 'data-recording-state': recordingHere ? snapshot?.phase : 'idle' }}>{leading}</UiToolbar>
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 bg-gap">
      <div className="flex min-h-0 flex-1 gap-0.5">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-media" data-recording-stage={live ? 'live' : 'program'}>
          {/* 节目画面一直挂着（不随指针来回重建渲染器）；指针在结尾或录制中时上面盖着将要录的来源 */}
          {preview}
          {live && <div className="absolute inset-0 flex items-center justify-center bg-media p-3">
            {source?.thumbnailUrl && <img src={source.thumbnailUrl} alt="" className="max-h-full max-w-full object-contain" data-recording-live-preview />}
          </div>}
          {stageLabel && <span className="pointer-events-none absolute bottom-3 left-3 z-raised flex h-6 max-w-sm items-center gap-1.5 truncate rounded-control bg-media-scrim px-2 text-xs text-on-media">{stageLabel}</span>}
        </div>
        {inline && <aside className="flex w-80 shrink-0 flex-col overflow-y-auto bg-panel px-4 pb-4" aria-label="录制设置">{settings}</aside>}
      </div>
      {lane.problem
        // 认不出唯一一条录屏轨时不猜：说明原因，给出回到剪辑去整理的入口。
        ? <div className="flex shrink-0 items-center justify-center bg-panel px-4 py-6" data-recording-lane-problem><UiError tone="warning" title="这条序列现在不能边录边剪" message={lane.problem} actions={<UiButton variant="secondary" onClick={() => run(() => setVideoEditLayout(projectId, 'edit'))}>切到剪辑</UiButton>} /></div>
        : <ProjectRecordingLane instance={instance} take={take} coverHint={hoverStart && overwrite && !take && !startBlocked} onError={onError} />}
    </div>
  </div>
}

/** 右侧设置：录制（来源、声音、清晰度、帧率，与屏幕录制页同一套）与选中一段时的“这一段”。录制中整组压暗。 */
function ProjectRecordingSettings({ setup, sourceName, recording, selected, onRename, onError }: { setup: RecordingSetupState; sourceName: string; recording: boolean; selected: { id: string; name: string; duration: string } | null; onRename: (id: string, name: string) => void; onError: (error: unknown) => void }): React.ReactElement {
  const { t } = useTranslation('ui')
  const change = (patch: Partial<RecordingSetupState['setup']>): void => setup.setSetup(value => ({ ...value, ...patch }))
  const resolution = setup.selected?.display ? ` · ${Math.round(setup.selected.display.width * setup.selected.display.scaleFactor)}×${Math.round(setup.selected.display.height * setup.selected.display.scaleFactor)}` : ''
  return <>
    <div className={recording ? 'pointer-events-none opacity-50' : undefined} aria-disabled={recording || undefined}>
      <UiGroup title={t('recording.recordGroup')} titleTone="compact" labelWidth={72}>
        <UiFormRow label="来源" density="compact">
          <PanelTrigger display={`${sourceName}${resolution}`} size="sm" disabled={recording} panelSize="workspace" panelPadding="none" renderPanel={() => <div className={`flex ${UI_PANEL_BODY_HEIGHT_CLASS.workspace} min-w-0 flex-col`}>
            <RecordingSourcePicker sources={setup.sources} loading={setup.loading} mode={setup.mode} sourceId={setup.sourceId} region={setup.region} onModeChange={setup.changeMode} onSourceChange={setup.setSourceId} onRegionChange={setup.setRegion} onRefresh={() => { void setup.refresh().catch(onError) }} />
          </div>} />
        </UiFormRow>
        <RecordingSoundRows value={setup.setup} disabled={recording} onChange={change} />
        <RecordingPictureRows value={setup.setup} disabled={recording} onChange={change} />
      </UiGroup>
    </div>
    {selected && <UiGroup title="这一段" titleTone="compact" labelWidth={72} divided>
      <UiFormRow label="名称" density="compact"><SegmentName key={selected.id} name={selected.name} disabled={recording} onCommit={value => onRename(selected.id, value)} /></UiFormRow>
      <UiFormRow label="时长" density="compact"><span className={`text-xs text-text2 ${UI_TEXT_TIMECODE_CLASS}`}>{selected.duration}</span></UiFormRow>
    </UiGroup>}
  </>
}
/** 名称输入：回车或离开时提交，Esc 放弃；块上双击改名走同一份操作。 */
function SegmentName({ name, disabled, onCommit }: { name: string; disabled: boolean; onCommit: (name: string) => void }): React.ReactElement {
  const [draft, setDraft] = useState(name)
  const cancelled = useRef(false)
  useEffect(() => setDraft(name), [name])
  const commit = (): void => {
    const next = draft.trim()
    if (!cancelled.current && next && next !== name) onCommit(next); else setDraft(name)
    cancelled.current = false
  }
  return <UiInput size="sm" aria-label="这一段的名称" disabled={disabled} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); else if (event.key === 'Escape') { cancelled.current = true; event.currentTarget.blur() } }} />
}

/** 指针在这一段里的位置：自己订阅帧，播放时只有它跟着变。 */
function BlockTime({ instance, start, fps }: { instance: VideoEditInstance; start: number; fps: number }): React.ReactElement {
  const frame = useVideoEditViewSelector(() => instance.frame)
  return <span className={`text-on-media/70 ${UI_TEXT_TIMECODE_CLASS}`}>{recordingTimeLabel(Math.max(0, frame - start) / fps * 1000)}</span>
}

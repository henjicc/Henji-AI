import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { Circle, Pause, Play, Settings2, Square } from 'lucide-react'
import { PanelTrigger, UiIconButton, UiInlineStatus } from '@/components/ui'
import { contributeAppMenus } from '@/core/appMenu/appMenu'
import { useAppMenuVisibility } from '@/components/appMenu/appMenuVisibility'
import { AudioCaptureSettingsForm, getAudioCaptureSession, AudioCaptureLive, isCaptureShortcut } from '@/features/audioCapture'
import { prepareAudioEditTake } from '../application/audioEditSpliceService'
import { useAudioEditPlaybackStore } from '../store/audioEditPlaybackStore'
import { useAudioEditWorkspace } from './audioEditWorkspaceContext'

export function AudioEditRecordingControls(): JSX.Element {
  const workspace = useAudioEditWorkspace()
  const visible = useAppMenuVisibility()
  const session = getAudioCaptureSession()
  const state = useStore(session.store)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const active = state.placement?.projectId === workspace.project.id && (state.phase === 'recording' || state.phase === 'paused')
  const blocked = state.busy || preparing || !active && workspace.disabled && workspace.project.source.durationFrames > 0
  const act = (operation: Promise<unknown>): void => { void operation.catch(workspace.notifyError) }
  const start = async (resume = false): Promise<void> => {
    if (preparing || state.busy) return
    setPreparing(true)
    try {
      if (useAudioEditPlaybackStore.getState().playing) await workspace.togglePlayback()
      const selection = resume ? null : workspace.waveSelection
      const frame = Math.max(0, Math.min(workspace.project.source.durationFrames, useAudioEditPlaybackStore.getState().sourceFrame))
      const placement = await prepareAudioEditTake(workspace.project.id, selection?.startFrame ?? frame, selection?.endFrame ?? frame)
      workspace.setWaveSelection(null)
      await session.start(placement)
    } finally { setPreparing(false) }
  }
  const toggle = (): void => act(active ? session.stop() : state.outputPath ? session.recoverTake() : start())
  const pause = (): void => act(state.phase === 'paused' ? start(true) : session.togglePause())
  useEffect(() => {
    if (!visible) return
    const keydown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !isCaptureShortcut(event) || blocked || settingsOpen || document.querySelector('[aria-modal="true"]')) return
      if (event.target instanceof Element && event.target.closest('input,textarea,[contenteditable="true"],[role="dialog"]')) return
      event.preventDefault(); event.stopPropagation(); toggle()
    }
    // 在面板空格播放处理之前拦下 Shift+空格。
    window.addEventListener('keydown', keydown, true)
    return () => window.removeEventListener('keydown', keydown, true)
  })
  useEffect(() => visible ? contributeAppMenus('audioCapture', [{ menu: 'audio', label: '音频', order: 100, items: [
    { kind: 'action', id: 'audioCapture.startStop', label: active ? '停止录音' : '开始录音', shortcut: 'Shift+Space', ...(blocked ? { disabledReason: '正在处理录音' } : {}), run: toggle },
    { kind: 'action', id: 'audioCapture.pause', label: state.phase === 'paused' ? '继续录音' : '暂停录音', ...(!active || blocked ? { disabledReason: '请先开始录音' } : {}), run: pause },
    { kind: 'action', id: 'audioCapture.settings', label: '录音设置', run: () => setSettingsOpen(true) },
  ] }]) : undefined)
  return <div className="flex shrink-0 items-center gap-1" data-capture-phase={state.phase}>
    <UiIconButton size="md" tone="danger" label={active ? '停止录音' : state.outputPath ? '恢复录音' : '开始录音'} tooltip={active ? '停止录音 · Shift+空格 / R' : '开始录音 · Shift+空格 / R'} disabled={blocked} disabledReason="正在处理录音" aria-keyshortcuts="Shift+Space R" onClick={toggle}>{active ? <Square fill="currentColor" /> : <Circle fill="currentColor" className="text-danger-text" />}</UiIconButton>
    {active && <UiIconButton size="md" label={state.phase === 'paused' ? '继续录音' : '暂停录音'} tooltip={state.phase === 'paused' ? '在当前播放头继续录音' : '暂停并编辑'} disabled={blocked} disabledReason="正在保存录音" onClick={pause}>{state.phase === 'paused' ? <Play /> : <Pause />}</UiIconButton>}
    <PanelTrigger panelSize="compact" panelPadding="content" open={settingsOpen} onOpenChange={setSettingsOpen} alignment="aboveCenter" renderPanel={() => <AudioCaptureSettingsForm disabled={state.phase === 'recording' || state.busy} />}>
      {({ open, togglePanel }) => <UiIconButton size="md" label="录音设置" tooltip="录音设置" on={open} onClick={togglePanel}><Settings2 /></UiIconButton>}
    </PanelTrigger>
    {active && <AudioCaptureLive session={session} sessionId={state.status?.sessionId} channels={state.settings?.effectiveSettings.channels ?? 1} summary="" />}
    {state.error && <UiInlineStatus role="alert" className="max-w-40 truncate" tooltip={state.error}>{state.error}</UiInlineStatus>}
  </div>
}

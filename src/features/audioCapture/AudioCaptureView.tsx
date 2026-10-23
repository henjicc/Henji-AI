import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { ArrowLeft, Mic, Pause, Play, Settings2, Square } from 'lucide-react'
import { PanelTrigger, UiButton, UiError, UiIconButton, UiToolbar } from '@/components/ui'
import { contributeAppMenus } from '@/core/appMenu/appMenu'
import { AudioCaptureSettingsForm } from './AudioCaptureSettingsForm'
import { AudioCaptureLive } from './AudioCaptureLive'
import { captureSummary } from './captureSettingsModel'
import { getAudioCaptureSession } from './captureApplicationService'
import { isCaptureShortcut } from './captureLiveModel'
export function AudioCaptureView(): JSX.Element {
  const session = getAudioCaptureSession()
  const state = useStore(session.store)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const active = state.phase === 'recording' || state.phase === 'paused'
  // 服务记录并展示全部失败；事件入口仅终止 Promise 传播，不能擦除错误。
  const act = (operation: Promise<unknown>): void => { void operation.catch(() => undefined) }
  useEffect(() => contributeAppMenus('audioCapture', [{ menu: 'audio', label: '音频', order: 100, items: [
    { kind: 'action', id: 'audioCapture.startStop', label: active ? '停止录音' : '开始录音', shortcut: 'Shift+Space', ...(state.busy ? { disabledReason: '正在处理录音' } : {}), run: () => act(active ? session.stop() : session.start()) },
    { kind: 'action', id: 'audioCapture.pause', label: state.phase === 'paused' ? '继续录音' : '暂停录音', ...(!active || state.busy ? { disabledReason: '请先开始录音并等待当前操作完成' } : {}), run: () => act(session.togglePause()) },
    { kind: 'action', id: 'audioCapture.settings', label: '录音设置', run: () => setSettingsOpen(true) },
  ] }]), [active, session, state.busy, state.phase])
  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !isCaptureShortcut(event) || session.store.getState().busy || settingsOpen || document.querySelector('[aria-modal="true"]')) return
      if (event.target instanceof Element && event.target.closest('input,textarea,[contenteditable="true"],[role="dialog"]')) return
      event.preventDefault()
      act(session.active ? session.stop() : session.start())
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [session, settingsOpen])
  return <div className="flex h-full min-h-0 flex-col bg-window" data-application-surface-id="tool.audio_edit.record" data-capture-phase={state.phase}>
    <UiToolbar variant="command" trailing={<PanelTrigger open={settingsOpen} onOpenChange={setSettingsOpen} panelSize="content" panelPadding="content" alignment="bottomRight" renderPanel={() => <AudioCaptureSettingsForm disabled={active || state.busy} onSettings={settings => session.store.setState({ settings })} />}>
      {({ togglePanel, open }) => <UiIconButton size="md" label="录音设置" tooltip="录音设置" on={open} onClick={togglePanel}><Settings2 /></UiIconButton>}
    </PanelTrigger>}>
      <UiIconButton size="md" label="返回音频列表" tooltip="返回音频列表" onClick={() => act(session.leave())}><ArrowLeft /></UiIconButton>
      <span className="text-sm text-text1">新录音</span>
    </UiToolbar>
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-3xl space-y-6">
        <AudioCaptureLive session={session} sessionId={state.status?.sessionId} channels={state.settings?.effectiveSettings.channels ?? 1} summary={state.settings ? captureSummary({ ...state.settings.effectiveSettings, ...(state.status ? { sampleRate: state.status.sampleRate } : {}) }) : ''} />
        {state.notice && <p className="text-center text-xs text-text2">{state.notice}</p>}
        <div className="flex items-center justify-center gap-3">
          <UiButton variant="primary" disabled={state.busy} disabledReason="正在处理录音" aria-keyshortcuts="Shift+Space R" onClick={() => act(active ? session.stop() : session.start())}>{active ? <Square /> : <Mic />}{active ? '停止' : '开始录音'}</UiButton>
          {active && <UiButton variant="secondary" disabled={state.busy} disabledReason="正在处理录音" onClick={() => act(session.togglePause())}>{state.phase === 'paused' ? <Play /> : <Pause />}{state.phase === 'paused' ? '继续' : '暂停'}</UiButton>}
          <UiButton variant="danger" disabled={state.busy || !state.outputPath} disabledReason={state.busy ? '正在处理录音' : '尚未开始录音'} onClick={() => act(session.discard())}>放弃</UiButton>
        </div>
        {state.error && <UiError message={state.error} onRetry={() => act(session.start())} />}
        {(state.phase === 'interrupted' || state.phase === 'stopped') && state.outputPath && <div className="flex justify-center"><UiButton variant="secondary" disabled={state.busy} disabledReason="正在处理录音" onClick={() => act(session.recover())}>打开已录部分</UiButton></div>}
        {state.error && <div className="flex justify-center"><UiButton onClick={() => setSettingsOpen(true)}>查看录音设置</UiButton></div>}
      </div>
    </div>
  </div>
}

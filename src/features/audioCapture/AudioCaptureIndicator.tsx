import { useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { Circle, Pause, Square, TriangleAlert } from 'lucide-react'
import { UiButton, UiIconButton } from '@/components/ui'
import { UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import { notifyUser } from '@/contexts/NotificationContext'
import { getPlatform } from '@/platform/runtime'
import { useNavigationStore } from '@/stores/navigationStore'
import { captureTimecode } from './captureLiveModel'
import { currentCaptureIndicatorBinding, useCaptureIndicatorBinding, type CaptureIndicatorBinding } from './captureIndicatorBinding'

const wholeSeconds = (seconds: number): string => captureTimecode(seconds).slice(0, 8)
const ATTACH_RETRY_MS = 5000

/**
 * 标题栏里的录音指示：录音在后台进行（切到别的工作区、界面重载之后）时显示时长并给出停止入口，中断时提示。
 * 在音频编辑里那一页有完整的录音控件，这里不重复显示。
 */
export function AudioCaptureIndicator(): JSX.Element | null {
  const binding = useCaptureIndicatorBinding()
  useEffect(() => {
    // 界面重载或崩溃后录音可能仍在主进程里进行：确实在录时才加载录音会话去接管，平时不拖慢启动。
    // 接管失败（或会话不知道这段录音）时每隔几秒再问一次，录音在后台继续时标题栏总能看到并停止它。
    let probing = false
    const probe = (): void => {
      const session = currentCaptureIndicatorBinding()?.store.getState()
      if (probing || session && (session.phase === 'recording' || session.phase === 'paused' || session.outputPath)) return
      probing = true
      void Promise.resolve().then(() => getPlatform().audioCapture.active()).then(status => {
        if (status) return import('./captureApplicationService').then(module => module.getAudioCaptureSession().attach())
      }).catch(() => undefined).finally(() => { probing = false })
    }
    probe()
    const timer = window.setInterval(probe, ATTACH_RETRY_MS)
    return () => window.clearInterval(timer)
  }, [])
  return binding ? <CaptureIndicator binding={binding} /> : null
}

function CaptureIndicator({ binding }: { binding: CaptureIndicatorBinding }): JSX.Element | null {
  const phase = useStore(binding.store, state => state.phase)
  // 补录模式下“暂停”是两段录音之间的编辑，并没有在录；只有原生会话还开着才算在录。
  const capturing = useStore(binding.store, state => state.phase === 'recording' || state.phase === 'paused' && Boolean(state.outputPath))
  const busy = useStore(binding.store, state => state.busy)
  const error = useStore(binding.store, state => state.error)
  const onRecordingPage = useNavigationStore(state => state.activeWorkspace === 'tools' && state.activeToolId === 'audioEdit')
  const time = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!capturing || onRecordingPage) return
    const update = (): void => { if (time.current) time.current.textContent = wholeSeconds(binding.durationSeconds()) }
    const timer = window.setInterval(update, 250)
    return () => window.clearInterval(timer)
  }, [binding, capturing, onRecordingPage])
  if (onRecordingPage) return null
  const show = (): void => { void binding.show().catch((raw: unknown) => notifyUser(raw instanceof Error ? raw.message : '无法打开录音所在的作品', 'error')) }
  if (phase === 'interrupted') return <UiButton size="sm" tooltip={error || '录音已中断，已录部分保留'} onClick={show}><TriangleAlert className="text-warning-text" />录音已中断</UiButton>
  if (!capturing) return null
  const stop = (): void => { void binding.stop().catch((raw: unknown) => notifyUser(raw instanceof Error ? raw.message : '录音没能保存，文件已保留', 'error')) }
  return <div className="flex shrink-0 items-center gap-0.5" role="status" aria-label="正在录音">
    <UiButton size="sm" tooltip="回到录音" onClick={show}>
      {phase === 'paused' ? <Pause /> : <Circle fill="currentColor" className="text-danger-text" />}
      <span ref={time} className={UI_TEXT_TIMECODE_CLASS} aria-label="已录时长">{wholeSeconds(binding.durationSeconds())}</span>
    </UiButton>
    <UiIconButton size="sm" tone="danger" label="停止录音" tooltip="停止录音" disabled={busy} disabledReason="正在保存录音" onClick={stop}><Square fill="currentColor" /></UiIconButton>
  </div>
}

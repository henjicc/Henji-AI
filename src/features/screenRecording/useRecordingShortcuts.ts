import { useEffect } from 'react'
import { getPlatform, isDesktopRuntime } from '@/platform'
import { useSettingsStore } from '@/stores/settingsStore'
import { createLogger } from '@/core/logging'
import { sensitiveDomRegions } from './application/recordingDomPrivacy'

const logger = createLogger('screen_recording.shortcuts')
if (import.meta.env.DEV || import.meta.env.MODE === 'development') {
  void import('./capture/development').then(module => module.installCaptureInspection())
}
/** 主窗口同步持久偏好；控制条只读取状态，不另设设置真相。 */
export function useRecordingShortcuts(): void {
  const shortcuts = useSettingsStore(state => state.recordingShortcuts)
  useEffect(() => {
    if (!isDesktopRuntime()) return
    void getPlatform().screenRecording.shortcuts(shortcuts).catch(error => logger.warn('录制快捷键同步失败', { event: 'recording.shortcuts.sync.failed', error }))
  }, [shortcuts])
  useEffect(() => {
    if (!isDesktopRuntime()) return
    const api = getPlatform().screenRecording, ids = new WeakMap<Element, string>()
    let sessionId: string | null = null, previous = '', busy = false, disposed = false, generation = 0
    const unsubscribe = api.onChanged(snapshot => { const next = snapshot?.phase === 'recording' ? snapshot.sessionId : null; if (next !== sessionId) { generation++; previous = ''; sessionId = next } })
    const timer = setInterval(() => {
      if (!sessionId || busy || disposed) return
      const regions = sensitiveDomRegions(document, ids), key = JSON.stringify([window.screenX, window.screenY, window.outerWidth, window.outerHeight, regions]), ownerGeneration = generation
      if (key === previous) return
      busy = true
      void api.recordSensitiveDom(sessionId, regions).then(() => { if (ownerGeneration === generation) previous = key }).catch(error => logger.warn('隐私区域采集失败', { event: 'recording.dom_privacy.failed', error })).finally(() => { busy = false })
    }, 100)
    return () => { disposed = true; clearInterval(timer); unsubscribe() }
  }, [])
}

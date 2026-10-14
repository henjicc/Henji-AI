import { useEffect } from 'react'
import { getPlatform, isDesktopRuntime } from '@/platform'
import { useSettingsStore } from '@/stores/settingsStore'
import { createLogger } from '@/core/logging'

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
}

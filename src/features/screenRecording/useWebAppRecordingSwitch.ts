import { useEffect } from 'react'
import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform'
import { useSettingsStore } from '@/stores/settingsStore'

const logger = createLogger('features.screenRecording.webAppRecording')

/** The experimental setting decides whether Henji listens for web app probes at all. */
export function useWebAppRecordingSwitch(): void {
  const enabled = useSettingsStore((state) => state.experimentalWebAppRecording)
  useEffect(() => {
    void getPlatform().webReplay.setEnabled(enabled).catch((error: unknown) => {
      logger.warn('网页应用录制开关同步失败', { event: 'web_replay.switch.failed', context: { enabled }, error })
    })
  }, [enabled])
}

export const WEB_APP_RECORDING_DISABLED_MESSAGE = '网页应用录制是实验性功能，尚未开启；请先在 设置 → 通用 → 实验性功能 中打开（设置属性 experimental.web_app_recording）。'

export function webAppRecordingEnabled(): boolean { return useSettingsStore.getState().experimentalWebAppRecording }

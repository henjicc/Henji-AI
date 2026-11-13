import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { getPlatform } from '@/platform'
import type { CaptureSource } from '@/core/screenRecording/contracts'
import { captureOptionsSchema, type ScreenCaptureOptions } from '@/core/screenRecording/capture'
import { recordingDevices } from './tracks/devices'
import { loadRecordingSetup, orderedScreens, recordingOutput, saveRecordingSetup, type RememberedRecordingSetup, type RecordingRangeMode, type RecordingRegion, type RecordingSetup } from './recordingSetupModel'

/**
 * 录制设置（录什么：来源、范围、区域；怎么录：声音、清晰度、帧率、编码）只有一份：工具里的屏幕录制页与剪辑的录制样子
 * 读写同一个状态源，任何一处改了另一处马上看到，存盘也只从这里写，不会互相拿旧值覆盖。
 */
let remembered: RememberedRecordingSetup | null = null
const listeners = new Set<() => void>()
const current = (): RememberedRecordingSetup => remembered ??= loadRecordingSetup()
function update(change: (value: RememberedRecordingSetup) => RememberedRecordingSetup): void {
  const next = change(current())
  if (next === remembered) return
  remembered = next
  saveRecordingSetup(next)
  for (const listener of listeners) listener()
}
// 没有界面在用时以存盘的那份为准：下次打开重新读，别处（另一个窗口、设置迁移）改过的值不会被内存里的旧值盖掉。
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); if (!listeners.size) remembered = null } }
type Update<T> = T | ((value: T) => T)
const resolve = <T,>(value: Update<T>, previous: T): T => typeof value === 'function' ? (value as (previous: T) => T)(previous) : value

/** `onError` 要是稳定的回调（useCallback），否则每次渲染都会重新读取来源。 */
export function useRecordingSetupState(onError: (error: unknown) => void) {
  const state = useSyncExternalStore(subscribe, current)
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [devices, setDevices] = useState<Awaited<ReturnType<typeof recordingDevices>>>([])
  const [loading, setLoading] = useState(false)
  const { range: mode, sourceId, region, setup } = state
  const setSetup = useCallback((value: Update<RecordingSetup>) => update(previous => ({ ...previous, setup: resolve(value, previous.setup) })), [])
  const setSourceId = useCallback((value: Update<string>) => update(previous => ({ ...previous, sourceId: resolve(value, previous.sourceId) })), [])
  const setRegion = useCallback((value: Update<RecordingRegion>) => update(previous => ({ ...previous, region: resolve(value, previous.region) })), [])
  const setMode = useCallback((value: Update<RecordingRangeMode>) => update(previous => ({ ...previous, range: resolve(value, previous.range) })), [])
  /** `devicesToo: false` 只刷新来源与缩略图（画面预览定时取新图），不重新枚举设备。 */
  const refresh = useCallback(async (devicesToo = true): Promise<void> => {
    setLoading(true)
    try {
      const values = await getPlatform().screenRecording.sources()
      setSources(values)
      // Keep the remembered source when it still exists; otherwise start from the primary monitor.
      if (!values.some(item => item.id === current().sourceId)) {
        // The remembered window has closed: fall back to the main screen, and show the screen range with it.
        update(previous => ({ ...previous, range: previous.range === 'window' ? 'screen' : previous.range, sourceId: (values.find(item => item.display?.primary) ?? orderedScreens(values)[0] ?? values[0])?.id ?? '' }))
      }
      if (devicesToo) setDevices(await recordingDevices())
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh().catch(onError) }, [refresh, onError])
  const changeMode = (next: RecordingRangeMode): void => {
    setMode(next)
    const selectedNow = sources.find(source => source.id === sourceId)
    const wanted = next === 'window' ? 'window' : 'screen'
    if (selectedNow?.kind !== wanted) setSourceId((wanted === 'screen' ? sources.find(source => source.display?.primary) ?? orderedScreens(sources)[0] : sources.find(source => source.kind === 'window'))?.id ?? '')
  }
  const selected = sources.find(source => source.id === sourceId)
  /** 采集选项：只有选了屏幕上的一块区域时才带区域。 */
  const captureOptions = (): ScreenCaptureOptions => {
    const useRegion = mode === 'region' && selected?.kind === 'screen' && (region.width < 1 || region.height < 1)
    return captureOptionsSchema.parse({ sourceId, ...recordingOutput(setup), ...(useRegion ? { region } : {}) })
  }
  return { sources, devices, loading, mode, sourceId, region, setup, selected, setSetup, setSourceId, setRegion, changeMode, refresh, captureOptions }
}
export type RecordingSetupState = ReturnType<typeof useRecordingSetupState>

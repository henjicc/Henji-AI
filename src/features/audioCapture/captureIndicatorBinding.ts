import { useSyncExternalStore } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import type { CaptureSessionState } from './captureSession'

/**
 * 标题栏录音指示与录音会话之间的唯一连接：会话随音频编辑按需加载，标题栏留在首屏，
 * 会话建立后在这里登记自己，指示直接读它的状态、调它的停止，不另存一份录音状态。
 */
export interface CaptureIndicatorBinding {
  store: StoreApi<CaptureSessionState>
  durationSeconds(): number
  stop(): Promise<void>
  show(): Promise<void>
}
let binding: CaptureIndicatorBinding | undefined
const listeners = new Set<() => void>()

export function bindCaptureIndicator(next: CaptureIndicatorBinding): void {
  binding = next
  for (const listener of listeners) listener()
}
export function currentCaptureIndicatorBinding(): CaptureIndicatorBinding | undefined { return binding }
export function useCaptureIndicatorBinding(): CaptureIndicatorBinding | undefined {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => binding)
}

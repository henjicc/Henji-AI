import type { RecordingOperation } from '@/core/screenRecording/script'
import { UI_DURATION } from '@/components/ui/motion'
import { waitRecordingStep } from './recordingWait'

let state: { x: number; y: number; clicking: boolean } | null = null
const listeners = new Set<() => void>()
export function directorCursorSnapshot() { return state }
export function subscribeDirectorCursor(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
function publish(value: typeof state) { state = value; for (const listener of listeners) listener() }
export function clearDirectorCursor(): void { publish(null) }
export async function pointDirectorCursor(operation: RecordingOperation, signal: AbortSignal): Promise<void> {
  const preset = operation.properties['interface.theme_preset']
  const selector = preset ? `[data-recording-theme="${preset}"]` : '[aria-label="剪辑画面"]'
  const deadline = performance.now() + 5000
  let target = document.querySelector(selector)
  while (!target && performance.now() < deadline) { await waitRecordingStep(50, signal); target = document.querySelector(selector) }
  target?.scrollIntoView({ block: 'center', inline: 'nearest' })
  await waitRecordingStep(UI_DURATION.fast, signal)
  const rect = target?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) throw new Error('演示目标尚未显示，请打开对应页面后重新录制。')
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
  if (!state) { publish({ x: Math.max(0, x - 100), y, clicking: false }); await waitRecordingStep(UI_DURATION.fast, signal) }
  publish({ x, y, clicking: false }); await waitRecordingStep(UI_DURATION.viewer, signal)
  publish({ x, y, clicking: true }); await waitRecordingStep(UI_DURATION.base, signal)
  publish({ x, y, clicking: false })
}

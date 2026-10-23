/**
 * 打开一份网页录制（作品列表里的 `.hjweb`）时，录制页切到“网页应用”并选中它。录制页可能还没挂载，
 * 所以请求先记下来，页面挂载或已挂载时取走。
 */
let pending: string | null = null
const listeners = new Set<() => void>()

export function requestWebRecordingFocus(recordingId: string): void {
  pending = recordingId
  for (const listener of listeners) listener()
}

/** 取走待选中的录制；没有时为 null。 */
export function takeWebRecordingFocus(): string | null {
  const value = pending
  pending = null
  return value
}

export function subscribeWebRecordingFocus(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

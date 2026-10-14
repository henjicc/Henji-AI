import { useEffect, useState } from 'react'
import { getPlatform } from '@/platform'
import type { RecordingControlSnapshot } from '@/core/screenRecording/contracts'

/** Live control snapshot for the auxiliary recording windows (control bar, range frame). */
export function useRecordingControlSnapshot(onReadFailed?: () => void): RecordingControlSnapshot | null {
  const [snapshot, setSnapshot] = useState<RecordingControlSnapshot | null>(null)
  useEffect(() => {
    const api = getPlatform().screenRecording
    let disposed = false
    let receivedEvent = false
    const unsubscribe = api.onChanged(value => { receivedEvent = true; if (!disposed) setSnapshot(value) })
    void api.snapshot().then(value => { if (!disposed && !receivedEvent) setSnapshot(value) }).catch(() => { if (!disposed) onReadFailed?.() })
    return () => { disposed = true; unsubscribe() }
  }, [onReadFailed])
  return snapshot
}

export function recordingTimeLabel(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  return `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds / 60 % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

import { useSyncExternalStore } from 'react'
import type { VideoEditGainTarget } from './videoEditLoudness'

type Request = { kind: 'gain'; target: VideoEditGainTarget } | { kind: 'export'; projectId: string }
let current: Request | null = null
const listeners = new Set<() => void>()
function publish(request: Request | null): void { current = request; for (const listener of listeners) listener() }
export function openVideoEditAudioGainDialog(target: VideoEditGainTarget): void { publish({ kind: 'gain', target: { ...target, clipIds: [...target.clipIds] } }) }
export function openVideoEditExportDialog(projectId: string): void { publish({ kind: 'export', projectId }) }
export function closeVideoEditAudioDialog(): void { publish(null) }
export function useVideoEditAudioDialog(projectId: string | undefined): Request | null {
  const request = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => current)
  return request && (request.kind === 'gain' ? request.target.projectId : request.projectId) === projectId ? request : null
}

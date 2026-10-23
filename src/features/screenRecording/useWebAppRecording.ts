import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WebRecordingSummary, WebReplayRenderResult, WebReplayServerState } from '@/platform/contracts/webReplay'
import { getPlatform } from '@/platform'

export interface WebAppRenderState { busy: boolean; progress: number; frame: string | null; result?: WebReplayRenderResult; error?: string }

export type WebAppRecordingModel = ReturnType<typeof useWebAppRecording>

/**
 * Web app recording state for the recording page: connected probes, the recording in progress
 * (with a live elapsed time), saved recordings, and replay renders with live preview frames.
 */
export function useWebAppRecording(): {
  server: WebReplayServerState | null; recordings: WebRecordingSummary[]
  selectedApp: string; selectApp(id: string): void; selectedRecording: WebRecordingSummary | null; selectRecording(id: string): void
  activeId: string | null; elapsedMs: number; busy: boolean; error: string; renders: Record<string, WebAppRenderState>
  start(): Promise<void>; stop(): Promise<void>; render(id: string): Promise<void>; reveal(id: string, file?: string): Promise<void>
  remove(id: string): Promise<void>; restore(id: string): Promise<void>
} {
  const [server, setServer] = useState<WebReplayServerState | null>(null)
  const [recordings, setRecordings] = useState<WebRecordingSummary[]>([])
  const [selectedApp, selectApp] = useState('')
  const [selectedRecordingId, selectRecording] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [renders, setRenders] = useState<Record<string, WebAppRenderState>>({})
  const [now, setNow] = useState(() => Date.now())
  const platform = getPlatform().webReplay
  const reload = useCallback(async () => setRecordings(await platform.recordings()), [platform])
  useEffect(() => {
    void platform.apps().then(setServer).catch(e => setError(String(e)))
    void reload().catch(e => setError(String(e)))
    const offApps = platform.onAppsChanged(setServer)
    const offProgress = platform.onRenderProgress(event => setRenders(value => ({ ...value, [event.recordingId]: { ...value[event.recordingId], busy: true, progress: event.progress, frame: event.frame } })))
    return () => { offApps(); offProgress() }
  }, [platform, reload])
  const apps = useMemo(() => server?.apps ?? [], [server])
  useEffect(() => { if (!apps.some(app => app.connectionId === selectedApp)) selectApp(apps[0]?.connectionId ?? '') }, [apps, selectedApp])
  const active = apps.find(app => app.recordingId)
  const activeId = active?.recordingId ?? null
  useEffect(() => {
    if (!active?.recordingStartedAt) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [active?.recordingStartedAt])
  const selectedRecording = recordings.find(r => r.id === selectedRecordingId) ?? recordings[0] ?? null
  const guard = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true); setError('')
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return {
    server, recordings, selectedApp, selectApp, selectedRecording, selectRecording, activeId, busy, error, renders,
    elapsedMs: active?.recordingStartedAt ? Math.max(0, now - active.recordingStartedAt) : 0,
    start: () => guard(async () => { await platform.start(selectedApp); await reload() }),
    stop: () => guard(async () => {
      if (!activeId) return
      const manifest = await platform.stop(activeId)
      await reload()
      selectRecording(manifest.id)
    }),
    render: async id => {
      setRenders(value => ({ ...value, [id]: { busy: true, progress: 0, frame: null } }))
      try {
        const result = await platform.render({ recordingId: id })
        setRenders(value => ({ ...value, [id]: { busy: false, progress: 1, frame: null, result } }))
        await reload()
      } catch (e) {
        setRenders(value => ({ ...value, [id]: { busy: false, progress: 0, frame: null, error: e instanceof Error ? e.message : String(e) } }))
      }
    },
    reveal: (id, file) => platform.reveal(id, file),
    remove: id => guard(async () => { await platform.remove(id); await reload() }),
    restore: id => guard(async () => { await platform.restore(id); await reload(); selectRecording(id) }),
  }
}

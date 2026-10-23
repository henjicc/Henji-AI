import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WebRecordingBackupOptions, WebRecordingExportResult, WebRecordingSummary, WebReplayRenderResult, WebReplayServerState } from '@/platform/contracts/webReplay'
import { getPlatform } from '@/platform'
import type { WebAppBackupSetup } from '@/services/recordingSetupModel'
import { finishWebAppBackupAudio, startWebAppBackupAudio } from './application/webAppBackupAudio'

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
  start(setup: WebAppBackupSetup, backup: WebRecordingBackupOptions | null, projectId?: string | null): Promise<void>; stop(): Promise<void>; render(id: string): Promise<void>; reveal(id: string, file?: string): Promise<void>
  removeMany(ids: string[]): Promise<string[]>; restoreMany(ids: string[]): Promise<void>
  rename(items: Array<{ recordingId: string; title: string | null }>): Promise<void>; exportVideos(ids: string[], directory: string): Promise<WebRecordingExportResult | null>
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
  // Nothing is selected until the user picks a recording; then its details and video show.
  const selectedRecording = recordings.find(r => r.id === selectedRecordingId) ?? null
  const guard = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true); setError('')
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return {
    server, recordings, selectedApp, selectApp, selectedRecording, selectRecording, activeId, busy, error, renders,
    elapsedMs: active?.recordingStartedAt ? Math.max(0, now - active.recordingStartedAt) : 0,
    // With a project (the page was opened from an edit in a project) the recording is saved into it as .hjweb.
    start: (setup, backup, projectId) => guard(async () => {
      const manifest = await platform.start(selectedApp, backup, projectId ? { projectId } : null)
      await reload()
      // Sound for the backup is recorded on this page, like screen recording; a failure keeps the picture going.
      if (backup) await startWebAppBackupAudio(manifest.id, setup).catch(e => setError(e instanceof Error ? e.message : String(e)))
    }),
    stop: () => guard(async () => {
      if (!activeId) return
      await finishWebAppBackupAudio(activeId)
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
    removeMany: async ids => {
      const removed: string[] = []
      // The preview keeps the selected recording's video open; let go of it before its folder moves.
      if (ids.includes(selectedRecordingId)) { selectRecording(''); await new Promise(resolve => setTimeout(resolve, 300)) }
      await guard(async () => { try { for (const id of ids) { await platform.remove(id); removed.push(id) } } finally { await reload() } })
      return removed
    },
    restoreMany: ids => guard(async () => { try { for (const id of ids) await platform.restore(id) } finally { await reload() } }),
    rename: items => guard(async () => { await platform.rename(items); await reload() }),
    exportVideos: async (ids, directory) => {
      let result: WebRecordingExportResult | null = null
      await guard(async () => { result = await platform.exportVideos(ids, directory) })
      return result
    },
  }
}

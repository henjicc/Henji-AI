import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WebRecordingManifest } from '@/core/webReplay/schema'
import type { WebReplayRenderResult, WebReplayServerState } from '@/platform/contracts/webReplay'
import { getPlatform } from '@/platform'

interface RenderState { busy: boolean; result?: WebReplayRenderResult; error?: string }

/**
 * Web app recording state for the recording page: which probes are connected, the recording in
 * progress, saved recordings and their replay renders. The page's command band shows `actions`.
 */
export type WebAppRecordingModel = ReturnType<typeof useWebAppRecording>

export function useWebAppRecording(): {
  server: WebReplayServerState | null; recordings: WebRecordingManifest[]; selected: string; select(id: string): void
  activeId: string | null; busy: boolean; error: string; renders: Record<string, RenderState>
  start(): Promise<void>; stop(): Promise<void>; render(id: string): Promise<void>; reveal(id: string, file?: string): Promise<void>
} {
  const [server, setServer] = useState<WebReplayServerState | null>(null)
  const [recordings, setRecordings] = useState<WebRecordingManifest[]>([])
  const [selected, select] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [renders, setRenders] = useState<Record<string, RenderState>>({})
  const platform = getPlatform().webReplay
  const reload = useCallback(async () => setRecordings(await platform.recordings()), [platform])
  useEffect(() => {
    void platform.apps().then(setServer).catch(e => setError(String(e)))
    void reload().catch(e => setError(String(e)))
    return platform.onAppsChanged(setServer)
  }, [platform, reload])
  const apps = useMemo(() => server?.apps ?? [], [server])
  useEffect(() => { if (!apps.some(app => app.connectionId === selected)) select(apps[0]?.connectionId ?? '') }, [apps, selected])
  const activeId = apps.find(app => app.recordingId)?.recordingId ?? null
  const guard = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true); setError('')
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return {
    server, recordings, selected, select, activeId, busy, error, renders,
    start: () => guard(async () => { await platform.start(selected); await reload() }),
    stop: () => guard(async () => { if (activeId) await platform.stop(activeId); await reload() }),
    render: async id => {
      setRenders(value => ({ ...value, [id]: { busy: true } }))
      try { const result = await platform.render({ recordingId: id }); setRenders(value => ({ ...value, [id]: { busy: false, result } })) } catch (e) {
        setRenders(value => ({ ...value, [id]: { busy: false, error: e instanceof Error ? e.message : String(e) } }))
      }
    },
    reveal: (id, file) => platform.reveal(id, file),
  }
}

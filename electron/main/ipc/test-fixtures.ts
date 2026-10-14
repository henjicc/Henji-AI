import { deleteGenerationSubmission, inspectGenerationSubmission } from '../services/ai-runtime/generation-submissions'
import { isAutomationTestMode } from '../services/automationMode'
import { parseStringField, registerIpcHandler } from './registry'
import { BrowserWindow, screen } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { uIOhook } from 'uiohook-napi'
import { RecordingEventStore } from '../services/screen-recording/event-store'
import type { CaptureEvent } from '../../../src/core/captureLog/events'
import { z } from 'zod'
import { assertTrustedApplicationSender } from './application-control'
import { closeRecordingControl, openRecordingControl, recordingControl } from '../services/screen-recording/runtime'
import { getUserFolderDir } from '../services/appPaths'

/*
 * 测试夹具通道（存储底座 2.3）：真实性测试脚本需要核对或清理、但正式界面没有入口的记录，
 * 经拥有该表的仓库函数访问，不写 SQL。只在自动化 / 隔离测试模式下注册，正常启动不可用。
 */
export function registerTestFixturesIpc(): void {
  if (!isAutomationTestMode()) return
  const calls: Record<string, number> = {}
  let eventDirectory: string | undefined
  let tracksDirectory: string | undefined
  let tracksOriginUs: number | undefined
  let eventFailure: string | undefined
  registerIpcHandler('testFixtures:recordingControl', input => z.enum(['setup', 'setup-events', 'setup-tracks', 'read', 'events', 'cleanup']).parse(input), async (action, event) => {
    if (action === 'cleanup') {
      try { await closeRecordingControl() } finally {
        if (eventDirectory) await rm(eventDirectory, { recursive: true, force: true }); eventDirectory = undefined
        if (tracksDirectory) await rm(tracksDirectory, { recursive: true, force: true }); tracksDirectory = undefined; tracksOriginUs = undefined
      }
      return { snapshot: null, calls: { ...calls }, protected: false, sourceId: '' }
    }
    if (action === 'setup' || action === 'setup-events' || action === 'setup-tracks') {
      for (const key of Object.keys(calls)) delete calls[key]
      const operation = (name: string) => async (): Promise<void> => { calls[name] = (calls[name] ?? 0) + 1 }
      const sessionId = randomUUID()
      const owner = BrowserWindow.fromWebContents(event.sender)
      if (!owner) throw new Error('录制巡检没有主窗口')
      const nowUs = () => Number(process.hrtime.bigint() / 1000n)
      const geometry = () => { const bounds = owner.getContentBounds(); const scale = screen.getDisplayMatching(bounds).scaleFactor; return { bounds, pixels: { width: Math.round(bounds.width * scale), height: Math.round(bounds.height * scale) } } }
      eventFailure = undefined
      if (action === 'setup-events' || action === 'setup-tracks') eventDirectory = await mkdtemp(join(tmpdir(), 'henji-recording-events-tour-'))
      if (action === 'setup-tracks') { tracksDirectory = await mkdtemp(join(tmpdir(), 'henji-recording-tracks-tour-')); tracksOriginUs = nowUs() }
      openRecordingControl(event.sender, sessionId, { start: operation('start'), pause: operation('pause'), resume: operation('resume'), mark: operation('mark'), stop: operation('stop'), cancel: operation('cancel') }, action === 'setup-events' || action === 'setup-tracks' ? {
        ownerRef: { kind: 'screen_recording.session', id: sessionId }, sourceDigest: `sha256:${createHash('sha256').update(JSON.stringify(geometry())).digest('hex')}`,
        directory: eventDirectory!, originUs: tracksOriginUs ?? nowUs(), nowUs, geometry, onFailure: error => { eventFailure = String(error) },
      } : undefined)
    }
    let events: { count: number; cursorCount: number; cursorShapes: string[]; facts: CaptureEvent[]; gaps: number; inputListeners: number; failure?: string } | undefined
    if (action === 'events' && eventDirectory) {
      let count = 0; let cursorCount = 0; let gaps = 0; const shapes = new Set<string>(); const facts: CaptureEvent[] = []
      for await (const page of new RecordingEventStore(eventDirectory).recover()) {
        count += page.count; gaps += page.clockSegments.filter(segment => segment.mode === 'gap').length
        for (const fact of page.entries) { if (fact.kind === 'cursor') { cursorCount++; shapes.add(fact.shape) } else facts.push(fact) }
      }
      events = { count, cursorCount, cursorShapes: [...shapes], facts, gaps, inputListeners: uIOhook.listenerCount('input'), ...(eventFailure ? { failure: eventFailure } : {}) }
    }
    const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=recording-control'))
    return { snapshot: recordingControl.snapshot(), calls: { ...calls }, protected: win?.isContentProtected() ?? false, sourceId: BrowserWindow.fromWebContents(event.sender)?.getMediaSourceId() ?? '', uploads: getUserFolderDir('uploads'), ...(events ? { events } : {}), ...(tracksDirectory ? { tracksDirectory, originUs: tracksOriginUs } : {}) }
  }, assertTrustedApplicationSender)
  registerIpcHandler('testFixtures:generationSubmission:inspect', (input) => ({ requestId: parseStringField(input, 'requestId') }),
    ({ requestId }) => inspectGenerationSubmission(requestId))
  registerIpcHandler('testFixtures:generationSubmission:delete', (input) => ({ requestId: parseStringField(input, 'requestId') }),
    ({ requestId }) => deleteGenerationSubmission(requestId))
}

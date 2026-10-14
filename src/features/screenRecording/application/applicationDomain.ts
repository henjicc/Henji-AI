import { z } from 'zod'
import type { ApplicationDomainModule } from '@/features/application-control'
import { RECORDING_CAPABILITIES, recordingDestinationSchema, recordingRefSchema, startRecordingInputSchema } from '@/core/application-control/domains/screenRecording/recordingCapabilities'
import { parseCapabilityInput } from '@/features/application-control'
import { registerDocumentBusyCheck, registerDocumentOpener } from '@/features/documents'
import { registerDocumentCoverProvider } from '@/features/documents'
import { openApplicationSurface } from '@/features/navigation'
import { recordingDocumentSchema } from '@/core/screenRecording/document'
import { captureOptionsSchema } from '@/core/screenRecording/capture'
import { controlRecording, readRecordingDocument, recordingEvents, recordingView, recoverRecording, showRecordingDocument, startRecording } from './recordingService'
import { importRecordingToVideo } from './recordingVideoImport'
import { recordingRegistrations } from './recordingReflection'

export const screenRecordingApplicationDomain: ApplicationDomainModule = {
  id: 'screen_recording', entities: recordingRegistrations, registerExecutors() {},
  registerCapabilities(registrar) {
    registerDocumentOpener('screen_recording', async document => { await showRecordingDocument(document.id); openApplicationSurface('tool.screen_recording') })
    registerDocumentBusyCheck('screen_recording', id => recordingView().snapshot?.sessionId === id || recordingView().busy && recordingView().documentId === id ? '请先停止录制并等待保存' : null)
    registerDocumentCoverProvider('screen_recording', read => { const first = recordingDocumentSchema.parse(read.content).media.find(media => media.kind === 'screen' && media.durationUs > 0); return first ? [{ source: first.path, sourceKind: 'video', atSeconds: 0 }] : null })
    for (const definition of RECORDING_CAPABILITIES) registrar.registerHandler(definition.id, async (input, context) => {
      context.signal.throwIfAborted()
      if (definition.id === 'start_screen_recording') {
        const parsed = startRecordingInputSchema.parse(input)
        if (parsed.destination && context.callerGrant && !context.callerGrant.permissions.includes('video_edit:write')) throw new Error('PERMISSION_DENIED:录制到剪辑还需要 video_edit:write 权限')
        const options = captureOptionsSchema.parse({ sourceId: parsed.sourceRef.id, width: parsed.width, height: parsed.height, fps: parsed.fps, bitrate: 12_000_000, ...(parsed.region ? { region: parsed.region } : {}) })
        const id = await startRecording(options, { name: parsed.name, tracks: parsed.tracks, ...(parsed.projectId ? { projectId: parsed.projectId } : {}) }, parsed.destination, context.signal)
        return { resultRef: { kind: 'screen_recording.session', id }, verified: (await readRecordingDocument(id)).sessionId === id }
      }
      if (definition.id === 'read_screen_recording_events') {
        const parsed = parseCapabilityInput<{ sessionRef: z.infer<typeof recordingRefSchema>; offset: number; limit: number; markersOnly: boolean }>(definition.id, input)
        return recordingEvents(parsed.sessionRef.id, parsed.offset, parsed.limit, parsed.markersOnly)
      }
      if (definition.id === 'import_screen_recording') {
        if (context.callerGrant && !context.callerGrant.permissions.includes('screen_recording:read')) throw new Error('PERMISSION_DENIED:导入剪辑需要 screen_recording:read 权限')
        const parsed = parseCapabilityInput<{ sessionRef: z.infer<typeof recordingRefSchema>; destination: z.infer<typeof recordingDestinationSchema> }>(definition.id, input)
        const itemIds = await importRecordingToVideo(parsed.sessionRef.id, parsed.destination, context.signal)
        return { resultRef: { kind: 'video_edit.document', id: parsed.destination.documentId }, itemIds, verified: itemIds.length > 0 }
      }
      const parsed = parseCapabilityInput<{ sessionRef: z.infer<typeof recordingRefSchema>; note?: string }>(definition.id, input)
      const action = definition.id.replace('_screen_recording', '') as 'pause' | 'resume' | 'mark' | 'stop' | 'cancel' | 'recover'
      if (action === 'recover') await recoverRecording(parsed.sessionRef.id)
      else await controlRecording(parsed.sessionRef.id, action, parsed.note)
      await readRecordingDocument(parsed.sessionRef.id)
      return { resultRef: parsed.sessionRef, verified: true }
    })
  },
}

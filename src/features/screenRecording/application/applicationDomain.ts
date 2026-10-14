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
import { recordingUnderstandingRegistration } from './recordingUnderstandingFields'
import { RecordingUnderstandingMutation } from './recordingUnderstandingMutation'
import { executeRecordingUnderstanding } from './recordingUnderstandingCapability'
import { generateRecordingMovieCapability } from '@/core/application-control/domains/screenRecording/movieCapability'
import { generateRecordingMovie } from './recordingMovieService'
import { openVideoEditDocument } from '@/features/videoEdit'
import { executeRecordingPrivacy } from './recordingPrivacyCapability'
import { recordingPrivacyBusy } from './recordingPrivacyService'
import { recordingProductInputSchema, recordingExportRefSchema } from '@/core/application-control/domains/screenRecording/productCapability'
import { exportRecordingProduct, cancelRecordingProductExport, recordingProductBusy } from './recordingProductService'
import { resolveConfiguredDestination } from '@/features/canvas'

export const screenRecordingApplicationDomain: ApplicationDomainModule = {
  id: 'screen_recording', entities: () => [...recordingRegistrations(), recordingUnderstandingRegistration()],
  registerExecutors(engine) { engine.registerMutationExecutor(new RecordingUnderstandingMutation()) },
  registerCapabilities(registrar) {
    registerDocumentOpener('screen_recording', async document => { await showRecordingDocument(document.id); openApplicationSurface('tool.screen_recording') })
    registerDocumentBusyCheck('screen_recording', id => recordingProductBusy(id) ? '请先等待产物导出完成或取消' : recordingPrivacyBusy(id) ? '请先等待敏感信息识别完成或取消' : recordingView().snapshot?.sessionId === id || recordingView().busy && recordingView().documentId === id ? '请先停止录制并等待保存' : null)
    registerDocumentCoverProvider('screen_recording', read => { const first = recordingDocumentSchema.parse(read.content).media.find(media => media.kind === 'screen' && media.durationUs > 0); return first ? [{ source: first.path, sourceKind: 'video', atSeconds: 0 }] : null })
    for (const definition of RECORDING_CAPABILITIES) registrar.registerHandler(definition.id, async (input, context) => {
      context.signal.throwIfAborted()
      if (definition.id === 'understand_screen_recording') return executeRecordingUnderstanding(input, context)
      if (definition.id === 'export_screen_recording_product') {
        const parsed = recordingProductInputSchema.parse(input)
        if (context.callerGrant && !context.callerGrant.permissions.includes('screen_recording:read')) throw new Error('PERMISSION_DENIED:导出需要 screen_recording:read 权限。')
        if (parsed.product === 'image_document' && context.callerGrant && !context.callerGrant.permissions.includes('documents:write')) throw new Error('PERMISSION_DENIED:创建图片文档还需要 documents:write 权限。')
        const result = await exportRecordingProduct(parsed.sessionRef.id, { product: parsed.product, stepIds: parsed.stepIds, ...(parsed.destination ? { directory: await resolveConfiguredDestination(parsed.destination) } : {}) }, context.signal)
        return { resultRef: { kind: 'screen_recording.export', id: result.id }, state: result.state, files: result.files, documentRefs: result.documentRefs, warnings: result.warnings, verified: result.verified }
      }
      if (definition.id === 'cancel_screen_recording_export') {
        const parsed = z.object({ exportRef: recordingExportRefSchema }).strict().parse(input)
        await cancelRecordingProductExport(parsed.exportRef.id)
        return { resultRef: parsed.exportRef, verified: true }
      }
      if (definition.id === generateRecordingMovieCapability.id) {
        const parsed = generateRecordingMovieCapability.inputSchema.parse(input)
        if (context.callerGrant && !context.callerGrant.permissions.includes('screen_recording:read')) throw new Error('PERMISSION_DENIED:生成成片需要 screen_recording:read 权限。')
        const prefix = `${parsed.documentRef.id}:`
        if (parsed.sequenceRef && !parsed.sequenceRef.id.startsWith(prefix)) throw new Error('sequenceRef 必须属于 documentRef。')
        const owner = await openVideoEditDocument({ id: parsed.documentRef.id }, { focus: false })
        const generate = () => generateRecordingMovie(parsed.sessionRef.id, { documentId: parsed.documentRef.id, sequenceId: parsed.sequenceRef?.id.slice(prefix.length), recipe: parsed.recipe }, context.signal)
        const result = context.execution ? await context.execution.atomic(() => owner.contentVersion, generate) : await generate()
        const sequenceRefs = result.sequenceIds.map(id => ({ kind: 'video_edit.sequence' as const, id: `${result.documentId}:${id}` }))
        return { documentRef: parsed.documentRef, resultRef: sequenceRefs[0], sequenceRefs, warnings: result.warnings, verified: result.verified }
      }
      if (definition.id === 'detect_screen_recording_sensitive_text') return executeRecordingPrivacy(input, context)
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

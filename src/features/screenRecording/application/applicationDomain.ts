import { recordingEncoding } from '@/core/screenRecording/encoding'
import { loadRecordingSetup, recordingOutput, recordingTracksFromSetup } from '../recordingSetupModel'
import { notExecutedFailure } from '@/core/application-control/execution/writeExecution'
import { CAPABILITY_SHORT_WAIT_MS, waitWithin } from '@/core/application-control/execution/waitWithin'
import { trackRecordingWork } from './recordingWork'
import { getPlatform } from '@/platform'
import { planRecordingDirector, startRecordingDirector, cancelRecordingDirector, recordingDirectorBusy } from './recordingDirectorService'
import { planRecordingDirectorCapability, startRecordingDirectorCapability, cancelRecordingDirectorCapability, redubRecordingCapability } from '@/core/application-control/domains/screenRecording/directorCapability'
import { redubRecordingSentence } from './recordingRedubService'
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
import { WEB_APP_CAPABILITY_IDS, executeWebAppCapability, webAppRecordingRegistrations } from './webAppRecording'
import { WebRecordingCollectionExecutor } from './webAppRecordingCollectionExecutor'
import { WebReplayTakeCollectionExecutor, webReplayTakeRegistration } from './webReplayTake'
import { requestWebRecordingFocus } from './webAppRecordingFocus'
import { WebRecordingMutation } from './webAppRecordingMutation'
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
import { generateSessionScript, replaySession, recordingReplayBusy } from './recordingReplayService'
import { generateRecordingScriptCapability, replayRecordingCapability, rerecordRecordingCapability } from '@/core/application-control/domains/screenRecording/scriptCapability'

/** 没在约 45 秒内做完时的如实回执：工作照常在后台进行，去哪查。 */
const stillRunning = (what: string): string => `${what}仍在后台进行（长录要拼接声音、补齐分片或导入剪辑），不要重发。读 screen_recording.session 的 details：finishing 变回 false 后，details.error 有值就是失败（写着原因），没有就是做完了。`

export const screenRecordingApplicationDomain: ApplicationDomainModule = {
  id: 'screen_recording', entities: () => [...recordingRegistrations(), ...webAppRecordingRegistrations(), webReplayTakeRegistration(), recordingUnderstandingRegistration()],
  registerExecutors(engine) { engine.registerMutationExecutor(new RecordingUnderstandingMutation()); engine.registerCollectionExecutor(new WebRecordingCollectionExecutor()); engine.registerCollectionExecutor(new WebReplayTakeCollectionExecutor()); engine.registerMutationExecutor(new WebRecordingMutation()) },
  registerCapabilities(registrar) {
    registerDocumentOpener('screen_recording', async document => {
      // A recorded session lives on in its edit; only a planned director script still belongs to the recording page.
      if ((await readRecordingDocument(document.id)).sessionId) { await (await import('./recordingVideoImport')).openRecordingInEditor(document.id); return }
      await showRecordingDocument(document.id); openApplicationSurface('tool.screen_recording')
    })
    // 项目里的网页录制（.hjweb）在录制页的“网页应用”里看、重演、导出。
    registerDocumentOpener('web_recording', async document => { requestWebRecordingFocus(document.id); openApplicationSurface('tool.screen_recording') })
    registerDocumentBusyCheck('screen_recording', id => recordingDirectorBusy(id) ? '请先等待导演录制完成或取消' : recordingReplayBusy() ? '请先等待重放完成或取消' : recordingProductBusy(id) ? '请先等待产物导出完成或取消' : recordingPrivacyBusy(id) ? '请先等待敏感信息识别完成或取消' : recordingView().snapshot?.sessionId === id || recordingView().busy && recordingView().documentId === id ? '请先停止录制并等待保存' : null)
    registerDocumentCoverProvider('screen_recording', read => { const first = recordingDocumentSchema.parse(read.content).media.find(media => media.kind === 'screen' && media.durationUs > 0); return first ? [{ source: first.path, sourceKind: 'video', atSeconds: 0 }] : null })
    for (const definition of RECORDING_CAPABILITIES) registrar.registerHandler(definition.id, async (input, context) => {
      context.signal.throwIfAborted()
      if (WEB_APP_CAPABILITY_IDS.has(definition.id)) return executeWebAppCapability(definition.id, input, context)
      if (definition.id === redubRecordingCapability.id) {
        const parsed = redubRecordingCapability.inputSchema.parse(input)
        const [documentId, clipId, extra] = parsed.clipRef.id.split(':')
        if (!documentId || !clipId || extra) throw new Error('请选择有效的旁白片段引用。')
        const result = await redubRecordingSentence(parsed.sessionRef.id, { documentId, clipId, text: parsed.text, voice: parsed.voice, rerecord: parsed.rerecord }, context)
        return { resultRef: parsed.clipRef, verified: result.verified, undoSteps: result.undoSteps }
      }
      if ([planRecordingDirectorCapability.id, startRecordingDirectorCapability.id, cancelRecordingDirectorCapability.id].includes(definition.id)) {

        if (definition.id === planRecordingDirectorCapability.id) return { resultRef: { kind: 'screen_recording.session', id: await planRecordingDirector(planRecordingDirectorCapability.inputSchema.parse(input), context) }, verified: true }
        if (definition.id === cancelRecordingDirectorCapability.id) {
          const parsed = cancelRecordingDirectorCapability.inputSchema.parse(input)
          cancelRecordingDirector(parsed.sessionRef.id)
          return { resultRef: parsed.sessionRef, verified: true }
        }
        const parsed = startRecordingDirectorCapability.inputSchema.parse(input)
        const result = await startRecordingDirector(parsed.sessionRef.id, parsed.documentRef.id, context)
        return { resultRef: parsed.documentRef, sessionRef: { kind: 'screen_recording.session', id: result.sessionId }, sequenceRefs: result.sequenceIds.map(id => ({ kind: 'video_edit.sequence', id: `${parsed.documentRef.id}:${id}` })), verified: result.verified }
      }
      if ([generateRecordingScriptCapability.id, replayRecordingCapability.id, rerecordRecordingCapability.id].includes(definition.id)) {
        if (definition.id === generateRecordingScriptCapability.id) return generateSessionScript(generateRecordingScriptCapability.inputSchema.parse(input).sessionRef.id, context)
        if (recordingReplayBusy()) throw new Error('请等待当前重放结束。')
        if (definition.id === rerecordRecordingCapability.id) {
          const parsed = rerecordRecordingCapability.inputSchema.parse(input)
          return { resultRef: parsed.documentRef, ...await replaySession(parsed.sessionRef.id, { stepId: parsed.stepId, destinationId: parsed.documentRef.id, sourceId: parsed.sourceRef.id }, context) }
        }
        const parsed = replayRecordingCapability.inputSchema.parse(input)
        return { resultRef: { kind: 'screen_recording.understanding', id: parsed.sessionRef.id }, ...await replaySession(parsed.sessionRef.id, { stepId: parsed.stepId }, context) }
      }
      if (definition.id === 'understand_screen_recording') return executeRecordingUnderstanding(input, context)
      if (definition.id === 'export_screen_recording_product') {
        const parsed = recordingProductInputSchema.parse(input)
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
        if ((parsed.width === undefined) !== (parsed.height === undefined)) throw notExecutedFailure(new Error('width 与 height 要一起给；都省略时用录屏设置里保存的清晰度。'))
        // 省略的参数跟随用户在录屏设置里保存的值，与点录屏页“开始录制”得到的一样。
        const { setup } = loadRecordingSetup()
        const saved = recordingOutput(setup)
        const size = { width: parsed.width ?? saved.width, height: parsed.height ?? saved.height, fps: parsed.fps ?? setup.fps }
        const options = captureOptionsSchema.parse({ ...recordingEncoding({ ...setup, ...size }), sourceId: parsed.sourceRef.id, ...size, ...(parsed.region ? { region: parsed.region } : {}) })
        // 快速录制在界面上不录摄像头，省略 tracks 时与界面一致。
        let tracks = parsed.tracks ?? recordingTracksFromSetup(setup, setup.mode === 'quick')
        let note: string | undefined
        // 音频编辑录音独占麦克风，录屏再开麦克风会在开始时失败：写入前就处理，不靠提醒。
        if (tracks.microphone && (await getPlatform().audioCapture.recordingState()).recording) {
          if (parsed.tracks) throw notExecutedFailure(new Error('音频编辑正在录音，麦克风被它占着：tracks 里去掉 microphone，或先用 stop_audio_edit_recording 结束那边的录音。'))
          const { microphone: _microphone, ...rest } = tracks
          tracks = rest
          note = '音频编辑正在录音、占着麦克风，这次录屏没有开麦克风（录屏设置里是开着的）；倒计时后开始，可读取会话查看进度。'
        }
        const id = await startRecording(options, { name: parsed.name, tracks, ...(parsed.projectId ? { projectId: parsed.projectId } : {}) }, parsed.destination, context.signal)
        return { resultRef: { kind: 'screen_recording.session', id }, verified: (await readRecordingDocument(id)).sessionId === id, ...(note ? { message: note } : {}) }
      }
      if (definition.id === 'read_screen_recording_events') {
        const parsed = parseCapabilityInput<{ sessionRef: z.infer<typeof recordingRefSchema>; offset: number; limit: number; markersOnly: boolean }>(definition.id, input)
        return recordingEvents(parsed.sessionRef.id, parsed.offset, parsed.limit, parsed.markersOnly)
      }
      if (definition.id === 'import_screen_recording') {
        const parsed = parseCapabilityInput<{ sessionRef: z.infer<typeof recordingRefSchema>; destination: z.infer<typeof recordingDestinationSchema> }>(definition.id, input)
        const work = trackRecordingWork(parsed.sessionRef.id, importRecordingToVideo(parsed.sessionRef.id, parsed.destination, context.signal))
        const resultRef = { kind: 'video_edit.document', id: parsed.destination.documentId }
        if (!await waitWithin(work, CAPABILITY_SHORT_WAIT_MS)) return { resultRef, itemIds: [], verified: false, finishing: true, message: stillRunning('导入') }
        const itemIds = await work
        return { resultRef, itemIds, verified: itemIds.length > 0 }
      }
      const parsed = parseCapabilityInput<{ sessionRef: z.infer<typeof recordingRefSchema>; note?: string }>(definition.id, input)
      const action = definition.id.replace('_screen_recording', '') as 'pause' | 'resume' | 'mark' | 'stop' | 'cancel' | 'recover'
      if (action === 'recover' || action === 'stop') {
        // 长录的收尾、恢复可能比客户端的工具超时还久：短等，没做完就如实说仍在进行，不当成失败。
        const work = trackRecordingWork(parsed.sessionRef.id, action === 'recover' ? recoverRecording(parsed.sessionRef.id) : controlRecording(parsed.sessionRef.id, 'stop'))
        if (!await waitWithin(work, CAPABILITY_SHORT_WAIT_MS)) return { resultRef: parsed.sessionRef, verified: false, finishing: true, message: stillRunning(action === 'stop' ? '已停止采集，收尾' : '恢复') }
      } else await controlRecording(parsed.sessionRef.id, action, parsed.note)
      await readRecordingDocument(parsed.sessionRef.id)
      return { resultRef: parsed.sessionRef, verified: true }
    })
  },
}

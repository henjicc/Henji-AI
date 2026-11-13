import { recordingEncoding } from '@/core/screenRecording/encoding'
import { loadRecordingSetup, recordingOutput, recordingTracksFromSetup } from '../recordingSetupModel'
import { notExecutedFailure } from '@/core/application-control/execution/writeExecution'
import { getPlatform } from '@/platform'
import { CAPABILITY_SHORT_WAIT_MS, waitWithin } from '@/core/application-control/execution/waitWithin'
import { trackRecordingWork } from './recordingWork'
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
import { controlRecording, readRecordingDocument, recordingEvents, recordingStopOutcome,recordingView, recoverRecording, showRecordingDocument, startRecording } from './recordingService'
import { importRecordingToVideo, recordingPlacementText } from './recordingVideoImport'
import { videoEditRecordingTarget } from '@/core/videoEdit/recordingLane'
import { videoEditComposition } from '@/core/videoEdit/document'
import type { RecordingDestination } from './recordingService'
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
/**
 * 助手读回或创建得到的序列引用是“文档:序列”，界面传的是裸序列 id，两种都认。目标在任何写入之前核对：
 * 不对就作为参数错误拒绝（没有执行），并列出这份剪辑里能用的序列。
 */
async function resolveRecordingDestination(destination: RecordingDestination & { seconds?: number }, options: { inProject?: boolean } = {}): Promise<RecordingDestination> {
  const prefix = `${destination.documentId}:`
  const sequenceId = destination.sequenceId?.startsWith(prefix) ? destination.sequenceId.slice(prefix.length) : destination.sequenceId
  let owner: Awaited<ReturnType<typeof openVideoEditDocument>>
  try { owner = await openVideoEditDocument({ id: destination.documentId }, { focus: false }) }
  catch (error) { throw notExecutedFailure(new Error(`destination.documentId 打不开（${error instanceof Error ? error.message : String(error)}）：要写剪辑文档 id，取自 list_documents（kind=video_edit）或 create_document 的返回。`)) }
  if (options.inProject && owner.session.documentMeta.container.kind !== 'project') throw notExecutedFailure(new Error('目标剪辑必须位于项目中：换一份项目里的剪辑，或省略 destination 只录制。'))
  if (sequenceId && !owner.document.sequences.some(sequence => sequence.id === sequenceId)) {
    const available = owner.document.sequences.map(sequence => `${prefix}${sequence.id}（${sequence.name}）`).join('、')
    throw notExecutedFailure(new Error(`destination.sequenceId「${destination.sequenceId}」不是这份剪辑里的序列。可用：${available || '没有序列，先新建序列'}；写完整序列引用或只写冒号后的序列 id 都可以，省略 sequenceId 只导入素材库。`))
  }
  const { seconds, ...rest } = destination
  if (seconds !== undefined && destination.frame !== undefined) throw notExecutedFailure(new Error('destination 的 seconds 与 frame 只写一个：seconds 是作品时间的秒，frame 是序列帧。'))
  const sequence = sequenceId ? owner.document.sequences.find(value => value.id === sequenceId) : undefined
  const frame = seconds !== undefined && sequence ? Math.round(seconds * sequence.frameRate.numerator / sequence.frameRate.denominator) : destination.frame
  if (!destination.placement) return { ...rest, ...(sequenceId ? { sequenceId } : {}), ...(frame !== undefined ? { frame } : {}) }
  if (!sequence) throw notExecutedFailure(new Error('destination.placement 要和 sequenceId 一起给：写明放进哪条序列的录屏轨。'))
  // 覆盖必须写明从哪里盖起：没打开或刚打开的剪辑指针在 0，省略就会从头盖起。
  if (destination.placement === 'overwrite' && frame === undefined) throw notExecutedFailure(new Error('placement=overwrite 要写明从哪里盖起：seconds（作品时间的秒）或 frame（序列帧）。只想接在后面就写 placement=end。'))
  let target: ReturnType<typeof videoEditRecordingTarget>
  try { target = videoEditRecordingTarget(videoEditComposition(owner.document, sequence.id), destination.placement === 'end' ? { at: 'end' } : { at: 'frame', frame: frame! }) }
  catch (error) { throw notExecutedFailure(error instanceof Error ? error : new Error(String(error))) }
  return { documentId: destination.documentId, sequenceId: sequence.id, frame: target.frame, placement: destination.placement, basis: target.basis }
}
/**
 * 停止回执说清录好的素材去了哪：导入了哪份剪辑的哪些素材项、放没放进序列，或按录屏页的快速录制存成了视频文件。
 * 已经进了剪辑或存成文件时不能提示再导入，否则会多出一份重复素材。
 */
async function stopImportReceipt(sessionId: string): Promise<{ message: string; imported?: Record<string, unknown> }> {
  const outcome = recordingStopOutcome(sessionId)
  if (!outcome) return { message: '已停止并保存。开始时没有指定剪辑目标（或没录到画面），没有导入剪辑；需要时用 import_screen_recording。' }
  if (outcome.kind === 'file') return { message: outcome.path ? `已停止并按录屏页的快速录制存成视频文件：${outcome.path}；没有导入剪辑。` : outcome.error ? `已停止并保存会话，但存成视频文件失败：${outcome.error}。会话原片还在，可用 import_screen_recording 导入剪辑。` : '已停止，正按录屏页的快速录制在后台存成视频文件（存好后应用里会提示文件位置）；没有导入剪辑，不要再导入。' }
  // 停止与导入都已成功；读名称只为回执好读，剪辑这时打不开就用 id 写，不把成功的停止报成失败。
  const owner = await openVideoEditDocument({ id: outcome.documentId }, { focus: false }).catch(() => undefined)
  const itemIds = outcome.itemIds ?? []
  const names = itemIds.map(id => owner?.document.items.find(item => item.id === id)?.name ?? id)
  const sequenceName = outcome.sequenceId ? owner?.document.sequences.find(value => value.id === outcome.sequenceId)?.name ?? `${outcome.documentId}:${outcome.sequenceId}` : undefined
  const placed = `${outcome.placement && sequenceName ? recordingPlacementText(outcome.placement, sequenceName) : sequenceName ? `已放进序列「${sequenceName}」第 ${outcome.frame ?? 0} 帧起，${outcome.combined ? combinedPlacement(outcome.screens ?? 1) : '暂停前后各段分别链接。'}` : '没给 sequenceId，只进了素材库。'}${outcome.separate ? `${outcome.separate}。` : ''}`
  return {
    message: outcome.itemIds ? `已停止并保存，导入剪辑素材库 ${names.length} 项：${names.join('、')}；${placed}不要再导入。` : `已停止并保存，按录屏页的设置回到上次送进的剪辑${sequenceName ? `（序列「${sequenceName}」）` : ''}，素材已在里面，不要再导入。`,
    imported: { documentRef: { kind: 'video_edit.document', id: outcome.documentId }, ...(outcome.sequenceId ? { sequenceRef: { kind: 'video_edit.sequence', id: `${outcome.documentId}:${outcome.sequenceId}` } } : {}),
      itemRefs: itemIds.map(id => ({ kind: 'video_edit.item', id: `${outcome.documentId}:${id}` })) },
  }
}
/** 合并后通常一个画面素材；编码器中途重启留下真实空档时分成几组，如实说几个。 */
const combinedPlacement = (screens: number): string => screens > 1 ? `暂停不占时间线；画面因编码中途重启分成 ${screens} 个素材，各自与同段声音链接成组。` : '暂停不占时间线，画面与声音链接成一组。'
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
        const tracks = parsed.tracks ?? recordingTracksFromSetup(setup, setup.mode === 'quick')
        const destination = parsed.destination ? await resolveRecordingDestination(parsed.destination, { inProject: true }) : undefined
        // 音频编辑正在录音时麦克风轨接到同一路采集上，两边互不打断，但设备、采样率与声道沿用音频编辑那边的。
        const joined = Boolean(tracks.microphone) && Boolean((await getPlatform().audioCapture.recordingState()).recording)
        const id = await startRecording(options, { name: parsed.name, tracks, ...(parsed.projectId ? { projectId: parsed.projectId } : {}) }, destination, context.signal)
        return { resultRef: { kind: 'screen_recording.session', id }, verified: (await readRecordingDocument(id)).sessionId === id,
          ...(joined ? { message: '音频编辑正在录音：录屏的麦克风接到它正在用的设备上（采样率与声道也沿用它的），两边互不打断；倒计时后开始，实际设备读会话 details.capture.microphone.device。' } : {}) }
      }
      if (definition.id === 'read_screen_recording_events') {
        const parsed = parseCapabilityInput<{ sessionRef: z.infer<typeof recordingRefSchema>; offset: number; limit: number; markersOnly: boolean }>(definition.id, input)
        return recordingEvents(parsed.sessionRef.id, parsed.offset, parsed.limit, parsed.markersOnly)
      }
      if (definition.id === 'import_screen_recording') {
        const parsed = parseCapabilityInput<{ sessionRef: z.infer<typeof recordingRefSchema>; destination: z.infer<typeof recordingDestinationSchema> }>(definition.id, input)
        const destination = await resolveRecordingDestination(parsed.destination)
        const work = trackRecordingWork(parsed.sessionRef.id, importRecordingToVideo(parsed.sessionRef.id, destination, context.signal))
        const resultRef = { kind: 'video_edit.document', id: parsed.destination.documentId }
        if (!await waitWithin(work, CAPABILITY_SHORT_WAIT_MS)) return { resultRef, itemIds: [], verified: false, finishing: true, message: stillRunning('导入') }
        const { itemIds, combined, screens, separate, placement } = await work
        const sequenceName = destination.sequenceId ? (await openVideoEditDocument({ id: destination.documentId }, { focus: false }).catch(() => undefined))?.document.sequences.find(value => value.id === destination.sequenceId)?.name ?? destination.sequenceId : ''
        return { resultRef, itemIds, verified: itemIds.length > 0, message: `已导入 ${itemIds.length} 项录制素材${placement ? `：${recordingPlacementText(placement, sequenceName)}` : combined ? `：${combinedPlacement(screens)}` : '。'}${separate ? `${separate}。` : ''}` }
      }
      const parsed = parseCapabilityInput<{ sessionRef: z.infer<typeof recordingRefSchema>; note?: string }>(definition.id, input)
      const action = definition.id.replace('_screen_recording', '') as 'pause' | 'resume' | 'mark' | 'stop' | 'cancel' | 'recover'
      if (action === 'recover' || action === 'stop') {
        // 长录的收尾、恢复可能比客户端的工具超时还久：短等，没做完就如实说仍在进行，不当成失败。
        const work = trackRecordingWork(parsed.sessionRef.id, action === 'recover' ? recoverRecording(parsed.sessionRef.id) : controlRecording(parsed.sessionRef.id, 'stop'))
        if (!await waitWithin(work, CAPABILITY_SHORT_WAIT_MS)) return { resultRef: parsed.sessionRef, verified: false, finishing: true, message: stillRunning(action === 'stop' ? '已停止采集，收尾' : '恢复') }
      } else await controlRecording(parsed.sessionRef.id, action, parsed.note)
      await readRecordingDocument(parsed.sessionRef.id)
      if (action === 'stop') return { resultRef: parsed.sessionRef, verified: true, ...await stopImportReceipt(parsed.sessionRef.id) }
      return { resultRef: parsed.sessionRef, verified: true }
    })
  },
}

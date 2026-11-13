import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { assertAudioEditSplicePosition, audioEditOutputSeconds, audioEditPlacementFrames, type AudioEditPlacementInput } from '@/core/audioEdit/splice'
import type { AudioCaptureFile } from '@/core/audioCapture/contracts'
import type { AudioEditRecordingOutput } from '@/core/application-control/domains/audioEdit/audioEditRecordingCapabilities'
import { AUDIO_CAPTURE_TARGET } from '@/core/application-control/domains/audioEdit/audioEditRecordingCapabilities'
import { notExecutedFailure, type ApplicationWriteExecution } from '@/core/application-control/execution/writeExecution'
import { CAPABILITY_SHORT_WAIT_MS, waitWithin } from '@/core/application-control/execution/waitWithin'
import { audioEditResumeFrame, createAudioEditDraft, getAudioEditProjectInstance, loadAudioEditProject, prepareAudioEditTake, recordAudioEditStep } from '@/features/audioEdit'
import { getDocumentOperations } from '@/features/documents'
import { getAudioCaptureSession, noteAudioEditTake, readAudioCaptureMain, readAudioCaptureRecording, type AudioCaptureRecordingFacts } from './captureApplicationService'

/*
 * 助手控制音频编辑录音。会话、拼接、保存都走录音按钮用的同一个 CaptureSession 与 prepareAudioEditTake，
 * 这里只补助手需要的几件事：写入前就能说清的拒绝、录到哪的意图换算成采样帧、把拼回登记成一步撤销、
 * 等不及时如实说“仍在进行”。读回与写入前检查只走主进程不排队的 recordingState，不被正在进行的录音操作拖住。
 */

interface Context { execution?: ApplicationWriteExecution }
/** 写入前的拒绝：没有改动任何东西，调用方修正后可以直接重试。 */
const refuse = (message: string): never => { throw notExecutedFailure(new Error(message)) }
const preflight = <T>(context: Context, work: () => Promise<T>): Promise<T> => context.execution ? context.execution.preflight(work) : work()
const describe = (error: unknown): string => error instanceof Error ? error.message : String(error)

/**
 * 每份口播最近一次开始录音时的内容：录音被别处停下（界面按钮、标题栏、覆盖到头自动停）后，
 * 停止能力仍能把那次拼回登记成一步撤销。录音期间作品被锁着，这份内容就是拼回前的作品。
 */
const takeStarts = new Map<string, AudioEditProjectDocument>()

/** 每份口播刚拼回那一段的末尾（拼回后的坐标）：没在音频编辑里显示这份口播时，继续录音默认接在这里。 */
const takeEnds = new Map<string, number>()
/** 等不及返回、还在后台拼回的操作数：这期间会话可能已经空闲，但上一段的结果还没出来。 */
let background = 0
const BUSY = '界面或后台正在处理上一个录音操作，等它完成后读 audio_capture.settings.recording 再决定。'
const busy = (): boolean => getAudioCaptureSession().store.getState().busy || background > 0
/** 写入前检查的第一条：正在处理时一律请调用方等待，不让后面的检查把它引去恢复或新录。 */
const refuseWhileBusy = (): void => { if (busy()) refuse(BUSY) }

/**
 * 会话同一时间只做一件事，正在做时再调用会直接拿到那件事的结果（CaptureSession.run）。
 * 助手只调自己发起的：界面或后台正在处理时如实拒绝（未执行），不把别人那次的结果说成自己的。
 * 检查与调用之间不能有 await；拒绝原样抛出，不要再包装，否则“未执行”标记会丢。
 */
function own<T>(operation: () => Promise<T>): Promise<T> {
  refuseWhileBusy()
  return operation()
}

interface TakeResult { undoRef?: string; saved: boolean; pending: boolean }
/**
 * 把录音拼回作品（暂停、停止、恢复）：开始时登记“这一段在拼回”（清掉上一段的结果），做完登记成败与撤销引用。
 * 能力等不及返回时，调用方之后从读回的 lastTake 看这一段的结果，不会拿到上一段的引用。
 */
function commitTake(documentId: string, outputPath: string | null, before: AudioEditProjectDocument | undefined, operation: () => Promise<void>, explain: (error: unknown) => string): Promise<TakeResult> {
  const started = own(operation)
  noteAudioEditTake({ documentId, outputPath, state: 'saving' })
  background++
  return (async () => {
    try { await started } catch (error) {
      const message = explain(error)
      noteAudioEditTake({ documentId, outputPath, state: 'failed', error: message })
      throw new Error(message, { cause: error })
    }
    const take = await settleTake(documentId, before, outputPath)
    const ok = take.saved && !take.pending
    noteAudioEditTake({ documentId, outputPath, state: ok ? 'saved' : 'failed', ...(take.undoRef ? { undoRef: take.undoRef } : {}), ...(ok ? {} : { error: '没能确认这一段已拼回并保存，读 pending_files 核对，文件还在就用 recover_audio_edit_recording 拼回。' }) })
    return take
  })().finally(() => { background-- })
}

async function outcome(documentId: string, message: string, verified: boolean, extra: { undoRef?: string; finishing?: boolean } = {}): Promise<AudioEditRecordingOutput> {
  const facts = await readAudioCaptureRecording()
  const instance = getAudioEditProjectInstance(documentId)
  return { resultRef: { kind: 'audio_edit.document', id: documentId }, message, verified, recording: { phase: facts.phase, durationSeconds: facts.durationSeconds, positionSeconds: facts.positionSeconds },
    ...(instance ? { durationFrames: instance.document.source.durationFrames } : {}), ...(extra.undoRef ? { undoRef: extra.undoRef } : {}), ...(extra.finishing ? { finishing: true } : {}) }
}
const STILL_RUNNING = '仍在后台拼回并保存（长录音要处理一阵），不要重发。读 audio_capture.settings.recording：busy 变回 false 后看 lastTake（outputPath 就是这一段）——state=saved 已拼回并保存，undoRef 交给 undo_audio_edit；state=failed 没拼回，error 是原因，用 recover_audio_edit_recording 拼回。'

/** 拼回作品之后：登记撤销，按真实结果给回执。 */
async function settleTake(documentId: string, before: AudioEditProjectDocument | undefined, outputPath: string | null): Promise<TakeResult> {
  const undoRef = before ? recordAudioEditStep(documentId, before) : undefined
  const main = await readAudioCaptureMain()
  const instance = getAudioEditProjectInstance(documentId)
  return { ...(undoRef ? { undoRef } : {}), saved: Boolean(instance && !instance.dirty), pending: Boolean(outputPath && main.pending.some(file => file.outputPath === outputPath)) }
}

function assertCanBegin(facts: AudioCaptureRecordingFacts): void {
  refuseWhileBusy()
  if (facts.phase === 'recording' || facts.outputPath && facts.phase !== 'interrupted') refuse(`已经在录音${facts.documentId ? `（口播 ${facts.documentId}）` : ''}，已录 ${facts.durationSeconds.toFixed(1)} 秒；要换位置先 stop_audio_edit_recording。`)
  if (facts.phase === 'interrupted' || getAudioCaptureSession().store.getState().outputPath) refuse('上一段录音中断后还没处理：先用 recover_audio_edit_recording 拼回或移到回收区，再开始新的录音。')
  if (facts.microphoneInUse) refuse('讲解正在用麦克风，音频编辑不能同时录音：等讲解结束再录。录屏的麦克风不影响音频编辑录音。')
}

/**
 * 录到哪：秒数按剪后作品时间、采样帧按原素材时间（与插入音频同一个换算），换成原素材帧，
 * 并按拼接时同一条位置规则（不越界、不落在锁定词块里）在写入前检查。fallback 是省略位置时的原素材帧。
 */
function takeRange(document: AudioEditProjectDocument, placement: AudioEditPlacementInput, fallback: number): [number, number] {
  try {
    const [start, end] = audioEditPlacementFrames(document, placement, fallback)
    assertAudioEditSplicePosition(document, start, end)
    return [start, end]
  } catch (error) { return refuse(describe(error)) }
}
/** 原素材帧在剪后作品里的秒数，回执与读回都用这一坐标。 */
const outputSeconds = (documentId: string, frame: number): string => {
  const document = getAudioEditProjectInstance(documentId)?.document
  return (document ? audioEditOutputSeconds(document, frame) : 0).toFixed(2)
}

async function begin(documentId: string, startFrame: number, endFrame: number): Promise<void> {
  const placement = await prepareAudioEditTake(documentId, startFrame, endFrame)
  takeStarts.set(documentId, getAudioEditProjectInstance(documentId)!.document)
  await own(() => getAudioCaptureSession().start(placement))
}

export async function startAudioEditRecording(input: { documentRef?: { id: string }; projectId?: string } & AudioEditPlacementInput, context: Context): Promise<AudioEditRecordingOutput> {
  let documentId = input.documentRef?.id
  const range = await preflight(context, async () => {
    refuseWhileBusy()
    if (documentId && input.projectId) refuse('projectId 只用于新建录音口播；录进已有口播时只给 documentRef。')
    assertCanBegin(await readAudioCaptureRecording())
    if (!documentId) {
      if (input.positionSeconds || input.replaceUntilSeconds || input.positionSourceFrame || input.replaceUntilSourceFrame) refuse('新建的录音口播从 0 秒开始；positionSeconds、replaceUntilSeconds、positionSourceFrame、replaceUntilSourceFrame 只用于录进已有口播。')
      return null
    }
    const instance = await loadAudioEditProject(documentId)
    if (instance.busy) refuse('这份口播正在处理，等处理完成后再录音。')
    return takeRange(instance.document, input, instance.document.source.durationFrames)
  })
  if (!documentId) {
    // 与音频编辑里“录音”新建作品同一个入口；不打开页面。
    const draft = await createAudioEditDraft(null, input.projectId ? { kind: 'project', projectId: input.projectId } : { kind: 'user' })
    documentId = draft.document.id
    context.execution?.report({ targetMutation: 'applied' })
    try { await begin(documentId, 0, 0) } catch (error) { throw new Error(await abandonDraft(documentId, error), { cause: error }) }
  } else await begin(documentId, range![0], range![1])
  const facts = await readAudioCaptureRecording()
  const [start, end] = range ?? [0, 0]
  const name = getAudioEditProjectInstance(documentId)!.session.documentMeta.name
  const outputPath = facts.outputPath ?? getAudioCaptureSession().store.getState().outputPath
  const result = await outcome(documentId, `已开始录音，录进口播「${name}」（${documentId}）剪后作品的 ${outputSeconds(documentId, start)} 秒处${end > start ? '（覆盖到指定位置）' : ''}${outputPath ? `，录音文件写在 ${outputPath}` : ''}。读 audio_capture.settings.recording 看进度。`, facts.phase === 'recording' && facts.documentId === documentId)
  return { ...result, documentName: name, ...(outputPath ? { outputPath } : {}) }
}

/** 为这次录音新建的口播没能开始录音：空口播与预建的录音文件都移到回收区，不留给下一次开始当成“未处理的录音”。 */
async function abandonDraft(documentId: string, error: unknown): Promise<string> {
  const session = getAudioCaptureSession()
  const leftovers: string[] = []
  const path = session.store.getState().outputPath
  if (path && session.store.getState().placement?.projectId === documentId) await session.discard(path).catch(() => leftovers.push(`录音文件 ${path}`))
  await getDocumentOperations().trashDocument({ id: documentId }).catch(() => leftovers.push(`口播 ${documentId}`))
  return `录音没能开始：${describe(error)}。${leftovers.length ? `为它新建的${leftovers.join('、')}没能移到回收区，请读 audio_capture.settings.pending_files 与 list_documents 核对。` : '为它新建的空口播和预建的录音文件已移到回收区。'}`
}

export async function pauseAudioEditRecording(context: Context): Promise<AudioEditRecordingOutput> {
  const session = getAudioCaptureSession()
  const placement = await preflight(context, async () => {
    refuseWhileBusy()
    await session.attach()
    refuseWhileBusy()
    const state = session.store.getState()
    if (state.phase === 'interrupted' || (await readAudioCaptureRecording()).phase === 'interrupted') refuse('录音已经中断：用 recover_audio_edit_recording 拼回已录部分。')
    if (state.phase !== 'recording' || !state.placement) refuse(state.phase === 'paused' ? '录音已经暂停；继续用 resume_audio_edit_recording。' : '现在没有在录音。')
    return state.placement!
  })
  const documentId = placement.projectId
  const before = takeStarts.get(documentId) ?? getAudioEditProjectInstance(documentId)?.document
  const outputPath = session.store.getState().outputPath
  const work = commitTake(documentId, outputPath, before, () => session.togglePause(), error => `暂停时没能把这一段拼回口播：${describe(error)}。录音文件保留在 ${outputPath}，用 recover_audio_edit_recording 拼回。`).then(take => {
    // 这一段的撤销交出去之后，之后的停止不再为它发第二个引用；继续录音默认接在它真实的末尾（拼回后的坐标）。
    takeStarts.delete(documentId)
    const after = getAudioEditProjectInstance(documentId)?.document
    if (before && after) takeEnds.set(documentId, placement.startFrame + after.source.durationFrames - before.source.durationFrames + placement.endFrame - placement.startFrame)
    return take
  })
  if (!await waitWithin(work, CAPABILITY_SHORT_WAIT_MS)) return outcome(documentId, STILL_RUNNING, false, { finishing: true })
  const take = await work
  const ok = take.saved && !take.pending && session.store.getState().phase === 'paused'
  return outcome(documentId, ok ? `已暂停：这一段已拼进口播并保存${take.undoRef ? '，可用 undoRef 撤销' : ''}。resume_audio_edit_recording 继续录。` : '已暂停，但没能确认这一段已拼回并保存：读 audio_capture.settings.recording 与 pending_files 核对。', ok, take)
}

export async function resumeAudioEditRecording(input: Pick<AudioEditPlacementInput, 'positionSeconds' | 'positionSourceFrame'>, context: Context): Promise<AudioEditRecordingOutput> {
  const session = getAudioCaptureSession()
  const { documentId, frame } = await preflight(context, async () => {
    refuseWhileBusy()
    const state = session.store.getState()
    if (state.phase !== 'paused' || !state.placement) refuse(state.phase === 'recording' ? '已经在录音。' : '没有暂停中的录音；要新录一段用 start_audio_edit_recording。')
    assertCanBegin({ ...await readAudioCaptureRecording(), phase: 'paused' })
    const instance = await loadAudioEditProject(state.placement!.projectId)
    if (instance.busy) refuse('这份口播正在处理，等处理完成后再继续录音。')
    // 默认：音频编辑正显示这份口播时与界面“继续录音”同一处（当前播放头，试听中先停）；没显示时接在刚拼回那一段的末尾。
    const id = state.placement!.projectId, total = instance.document.source.durationFrames
    const takeEnd = takeEnds.get(id) ?? state.placement!.startFrame + Math.round(session.durationSeconds * instance.document.source.sampleRate)
    const given = input.positionSeconds !== undefined || input.positionSourceFrame !== undefined
    const [start] = takeRange(instance.document, { positionSeconds: input.positionSeconds, positionSourceFrame: input.positionSourceFrame }, given ? total : audioEditResumeFrame(id, total, takeEnd))
    return { documentId: state.placement!.projectId, frame: start }
  })
  await begin(documentId, frame, frame)
  const facts = await readAudioCaptureRecording()
  return outcome(documentId, `已从口播剪后作品的 ${outputSeconds(documentId, frame)} 秒处继续录音。`, facts.phase === 'recording' && facts.documentId === documentId)
}

export async function stopAudioEditRecording(context: Context): Promise<AudioEditRecordingOutput> {
  const session = getAudioCaptureSession()
  const plan = await preflight(context, async () => {
    refuseWhileBusy()
    // 界面重载后还没接管的录音先接上，停止才能照常拼回原位置。
    await session.attach()
    refuseWhileBusy()
    const state = session.store.getState()
    const facts = await readAudioCaptureRecording()
    if (state.phase === 'interrupted' || facts.phase === 'interrupted') refuse(`录音已经中断${facts.error ? `（${facts.error}）` : ''}：用 recover_audio_edit_recording 拼回已录部分。`)
    if (facts.phase === 'recording' && !facts.attached) refuse('主进程里有一段录音，但界面还没能接上它，停止后拼不回原位置：稍后再试，或请用户点标题栏的录音指示停止。')
    if (state.phase === 'stopped' && state.outputPath) refuse(`上次停止后这一段没能拼回口播，录音文件在 ${state.outputPath}：用 recover_audio_edit_recording 拼回。`)
    const id = state.placement?.projectId ?? [...takeStarts.keys()].at(-1)
    if (!id || state.phase === 'idle' && !takeStarts.has(id)) refuse('现在没有在录音，也没有本次运行里开始过、还没交代结果的录音。')
    const live = session.active || state.phase === 'paused'
    return { documentId: id!, before: session.active ? getAudioEditProjectInstance(id!)?.document : takeStarts.get(id!), live, outputPath: state.outputPath, wasActive: session.active, wasPaused: state.phase === 'paused' }
  })
  // 暂停中结束：那一段在暂停时已经拼回、结果已登记，这里只结束会话，不覆盖它的 lastTake。
  const work = (plan.wasPaused ? own(() => session.stop()).then((): TakeResult => ({ saved: true, pending: false })) : commitTake(plan.documentId, plan.outputPath, plan.before, () => plan.live ? session.stop() : Promise.resolve(), error => {
    const path = session.store.getState().outputPath ?? plan.outputPath
    return `录音已停止，但没能拼回口播：${describe(error)}。${path ? `录音文件保留在 ${path}，` : ''}用 recover_audio_edit_recording 拼回。`
  })).then(take => { takeStarts.delete(plan.documentId); takeEnds.delete(plan.documentId); return take })
  if (!await waitWithin(work, CAPABILITY_SHORT_WAIT_MS)) return outcome(plan.documentId, STILL_RUNNING, false, { finishing: true })
  const take = await work
  const facts = await readAudioCaptureRecording()
  const instance = getAudioEditProjectInstance(plan.documentId)
  const seconds = instance ? (instance.document.source.durationFrames / instance.document.source.sampleRate).toFixed(2) : '?'
  const ok = take.saved && !take.pending && facts.phase === 'idle'
  const message = !ok ? '录音已停止，但没能确认这一段已拼回并保存：读 audio_capture.settings.recording 与 pending_files 核对，文件还在就用 recover_audio_edit_recording 拼回。'
    : plan.wasPaused ? `已结束暂停中的录音；暂停时那一段已经拼回（撤销引用在暂停的回执或 audio_capture.settings.recording 的 lastTake），作品现长 ${seconds} 秒。`
    : plan.wasActive ? `已停止录音，这一段已拼回口播并保存，作品现长 ${seconds} 秒${take.undoRef ? '；undoRef 交给 undo_audio_edit 可撤掉这次拼接' : ''}。`
      : take.undoRef ? `录音此前已经停止并拼回口播（作品现长 ${seconds} 秒）；undoRef 交给 undo_audio_edit 可撤掉那次拼接。`
        : `录音此前已经停止；作品现长 ${seconds} 秒。没能确认那次拼回是最近一步（之后可能又改过或已撤销），这次不给撤销引用。`
  return outcome(plan.documentId, message, ok, take)
}

export async function recoverAudioEditRecording(input: { outputPath?: string; action: 'restore' | 'discard' }, context: Context): Promise<AudioEditRecordingOutput> {
  const session = getAudioCaptureSession()
  const plan = await preflight(context, async (): Promise<{ file: AudioCaptureFile; before?: AudioEditProjectDocument }> => {
    refuseWhileBusy()
    const main = await readAudioCaptureMain()
    const facts = await readAudioCaptureRecording(main)
    const candidates = main.pending.filter(file => file.outputPath !== main.recording?.outputPath)
    const outputPath = input.outputPath ?? (facts.phase === 'interrupted' ? facts.outputPath : null) ?? (candidates.length === 1 ? candidates[0].outputPath : null)
    if (!outputPath) refuse(candidates.length ? `有 ${candidates.length} 个待恢复的录音，请用 outputPath 指定（读 audio_capture.settings.pending_files）。` : '没有待恢复的录音文件。')
    const file = candidates.find(item => item.outputPath === outputPath)
    if (!file) refuse(main.recording?.outputPath === outputPath ? '这段录音还在进行，先 stop_audio_edit_recording。' : `找不到这个待恢复的录音文件（可能已经恢复或移走）；现在可用的：${candidates.map(item => item.outputPath).join('、') || '无'}。`)
    if (session.active) refuse('正在录音，先 stop_audio_edit_recording。')
    if (input.action === 'discard') return { file: file! }
    const placement = file!.placement
    if (!placement) refuse('这段录音没有记下原作品位置，不能拼回：请用户在音频编辑的恢复横幅里另存为新草稿，或用 action=discard 移到回收区。')
    const instance = await loadAudioEditProject(placement!.projectId)
    const spliced = instance.document.source.sourcePath.replaceAll('\\', '/').endsWith(`/${placement!.spliceId}.wav`)
    if (!spliced && instance.persistedRevision !== placement!.revision) refuse('原作品在这段录音之后又被改过，拼回会覆盖那些修改：请用户在音频编辑的恢复横幅里另存为新草稿。')
    if (instance.busy) refuse('原作品正在处理，等处理完成后再恢复。')
    return { file: file!, before: instance.document }
  })
  if (input.action === 'discard') {
    await own(() => session.discard(plan.file.outputPath))
    const gone = !(await readAudioCaptureMain()).pending.some(item => item.outputPath === plan.file.outputPath)
    const facts = await readAudioCaptureRecording()
    const ref = plan.file.placement ? { kind: 'audio_edit.document' as const, id: plan.file.placement.projectId } : AUDIO_CAPTURE_TARGET
    return { resultRef: ref, message: gone ? '录音文件已移到回收区，可以从回收区找回。' : '录音文件没能移到回收区，请读 audio_capture.settings.pending_files 核对。', verified: gone, recording: { phase: facts.phase, durationSeconds: facts.durationSeconds, positionSeconds: facts.positionSeconds } }
  }
  const documentId = plan.file.placement!.projectId
  const local = session.store.getState()
  const work = commitTake(documentId, plan.file.outputPath, plan.before, () => local.phase === 'interrupted' && local.outputPath === plan.file.outputPath && local.placement ? session.recoverTake() : session.restore(plan.file),
    error => `没能把这段录音拼回口播：${describe(error)}。文件 ${plan.file.outputPath} 还在，可以再试一次，或请用户在音频编辑的恢复横幅里另存为新草稿。`)
  if (!await waitWithin(work, CAPABILITY_SHORT_WAIT_MS)) return outcome(documentId, STILL_RUNNING, false, { finishing: true })
  const take = await work
  // 崩溃发生在保存之后、清登记之前时，作品里已经是这段录音，恢复只清登记：内容不变也算恢复成功。
  const ok = take.saved && !take.pending
  return outcome(documentId, ok ? `已把中断的录音拼回口播原位置并保存${take.undoRef ? '，可用 undoRef 撤销' : ''}。` : `没能确认已拼回并保存：读 audio_capture.settings.pending_files 核对，文件 ${plan.file.outputPath} 还在就再试一次。`, ok, take)
}

// @vitest-environment jsdom
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { queryVideoEditSubtitleCorrectionCapability } from '@/core/application-control/domains/videoEdit/videoEditSubtitleCorrectionCapabilities'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { bindVideoEditCaptionSpeech } from '@/core/videoEdit/captionSpeech'
import { getPlatform } from '@/platform/runtime'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession } from '@/features/application-control/applicationCapabilityService'
import { closeAllVideoEdits, createVideoEditTestProject, reopenVideoEdit, failVideoEditSaves } from './videoEditDocumentTestKit'
import { editVideoProject } from './videoEditService'
import { queryVideoEditSubtitleCorrection, applyVideoEditSubtitleCorrection } from './videoEditSubtitleCorrection'

const parse = queryVideoEditSubtitleCorrectionCapability.outputSchema.parse
const identity = { contentIdentity: 'voice-content', sizeBytes: 100, fileModifiedAt: 10 }
const context = () => ({ signal: new AbortController().signal })
beforeEach(() => { installHarnessNativeStorage(); vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue(identity) })
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function fixture(count = 35) {
  const owner = await createVideoEditTestProject(); const documentId = owner.document.id; const sequenceId = owner.activeSequenceId
  editVideoProject(documentId, document => { document = structuredClone(document);
    document.media = [{ id: 'voice', kind: 'audio', name: '口播', path: path.resolve(path.sep, 'subtitle-correction.wav'), durationSeconds: count + 1, width: 0, height: 0, hasAudio: true, assetContent: identity }]
    document.items = [{ id: 'voice-item', kind: 'audio', name: '口播', mediaId: 'voice' }]
    const sequence = document.sequences[0]; sequence.frameRate = { numerator: 30, denominator: 1 }
    const clip = { ...makeVideoEditItemClip(document, 'voice-item', sequenceId, { frame: 0, duration: count * 24 }), id: 'clip' }; sequence.clips = [clip]
    sequence.captions = Array.from({ length: count }, (_, index) => {
      const words = Array.from({ length: 8 }, (_, word) => ({ clipId: clip.id, text: `词${word}`, startUs: (index * 8 + word) * 100000, endUs: (index * 8 + word + 1) * 100000, precision: 'word' as const }))
      return bindVideoEditCaptionSpeech({ id: `caption-${index}`, text: words.map(word => word.text).join(''), start: index * 24, duration: 24 }, words)
    })
    return document
  })
  const input = { documentRef: { kind: 'video_edit.document', id: documentId }, sequenceRef: { kind: 'video_edit.sequence', id: `${documentId}:${sequenceId}` } }
  const query = { ...input, budgets: { inputTokens: 3200, outputTokens: 1500, contextTokens: 100 } }
  return { owner, input, query }
}
const resultCues = (batch: NonNullable<ReturnType<typeof parse>['batch']>, edited = true) => batch.packet!.baseline.map(caption => ({ startWord: caption.startWord, endWord: caption.endWord, text: edited ? caption.text.replace('词0', '术语') : caption.text }))

it('正式公共入口按双预算分页校对，应用后保存、一批一次撤销，不识别或调用模型', async () => {
  const { owner, input, query } = await fixture(); const app = createApplicationHarness()
  const before = structuredClone(owner.document); const history = owner.past.length; const frame = owner.frame
  const recognition = vi.spyOn(getPlatform().audioEdit, 'transcribe')
  try {
    const plan = parse(await app.requireResult('query_video_edit_subtitle_correction', query))
    expect(plan.batchCount).toBeGreaterThan(1); expect(owner.document).toEqual(before); expect(owner.past.length).toBe(history)
    const applied = await app.requireResult('apply_video_edit_subtitle_correction', { ...input, planId: plan.planId, batchIndex: plan.batch!.index, cues: resultCues(plan.batch!) })
    expect(applied).toMatchObject({ changed: true, verified: true, replayed: false })
    expect(owner.past.length).toBe(history + 1); expect(owner.frame).toBe(frame)
    const next = parse(await app.requireResult('query_video_edit_subtitle_correction', { ...input, planId: plan.planId }))
    expect(next.completed).toBe(1); expect(next.batch!.index).toBe(1)
    const saved = structuredClone(owner.document)
    await app.requireResult('undo_video_edit', { documentRef: input.documentRef })
    expect(owner.document.sequences[0].captions).toEqual(before.sequences[0].captions)
    expect(parse(await app.requireResult('query_video_edit_subtitle_correction', { ...input, planId: plan.planId }))).toMatchObject({ completed: 0, conflicts: 1 })
    await app.requireResult('redo_video_edit', { documentRef: input.documentRef })
    expect(owner.document.sequences[0].captions).toEqual(saved.sequences[0].captions)
    expect(parse(await app.requireResult('query_video_edit_subtitle_correction', { ...input, planId: plan.planId }))).toMatchObject({ completed: 1, conflicts: 0 })
    const reopened = await reopenVideoEdit(owner.document.id)
    expect(reopened.document.sequences[0].captions).toEqual(saved.sequences[0].captions)
    expect(recognition).not.toHaveBeenCalled()
    await expect(queryVideoEditSubtitleCorrection({ ...input, planId: plan.planId }, context())).rejects.toThrow('已失效')
  } finally { app.dispose() }
})
it('坏词范围只失败本批，查询保留进度；修正后继续，成功重放不重复历史或新建字幕', async () => {
  const { owner, input, query } = await fixture(); const app = createApplicationHarness()
  try {
    const plan = parse(await app.requireResult('query_video_edit_subtitle_correction', query)); const firstCues = resultCues(plan.batch!)
    const firstInput = { ...input, planId: plan.planId, batchIndex: 0, cues: firstCues }
    await app.requireResult('apply_video_edit_subtitle_correction', firstInput)
    const afterFirst = structuredClone(owner.document); const history = owner.past.length
    const second = parse(await app.requireResult('query_video_edit_subtitle_correction', { ...input, planId: plan.planId }))
    const bad = await app.call('apply_video_edit_subtitle_correction', { ...input, planId: plan.planId, batchIndex: 1, cues: resultCues(second.batch!).slice(1) })
    expect(bad.ok).toBe(false); expect(owner.document).toEqual(afterFirst); expect(owner.past.length).toBe(history)
    const retry = parse(await app.requireResult('query_video_edit_subtitle_correction', { ...input, planId: plan.planId }))
    expect(retry.completed).toBe(1); expect(retry.batch!.index).toBe(1); expect(retry.batch!.lastError).toContain('词范围')
    await app.requireResult('apply_video_edit_subtitle_correction', { ...input, planId: plan.planId, batchIndex: 1, cues: resultCues(retry.batch!) })
    const historyAfterSecond = owner.past.length
    const replay = await app.requireResult('apply_video_edit_subtitle_correction', firstInput)
    expect(replay).toMatchObject({ changed: false, replayed: true, verified: true }); expect(owner.past.length).toBe(historyAfterSecond)
    const conflicting = await app.call('apply_video_edit_subtitle_correction', { ...firstInput, cues: firstCues.map(cue => ({ ...cue, text: '不同结果' })) })
    expect(conflicting.ok).toBe(false); expect(owner.past.length).toBe(historyAfterSecond)
  } finally { app.dispose() }
})
it('计划期间人工修改只阻断对应批，其他批能继续；初始人工字幕列为受保护', async () => {
  const { owner, input, query } = await fixture(); const app = createApplicationHarness()
  try {
    editVideoProject(owner.document.id, document => { document = structuredClone(document); document.sequences[0].captions![0].text = '人工校对'; return document })
    const plan = parse(await app.requireResult('query_video_edit_subtitle_correction', query))
    expect(plan.protected).toMatchObject([{ captionRef: { id: `${owner.document.id}:caption-0` }, reason: 'authored_text' }])
    const editedId = plan.batch!.packet!.baseline[0].captionId
    editVideoProject(owner.document.id, document => { document = structuredClone(document); document.sequences[0].captions!.find(caption => caption.id === editedId)!.text = '后来手改'; return document })
    const later = parse(await app.requireResult('query_video_edit_subtitle_correction', { ...input, planId: plan.planId }))
    expect(later.conflicts).toBe(1); expect(later.batch!.index).toBe(1)
    await app.requireResult('apply_video_edit_subtitle_correction', { ...input, planId: plan.planId, batchIndex: 1, cues: resultCues(later.batch!) })
    expect(owner.document.sequences[0].captions!.find(caption => caption.id === editedId)!.text).toBe('后来手改')
    expect(owner.document.sequences[0].captions![0].text).toBe('人工校对')
    const invalid = await app.call('apply_video_edit_subtitle_correction', { ...input, planId: plan.planId, batchIndex: 0, cues: resultCues(plan.batch!) })
    expect(invalid.ok).toBe(false)
  } finally { app.dispose() }
})
it('整句无需修改不会新增撤销；完成后用户改字不可被相同批次重放覆盖', async () => {
  const { owner, input, query } = await fixture(1); const app = createApplicationHarness()
  try {
    const plan = parse(await app.requireResult('query_video_edit_subtitle_correction', query)); const history = owner.past.length
    const args = { ...input, planId: plan.planId, batchIndex: 0, cues: resultCues(plan.batch!, false) }
    expect(await app.requireResult('apply_video_edit_subtitle_correction', args)).toMatchObject({ changed: false, verified: true })
    expect(owner.past.length).toBe(history)
    editVideoProject(owner.document.id, document => { document = structuredClone(document); document.sequences[0].captions![0].text = '保留手改'; return document })
    expect((await app.call('apply_video_edit_subtitle_correction', args)).ok).toBe(false)
    expect(owner.document.sequences[0].captions![0].text).toBe('保留手改')
  } finally { app.dispose() }
})
it('来源变化、时序变化、取消和错误目标拒绝写入，锁轨阻断本批', async () => {
  const { owner, input, query } = await fixture(1); const app = createApplicationHarness()
  try {
    const plan = parse(await app.requireResult('query_video_edit_subtitle_correction', query))
    const args = { ...input, planId: plan.planId, batchIndex: 0, cues: resultCues(plan.batch!) }; const history = owner.past.length
    const controller = new AbortController(); controller.abort()
    await expect(applyVideoEditSubtitleCorrection(args, { signal: controller.signal })).rejects.toThrow()
    await expect(queryVideoEditSubtitleCorrection({ ...input, documentRef: { ...input.documentRef, id: 'other' }, planId: plan.planId }, context())).rejects.toThrow('必须属于')
    vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockResolvedValueOnce({ ...identity, contentIdentity: 'changed' })
    expect((await app.call('apply_video_edit_subtitle_correction', args)).ok).toBe(false); expect(owner.past.length).toBe(history)
    editVideoProject(owner.document.id, document => { document = structuredClone(document); const sequence = document.sequences[0]; sequence.tracks.find(track => track.index === sequence.clips[0].track)!.locked = true; return document })
    expect((await app.call('apply_video_edit_subtitle_correction', args)).ok).toBe(false)
    editVideoProject(owner.document.id, document => { document = structuredClone(document); document.sequences[0].tracks.forEach(track => { track.locked = false }); return document })
    editVideoProject(owner.document.id, document => { document = structuredClone(document); document.sequences[0].clips[0].sourceInUs = 100000; return document })
    await expect(queryVideoEditSubtitleCorrection({ ...input, planId: plan.planId }, context())).rejects.toThrow('时序已改变')
  } finally { app.dispose() }
})
it('只读调用者能取批次但不能应用；公共契约不允许模型提供时间或任意属性', async () => {
  const { input, query } = await fixture(1); const app = createApplicationHarness()
  const grant = createApplicationCallerGrant({ callerId: 'correction-read' })
  const session = createApplicationCapabilitySession(grant)
  try {
    const read = await session.execute({ id: 'query_video_edit_subtitle_correction', version: 1, input: query }, { ...context(), requestId: crypto.randomUUID() })
    expect(read.ok).toBe(true)
    const plan = parse(await app.requireResult('query_video_edit_subtitle_correction', query))
    const forged = await app.call('apply_video_edit_subtitle_correction', { ...input, planId: plan.planId, batchIndex: 0, cues: resultCues(plan.batch!).map(cue => ({ ...cue, startFrame: 0 })) })
    expect(forged.ok).toBe(false)
  } finally { app.dispose() }
})
it('保存失败保留已应用结果，恢复只保存，同批相同结果不重复写入', async () => {
  const { owner, input, query } = await fixture(1); const app = createApplicationHarness()
  try {
    const plan = parse(await app.requireResult('query_video_edit_subtitle_correction', query))
    const args = { ...input, planId: plan.planId, batchIndex: 0, cues: resultCues(plan.batch!) }; const history = owner.past.length
    failVideoEditSaves(true)
    const failed = await app.call('apply_video_edit_subtitle_correction', args)
    expect(failed.ok).toBe(false); expect(owner.past.length).toBe(history + 1)
    expect(owner.document.sequences[0].captions![0].text).toContain('术语')
    failVideoEditSaves(false)
    await app.requireResult('save_video_edit', { documentRef: input.documentRef })
    expect(await app.requireResult('apply_video_edit_subtitle_correction', args)).toMatchObject({ replayed: true, changed: false, verified: true })
    expect(owner.past.length).toBe(history + 1)
  } finally { failVideoEditSaves(false); app.dispose() }
})
it('规则首次传递后按计划复用，可显式重读；返回副本不会污染计划，固定选项不能悄悄改动', async () => {
  const { input, query } = await fixture(1); const app = createApplicationHarness()
  try {
    const plan = parse(await app.requireResult('query_video_edit_subtitle_correction', { ...query, rules: '保留口语' }))
    expect(plan.batch!.packet!.rules).toBe('保留口语')
    plan.batch!.packet!.words[0].text = '污染副本'
    const next = parse(await app.requireResult('query_video_edit_subtitle_correction', { ...input, planId: plan.planId }))
    expect(next.batch!.packet!.words[0].text).not.toBe('污染副本')
    expect(next.batch!.packet!.rules).toBeUndefined(); expect(next.batch!.packet!.instructions).toBeUndefined()
    const reread = parse(await app.requireResult('query_video_edit_subtitle_correction', { ...input, planId: plan.planId, includeGuidance: true }))
    expect(reread.batch!.packet!.rules).toBe('保留口语')
    await expect(queryVideoEditSubtitleCorrection({ ...input, planId: plan.planId, rules: '改变规则' }, context())).rejects.toThrow('选项已固定')
  } finally { app.dispose() }
})
it('受保护字幕有界分页，缓存淘汰后明确重查而非伪造已完成状态', async () => {
  const { owner, input, query } = await fixture(25); const app = createApplicationHarness()
  try {
    editVideoProject(owner.document.id, document => { document = structuredClone(document); document.sequences[0].captions!.forEach(caption => { caption.text = '人工改写' }); return document })
    const plan = parse(await app.requireResult('query_video_edit_subtitle_correction', query))
    expect(plan).toMatchObject({ batchCount: 0, protectedCount: 25, protectedNextOffset: 20, batch: null })
    expect(plan.protected).toHaveLength(20)
    const next = parse(await app.requireResult('query_video_edit_subtitle_correction', { ...input, planId: plan.planId, protectedOffset: 20 }))
    expect(next.protected).toHaveLength(5); expect(next.protectedNextOffset).toBeNull()
    for (let index = 0; index < 4; index++) await app.requireResult('query_video_edit_subtitle_correction', query)
    await expect(queryVideoEditSubtitleCorrection({ ...input, planId: plan.planId }, context())).rejects.toThrow('计划已失效')
  } finally { app.dispose() }
})
it('完整执行多个批次后无剩余任务，所有字幕只校对一次且不反复发送规则', async () => {
  const { owner, input, query } = await fixture(40); const app = createApplicationHarness()
  try {
    let current = parse(await app.requireResult('query_video_edit_subtitle_correction', { ...query, rules: '保留口语' }))
    const count = current.batchCount; const planId = current.planId; let applied = 0; let guidanceReads = 0
    while (current.batch) {
      if (current.batch.packet?.rules !== undefined) guidanceReads++
      await app.requireResult('apply_video_edit_subtitle_correction', { ...input, planId, batchIndex: current.batch.index, cues: resultCues(current.batch) })
      applied++
      current = parse(await app.requireResult('query_video_edit_subtitle_correction', { ...input, planId }))
      expect(applied).toBeLessThanOrEqual(count)
    }
    expect(current).toMatchObject({ completed: count, pending: 0, conflicts: 0 })
    expect(applied).toBe(count); expect(guidanceReads).toBe(1)
    expect(owner.document.sequences[0].captions).toHaveLength(40)
    expect(owner.document.sequences[0].captions!.every(caption => caption.text.startsWith('术语'))).toBe(true)
  } finally { app.dispose() }
})
it('等待来源核对期间的新修改拒绝迟到写入，保留人工修改与未完成批次', async () => {
  const { owner, input, query } = await fixture(20); const app = createApplicationHarness()
  try {
    const plan = parse(await app.requireResult('query_video_edit_subtitle_correction', query))
    const captionId = plan.batch!.packet!.baseline[0].captionId
    vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockImplementationOnce(async () => {
      editVideoProject(owner.document.id, document => { document = structuredClone(document); document.sequences[0].captions!.find(caption => caption.id === captionId)!.text = '核对期间手改'; return document })
      return identity
    })
    const result = await app.call('apply_video_edit_subtitle_correction', { ...input, planId: plan.planId, batchIndex: 0, cues: resultCues(plan.batch!) })
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).toContain('核对来源期间作品已改变')
    expect(owner.document.sequences[0].captions!.find(caption => caption.id === captionId)!.text).toBe('核对期间手改')
    const pending = parse(await app.requireResult('query_video_edit_subtitle_correction', { ...input, planId: plan.planId }))
    expect(pending.completed).toBe(0); expect(pending.conflicts).toBe(1); expect(pending.pending).toBeGreaterThan(0)
  } finally { app.dispose() }
})

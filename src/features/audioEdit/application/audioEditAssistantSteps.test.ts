// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'

import type { AudioEditProjectDocument, AudioEditTranscriptBlock } from '@/core/audioEdit/types'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { harnessDocumentStore, installHarnessNativeStorage, registerHarnessAudioEditProject, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { editAudioEditProject, flushAudioEditProject, loadAudioEditProject, resetAudioEditProjectInstancesForTests, undoAudioEditProject } from './audioEditProjectInstances'
import { resetAudioEditStepsForTests } from './audioEditStepUndo'

const words: Array<[string, string]> = [['b0', '前面一句。'], ['b1', '我们'], ['b2', '今天'], ['b3', '我们'], ['b4', '今天'], ['b5', '来聊聊，'], ['b6', '后面一句。'], ['b7', '再后面。']]
// 每个词 0.8 万采样帧，词与词之间留 0.2 万的停顿
const block = ([id, text]: [string, string], index: number): AudioEditTranscriptBlock => ({ id, text, startFrame: index * 10_000, endFrame: index * 10_000 + 8_000, included: true, locked: false, granularity: 'word' })
const original = words.map(block)

function fixture(): AudioEditProjectDocument {
  return {
    id: 'audio-steps', name: '口播', referenceScript: '',
    source: { mediaType: 'audio', sourcePath: 'fixture.wav', audioPath: 'fixture.wav', durationFrames: 96_000, sampleRate: 48_000, channels: 1 },
    // 用户此前删掉了最后一句，全部还原会把它恢复
    transcript: original.map((item) => item.id === 'b7' ? { ...item, included: false } : item),
    suggestions: [
      { id: 'retake-1', kind: 'retake', evidence: 'audio', title: '重念：我们今天', detail: '开头相同，后面换了说法', startFrame: 10_000, endFrame: 30_000, blockIds: ['b1', 'b2'], confidence: 'low', status: 'pending' },
      { id: 'filler-1', kind: 'filler', title: '语气词', detail: '', startFrame: 60_000, endFrame: 70_000, blockIds: ['b6'], confidence: 'high', status: 'pending' },
    ],
    editBaseline: { kind: 'original', transcript: original, suggestions: [] },
    createdAt: 1, updatedAt: 1, revision: 1,
  }
}

const documentRef = { kind: 'audio_edit.document', id: 'audio-steps' } as const
const stored = () => harnessDocumentStore().stored('audio-steps')!.content as AudioEditProjectDocument
const lastIncluded = (document: AudioEditProjectDocument) => document.transcript.find((item) => item.id === 'b7')!.included

beforeEach(() => { installHarnessNativeStorage(); registerHarnessAudioEditProject(fixture()) })
afterEach(async () => { resetAudioEditStepsForTests(); await resetAudioEditProjectInstancesForTests(); uninstallHarnessNativeStorage() })

it('待确认线索可按类型与把握筛选，读回词块、起止时间与读取时现算的上下文', async () => {
  const app = createApplicationHarness()
  try {
    const result = await app.requireResult('list_application_entities', {
      entityType: 'audio_edit.suggestion', where: { document_id: 'audio-steps', kind: 'retake', confidence: 'low' },
      propertyIds: ['kind', 'confidence', 'start_frame', 'end_frame', 'sample_rate', 'block_ids', 'removed_text', 'kept_text', 'before_text', 'after_text'].map((id) => `audio_edit.suggestion.${id}`),
    })
    expect(result.items).toHaveLength(1)
    expect(result.items).toMatchObject([{ ref: { id: 'audio-steps:retake-1' }, properties: {
      'audio_edit.suggestion.kind': 'retake', 'audio_edit.suggestion.confidence': 'low',
      'audio_edit.suggestion.start_frame': 10_000, 'audio_edit.suggestion.end_frame': 30_000, 'audio_edit.suggestion.sample_rate': 48_000,
      'audio_edit.suggestion.block_ids': ['b1', 'b2'],
      'audio_edit.suggestion.removed_text': '我们今天',
      // 后一段取到句读为止、至少与被删段一样长；已删的最后一句不算后文
      'audio_edit.suggestion.kept_text': '我们今天来聊聊，',
      'audio_edit.suggestion.before_text': '前面一句。',
      'audio_edit.suggestion.after_text': '后面一句。',
    } }])
    // 上下文跟着当前保留状态走：删掉前一句后，前文为空
    editAudioEditProject('audio-steps', (document) => ({ ...document, transcript: document.transcript.map((item) => item.id === 'b0' ? { ...item, included: false } : item) }))
    const after = await app.read({ kind: 'audio_edit.suggestion', id: 'audio-steps:retake-1' }, ['audio_edit.suggestion.before_text'])
    expect(after.properties).toMatchObject({ 'audio_edit.suggestion.before_text': '' })
    await flushAudioEditProject('audio-steps')
  } finally { app.dispose() }
})

it('助手按回执撤销自己那一步并保存，可以重做；之前的手改保留', async () => {
  const app = createApplicationHarness()
  try {
    await loadAudioEditProject('audio-steps')
    editAudioEditProject('audio-steps', (document) => ({ ...document, referenceScript: '用户写的稿子' }))
    const reset = await app.requireResult('reset_audio_edit', { documentRef })
    expect(reset.undoRef).toEqual(expect.any(String))
    expect(lastIncluded(stored())).toBe(true)
    await app.requireResult('undo_audio_edit', { documentRef, undoRef: reset.undoRef })
    expect(lastIncluded(stored())).toBe(false)
    expect(stored().referenceScript).toBe('用户写的稿子')
    await app.requireResult('redo_audio_edit', { documentRef, undoRef: reset.undoRef })
    expect(lastIncluded(stored())).toBe(true)
    // 重做后仍可再撤销同一步
    await app.requireResult('undo_audio_edit', { documentRef, undoRef: reset.undoRef })
    expect(lastIncluded(stored())).toBe(false)
  } finally { app.dispose() }
})

it('这一步之后用户又手改过时拒绝撤销，不冲掉用户的修改', async () => {
  const app = createApplicationHarness()
  try {
    const reset = await app.requireResult('reset_audio_edit', { documentRef })
    editAudioEditProject('audio-steps', (document) => ({ ...document, referenceScript: '之后手写的稿子' }))
    await flushAudioEditProject('audio-steps')
    const refused = await app.call('undo_audio_edit', { documentRef, undoRef: reset.undoRef })
    expect(refused).toMatchObject({ ok: false, error: { details: { execution: { notExecuted: true } } } })
    expect(JSON.stringify(refused)).toContain('用户手改')
    const instance = await loadAudioEditProject('audio-steps')
    expect(instance.document.referenceScript).toBe('之后手写的稿子')
    expect(lastIncluded(instance.document)).toBe(true)
    expect(stored().referenceScript).toBe('之后手写的稿子')
    // 其他口播或伪造的引用直接说明找不到
    expect(JSON.stringify(await app.call('undo_audio_edit', { documentRef, undoRef: 'audio_edit.step:unknown' }))).toContain('找不到这一步')
  } finally { app.dispose() }
})

it('筛出线索后整条接受写 status=applied：删掉词块并补上接缝处的停顿剪切', async () => {
  const app = createApplicationHarness()
  try {
    const listed = await app.requireResult('list_application_entities', { entityType: 'audio_edit.suggestion', where: { document_id: 'audio-steps', kind: 'retake', current_state: 'available' } })
    expect(listed.refs).toMatchObject([{ id: 'audio-steps:retake-1' }])
    const ref = { kind: 'audio_edit.suggestion', id: 'audio-steps:retake-1' }
    expect((await app.change(ref, { 'audio_edit.suggestion.status': 'applied' })).ok).toBe(true)
    const saved = stored()
    expect(saved.transcript.filter((item) => !item.included).map((item) => item.id)).toEqual(expect.arrayContaining(['b1', 'b2']))
    // 两个词之间与后一遍之前的停顿也一起剪掉，不留空当
    expect((saved.cuts ?? []).filter((cut) => cut.id.startsWith('retake-1')).map((cut) => [cut.startFrame, cut.endFrame])).toEqual([[18_000, 20_000], [28_000, 30_000]])
    expect((await app.read(ref, ['audio_edit.suggestion.current_state'])).properties).toMatchObject({ 'audio_edit.suggestion.current_state': 'removed' })
  } finally { app.dispose() }
})

it('用户已在界面撤销了助手那一步：撤销说明已撤销，重做可以恢复', async () => {
  const app = createApplicationHarness()
  try {
    const reset = await app.requireResult('reset_audio_edit', { documentRef })
    undoAudioEditProject('audio-steps')
    await flushAudioEditProject('audio-steps')
    const refused = await app.call('undo_audio_edit', { documentRef, undoRef: reset.undoRef })
    expect(refused).toMatchObject({ ok: false })
    expect(JSON.stringify(refused)).toContain('已经撤销')
    await app.requireResult('redo_audio_edit', { documentRef, undoRef: reset.undoRef })
    expect(lastIncluded(stored())).toBe(true)
    expect(JSON.stringify(await app.call('redo_audio_edit', { documentRef, undoRef: reset.undoRef }))).toContain('不需要重做')
  } finally { app.dispose() }
})

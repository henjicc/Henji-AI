// @vitest-environment jsdom
import { editAudioEditProject, loadAudioEditProject, undoAudioEditProject, flushAudioEditProject, resetAudioEditProjectInstancesForTests } from './audioEditProjectInstances'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'

import { editedDurationFrames, buildAudioEditTimeline, buildProjectAudioEditTimeline } from '@/core/audioEdit/timeline'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { updateAudioEditCut } from '@/core/audioEdit/edits'
import { createApplicationHarness } from '@/tests/applicationHarness'
import {
  harnessDocumentStore,
  installHarnessNativeStorage,
  registerHarnessAudioEditProject,
  uninstallHarnessNativeStorage,
} from '@/tests/harnessNativeStorage'

function fixture(): AudioEditProjectDocument {
  return {
    id: 'audio-result', name: '原口播', referenceScript: '', suggestions: [],
    source: { mediaType: 'audio', sourcePath: 'fixture.wav', audioPath: 'fixture.wav', durationFrames: 96_000, sampleRate: 48_000, channels: 1 },
    transcript: [
      { id: 'first', text: '第一句', startFrame: 0, endFrame: 48_000, included: true, locked: false, granularity: 'word' },
      { id: 'second', text: '第二句', startFrame: 48_000, endFrame: 96_000, included: true, locked: false, granularity: 'word' },
    ],
    createdAt: 1, updatedAt: 1, revision: 1,
  }
}

beforeEach(() => {
  installHarnessNativeStorage()
  registerHarnessAudioEditProject(fixture())
})

afterEach(async () => { await resetAudioEditProjectInstancesForTests(); uninstallHarnessNativeStorage() })

it('已有文件拼接由正式能力提交、回读素材和词时间，并可一步撤销', async () => {
  const source = fixture().source
  const splice = vi.spyOn(getPlatform().audioEdit, 'splice').mockResolvedValue({ source: { ...source, sourcePath: 'inserted.wav', audioPath: 'inserted.wav', durationFrames: 120000, ownership: 'managed' }, insertedFrames: 24000 })
  const app = createApplicationHarness()
  try {
    const result = await app.requireResult('insert_audio_edit_file', { documentRef: { kind: 'audio_edit.document', id: 'audio-result' }, sourcePath: 'take.wav', positionSeconds: 1 })
    expect(result.verified).toBe(true)
    expect(splice).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'audio-result', startFrame: 48000, endFrame: 48000 }))
    const instance = await loadAudioEditProject('audio-result')
    expect(instance.document.source.sourcePath).toBe('inserted.wav')
    expect(instance.document.transcript.find(block => block.id === 'second')?.startFrame).toBe(72000)
    undoAudioEditProject('audio-result')
    await flushAudioEditProject('audio-result')
    expect(instance.document.source).toEqual(source)
    expect(instance.document.transcript).toEqual(fixture().transcript)
  } finally { splice.mockRestore(); app.dispose() }
})

it('未打开口播草稿可按document_id后台读取词块，返回采样率而不导航', async () => {
  const app = createApplicationHarness()
  try {
    const result = await app.requireResult('list_application_entities', { entityType: 'audio_edit.transcript_block', where: { document_id: 'audio-result' }, propertyIds: ['text', 'start_frame', 'end_frame', 'sample_rate'] })
    expect(result.items).toMatchObject([
      { ref: { id: 'audio-result:first' }, properties: { 'audio_edit.transcript_block.start_frame': 0, 'audio_edit.transcript_block.end_frame': 48000, 'audio_edit.transcript_block.sample_rate': 48000 } },
      { ref: { id: 'audio-result:second' } },
    ])
  } finally { app.dispose() }
})

it('口播识别预检失败经正式能力返回未执行事实', async () => {
  registerHarnessAudioEditProject({ ...fixture(), transcript: [] })
  const app = createApplicationHarness()
  const preflight = vi.spyOn(getPlatform().audioEdit, 'preflightTranscription').mockRejectedValue(new Error('没有配置识别模型'))
  const submit = vi.spyOn(getPlatform().audioEdit, 'transcribe')
  try {
    expect(await app.call('transcribe_audio_edit', { documentRef: { kind: 'audio_edit.document', id: 'audio-result' } })).toMatchObject({ ok: false, error: { details: { execution: { notExecuted: true, billing: 'not_charged' } } } })
    expect(submit).not.toHaveBeenCalled()
  } finally { preflight.mockRestore(); submit.mockRestore(); app.dispose() }
})

it('口播名就是文件名：内容实体的名称只读，读到的是文档名（改名走 documents.document.name）', async () => {
  const app = createApplicationHarness()
  try {
    const ref = { kind: 'audio_edit.document', id: 'audio-result' }
    expect((await app.read(ref, ['audio_edit.document.name'])).properties).toMatchObject({ 'audio_edit.document.name': '原口播' })
    const result = await app.change(ref, { 'audio_edit.document.name': '新口播名' })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).toContain('documents.document.name')
    expect(harnessDocumentStore().stored('audio-result')?.meta.name).toBe('原口播')
  } finally {
    app.dispose()
  }
})

it('通用属性静音与界面设置保存可回读，静音不缩短成片且可以撤销', async () => {
  const app = createApplicationHarness()
  try {
    const ref = { kind: 'audio_edit.document', id: 'audio-result' }
    const view = { textSize: 28, sidePadding: 80, timelineCaptions: false }
    const baseline = await app.read(ref)
    expect((await app.call('change_application_entities', { summary: '静音一段并改界面设置', changes: [
      { kind: 'create_items', entityType: 'audio_edit.cut', parent: ref, items: [{ properties: { start_frame: 12000, end_frame: 36000, mode: 'mute' } }] },
      { kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'audio_edit.document.view_settings': view } },
    ] }, baseline.revisions as Record<string, number>)).ok).toBe(true)
    expect((await app.read(ref, ['audio_edit.document.view_settings'])).properties).toMatchObject({ 'audio_edit.document.view_settings': view })
    const instance = await loadAudioEditProject('audio-result')
    const spans = buildProjectAudioEditTimeline(instance.document)
    expect(editedDurationFrames(spans)).toBe(96000)
    expect(spans.some((span) => span.muted)).toBe(true)
    expect((await app.change(ref, { 'audio_edit.document.view_settings': { ...view, textSize: 32 } })).ok).toBe(true)
    expect(instance.past).toHaveLength(1)
    undoAudioEditProject('audio-result')
    expect(instance.document.cuts).toBeUndefined()
    expect(instance.document.viewSettings?.textSize).toBe(32)
    await flushAudioEditProject('audio-result')
  } finally { app.dispose() }
})

it('通过通用 change 删除词块并让成片映射同步缩短', async () => {
  const app = createApplicationHarness()
  try {
    const blockRef = { kind: 'audio_edit.transcript_block', id: 'audio-result:first' }
    expect((await app.change(blockRef, { 'audio_edit.transcript_block.included': false })).ok).toBe(true)
    // 从文档文件回读（3.3：口播是 .hjaud 文档）
    const project = harnessDocumentStore().stored('audio-result')?.content as AudioEditProjectDocument
    expect(project.transcript[0].included).toBe(false)
    expect(editedDurationFrames(buildAudioEditTimeline(project.source.durationFrames, project.transcript))).toBe(48_000)
  } finally {
    app.dispose()
  }
})

it('正式公共事务同一步删除并锁定后，可用本连接 undoRef 恢复内容和锁并保存', async () => {
  const app = createApplicationHarness()
  try {
    const blockRef = { kind: 'audio_edit.transcript_block', id: 'audio-result:first' }
    const changed = await app.change(blockRef, {
      'audio_edit.transcript_block.included': false,
      'audio_edit.transcript_block.locked': true,
    })
    expect(changed.ok).toBe(true)
    if (!changed.ok) throw new Error(JSON.stringify(changed.error))
    const instance = await loadAudioEditProject('audio-result')
    expect(instance.document.transcript[0]).toMatchObject({ included: false, locked: true })
    expect(instance.past).toHaveLength(1)
    await app.requireResult('undo_application_changes', { undoRef: changed.data.undoRef })
    expect(instance.document.transcript[0]).toMatchObject({ included: true, locked: false })
    const stored = harnessDocumentStore().stored('audio-result')!.content as AudioEditProjectDocument
    expect(stored.transcript[0]).toMatchObject({ included: true, locked: false })
  } finally { app.dispose() }
})

it('助手修改与手工历史共存，撤销助手操作不会抹去之前的手工编辑', async () => {
  const app = createApplicationHarness()
  try {
    const instance = await loadAudioEditProject('audio-result')
    editAudioEditProject('audio-result', (document) => ({ ...document, referenceScript: '手工参考稿' }))
    await flushAudioEditProject('audio-result')
    const ref = { kind: 'audio_edit.document', id: 'audio-result' }
    const baseline = await app.read(ref)
    expect((await app.call('change_application_entities', { summary: '改参考稿并剪一段', changes: [
      { kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'audio_edit.document.reference_script': '助手参考稿' } },
      { kind: 'create_items', entityType: 'audio_edit.cut', parent: ref, items: [{ properties: { start_frame: 1000, end_frame: 3000 } }] },
    ] }, baseline.revisions as Record<string, number>)).ok).toBe(true)
    expect(instance.past).toHaveLength(2)
    undoAudioEditProject('audio-result')
    expect(instance.document.cuts).toBeUndefined()
    expect(instance.document.referenceScript).toBe('手工参考稿')
    await flushAudioEditProject('audio-result')
  } finally { app.dispose() }
})


it('区域音量与修复通过公共事务写入、回读、持久化并一次撤销', async () => {
  const app = createApplicationHarness()
  const ref = { kind: 'audio_edit.document', id: 'audio-result' }
  const gain = { id: 'gain', startFrame: 0, endFrame: 24000, gainDb: -6, fadeInFrames: 100, fadeOutFrames: 100, enabled: true }
  const repair = { id: 'repair', kind: 'spectral_heal', startFrame: 5000, endFrame: 6000, lowHz: 100, highHz: 4000, strength: .5, enabled: true }
  try {
    expect((await app.change(ref, { 'audio_edit.document.gain_regions': [gain], 'audio_edit.document.repairs': [repair] })).ok).toBe(true)
    expect((await app.read(ref, ['audio_edit.document.gain_regions', 'audio_edit.document.repairs'])).properties).toMatchObject({ 'audio_edit.document.gain_regions': [gain], 'audio_edit.document.repairs': [repair] })
    expect(harnessDocumentStore().stored(ref.id)?.content).toMatchObject({ gainRegions: [gain], repairs: [repair] })
    undoAudioEditProject(ref.id)
    await flushAudioEditProject(ref.id)
    expect((await loadAudioEditProject(ref.id)).document.gainRegions ?? []).toEqual([])
    expect((await loadAudioEditProject(ref.id)).document.repairs ?? []).toEqual([])
    expect((await app.change(ref, { 'audio_edit.document.repairs': [{ ...repair, highHz: 50000 }] })).ok).toBe(false)
    expect((await loadAudioEditProject(ref.id)).document.repairs ?? []).toEqual([])
  } finally { app.dispose() }
})


it('区域修复公共能力渲染实际保存版本并回读，同一历史可撤销；失败保留可恢复记录', async () => {
  const app = createApplicationHarness(), ref = { kind: 'audio_edit.document', id: 'audio-result' }
  const repair = { id: 'algorithm', kind: 'spectral_heal', startFrame: 1000, endFrame: 2000, lowHz: 100, highHz: 1000, strength: 1, enabled: true }
  const render = vi.spyOn(getPlatform().audioEdit, 'render').mockImplementation(async ({ projectId }) => {
    expect(harnessDocumentStore().stored(projectId)?.content).toMatchObject({ repairs: [repair] })
    return { audioPath: 'result.wav', durationFrames: 96000, sampleRate: 48000, channels: 1, revision: harnessDocumentStore().stored(projectId)!.meta.revision }
  })
  try {
    expect(await app.call('repair_audio_edit_region', { documentRef: ref, repair })).toMatchObject({ ok: true, data: { verified: true, durationFrames: 96000 } })
    expect(render).toHaveBeenCalledOnce()
    undoAudioEditProject(ref.id); await flushAudioEditProject(ref.id)
    expect((await loadAudioEditProject(ref.id)).document.repairs ?? []).toEqual([])
    render.mockRejectedValueOnce(new Error('Worker unavailable'))
    expect(await app.call('repair_audio_edit_region', { documentRef: ref, repair: { ...repair, id: 'failed' } })).toMatchObject({ ok: false })
    expect((await loadAudioEditProject(ref.id)).document.repairs?.[0].id).toBe('failed')
  } finally { render.mockRestore(); app.dispose() }
})

const cutsFixture = () => ({ ...fixture(), cuts: [
  { id: 'gap:1', startFrame: 1000, endFrame: 2000, reason: 'silence' as const, enabled: true },
  { id: 'gap:2', startFrame: 50000, endFrame: 51000, reason: 'silence' as const, enabled: true },
  { id: 'mute-1', startFrame: 60000, endFrame: 62000, reason: 'manual' as const, enabled: true, mode: 'mute' as const },
] })
const cutRef = (id: string) => ({ kind: 'audio_edit.cut', id: `audio-result:${id}` })
const projectRef = { kind: 'audio_edit.document', id: 'audio-result' }
const storedCuts = () => (harnessDocumentStore().stored('audio-result')?.content as AudioEditProjectDocument).cuts

it('剪切逐条改、增、删：只换改到的那一处，其余剪切原样保留，落盘回读并可一次撤销', async () => {
  registerHarnessAudioEditProject(cutsFixture())
  const app = createApplicationHarness()
  try {
    const listed = await app.requireResult('list_application_entities', { entityType: 'audio_edit.cut', where: { document_id: 'audio-result' }, propertyIds: ['start_frame', 'end_frame', 'mode', 'reason'] })
    expect((listed as { refs: Array<{ id: string }> }).refs.map(ref => ref.id)).toEqual(['audio-result:gap:1', 'audio-result:gap:2', 'audio-result:mute-1'])
    const instance = await loadAudioEditProject('audio-result')
    const before = instance.document.cuts!
    expect((await app.change(cutRef('gap:2'), { 'audio_edit.cut.end_frame': 50500, 'audio_edit.cut.enabled': false })).ok).toBe(true)
    // 没改到的两处仍是同一个对象：没有被整组读出再写回
    expect(instance.document.cuts![0]).toBe(before[0])
    expect(instance.document.cuts![2]).toBe(before[2])
    expect(storedCuts()).toEqual([before[0], { ...before[1], endFrame: 50500, enabled: false }, before[2]])

    const baseline = await app.read(projectRef)
    const changed = await app.call('change_application_entities', { summary: '去掉静音并新加一刀', changes: [
      { kind: 'remove_items', entityType: 'audio_edit.cut', parent: projectRef, targets: [cutRef('mute-1')] },
      { kind: 'create_items', entityType: 'audio_edit.cut', parent: projectRef, items: [{ properties: { start_frame: 70000, end_frame: 72000, mode: 'mute' } }] },
    ] }, baseline.revisions as Record<string, number>)
    expect(changed.ok).toBe(true)
    const cuts = storedCuts()!
    expect(cuts.map(cut => cut.id).slice(0, 2)).toEqual(['gap:1', 'gap:2'])
    expect(cuts[2]).toMatchObject({ startFrame: 70000, endFrame: 72000, mode: 'mute', reason: 'manual', enabled: true })
    expect(cuts).toHaveLength(3)
    undoAudioEditProject('audio-result')
    await flushAudioEditProject('audio-result')
    expect(storedCuts()!.map(cut => cut.id)).toEqual(['gap:1', 'gap:2', 'mute-1'])
  } finally { app.dispose() }
})

it('不合法的剪切不写入：结束早于开始、超出音频、盖住锁定词块都被拒绝，原剪切不变', async () => {
  registerHarnessAudioEditProject({ ...cutsFixture(), transcript: fixture().transcript.map((block, index) => index === 1 ? { ...block, locked: true } : block) })
  const app = createApplicationHarness()
  try {
    const original = (await loadAudioEditProject('audio-result')).document.cuts
    expect((await app.change(cutRef('gap:1'), { 'audio_edit.cut.end_frame': 500 })).ok).toBe(false)
    expect((await app.change(cutRef('gap:1'), { 'audio_edit.cut.end_frame': 200_000 })).ok).toBe(false)
    const baseline = await app.read(projectRef)
    expect((await app.call('change_application_entities', { summary: '剪进锁定内容', changes: [
      { kind: 'create_items', entityType: 'audio_edit.cut', parent: projectRef, items: [{ properties: { start_frame: 49000, end_frame: 52000 } }] },
    ] }, baseline.revisions as Record<string, number>)).ok).toBe(false)
    expect((await loadAudioEditProject('audio-result')).document.cuts).toBe(original)
  } finally { app.dispose() }
})

it('用户刚改了另一处剪切，助手改这一处：两边的修改都保留', async () => {
  registerHarnessAudioEditProject(cutsFixture())
  const app = createApplicationHarness()
  try {
    await app.read(cutRef('gap:1'), ['audio_edit.cut.end_frame'])
    // 助手读取之后，用户在界面上改了另一处
    editAudioEditProject('audio-result', document => updateAudioEditCut(document, 'gap:2', { endFrame: 50800 }))
    expect((await app.call('change_application_entities', { summary: '缩短一刀', changes: [
      { kind: 'set_properties', entityType: 'audio_edit.cut', target: cutRef('gap:1'), properties: { 'audio_edit.cut.end_frame': 1500 } },
    ] })).ok).toBe(true)
    await flushAudioEditProject('audio-result')
    expect(storedCuts()!.map(cut => cut.endFrame)).toEqual([1500, 50800, 62000])
  } finally { app.dispose() }
})

it('助手读取后用户改了同一处剪切：带着旧基线的写入被拒绝，不覆盖用户的修改', async () => {
  registerHarnessAudioEditProject(cutsFixture())
  const app = createApplicationHarness()
  try {
    const stale = await app.read(cutRef('gap:1'), ['audio_edit.cut.end_frame'])
    editAudioEditProject('audio-result', document => updateAudioEditCut(document, 'gap:1', { endFrame: 1800 }))
    const result = await app.call('change_application_entities', { summary: '缩短一刀', changes: [
      { kind: 'set_properties', entityType: 'audio_edit.cut', target: cutRef('gap:1'), properties: { 'audio_edit.cut.end_frame': 1500 } },
    ] }, stale.revisions as Record<string, number>)
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).toContain('CONFLICT')
    expect((await loadAudioEditProject('audio-result')).document.cuts![0].endFrame).toBe(1800)
  } finally { app.dispose() }
})

it('参考稿按文档上限写入，六十分钟口播的长稿不被两万字截住', async () => {
  const app = createApplicationHarness()
  try {
    const script = '这是一段很长的参考稿。'.repeat(3000)
    expect(script.length).toBeGreaterThan(20000)
    expect((await app.change(projectRef, { 'audio_edit.document.reference_script': script })).ok).toBe(true)
    expect((harnessDocumentStore().stored('audio-result')?.content as AudioEditProjectDocument).referenceScript).toBe(script)
  } finally { app.dispose() }
})

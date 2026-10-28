// @vitest-environment jsdom
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { queryVideoEditReviewCapability } from '@/core/application-control/domains/videoEdit/videoEditReviewCapability'
import { testCodeManifest } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { GOLDEN_SCENE_DECLARATION } from '@/core/videoEdit/scene/sceneTestFixtures'
import { videoEditComposition, type VideoEditSequence } from '@/core/videoEdit/document'
import type { CaptureEvent } from '@/core/captureLog/events'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { testAuthorBundle, testAuthorProgram } from '../engine/videoEditAuthorTestFixtures'
import { readVideoEditCodeMetadata, rememberVideoEditCodeMetadata } from './videoEditCodeState'
import { closeAllVideoEdits, createVideoEditTestProject } from './videoEditDocumentTestKit'
import { editVideoProject } from './videoEditService'
import { collectVideoEditSceneReview as collectSceneReview, readVideoEditSceneReviewPage } from './videoEditSceneReview'
import { queryVideoEditReview } from './videoEditReview'
import * as sceneDeclaration from '@/core/videoEdit/scene/sceneDeclaration'
import { videoEditCodeDeclarationReader } from './videoEditCodeDeclarations'
import * as recording from './videoEditRecordingClip'
import * as sceneCore from '@/core/videoEdit/scene/sceneReview'
import { videoEditSceneRecordRef } from './videoEditSceneFields'
import { getLogEvents } from '@/core/logging'
import type { VideoEditInstance } from './videoEditService'

async function collectVideoEditSceneReview(...args: Parameters<typeof collectSceneReview>) {
  const records = await collectSceneReview(...args)
  const prepared = await readVideoEditSceneReviewPage(records, args[5], args[6])
  return records.map(record => ({ ...record, motionEvidence: prepared.get(record) ?? record.motionEvidence }))
}

beforeEach(() => installHarnessNativeStorage())
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

const schema = { ...GOLDEN_SCENE_DECLARATION, kinds: {
  ...GOLDEN_SCENE_DECLARATION.kinds,
  shot: { ...GOLDEN_SCENE_DECLARATION.kinds.shot, fields: { ...GOLDEN_SCENE_DECLARATION.kinds.shot.fields, cursor: { type: 'boolean', default: true }, xf: { type: 'duration', optional: true } } },
  focusKey: { ...GOLDEN_SCENE_DECLARATION.kinds.focusKey, influence: 'span', fields: { ...GOLDEN_SCENE_DECLARATION.kinds.focusKey.fields, dur: { type: 'duration', max: 60 } } },
} }
const event = (src: number, x: number): CaptureEvent => ({ kind: 'cursor', eventId: `e${src}`, monoUs: 0, seq: Math.round(src * 100), clockSegmentRef: 'clock', recordingUs: Math.round((src + 1) * 1e6), timeline: null, point: [x, 100], shape: 'arrow' })
const cursorEvents = [event(16.18, 100), event(20, 1000), event(26.75, 1600), event(34.83, 100)]
function attachRecording(owner: VideoEditInstance, baked = false): void {
  editVideoProject(owner.document.id, document => {
    for (const media of document.media) media.recordingCursor = { ownerRef: { kind: 'screen_recording.document', id: 'recording' }, sourceDigest: `sha256:${'a'.repeat(64)}`, cursorBakedIn: baked, recordingStartUs: 1_000_000, width: 1920, height: 1080,
      pages: [{ path: path.resolve(path.sep, 'events.json'), sha256: 'a'.repeat(64), recordingSpanUs: [0, 400_000_000], seqSpan: [0, 10] }] }
    return document
  })
}
async function fixture(minDuration = 0, influence = 'span') {
  const owner = await createVideoEditTestProject(), id = owner.document.id
  const declaration = { ...schema, kinds: { ...schema.kinds, focusKey: { ...schema.kinds.focusKey, influence, fields: { ...schema.kinds.focusKey.fields, dur: { type: 'duration', min: minDuration, max: 60 } } } } }
  const source = `export default {name:'片子',kind:'generator',mode:'dynamic',width:1920,height:1080,durationSeconds:400,params:[{key:'film',type:'scene',title:'片子数据',schema:${JSON.stringify(declaration)}}],draw(){}}`
  const program = testAuthorProgram(testAuthorBundle({ entry: 'main.ts', files: { 'main.ts': source }, apiVersion: 5 }))
  const version = { id: 'v', ...testCodeManifest(source, owner.document), apiVersion: 5 as const, languageVersion: program.languageVersion }
  rememberVideoEditCodeMetadata(owner, 'd', version, program)
  editVideoProject(id, document => {
    document.media = ['A', 'B'].map(mediaId => ({ id: mediaId, name: `录屏 ${mediaId}`, kind: 'video' as const, path: path.resolve(path.sep, `${mediaId}.mp4`), durationSeconds: 400, width: 1920, height: 1080 }))
    document.codeMaterials = [{ id: 'd', name: '片子', defaultVersionId: 'v', versions: [version] }]
    document.scenes = [{ id: 'film', name: '片子', schema: { id: schema.id, version: 1 }, records: [
      { id: 'win', kind: 'window', values: { name: '演示窗口', media: 'A', rect: { x: 0, y: 0, width: 1920, height: 1080 } } },
      { id: 'shot-a', kind: 'shot', parent: 'win', values: { at: 290, src: 0, media: 'A' } },
      { id: 'shot-b', kind: 'shot', parent: 'win', values: { at: 324.83, src: 20, media: 'B', xf: 0 } },
      { id: 'focus', kind: 'focus', values: {} },
      { id: 'box', kind: 'focusKey', parent: 'focus', values: { at: 300, dur: 30, win: 'win', target: { x: .1, y: .1, width: .2, height: .2 } } },
      { id: 'cut', kind: 'cut', values: { from: 306.18, to: 316.75 } },
    ] }]
    document.items.push({ id: 'i', kind: 'code', name: '片子', code: { definitionId: 'd', versionId: 'v', parameters: { film: { kind: 'scene', sceneId: 'film' } } } })
    const sequence = document.sequences[0]
    const clip = makeVideoEditItemClip(document, 'i', sequence.id, { frame: 0 }, readVideoEditCodeMetadata(owner, document))
    sequence.clips = [{ ...clip, id: 'first' }, { ...clip, id: 'repeat', start: clip.duration }]
    return document
  })
  return { owner, input: { documentRef: { kind: 'video_edit.document', id }, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${owner.document.sequences[0].id}` }, from: 0, to: 24000, scene: { checks: ['scene_box_stale'] }, limit: 50 } }
}

it('跨剪切数据错位只报一次；正式 describe → proposal change → 读回后重查为零，旧分页与 documentVersion 失效', async () => {
  const { owner, input } = await fixture(), app = createApplicationHarness()
  const parse = queryVideoEditReviewCapability.outputSchema.parse
  try {
    const first = parse(await app.requireResult('query_video_edit_review', input))
    const stale = first.records.filter(record => record.kind === 'scene_box_stale')
    expect(stale).toHaveLength(1)
    const finding = stale[0]
    expect(finding.timeline).toEqual({ fromFrame: 9428, toFrame: 9583 })
    expect(finding.subjectRef).toMatchObject({ kind: 'video_edit.scene_record', id: `${owner.document.id}:film/box` })
    expect(finding.path).toHaveLength(1)
    const narrow = parse(await app.requireResult('query_video_edit_review', { ...input, from: 9428, to: 9430 }))
    expect(narrow.records.filter(record => record.kind === 'scene_box_stale')).toHaveLength(1)
    const proposal = finding.motionEvidence!.proposal!
    expect(proposal).toHaveLength(1)
    const description = await app.requireResult('describe_application_entities', { refs: [proposal[0].ref], propertyIds: proposal.map(item => item.propertyId), detail: 'full' })
    expect(description.properties).toEqual(expect.arrayContaining([expect.objectContaining({ id: proposal[0].propertyId })]))
    const page = parse(await app.requireResult('query_video_edit_review', { ...input, limit: 1 }))
    expect(page.nextCursor).not.toBeNull()
    const changed = await app.change(proposal[0].ref, { [proposal[0].propertyId]: proposal[0].value })
    expect(changed.ok).toBe(true)
    const read = await app.read(finding.subjectRef, ['video_edit.scene_record.end'])
    expect(read.properties).toEqual({ 'video_edit.scene_record.end': expect.closeTo(314.26, 6) })
    const result = parse(await app.requireResult('query_video_edit_review', input))
    expect(result.records.filter(record => record.kind === 'scene_box_stale')).toEqual([])
    expect(result.documentVersion).not.toBe(first.documentVersion)
    expect((await app.call('query_video_edit_review', { ...input, limit: 1, cursor: page.nextCursor })).ok).toBe(false)
  } finally { app.dispose() }
})

it('鼠标续放与拼接按录制起点读坐标、按画面宽判距离；proposal 关闭鼠标后消除候选', async () => {
  const { owner, input } = await fixture(), app = createApplicationHarness()
  attachRecording(owner)
  const read = vi.spyOn(recording, 'readRecordingClipEvents').mockResolvedValue(cursorEvents)
  const parse = queryVideoEditReviewCapability.outputSchema.parse
  try {
    const query = { ...input, limit: 1, scene: { checks: ['scene_cursor_jump'] } }
    let page = parse(await app.requireResult('query_video_edit_review', query))
    const all = [...page.records]
    while (page.nextCursor) { page = parse(await app.requireResult('query_video_edit_review', { ...query, cursor: page.nextCursor })); all.push(...page.records) }
    const jumps = all.filter(record => record.kind === 'scene_cursor_jump')
    expect(jumps).toHaveLength(2)
    expect(jumps.map(record => record.timeline.fromFrame)).toEqual([9186, 9428])
    expect(read).toHaveBeenCalledTimes(2)
    const proposals = jumps.flatMap(record => record.motionEvidence!.proposal!)
    for (const proposal of proposals) {
      await app.requireResult('describe_application_entities', { refs: [proposal.ref], propertyIds: [proposal.propertyId], detail: 'full' })
      expect((await app.change(proposal.ref, { [proposal.propertyId]: proposal.value })).ok).toBe(true)
      expect((await app.read(proposal.ref, [proposal.propertyId])).properties).toEqual({ [proposal.propertyId]: proposal.value })
    }
    const fixed = parse(await app.requireResult('query_video_edit_review', { ...input, scene: { checks: ['scene_cursor_jump'] } }))
    expect(fixed.records.filter(record => record.kind === 'scene_cursor_jump')).toEqual([])
  } finally { app.dispose() }
})

it('嵌套、修剪与倒放用正式源映射，区间外记录不报；预算超限拒绝且不截断', async () => {
  const { owner } = await fixture()
  editVideoProject(owner.document.id, document => {
    const child = document.sequences[0], clip = child.clips[0]
    child.clips = [{ ...clip, reverse: true, sourceInUs: 320_000_000, duration: 600 }]
    const parent: VideoEditSequence = { ...child, id: 'parent', name: '父序列', tracks: child.tracks.map(track => ({ ...track, id: `parent-${track.id}` })), clips: [], transitions: [] }
    document.sequences.push(parent)
    document.items.push({ id: 'nested', name: '嵌套', kind: 'sequence', sequenceId: child.id })
    parent.clips.push(makeVideoEditItemClip(document, 'nested', parent.id, { frame: 60, duration: 600 }))
    return document
  })
  const composition = videoEditComposition(owner.document, 'parent')
  const options = queryVideoEditReviewCapability.inputSchema.parse({ documentRef: { kind: 'video_edit.document', id: owner.document.id }, sequenceRef: { kind: 'video_edit.sequence', id: `${owner.document.id}:parent` }, from: 0, to: 660, scene: { checks: ['scene_box_stale'] } }).scene!
  const collect = (from: number, to: number, count = 0) => collectVideoEditSceneReview(owner.document.id, composition, { from, to }, options, videoEditCodeDeclarationReader(owner), new AbortController().signal, () => {}, count)
  const facts = await collect(0, 660)
  expect(facts).toHaveLength(1)
  expect(facts[0].path.map(step => step.sequenceId)).toEqual(['parent', owner.document.sequences[0].id])
  expect(facts[0].timeline).toEqual({ from: 77, to: 232 })
  expect(await collect(300, 660)).toEqual([])
  await expect(collect(0, 660, 20000)).rejects.toThrow('预算')
})

it('解析器 user 问题保留原文，只在取帧截断开始之后返回', async () => {
  const { owner } = await fixture()
  editVideoProject(owner.document.id, document => {
    const scene = document.scenes![0]
    scene.records = [scene.records[0], ...Array.from({ length: 520 }, (_, index) => ({ id: `shot-${index}`, kind: 'shot', parent: 'win', values: { at: index / 20, src: index / 10, media: 'A', cursor: false } }))]
    return document
  })
  const composition = videoEditComposition(owner.document, owner.document.sequences[0].id)
  const options = { checks: ['scene_issue'] as const, cursorJumpRatio: .08, minSeconds: .2 }
  const collect = (from: number, to: number) => collectVideoEditSceneReview(owner.document.id, composition, { from, to }, { ...options, checks: [...options.checks] }, videoEditCodeDeclarationReader(owner), new AbortController().signal, () => {})
  expect(await collect(0, 600)).toEqual([])
  const facts = await collect(750, 900)
  expect(facts).toHaveLength(1)
  expect(facts[0]).toMatchObject({ kind: 'scene_issue', subjectId: 'film/win', timeline: { from: 768, to: 900 } })
  expect(facts[0].motionEvidence.suggestion).toContain('之后的内容不再取帧')
})

it('收短会违反声明最短时长时保留错位依据，不给不可写的 proposal', async () => {
  const { owner } = await fixture(26)
  const composition = videoEditComposition(owner.document, owner.document.sequences[0].id)
  const before = owner.document
  const rejected = getLogEvents().filter(log => log.event === 'video_edit.scene.write.rejected').length
  const facts = await collectVideoEditSceneReview(owner.document.id, composition, { from: 9000, to: 10000 }, { checks: ['scene_box_stale'], cursorJumpRatio: .08, minSeconds: .2 }, videoEditCodeDeclarationReader(owner), new AbortController().signal, () => {})
  expect(facts).toHaveLength(1)
  expect(facts[0].motionEvidence.proposal).toBeUndefined()
  expect(facts[0].motionEvidence.suggestion).toContain('尾部错位，未给收短建议的原因：结束字段未通过声明校验')
  expect(facts[0].motionEvidence.suggestion).not.toContain('中段错位')
  expect(owner.document).toBe(before)
  expect(getLogEvents().filter(log => log.event === 'video_edit.scene.write.rejected')).toHaveLength(rejected)
})

it('中文、空格、百分号和斜杠 ID 使用正式引用，proposal 写回不产生未声明级联', async () => {
  const { owner, input } = await fixture(), app = createApplicationHarness()
  const sceneId = '片子 数据%/一', recordId = '落点 数据%/二'
  editVideoProject(owner.document.id, document => {
    document.scenes![0].id = sceneId
    document.scenes![0].records.find(record => record.id === 'box')!.id = recordId
    for (const clip of document.sequences[0].clips) clip.code!.parameters.film = { kind: 'scene', sceneId }
    document.items.find(item => item.id === 'i')!.code!.parameters.film = { kind: 'scene', sceneId }
    return document
  })
  const parse = queryVideoEditReviewCapability.outputSchema.parse
  try {
    const result = parse(await app.requireResult('query_video_edit_review', input))
    const finding = result.records.find(record => record.kind === 'scene_box_stale')!
    const record = owner.document.scenes![0].records.find(record => record.id === recordId)!
    expect(finding.subjectRef).toEqual(videoEditSceneRecordRef(owner.document.id, sceneId, record))
    const proposal = finding.motionEvidence!.proposal![0]
    expect(proposal.ref).toEqual(finding.subjectRef)
    await app.requireResult('describe_application_entities', { refs: [proposal.ref], propertyIds: [proposal.propertyId], detail: 'full' })
    const changed = await app.change(proposal.ref, { [proposal.propertyId]: proposal.value })
    expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
    expect((await app.read(proposal.ref, ['video_edit.scene_record.end'])).properties).toEqual({ 'video_edit.scene_record.end': expect.closeTo(314.26, 6) })
    expect(parse(await app.requireResult('query_video_edit_review', input)).records.filter(record => record.kind === 'scene_box_stale')).toEqual([])
  } finally { app.dispose() }
})

it('300 项内容与 250 个框的全片查询不触发候选预算，重复引用共用分析结果', async () => {
  const { owner, input } = await fixture(), app = createApplicationHarness()
  editVideoProject(owner.document.id, document => {
    const records = document.scenes![0].records
    const box = records.find(record => record.id === 'box')!
    document.scenes![0].records = [records[0], records[3],
      ...Array.from({ length: 300 }, (_, i) => ({ id: `shot-${i}`, kind: 'shot', parent: 'win', values: { at: i, src: i, media: i % 2 ? 'B' : 'A', xf: 0, cursor: false } })),
      ...Array.from({ length: 250 }, (_, i) => ({ ...box, id: `box-${i}`, values: { ...box.values, at: i / 2, dur: 30 } })),
    ]
    return document
  })
  const review = vi.spyOn(sceneCore, 'reviewVideoEditScene')
  try {
    const result = queryVideoEditReviewCapability.outputSchema.parse(await app.requireResult('query_video_edit_review', { ...input, limit: 1 }))
    expect(result.total).toBeGreaterThan(250)
    expect(result.total).toBeLessThan(20000)
    expect(review).toHaveBeenCalledOnce()
  } finally { app.dispose() }
})

it('分开的中段错位保留全部区间，不用收短建议删除中间正常部分', async () => {
  const { owner, input } = await fixture(), app = createApplicationHarness()
  editVideoProject(owner.document.id, document => {
    const scene = document.scenes![0], box = scene.records.find(record => record.id === 'box')!
    scene.records = [scene.records[0], scene.records[3], { ...box, values: { ...box.values, at: 0, dur: 50 } },
      ...[0, 10, 20, 30, 40].map((at, i) => ({ id: `s${i}`, kind: 'shot', parent: 'win', values: { at, src: 0, media: i % 2 ? 'B' : 'A', xf: 0, cursor: false } })),
    ]
    const clip = document.sequences[0].clips[0]
    document.sequences[0].clips = [{ ...clip, duration: 900 }, { ...clip, id: 'split', start: 900, sourceInUs: 30_000_000, duration: 12000 - 900 }]
    return document
  })
  const parse = queryVideoEditReviewCapability.outputSchema.parse
  try {
    const facts = parse(await app.requireResult('query_video_edit_review', input)).records.filter(record => record.kind === 'scene_box_stale')
    expect(facts.map(record => record.timeline)).toEqual([{ fromFrame: 300, toFrame: 600 }, { fromFrame: 900, toFrame: 1200 }])
    expect(facts.every(record => record.motionEvidence!.proposal === undefined)).toBe(true)
    expect(facts.every(record => record.motionEvidence!.suggestion.includes('拆成多段'))).toBe(true)
    expect(owner.document.scenes![0].records.find(record => record.id === 'box')!.values.dur).toBe(50)
  } finally { app.dispose() }
})

it('中段与尾部同时错位时只建议收短尾部，写回后保留中间正常部分', async () => {
  const { owner, input } = await fixture(), app = createApplicationHarness()
  editVideoProject(owner.document.id, document => {
    const scene = document.scenes![0], box = scene.records.find(record => record.id === 'box')!
    scene.records = [scene.records[0], scene.records[3], { ...box, values: { ...box.values, at: 300, dur: 30 } },
      ...[300, 305, 310, 325].map((at, i) => ({ id: `s${i}`, kind: 'shot', parent: 'win', values: { at, src: 0, media: i % 2 ? 'B' : 'A', xf: 0, cursor: false } })),
    ]
    return document
  })
  const parse = queryVideoEditReviewCapability.outputSchema.parse
  try {
    const facts = parse(await app.requireResult('query_video_edit_review', input)).records.filter(record => record.kind === 'scene_box_stale')
    expect(facts.map(record => record.timeline)).toEqual([{ fromFrame: 9150, toFrame: 9300 }, { fromFrame: 9750, toFrame: 9900 }])
    expect(facts[0].motionEvidence!.proposal).toBeUndefined()
    expect(facts[0].motionEvidence!.suggestion).toContain('保留错位前后正常的部分')
    const proposal = facts[1].motionEvidence!.proposal![0]
    expect(proposal.value).toBe(325)
    await app.requireResult('describe_application_entities', { refs: [proposal.ref], propertyIds: [proposal.propertyId], detail: 'full' })
    expect((await app.change(proposal.ref, { [proposal.propertyId]: proposal.value })).ok).toBe(true)
    expect((await app.read(proposal.ref, ['video_edit.scene_record.end'])).properties).toEqual({ 'video_edit.scene_record.end': 325 })
    const remaining = parse(await app.requireResult('query_video_edit_review', input)).records.filter(record => record.kind === 'scene_box_stale')
    expect(remaining.map(record => record.timeline)).toEqual([{ fromFrame: 9150, toFrame: 9300 }])
    expect(remaining[0].motionEvidence!.proposal).toBeUndefined()
  } finally { app.dispose() }
})

it('查询上下文之外已经开始的错位不把上下文边界写成真实起点，也不给收短建议', async () => {
  const { input } = await fixture()
  const result = queryVideoEditReviewCapability.outputSchema.parse(await queryVideoEditReview({ ...input, from: 9460, to: 9500 }, { signal: new AbortController().signal }))
  const stale = result.records.filter(record => record.kind === 'scene_box_stale')
  expect(stale).toHaveLength(1)
  expect(stale[0].motionEvidence!.suggestion).toContain('此前已开始')
  expect(stale[0].motionEvidence!.suggestion).not.toContain('起数据错位')
  expect(stale[0].motionEvidence!.proposal).toBeUndefined()
})

it.each(['query', 'clip'] as const)('%s 范围截在错位中间时说明尾部尚未确认，不宣称是中段错位', async scope => {
  const { owner, input } = await fixture()
  if (scope === 'clip') editVideoProject(owner.document.id, document => {
    document.sequences[0].clips = [{ ...document.sequences[0].clips[0], duration: 9500 }]
    return document
  })
  const result = queryVideoEditReviewCapability.outputSchema.parse(await queryVideoEditReview({ ...input, to: 9500 }, { signal: new AbortController().signal }))
  const stale = result.records.filter(record => record.kind === 'scene_box_stale')
  expect(stale).toHaveLength(1)
  expect(stale[0].motionEvidence!.proposal).toBeUndefined()
  expect(stale[0].motionEvidence!.suggestion).toContain('尚未确认是否延续到记录结束')
  expect(stale[0].motionEvidence!.suggestion).not.toContain('中段错位')
})

async function manyStaleBoxes() {
  const result = await fixture()
  editVideoProject(result.owner.document.id, document => {
    const records = document.scenes![0].records, box = records.find(record => record.id === 'box')!
    document.scenes![0].records = [records[0], records[3],
      { id: 'a', kind: 'shot', parent: 'win', values: { at: 0, src: 0, media: 'A', xf: 0, cursor: false } },
      { id: 'b', kind: 'shot', parent: 'win', values: { at: 10, src: 0, media: 'B', xf: 0, cursor: false } },
      ...Array.from({ length: 800 }, (_, i) => ({ ...box, id: `box-${i}`, values: { ...box.values, at: 0, dur: 50 } })),
    ]
    return document
  })
  return result
}

it('大量框同时错位时首页及时返回，只对当前页做单记录字段校验，分页按需继续', async () => {
  const { input } = await manyStaleBoxes()
  const validate = vi.spyOn(sceneDeclaration, 'validateCodeSceneRecords')
  const start = performance.now()
  const first = queryVideoEditReviewCapability.outputSchema.parse(await queryVideoEditReview({ ...input, limit: 5 }, { signal: new AbortController().signal }))
  expect(performance.now() - start).toBeLessThan(5000)
  expect(first.total).toBeGreaterThanOrEqual(800)
  const proposals = first.records.flatMap(record => record.motionEvidence?.proposal ?? [])
  expect(proposals.length).toBeGreaterThan(0)
  // 正式解析可能校验完整声明；建议阶段只校验单条记录的结束字段。
  const proposalChecks = () => validate.mock.calls.filter(([, scene]) => scene.records.length === 1)
  expect(proposalChecks()).toHaveLength(proposals.length)
  expect(proposalChecks().every(([, scene]) => Object.keys(scene.records[0].values).length === 1)).toBe(true)
  const count = proposalChecks().length
  expect(count).toBeLessThanOrEqual(5)
  expect(first.nextCursor).not.toBeNull()
  const next = queryVideoEditReviewCapability.outputSchema.parse(await queryVideoEditReview({ ...input, limit: 5, cursor: first.nextCursor }, { signal: new AbortController().signal }))
  expect(next.documentVersion).toBe(first.documentVersion)
  expect(proposalChecks().length - count).toBeGreaterThan(0)
  expect(proposalChecks().length - count).toBeLessThanOrEqual(5)
})

it('大量框的当前页建议在逐条校验之间响应取消，不改作品', async () => {
  const { owner, input } = await manyStaleBoxes(), before = owner.document
  const controller = new AbortController(), original = sceneDeclaration.validateCodeSceneRecords
  let checked = 0
  vi.spyOn(sceneDeclaration, 'validateCodeSceneRecords').mockImplementation((...args) => {
    if (args[1].records.length === 1 && ++checked === 1) setTimeout(() => controller.abort(new Error('取消片子数据建议')), 0)
    return original(...args)
  })
  const start = performance.now()
  await expect(queryVideoEditReview({ ...input, limit: 50 }, { signal: controller.signal })).rejects.toThrow('取消片子数据建议')
  expect(performance.now() - start).toBeLessThan(5000)
  expect(checked).toBeGreaterThan(0)
  expect(checked).toBeLessThan(50)
  expect(owner.document).toBe(before)
})

it('准备分页建议让出期间编辑文档，当前页拒绝返回且旧分页失效', async () => {
  const { owner, input } = await manyStaleBoxes(), signal = new AbortController().signal
  const first = queryVideoEditReviewCapability.outputSchema.parse(await queryVideoEditReview({ ...input, limit: 1 }, { signal }))
  expect(first.nextCursor).not.toBeNull()
  const original = sceneDeclaration.validateCodeSceneRecords
  let checked = 0, edited = false
  vi.spyOn(sceneDeclaration, 'validateCodeSceneRecords').mockImplementation((...args) => {
    if (args[1].records.length === 1 && ++checked === 1) setTimeout(() => {
      editVideoProject(owner.document.id, document => { document.scenes![0].name = '准备建议期间编辑'; return document })
      edited = true
    }, 0)
    return original(...args)
  })
  await expect(queryVideoEditReview({ ...input, limit: 50, cursor: first.nextCursor }, { signal })).rejects.toThrow('检查期间剪辑或跟踪结果已改变')
  expect(edited).toBe(true)
  expect(checked).toBeGreaterThan(0)
  expect(checked).toBeLessThan(50)
  await expect(queryVideoEditReview({ ...input, limit: 50, cursor: first.nextCursor }, { signal })).rejects.toThrow('分页已失效')
})

it('一项内容跨两刀的鼠标续放接缝分别报告', async () => {
  const { owner } = await fixture()
  attachRecording(owner)
  editVideoProject(owner.document.id, document => {
    const records = document.scenes![0].records
    document.scenes![0].records = [records[0], { ...records[1], values: { at: 0, src: 0, media: 'A' } },
      { id: 'cut-1', kind: 'cut', values: { from: 10, to: 12 } }, { id: 'cut-2', kind: 'cut', values: { from: 20, to: 22 } }]
    return document
  })
  vi.spyOn(recording, 'readRecordingClipEvents').mockResolvedValue([event(10, 100), event(12, 1000), event(20, 100), event(22, 1000)])
  const composition = videoEditComposition(owner.document, owner.document.sequences[0].id)
  const facts = await collectVideoEditSceneReview(owner.document.id, composition, { from: 0, to: 24000 }, { checks: ['scene_cursor_jump'], cursorJumpRatio: .08, minSeconds: .2 }, videoEditCodeDeclarationReader(owner), new AbortController().signal, () => {})
  expect(facts.map(fact => fact.timeline.from)).toEqual([300, 540])
})

it('同一段连续错位跨片段拆分点，拆分两侧的序列帧区间都保留', async () => {
  const { owner } = await fixture()
  editVideoProject(owner.document.id, document => {
    const clip = document.sequences[0].clips[0]
    document.sequences[0].clips = [{ ...clip, duration: 9450 }, { ...clip, id: 'split', start: 9450, sourceInUs: 315_000_000, duration: 2550 }]
    return document
  })
  const composition = videoEditComposition(owner.document, owner.document.sequences[0].id)
  const facts = await collectVideoEditSceneReview(owner.document.id, composition, { from: 0, to: 12000 }, { checks: ['scene_box_stale'], cursorJumpRatio: .08, minSeconds: .2 }, videoEditCodeDeclarationReader(owner), new AbortController().signal, () => {})
  expect(facts.map(fact => fact.timeline)).toEqual([{ from: 9428, to: 9450 }, { from: 9450, to: 9583 }])
  expect(facts.map(fact => fact.motionEvidence.proposal![0].value)).toEqual([314.26, 314.26])
})

it.each(['tuned', 'anchored', 'baked'] as const)('%s 值不给覆盖建议，文案说明原因', async mode => {
  const { owner } = await fixture()
  if (mode === 'baked') attachRecording(owner, true)
  editVideoProject(owner.document.id, document => {
    const record = document.scenes![0].records.find(record => record.id === 'box')!
    if (mode === 'tuned') record.tuned = ['dur']
    if (mode === 'anchored') record.values.at = { src: 10 }
    return document
  })
  if (mode === 'baked') vi.spyOn(recording, 'readRecordingClipEvents').mockResolvedValue(cursorEvents)
  const composition = videoEditComposition(owner.document, owner.document.sequences[0].id)
  const facts = await collectVideoEditSceneReview(owner.document.id, composition, { from: 0, to: 24000 }, { checks: [mode === 'baked' ? 'scene_cursor_jump' : 'scene_box_stale'], cursorJumpRatio: .08, minSeconds: .2 }, videoEditCodeDeclarationReader(owner), new AbortController().signal, () => {})
  expect(facts.length).toBeGreaterThan(0)
  expect(facts.every(fact => fact.motionEvidence.proposal === undefined)).toBe(true)
  expect(facts[0].motionEvidence.suggestion).toContain(mode === 'tuned' ? '手调过' : mode === 'anchored' ? '锚定' : '烘焙')
  if (mode !== 'baked') {
    expect(facts[0].motionEvidence.suggestion).toContain('尾部错位，未给收短建议的原因：')
    expect(facts[0].motionEvidence.suggestion).not.toContain('中段错位')
  }
  if (mode === 'anchored') expect(owner.document.scenes![0].records.find(record => record.id === 'box')!.values.at).toEqual({ src: 10 })
})

it('手调 cursor 保留跳动依据，既不给 proposal 也不建议直接关闭', async () => {
  const { owner } = await fixture()
  attachRecording(owner)
  editVideoProject(owner.document.id, document => {
    for (const record of document.scenes![0].records.filter(record => record.kind === 'shot')) { record.values.cursor = true; record.tuned = ['cursor'] }
    return document
  })
  vi.spyOn(recording, 'readRecordingClipEvents').mockResolvedValue(cursorEvents)
  const composition = videoEditComposition(owner.document, owner.document.sequences[0].id)
  const facts = await collectVideoEditSceneReview(owner.document.id, composition, { from: 0, to: 24000 }, { checks: ['scene_cursor_jump'], cursorJumpRatio: .08, minSeconds: .2 }, videoEditCodeDeclarationReader(owner), new AbortController().signal, () => {})
  expect(facts).toHaveLength(2)
  expect(facts.every(fact => !fact.motionEvidence.proposal && fact.motionEvidence.suggestion.includes('手调过') && !fact.motionEvidence.suggestion.includes('设为 false'))).toBe(true)
})

it('不可读引用变成警告，其他引用结果照常返回', async () => {
  const { owner } = await fixture()
  const composition = videoEditComposition(owner.document, owner.document.sequences[0].id), warnings: string[] = []
  const read = videoEditCodeDeclarationReader(owner), unavailable = composition.clips[1].code
  const facts = await collectVideoEditSceneReview(owner.document.id, composition, { from: 0, to: 24000 }, { checks: ['scene_box_stale'], cursorJumpRatio: .08, minSeconds: .2 }, code => code === unavailable ? undefined : read(code), new AbortController().signal, () => {}, 0, warnings)
  expect(facts).toHaveLength(1)
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toContain('未完成片子数据检查')
})

it.each([false, true])('minSeconds 使用播放秒，正确处理%s曲线变速', async remap => {
  const { owner } = await fixture()
  editVideoProject(owner.document.id, document => {
    const records = document.scenes![0].records, box = records.find(record => record.id === 'box')!
    document.scenes![0].records = [records[0], records[3], { ...box, values: { ...box.values, at: 0, dur: 3 } },
      ...[0, 1, 1.3].map((at, i) => ({ id: `s${i}`, kind: 'shot', parent: 'win', values: { at, src: 0, media: i === 1 ? 'B' : 'A', xf: 0, cursor: false } })),
    ]
    const clip = document.sequences[0].clips[0]
    document.sequences[0].clips = [{ ...clip, duration: 6000, ...(remap ? { timeRemap: { points: [{ offsetUs: 0, speed: 2, interpolation: 'hold' as const }] } } : { speed: { numerator: 2, denominator: 1 } }) }]
    return document
  })
  const collect = (minSeconds: number) => collectVideoEditSceneReview(owner.document.id, videoEditComposition(owner.document, owner.document.sequences[0].id), { from: 0, to: 6000 }, { checks: ['scene_box_stale'], cursorJumpRatio: .08, minSeconds }, videoEditCodeDeclarationReader(owner), new AbortController().signal, () => {})
  expect(await collect(.2)).toEqual([])
  expect(await collect(.1)).toHaveLength(1)
})

it('neighbors 建议调整相邻或新增落点，不以移动本落点开头冒充修复', async () => {
  const { owner } = await fixture(0, 'neighbors')
  const composition = videoEditComposition(owner.document, owner.document.sequences[0].id)
  const facts = await collectVideoEditSceneReview(owner.document.id, composition, { from: 9428, to: 9600 }, { checks: ['scene_box_stale'], cursorJumpRatio: .08, minSeconds: .2 }, videoEditCodeDeclarationReader(owner), new AbortController().signal, () => {})
  expect(facts).toHaveLength(1)
  expect(facts[0].motionEvidence.proposal).toBeUndefined()
  expect(facts[0].motionEvidence.suggestion).toContain('下一落点')
  expect(facts[0].motionEvidence.suggestion).toContain('新增')
  expect(facts[0].motionEvidence.suggestion).not.toContain('start_cut 挪到')
})

it('59.996 秒的建议时间码正确进位为 1:00.00', async () => {
  const { owner } = await fixture()
  editVideoProject(owner.document.id, document => {
    const records = document.scenes![0].records, box = records.find(record => record.id === 'box')!
    document.scenes![0].records = [records[0], records[3], { ...box, values: { ...box.values, at: 50, dur: 20 } },
      { ...records[1], values: { at: 0, src: 0, media: 'A', cursor: false } }, { ...records[2], values: { at: 59.996, src: 0, media: 'B', xf: 0, cursor: false } }]
    return document
  })
  const composition = videoEditComposition(owner.document, owner.document.sequences[0].id)
  const facts = await collectVideoEditSceneReview(owner.document.id, composition, { from: 0, to: 24000 }, { checks: ['scene_box_stale'], cursorJumpRatio: .08, minSeconds: .2 }, videoEditCodeDeclarationReader(owner), new AbortController().signal, () => {})
  expect(facts).toHaveLength(1)
  expect(facts[0].motionEvidence.suggestion).toContain('1:00.00')
  expect(facts[0].motionEvidence.suggestion).not.toContain('0:60.00')
})

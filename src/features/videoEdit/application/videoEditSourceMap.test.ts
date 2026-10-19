// @vitest-environment jsdom
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession } from '@/features/application-control/applicationCapabilityService'
import { queryVideoEditSourceMapCapability } from '@/core/application-control/domains/videoEdit/videoEditSourceMapCapability'
import { videoEditComposition } from '@/core/videoEdit/document'
import { videoEditTextMediaIdentity } from '@/core/videoEdit/textTranscript'
import { ScreenChangeAccumulator } from '@/core/videoEdit/screenChanges'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { getPlatform } from '@/platform/runtime'
import { closeAllVideoEdits, createVideoEditTestProject, reopenVideoEdit } from './videoEditDocumentTestKit'
import { editVideoProject, saveVideoEdit } from './videoEditService'
import { queryVideoEditSourceMap } from './videoEditSourceMap'

const identity = { sizeBytes: 123, fileModifiedAt: 1234, contentIdentity: 'source' }
const context = () => ({ signal: new AbortController().signal })
const parse = queryVideoEditSourceMapCapability.outputSchema.parse
beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue(identity)
  vi.spyOn(getPlatform().sceneDetection, 'onProgress').mockReturnValue(() => undefined)
})
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function fixture() {
  const owner = await createVideoEditTestProject(); const sequenceId = owner.document.sequences[0].id
  editVideoProject(owner.document.id, document => {
    document.media = [{ id: 'media', kind: 'video', name: '口播', path: path.resolve(path.sep, 'map-source.mp4'), width: 64, height: 64, durationSeconds: 30, hasAudio: true, assetContent: identity }]
    document.items = [{ id: 'item', kind: 'video', name: '口播', mediaId: 'media' }]
    const sequence = document.sequences[0]
    const base = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 30, duration: 60 })
    sequence.clips = [{ ...base, id: 'a', sourceInUs: 1000000, speed: { numerator: 2, denominator: 1 } }, { ...base, id: 'b', start: 120, sourceInUs: 1000000 }]
    sequence.textTranscription = { audioDocumentId: 'audio', sources: [{ itemId: 'item', mediaIdentity: videoEditTextMediaIdentity(videoEditComposition(document, sequence.id), 'item'), silences: [], blocks: [{ id: 'word', text: '打开后台', startFrame: 1500000, endFrame: 2000000, included: true, locked: false, granularity: 'word' }] }] }
    return document
  })
  return { owner, input: { documentRef: { kind: 'video_edit.document', id: owner.document.id }, sequenceRef: { kind: 'video_edit.sequence', id: `${owner.document.id}:${sequenceId}` }, from: 0, to: 180 } }
}

it('公共入口按成片范围读回重复实例来源；默认不读取文件、不识别、不修改作品或播放头', async () => {
  const { owner, input } = await fixture(); const app = createApplicationHarness()
  const before = structuredClone(owner.document); const past = owner.past.length; const frame = owner.frame
  const transcribe = vi.spyOn(getPlatform().audioEdit, 'transcribe')
  try {
    const result = parse(await app.requireResult('query_video_edit_source_map', input))
    expect(result).toMatchObject({ coverageBasis: 'timeline_structure', visibilityVerified: false, total: 4 })
    expect(result.records.filter(record => record.medium === 'video').map(record => record.path[0].clipRef.id)).toEqual([`${owner.document.id}:a`, `${owner.document.id}:b`])
    expect(result.records.every(record => record.content === null)).toBe(true)
    expect(getPlatform().assetLibrary.inspectFileContent).not.toHaveBeenCalled(); expect(transcribe).not.toHaveBeenCalled()
    expect(owner.document).toEqual(before); expect(owner.past.length).toBe(past); expect(owner.frame).toBe(frame)
  } finally { app.dispose() }
})
it('按需复用素材内容查询并把词源投影到每次放置，声音保留小数帧边界', async () => {
  const { owner, input } = await fixture()
  const result = parse(await queryVideoEditSourceMap({ ...input, includeContent: true, discoveryScope: 'none' }, context()))
  const audio = result.records.filter(record => record.medium === 'audio')
  expect(audio[0].content?.records[0]).toMatchObject({ record: { text: '打开后台', sourceVerified: true }, timelineRanges: [{ fromFrame: 37.5, toFrame: 45 }] })
  expect(audio[1].content?.records[0].timelineRanges).toEqual([{ fromFrame: 135, toFrame: 150 }])
  expect(result.records.filter(record => record.medium === 'video')[0].content?.records[0].timelineRanges).toEqual([{ fromFrame: 38, toFrame: 45 }])
  expect(vi.mocked(getPlatform().assetLibrary.inspectFileContent).mock.calls.length).toBe(6)
  const history = owner.past.length
  await saveVideoEdit(owner.document.id); const reopened = await reopenVideoEdit(owner.document.id)
  expect(parse(await queryVideoEditSourceMap({ ...input, includeContent: true, discoveryScope: 'none' }, context())).records[0].content?.records[0].record.text).toBe('打开后台')
  expect(reopened.past.length).toBeLessThanOrEqual(history)
})
it('分页有界、结果副本不污染缓存；改范围、筛选、剪辑或关闭重开后拒绝旧分页', async () => {
  const { owner, input } = await fixture()
  const first = parse(await queryVideoEditSourceMap({ ...input, limit: 1 }, context()))
  first.records[0].path[0].clipRef.id = 'polluted'
  const second = parse(await queryVideoEditSourceMap({ ...input, limit: 1, cursor: first.nextCursor }, context()))
  expect(second.records[0].path[0].clipRef.id).not.toBe('polluted')
  await expect(queryVideoEditSourceMap({ ...input, to: 90, cursor: first.nextCursor }, context())).rejects.toThrow('失效')
  await expect(queryVideoEditSourceMap({ ...input, mediums: ['video'], cursor: first.nextCursor }, context())).rejects.toThrow('失效')
  editVideoProject(owner.document.id, document => { document.sequences[0].clips[0].start = 0; return document })
  await expect(queryVideoEditSourceMap({ ...input, cursor: first.nextCursor }, context())).rejects.toThrow('失效')
  const fresh = parse(await queryVideoEditSourceMap({ ...input, limit: 1 }, context()))
  await reopenVideoEdit(owner.document.id)
  await expect(queryVideoEditSourceMap({ ...input, cursor: fresh.nextCursor }, context())).rejects.toThrow('失效')
})
it('原文件不可读或变化保留结构来源，明确内容证据不可用，不交付旧文字', async () => {
  const { input } = await fixture()
  vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockResolvedValue({ ...identity, contentIdentity: 'replaced' })
  const result = parse(await queryVideoEditSourceMap({ ...input, includeContent: true }, context()))
  expect(result.total).toBe(4)
  expect(result.records.every(record => record.content?.complete === false && record.content.records.length === 0 && record.content.error?.includes('原素材已改变'))).toBe(true)
  expect(result.warnings).toContainEqual(expect.stringContaining('未能读取'))
})
it('只读权限可查询，内容读取尊重跨域权限；取消或核对期间编辑不返回迟到映射', async () => {
  const { owner, input } = await fixture(); const app = createApplicationHarness()
  const grant = createApplicationCallerGrant({ callerId: 'map-read', capabilityIds: ['query_video_edit_source_map'], permissions: ['video_edit:read'], allowWrites: false, allowDestructive: false })
  const session = createApplicationCapabilitySession(grant)
  try {
    const response = await session.execute({ id: 'query_video_edit_source_map', version: 1, input: { ...input, includeContent: true } }, { ...context(), requestId: crypto.randomUUID() })
    expect(response).toMatchObject({ ok: true, data: { records: [{ content: { complete: false } }, { content: { complete: false } }, { content: { complete: false } }, { content: { complete: false } }] } })
    const controller = new AbortController(); controller.abort()
    await expect(queryVideoEditSourceMap(input, { signal: controller.signal })).rejects.toThrow()
    vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockImplementationOnce(async () => {
      editVideoProject(owner.document.id, document => { document.sequences[0].name = '人工修改'; return document }); return identity
    })
    await expect(queryVideoEditSourceMap({ ...input, includeContent: true }, context())).rejects.toThrow('内容改变')
    expect(owner.document.sequences[0].name).toBe('人工修改')
  } finally { app.dispose() }
})
it('半开帧范围、完整序列引用和输出预算由正式输入约束', async () => {
  const { input } = await fixture()
  expect(parse(await queryVideoEditSourceMap({ ...input, from: 90, to: 120 }, context())).total).toBe(0)
  expect(queryVideoEditSourceMapCapability.inputSchema.safeParse({ ...input, limit: 51 }).success).toBe(false)
  expect(queryVideoEditSourceMapCapability.inputSchema.safeParse({ ...input, to: 0 }).success).toBe(false)
  await expect(queryVideoEditSourceMap({ ...input, documentRef: { ...input.documentRef, id: 'other' } }, context())).rejects.toThrow('属于 documentRef')
})
it('显式画面证据投影到跨越切点的采样帧，点事件不伪造成持续区间', async () => {
  const { input } = await fixture()
  vi.spyOn(getPlatform().sceneDetection, 'detect').mockResolvedValue({ cutsSeconds: [1.5, 2], contentIdentity: 'a'.repeat(64) })
  const result = parse(await queryVideoEditSourceMap({ ...input, includeContent: true, contentKinds: ['scene'], discoveryScope: 'none' }, context()))
  const picture = result.records.find(record => record.medium === 'video')!
  expect(picture.content?.records.map(value => value.timelineRanges)).toEqual([[{ fromFrame: 38, toFrame: 38 }], [{ fromFrame: 45, toFrame: 45 }]])
  const sound = result.records.find(record => record.medium === 'audio')!
  expect(sound.content?.records[0].timelineRanges).toEqual([{ fromFrame: 37.5, toFrame: 37.5 }])
})
it('录屏局部突变沿同一内容入口投影到重复成片实例，区域与采样证据保留', async () => {
  const { input } = await fixture()
  const scan = new ScreenChangeAccumulator({ width: 2, height: 1, channels: 1, fps: 5, startSeconds: 1, endSeconds: 5 })
  for (let frame = 0; frame < 20; frame++) scan.push(Uint8Array.of(frame === 3 ? 255 : 0, 0))
  const detect = vi.spyOn(getPlatform().sceneDetection, 'detect').mockResolvedValue({ cutsSeconds: [], contentIdentity: 'a'.repeat(64), screenChanges: { coarse: scan.finish(), refinements: [], omittedCandidates: 1 } })
  const result = parse(await queryVideoEditSourceMap({ ...input, includeContent: true, contentKinds: ['screen_change'], discoveryScope: 'none', mediums: ['video'] }, context()))
  const first = result.records[0].content!.records[0]; const second = result.records[1].content!.records[0]
  expect(first.record).toMatchObject({ kind: 'screen_change', screenChange: { stage: 'coarse', region: { width: .5 } } })
  expect(first.timelineRanges).toEqual([{ fromFrame: 39, toFrame: 42 }])
  expect(second.timelineRanges).toEqual([{ fromFrame: 138, toFrame: 144 }])
  expect(detect).toHaveBeenCalledWith(expect.objectContaining({ analysis: 'screen_changes' }))
})
it('组合证据在交付前重新核对早先已读的来源，不能把中途替换的文件继续标为核实', async () => {
  const { input } = await fixture(); let reads = 0
  vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockImplementation(async () => ++reads <= 4 ? identity : { ...identity, contentIdentity: 'replaced-during-later-read' })
  await expect(queryVideoEditSourceMap({ ...input, includeContent: true, discoveryScope: 'none' }, context())).rejects.toThrow('原素材已改变')
})

// @vitest-environment jsdom
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage, harnessDocumentStore } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { getPlatform } from '@/platform/runtime'
import { videoEditComposition } from '@/core/videoEdit/document'
import { videoEditTextMediaIdentity } from '@/core/videoEdit/textTranscript'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { createRecordingDocument } from '@/core/screenRecording/document'
import { queryVideoEditContentCapability } from '@/core/application-control/domains/videoEdit/videoEditContentIndexCapability'
import { ScreenChangeAccumulator } from '@/core/videoEdit/screenChanges'
import { createApplicationCallerGrant, revokeApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession } from '@/features/application-control/applicationCapabilityService'
import { createAudioEditDraft, flushAudioEditProject } from '@/features/audioEdit'
import { editAudioEditProject, releaseAudioEditProject } from '@/features/audioEdit/application/audioEditProjectInstances'
import { closeAllVideoEdits, createVideoEditTestProject, reopenVideoEdit } from './videoEditDocumentTestKit'
import { editVideoProject, saveVideoEdit, subscribeVideoEdit } from './videoEditService'
import { readVideoEditContentIndex } from './videoEditContentIndex'
import { readVideoEditContentQueries } from './videoEditContentQueryProgress'
import { mediaContentQueryProgressSchema } from '@/core/media/contentIndex'

const identity = { sizeBytes: 123, fileModifiedAt: 1234, contentIdentity: 'original' }
const context = () => ({ signal: new AbortController().signal })
const audioIds: string[] = []
beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue(identity)
  vi.spyOn(getPlatform().sceneDetection, 'onProgress').mockReturnValue(() => undefined)
})
afterEach(async () => {
  await closeAllVideoEdits()
  for (const id of audioIds.splice(0)) await releaseAudioEditProject(id)
  vi.restoreAllMocks(); uninstallHarnessNativeStorage()
})
async function fixture(count = 70) {
  const owner = await createVideoEditTestProject()
  const sourcePath = path.resolve(path.sep, 'index-source.mp4')
  editVideoProject(owner.document.id, document => { document = structuredClone(document);
    document.media = [{ id: 'media', name: '口播', kind: 'video', path: sourcePath, width: 64, height: 64, durationSeconds: 300, hasAudio: true, assetContent: identity }]
    document.items = [{ id: 'item', name: '口播', kind: 'video', mediaId: 'media' }, { id: 'other', name: '重复引用', kind: 'video', mediaId: 'media' }]
    const sequence = document.sequences[0]
    sequence.clips = [{ ...makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, duration: 300 }), id: 'clip' }]
    sequence.textTranscription = { audioDocumentId: 'saved-audio', sources: [{ itemId: 'item', mediaIdentity: videoEditTextMediaIdentity(videoEditComposition(document, sequence.id), 'item'), silences: [], blocks: Array.from({ length: count }, (_, i) => ({ id: `word-${i}`, text: `打开后台${i}`, startFrame: i * 1000000, endFrame: i * 1000000 + 500000, included: true, locked: false, granularity: 'word' as const })) }] }
    return document
  })
  const input = { documentRef: { kind: 'video_edit.document', id: owner.document.id }, itemRef: { kind: 'video_edit.item', id: `${owner.document.id}:item` }, text: '打开后台', limit: 2 }
  return { owner, input, sourcePath }
}
const parse = queryVideoEditContentCapability.outputSchema.parse

it('公共入口按源时间分页且不识别、不写文档、不改变历史；保存重开读回校对', async () => {
  const { owner, input } = await fixture()
  const app = createApplicationHarness(); const before = structuredClone(owner.document); const past = owner.past.length
  const recognize = vi.spyOn(getPlatform().audioEdit, 'transcribe')
  try {
    const first = parse(await app.requireResult('query_video_edit_content', input))
    expect(first).toMatchObject({ sourceVerified: true, total: 70, records: [{ text: '打开后台0' }, { text: '打开后台1' }] })
    expect(first.records[0].ranges).toEqual([{ fromUs: 0, toUs: 500000 }])
    const second = parse(await app.requireResult('query_video_edit_content', { ...input, cursor: first.nextCursor }))
    expect(second.records.map(record => record.text)).toEqual(['打开后台2', '打开后台3'])
    expect(owner.document).toEqual(before); expect(owner.past.length).toBe(past); expect(recognize).not.toHaveBeenCalled()
    editVideoProject(owner.document.id, document => { document = structuredClone(document); document.sequences[0].captions = [{ id: 'caption', text: '人工校对', start: 0, duration: 15, clipId: 'clip' }]; return document })
    await saveVideoEdit(owner.document.id); await reopenVideoEdit(owner.document.id)
    expect(parse(await app.requireResult('query_video_edit_content', { ...input, text: '人工校对', kinds: ['caption'] })).records).toMatchObject([{ basis: 'timeline', text: '人工校对' }])
  } finally { app.dispose() }
})
it('分页拒绝换目标、换条件、内容变化及关闭重开；输出不能污染缓存', async () => {
  const { owner, input } = await fixture()
  const raw = await readVideoEditContentIndex(input, context())
  const first = parse(raw)
  ;(raw.records as Array<{ text: string }>)[0].text = 'polluted'
  expect(parse(await readVideoEditContentIndex({ ...input, cursor: `${first.nextCursor!.split(':')[0]}:0` }, context())).records[0].text).toBe('打开后台0')
  await expect(readVideoEditContentIndex({ ...input, itemRef: { ...input.itemRef, id: `${owner.document.id}:other` }, cursor: first.nextCursor }, context())).rejects.toThrow('失效')
  await expect(readVideoEditContentIndex({ ...input, text: '改变', cursor: first.nextCursor }, context())).rejects.toThrow('失效')
  editVideoProject(owner.document.id, document => { document = structuredClone(document); document.sequences[0].name = '移动后'; return document })
  await expect(readVideoEditContentIndex({ ...input, cursor: first.nextCursor }, context())).rejects.toThrow('失效')
  const fresh = parse(await readVideoEditContentIndex(input, context()))
  expect(fresh.records[0].text).toBe('打开后台0')
  await reopenVideoEdit(owner.document.id)
  await expect(readVideoEditContentIndex({ ...input, cursor: fresh.nextCursor }, context())).rejects.toThrow('失效')
})
it('文件被替换或查询期间被编辑均拒绝迟到结果；未绑定身份明确提示', async () => {
  const { owner, input } = await fixture()
  const inspect = vi.mocked(getPlatform().assetLibrary.inspectFileContent)
  inspect.mockResolvedValueOnce({ ...identity, contentIdentity: 'changed' })
  await expect(readVideoEditContentIndex(input, context())).rejects.toThrow('原素材已改变')
  inspect.mockResolvedValueOnce(identity).mockImplementationOnce(async () => {
    editVideoProject(owner.document.id, document => { document = structuredClone(document); document.sequences[0].name = '异步修改'; return document })
    return identity
  })
  await expect(readVideoEditContentIndex(input, context())).rejects.toThrow('关联内容已改变')
  editVideoProject(owner.document.id, document => { document = structuredClone(document); document.media[0].assetContent = undefined; return document })
  expect(parse(await readVideoEditContentIndex(input, context()))).toMatchObject({ sourceVerified: false, warnings: [expect.stringContaining('文件身份')] })
})
it('文件身份字段顺序不影响分页，查询期间文件变化会拒绝', async () => {
  const { input } = await fixture()
  const first = parse(await readVideoEditContentIndex(input, context()))
  const inspect = vi.mocked(getPlatform().assetLibrary.inspectFileContent)
  inspect.mockResolvedValue({ fileModifiedAt: 1234, sizeBytes: 123, contentIdentity: 'original' })
  expect(parse(await readVideoEditContentIndex({ ...input, cursor: first.nextCursor }, context())).records[0].text).toBe('打开后台2')
  inspect.mockResolvedValueOnce(identity).mockResolvedValueOnce({ ...identity, sizeBytes: 124 })
  await expect(readVideoEditContentIndex(input, context())).rejects.toThrow('原素材已改变')
})
it('公共只读授权可查询，但不能越权读取关联口播或录制', async () => {
  const { input } = await fixture()
  const app = createApplicationHarness()
  const grant = createApplicationCallerGrant({ callerId: 'index-read' })
  const session = createApplicationCapabilitySession(grant)
  const call = (extra: Record<string, unknown>) => session.execute({ id: 'query_video_edit_content', version: 1, input: { ...input, ...extra } }, { requestId: crypto.randomUUID(), ...context() })
  try {
    expect(await call({})).toMatchObject({ ok: true })
    expect(await call({ audioDocumentRef: { kind: 'audio_edit.document', id: 'audio' } })).toMatchObject({ ok: false })
    expect(await call({ recordingRef: { kind: 'screen_recording.session', id: 'recording' } })).toMatchObject({ ok: false })
  } finally { app.dispose() }
})
it('同源口播读取当前校对并验证源文件；跨源与过期分页拒绝', async () => {
  const { input, sourcePath } = await fixture()
  const audio = await createAudioEditDraft({ sourcePath, audioPath: sourcePath, mediaType: 'video', durationFrames: 10000, sampleRate: 1000, channels: 1 })
  audioIds.push(audio.document.id)
  editAudioEditProject(audio.document.id, document => ({ ...document, transcript: [{ id: 'word', text: '口播校对', startFrame: 1000, endFrame: 2000, granularity: 'word', included: true, locked: false }] }))
  const verify = vi.spyOn(getPlatform().audioEdit, 'verifySource').mockResolvedValue()
  const query = { ...input, text: '口播校对', audioDocumentRef: { kind: 'audio_edit.document', id: audio.document.id } }
  expect(parse(await readVideoEditContentIndex(query, context())).records).toMatchObject([{ text: '口播校对', ranges: [{ fromUs: 1000000, toUs: 2000000 }] }])
  expect(verify).toHaveBeenCalledWith(audio.document.id)
  const other = await createAudioEditDraft({ ...audio.document.source, sourcePath: path.resolve(path.sep, 'other.wav') }); audioIds.push(other.document.id)
  await expect(readVideoEditContentIndex({ ...query, audioDocumentRef: { kind: 'audio_edit.document', id: other.document.id } }, context())).rejects.toThrow('原文件与目标素材不同')
  verify.mockRejectedValueOnce(new Error('SOURCE_CHANGED'))
  await expect(readVideoEditContentIndex(query, context())).rejects.toThrow('SOURCE_CHANGED')
})
it('录制步骤与章节按同源媒体投影；改过的理解结果使分页失效', async () => {
  const { input, sourcePath } = await fixture()
  const recording = createRecordingDocument(); recording.status = 'stopped'
  recording.media = [{ id: 'screen', kind: 'screen', path: sourcePath, monoUs: 1000000, durationUs: 10000000 }]
  recording.understanding.steps = Array.from({ length: 3 }, (_, i) => ({ id: `step-${i}`, title: `步骤${i}`, description: '', startUs: 1000000 + i * 1000000, endUs: 1500000 + i * 1000000, signal: 'click' as const, eventIds: [] }))
  const meta = harnessDocumentStore().seed({ kind: 'screen_recording', name: '录制', content: recording })
  const query = { ...input, text: '步骤', recordingRef: { kind: 'screen_recording.session', id: meta.id } }
  const first = parse(await readVideoEditContentIndex(query, context()))
  expect(first).toMatchObject({ sourceVerified: true, warnings: [expect.stringContaining('未保存文件身份')] })
  expect(first.records[0]).toMatchObject({ text: '步骤0', ranges: [{ fromUs: 0, toUs: 500000 }], basis: 'saved', sourceVerified: false })
  const stored = harnessDocumentStore().stored(meta.id)!
  stored.meta.revision++
  await expect(readVideoEditContentIndex({ ...query, cursor: first.nextCursor }, context())).rejects.toThrow('失效')
})
it('显式声音分析检查全部声道路由的共同低谷；失败后可重新查询', async () => {
  const { owner, input } = await fixture()
  editVideoProject(owner.document.id, document => { document = structuredClone(document); document.items[0].audioChannels = [{ format: 'mono', sources: [{ stream: 0, channel: 0 }] }, { format: 'mono', sources: [{ stream: 1, channel: 0 }] }]; return document })
  const detect = vi.spyOn(getPlatform().audioEdit, 'detectSilence')
  const result = (startMs: number, endMs: number) => ({ revision: 0, suggestions: [], energy: { resolutionMs: 10, thresholdDb: -40, highThresholdDb: -45, pauses: [{ startMs, endMs, cutMs: (startMs + endMs) / 2 }] } })
  detect.mockResolvedValueOnce(result(1000, 2000)).mockResolvedValueOnce(result(1500, 2500))
  const query = { ...input, text: undefined, kinds: ['pause'], fromUs: 0, toUs: 5000000 }
  expect(parse(await readVideoEditContentIndex(query, context())).records).toMatchObject([{ ranges: [{ fromUs: 1500000, toUs: 2000000 }], basis: 'analysis' }])
  expect(detect.mock.calls.map(call => call[0].energy?.channels)).toEqual([[{ stream: 0, channel: 0 }], [{ stream: 1, channel: 0 }]])
  detect.mockRejectedValueOnce(new Error('解码失败'))
  await expect(readVideoEditContentIndex(query, context())).rejects.toThrow('解码失败')
  detect.mockResolvedValue(result(1000, 2000))
  expect(parse(await readVideoEditContentIndex(query, context())).records).toHaveLength(1)
})
it('已取消查询不启动分析，进行中取消转交原声音任务', async () => {
  const { input } = await fixture(); const controller = new AbortController()
  const cancel = vi.spyOn(getPlatform().audioEdit, 'cancelTask').mockResolvedValue()
  const detect = vi.spyOn(getPlatform().audioEdit, 'detectSilence').mockImplementation(async () => { controller.abort(); return { revision: 0, suggestions: [], energy: { resolutionMs: 10, thresholdDb: -40, highThresholdDb: -45, pauses: [] } } })
  const query = { ...input, text: undefined, kinds: ['pause'] }
  await expect(readVideoEditContentIndex(query, { signal: controller.signal })).rejects.toThrow()
  expect(cancel).toHaveBeenCalledWith(expect.any(String)); expect(detect).toHaveBeenCalledTimes(1)
  await expect(readVideoEditContentIndex(query, { signal: controller.signal })).rejects.toThrow()
  expect(detect).toHaveBeenCalledTimes(1)
})

it('局部变化经正式公共入口查询，优先返回密集证据并保留未复核候选及预算提示', async () => {
  const { owner, input } = await fixture(); const app = createApplicationHarness()
  const coarse = new ScreenChangeAccumulator({ width: 2, height: 1, channels: 1, fps: 5, startSeconds: 1, endSeconds: 5 })
  const dense = new ScreenChangeAccumulator({ width: 2, height: 1, channels: 1, fps: 30, startSeconds: 1, endSeconds: 2 })
  for (let frame = 0; frame < 20; frame++) coarse.push(Uint8Array.of(frame === 3 || frame === 13 ? 255 : 0, 0))
  for (let frame = 0; frame < 30; frame++) dense.push(Uint8Array.of(frame >= 16 && frame <= 20 ? 255 : 0, 0))
  const detect = vi.spyOn(getPlatform().sceneDetection, 'detect').mockResolvedValue({ cutsSeconds: [], contentIdentity: 'a'.repeat(64),
    screenChanges: { coarse: coarse.finish(), refinements: [{ fromSeconds: 1, toSeconds: 2, scan: dense.finish() }], omittedCandidates: 1 } })
  const before = structuredClone(owner.document); const frame = owner.frame; const history = owner.past.length
  const query = { ...input, text: undefined, kinds: ['screen_change'], discoveryScope: 'none', fromUs: 1000000, toUs: 5000000, limit: 1 }
  try {
    const result = parse(await app.requireResult('query_video_edit_content', query))
    expect(result).toMatchObject({ total: 3, records: [{ kind: 'screen_change', sourceVerified: true, basis: 'analysis', screenChange: { kind: 'transient', stage: 'refined', samplingFps: 30, region: { width: .5 } } }] })
    expect(result.warnings).toContainEqual(expect.stringContaining('1 个粗扫候选'))
    expect(detect).toHaveBeenCalledWith(expect.objectContaining({ analysis: 'screen_changes', startSeconds: 1, endSeconds: 5 }))
    const next = parse(await app.requireResult('query_video_edit_content', { ...query, cursor: result.nextCursor }))
    expect(next.records[0]).toMatchObject({ screenChange: { stage: 'refined', samplingFps: 30 } })
    expect(parse(await app.requireResult('query_video_edit_content', { ...query, cursor: next.nextCursor })).records[0]).toMatchObject({ screenChange: { stage: 'coarse', samplingFps: 5 } })
    expect(detect).toHaveBeenCalledOnce()
    expect(owner.document).toEqual(before); expect(owner.frame).toBe(frame); expect(owner.past.length).toBe(history)
  } finally { app.dispose() }
})

it('画面变化使用源范围及原检测通道；分页不再次解码，取消与失败可恢复', async () => {
  const { input } = await fixture()
  const detect = vi.spyOn(getPlatform().sceneDetection, 'detect').mockResolvedValue({ cutsSeconds: [1, 2, 3], contentIdentity: 'a'.repeat(64) })
  const cancel = vi.spyOn(getPlatform().sceneDetection, 'cancel').mockResolvedValue()
  const query = { ...input, text: undefined, kinds: ['scene'], fromUs: 1000000, toUs: 3000000, limit: 1 }
  const first = parse(await readVideoEditContentIndex(query, context()))
  expect(first).toMatchObject({ total: 2, records: [{ precision: 'point', ranges: [{ fromUs: 1000000, toUs: 1000000 }] }] })
  expect(detect).toHaveBeenCalledWith(expect.objectContaining({ startSeconds: 1, endSeconds: 3, source: expect.any(String) }))
  expect(parse(await readVideoEditContentIndex({ ...query, cursor: first.nextCursor }, context())).records[0].ranges[0].fromUs).toBe(2000000)
  expect(detect).toHaveBeenCalledTimes(1)
  const controller = new AbortController()
  detect.mockImplementationOnce(async () => { controller.abort(); return { cutsSeconds: [], contentIdentity: 'a'.repeat(64) } })
  await expect(readVideoEditContentIndex(query, { signal: controller.signal })).rejects.toThrow()
  expect(cancel).toHaveBeenCalledWith(expect.any(String))
  detect.mockRejectedValueOnce(new Error('视频解码失败'))
  await expect(readVideoEditContentIndex(query, context())).rejects.toThrow('视频解码失败')
  expect(parse(await readVideoEditContentIndex(query, context())).total).toBe(2)
})

it('输出最多五十条，子素材查询限制源范围且不接受跨文档引用', async () => {
  const { owner, input } = await fixture()
  expect(parse(await readVideoEditContentIndex({ ...input, limit: 50 }, context())).records).toHaveLength(50)
  expect(queryVideoEditContentCapability.inputSchema.safeParse({ ...input, limit: 51 }).success).toBe(false)
  editVideoProject(owner.document.id, document => { document = structuredClone(document); document.items[0].sourceRange = { inUs: 2000000, outUs: 4000000 }; return document })
  expect(parse(await readVideoEditContentIndex(input, context())).records.map(record => record.text)).toEqual(['打开后台2', '打开后台3'])
  await expect(readVideoEditContentIndex({ ...input, documentRef: { ...input.documentRef, id: 'another-document' } }, context())).rejects.toThrow('属于 documentRef')
})

it('静态图片可查询创作提示词，意图不冒充画面识别且不启动无效分析', async () => {
  const { owner, input } = await fixture()
  editVideoProject(owner.document.id, document => { document = structuredClone(document);
    document.media.push({ id: 'image', name: '生成图', kind: 'image', path: path.resolve(path.sep, 'generated.png'), width: 64, height: 64, durationSeconds: 0, assetContent: identity, creativeSource: { type: 'generation', recordId: 'generation', outputIndex: 0, prompt: '打开后台的示意图' } })
    document.items.push({ id: 'image-item', name: '生成图', kind: 'image', mediaId: 'image' })
    return document
  })
  const detect = vi.spyOn(getPlatform().sceneDetection, 'detect')
  const audio = vi.spyOn(getPlatform().audioEdit, 'detectSilence')
  const result = parse(await readVideoEditContentIndex({ ...input, itemRef: { ...input.itemRef, id: `${owner.document.id}:image-item` }, kinds: ['description', 'pause', 'scene'] }, context()))
  expect(result.records).toMatchObject([{ kind: 'description', basis: 'intent', ranges: [{ fromUs: 0, toUs: 0 }] }])
  expect(result.warnings).toHaveLength(2)
  expect(detect).not.toHaveBeenCalled(); expect(audio).not.toHaveBeenCalled()
})

it('已核实素材不吸收同路径未绑定的旧词源，显式查询旧项仍明确未核实', async () => {
  const { owner, input } = await fixture()
  editVideoProject(owner.document.id, document => { document = structuredClone(document);
    document.media.push({ ...document.media[0], id: 'unverified-media', assetContent: undefined })
    document.items.push({ ...document.items[0], id: 'unverified-item', mediaId: 'unverified-media' })
    const sequence = document.sequences[0]
    sequence.textTranscription!.sources.push({ itemId: 'unverified-item', mediaIdentity: videoEditTextMediaIdentity(videoEditComposition(document, sequence.id), 'unverified-item'), silences: [], blocks: [{ id: 'old-word', text: '未核实的旧转录', startFrame: 0, endFrame: 1000000, included: true, locked: false, granularity: 'word' }] })
    return document
  })
  expect(parse(await readVideoEditContentIndex({ ...input, text: '旧转录' }, context()))).toMatchObject({ sourceVerified: true, records: [], warnings: [expect.stringContaining('已排除')] })
  expect(parse(await readVideoEditContentIndex({ ...input, itemRef: { ...input.itemRef, id: `${owner.document.id}:unverified-item` }, text: '旧转录' }, context()))).toMatchObject({ sourceVerified: false, records: [{ text: '未核实的旧转录' }] })
})

function seedRelatedRecording(owner: Awaited<ReturnType<typeof fixture>>['owner'], sourcePath: string, name = '关联录制', inProject = true) {
  const content = createRecordingDocument(); content.status = 'stopped'
  content.media = [{ id: 'screen', kind: 'screen', path: sourcePath, monoUs: 1000000, durationUs: 10000000 }]
  content.understanding.steps = Array.from({ length: 3 }, (_, i) => ({ id: `step-${i}`, title: `自动发现${i}`, description: '', startUs: 1000000 + i * 1000000, endUs: 1500000 + i * 1000000, signal: 'click' as const, eventIds: [] }))
  const container = owner.session.documentMeta.container
  return harnessDocumentStore().seed({ kind: 'screen_recording', name, content, ...(inProject && container.kind === 'project' ? { projectId: container.projectId } : {}) })
}

it('默认只发现项目内文档，显式全局可扩大范围，none 不扫描目录', async () => {
  const { owner, input, sourcePath } = await fixture()
  const local = seedRelatedRecording(owner, sourcePath)
  const external = seedRelatedRecording(owner, sourcePath, '独立录制', false)
  seedRelatedRecording(owner, path.resolve(path.sep, 'different-source.mp4'), '其他文件')
  const query = { ...input, text: '自动发现', kinds: ['description'], limit: 50 }
  const localResult = parse(await readVideoEditContentIndex(query, context()))
  expect(localResult).toMatchObject({ discovery: { scope: 'project', complete: true, scannedDocuments: 2, matchedDocuments: 1 }, total: 3 })
  expect(localResult.records.every(record => record.originRef.id === local.id && !record.sourceVerified)).toBe(true)
  const global = parse(await readVideoEditContentIndex({ ...query, discoveryScope: 'all' }, context()))
  expect(new Set(global.records.map(record => record.originRef.id))).toEqual(new Set([local.id, external.id]))
  const list = vi.spyOn(getPlatform().documents, 'listDocumentsPage')
  expect(parse(await readVideoEditContentIndex({ ...query, discoveryScope: 'none' }, context()))).toMatchObject({ records: [], discovery: { scope: 'none', complete: true, scannedDocuments: 0 } })
  expect(list).not.toHaveBeenCalled()
})

it('项目自动发现当前未保存口播；不把剪后导出音频当成原文件', async () => {
  const { owner, input, sourcePath } = await fixture()
  const audio = await createAudioEditDraft({ sourcePath, audioPath: sourcePath, mediaType: 'video', durationFrames: 10000, sampleRate: 1000, channels: 1 }, owner.session.documentMeta.container)
  audioIds.push(audio.document.id)
  const verify = vi.spyOn(getPlatform().audioEdit, 'verifySource').mockResolvedValue()
  editAudioEditProject(audio.document.id, document => ({ ...document, transcript: Array.from({ length: 3 }, (_, i) => ({ id: `word${i}`, text: `口播校对${i}`, startFrame: i * 1000, endFrame: i * 1000 + 500, granularity: 'word' as const, included: true, locked: false })) }))
  const query = { ...input, text: '口播校对', limit: 1 }
  const first = parse(await readVideoEditContentIndex(query, context()))
  expect(first).toMatchObject({ total: 3, records: [{ sourceVerified: true, originRef: { id: audio.document.id } }] })
  expect(verify).toHaveBeenCalledWith(audio.document.id)
  expect(parse(await readVideoEditContentIndex({ ...query, cursor: first.nextCursor }, context())).records[0].text).toBe('口播校对1')
  editAudioEditProject(audio.document.id, document => ({ ...document, transcript: document.transcript.map(block => ({ ...block, text: '再次校对' })) }))
  await expect(readVideoEditContentIndex({ ...query, cursor: first.nextCursor }, context())).rejects.toThrow('失效')
  editVideoProject(owner.document.id, document => { document = structuredClone(document);
    document.media[0].path = path.resolve(path.sep, 'edited-export.wav')
    document.media[0].creativeSource = { type: 'document', docRef: { docId: audio.document.id, path: audio.session.documentMeta.path } }
    return document
  })
  expect(parse(await readVideoEditContentIndex({ ...query, text: '再次校对' }, context())).total).toBe(0)
})

it('冷口播加载后可继续翻页，关闭重开同版本实例使旧分页失效', async () => {
  const { owner, input, sourcePath } = await fixture()
  const audio = await createAudioEditDraft({ sourcePath, audioPath: sourcePath, mediaType: 'video', durationFrames: 10000, sampleRate: 1000, channels: 1 }, owner.session.documentMeta.container)
  audioIds.push(audio.document.id)
  editAudioEditProject(audio.document.id, document => ({ ...document, transcript: [0, 1, 2].map(i => ({ id: `w${i}`, text: `冷文档${i}`, startFrame: i * 1000, endFrame: i * 1000 + 500, granularity: 'word' as const, included: true, locked: false })) }))
  await flushAudioEditProject(audio.document.id); await releaseAudioEditProject(audio.document.id)
  const verify = vi.spyOn(getPlatform().audioEdit, 'verifySource').mockResolvedValue()
  const query = { ...input, text: '冷文档', limit: 1 }
  verify.mockRejectedValueOnce(new Error('SOURCE_CHANGED'))
  expect(parse(await readVideoEditContentIndex(query, context()))).toMatchObject({ total: 0, discovery: { complete: false }, warnings: [expect.stringContaining('不完整')] })
  const first = parse(await readVideoEditContentIndex(query, context()))
  expect(first.total).toBe(3)
  expect(parse(await readVideoEditContentIndex({ ...query, cursor: first.nextCursor }, context())).records[0].text).toBe('冷文档1')
  await releaseAudioEditProject(audio.document.id)
  await expect(readVideoEditContentIndex({ ...query, cursor: first.nextCursor }, context())).rejects.toThrow('失效')
})

it('关联目录按页扫描，不重复读取未改变的无关正文；新增、删除和改动使分页失效', async () => {
  const { owner, input, sourcePath } = await fixture()
  const target = seedRelatedRecording(owner, sourcePath)
  for (let i = 0; i < 103; i++) seedRelatedRecording(owner, path.resolve(path.sep, `other-${i}.mp4`), `无关录制${i}`)
  const list = vi.spyOn(getPlatform().documents, 'listDocumentsPage')
  const read = vi.spyOn(getPlatform().documents, 'readDocument')
  const query = { ...input, text: '自动发现', limit: 1 }
  const first = parse(await readVideoEditContentIndex(query, context()))
  expect(first.discovery.scannedDocuments).toBe(104)
  expect(list.mock.calls.some(([request]) => request?.cursor)).toBe(true)
  read.mockClear()
  expect(parse(await readVideoEditContentIndex({ ...query, cursor: first.nextCursor }, context())).records[0].text).toBe('自动发现1')
  expect(read.mock.calls.every(([request]) => request.id === target.id)).toBe(true)
  const added = seedRelatedRecording(owner, sourcePath, '新录制')
  await expect(readVideoEditContentIndex({ ...query, cursor: first.nextCursor }, context())).rejects.toThrow('失效')
  const fresh = parse(await readVideoEditContentIndex(query, context()))
  harnessDocumentStore().documents.delete(added.id)
  await expect(readVideoEditContentIndex({ ...query, cursor: fresh.nextCursor }, context())).rejects.toThrow('失效')
  const next = parse(await readVideoEditContentIndex(query, context()))
  harnessDocumentStore().stored(target.id)!.meta.revision++
  await expect(readVideoEditContentIndex({ ...query, cursor: next.nextCursor }, context())).rejects.toThrow('失效')
})

it('自动发现损坏文档明确不完整且修复后可重试', async () => {
  const { owner, input, sourcePath } = await fixture()
  const recording = seedRelatedRecording(owner, sourcePath)
  const query = { ...input, text: '自动发现' }
  const stored = harnessDocumentStore().stored(recording.id)!; const content = stored.content
  stored.content = { media: 'broken' }
  expect(parse(await readVideoEditContentIndex(query, context()))).toMatchObject({ total: 0, discovery: { complete: false }, warnings: [expect.stringContaining('不完整')] })
  stored.content = content
  expect(parse(await readVideoEditContentIndex(query, context()))).toMatchObject({ total: 3, discovery: { complete: true } })
})

it('目录读取失败保留已有结果并报告不完整，发现期间取消或变化不返回迟到结果', async () => {
  const { owner, input, sourcePath } = await fixture()
  seedRelatedRecording(owner, sourcePath)
  const original = getPlatform().documents.listDocumentsPage.bind(getPlatform().documents)
  const list = vi.spyOn(getPlatform().documents, 'listDocumentsPage')
  list.mockImplementation(async request => {
    if (request?.kind === 'audio_edit') throw new Error('无法读取目录')
    return original(request)
  })
  expect(parse(await readVideoEditContentIndex({ ...input, text: '自动发现' }, context()))).toMatchObject({ total: 3, discovery: { complete: false } })
  list.mockImplementation(original)
  const controller = new AbortController()
  list.mockImplementationOnce(async request => { const page = await original(request); controller.abort(); return page })
  await expect(readVideoEditContentIndex(input, { signal: controller.signal })).rejects.toThrow()
  const readOriginal = getPlatform().documents.readDocument.bind(getPlatform().documents)
  const read = vi.spyOn(getPlatform().documents, 'readDocument')
  read.mockImplementationOnce(async target => { const result = await readOriginal(target); seedRelatedRecording(owner, sourcePath, '查询中新建'); return result })
  await expect(readVideoEditContentIndex(input, context())).rejects.toThrow('目录或内容已改变')
})

it('查询期间经正式素材属性读到真实阶段进度，查询完成不改变作品或历史；进度不可伪造', async () => {
  const { owner, input } = await fixture()
  const app = createApplicationHarness(); const before = structuredClone(owner.document); const past = owner.past.length
  let report!: (event: { requestId: string; progress: number }) => void
  const unsubscribe = vi.fn()
  vi.mocked(getPlatform().sceneDetection.onProgress).mockImplementation(listener => { report = listener; return unsubscribe })
  let accept!: (value: { cutsSeconds: number[]; contentIdentity: string }) => void
  let started!: (id: string) => void
  const ready = new Promise<string>(resolve => { started = resolve })
  vi.spyOn(getPlatform().sceneDetection, 'detect').mockImplementation(request => { started(request.requestId); return new Promise(resolve => { accept = resolve }) })
  const query = app.requireResult('query_video_edit_content', { ...input, kinds: ['scene'], text: undefined })
  const requestId = await ready
  const read = async () => await app.requireResult('read_application_entity', { ref: input.itemRef, propertyIds: ['video_edit.item.content_queries'] })
  try {
    report({ requestId: 'unrelated-request', progress: .9 })
    expect(readVideoEditContentQueries(owner, 'item')[0]).toMatchObject({ state: 'running', phase: 'analyzing_video', phaseProgress: null })
    report({ requestId, progress: .4 })
    const result = await read()
    expect(result).toMatchObject({ properties: { 'video_edit.item.content_queries': [{ state: 'running', phase: 'analyzing_video', phaseProgress: .4, totalUnits: null }] } })
    const rejected = await app.call('change_application_entities', { summary: '伪造进度', changes: [{ kind: 'set_properties', target: input.itemRef, entityType: 'video_edit.item', properties: { 'video_edit.item.content_queries': [] } }] })
    expect(rejected.ok).toBe(false)
    accept({ cutsSeconds: [1], contentIdentity: 'a'.repeat(64) })
    expect(parse(await query).total).toBe(1)
    expect(readVideoEditContentQueries(owner, 'item')[0]).toMatchObject({ state: 'completed', phase: 'finished', phaseProgress: 1 })
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(owner.document).toEqual(before); expect(owner.past.length).toBe(past)
    await saveVideoEdit(owner.document.id); const reopened = await reopenVideoEdit(owner.document.id)
    expect(readVideoEditContentQueries(reopened, 'item')).toEqual([])
  } finally { app.dispose() }
})

it('文档扫描与声音声道路数进度可读，失败状态保留后原入口可重试', async () => {
  const { owner, input, sourcePath } = await fixture()
  seedRelatedRecording(owner, sourcePath)
  editVideoProject(owner.document.id, document => { document = structuredClone(document); document.items[0].audioChannels = [{ format: 'mono', sources: [{ stream: 0, channel: 0 }] }, { format: 'mono', sources: [{ stream: 1, channel: 0 }] }]; return document })
  const seen: ReturnType<typeof readVideoEditContentQueries> = []
  const unsubscribe = subscribeVideoEdit(() => { const last = readVideoEditContentQueries(owner, 'item').at(-1); if (last) seen.push(last) })
  const detect = vi.spyOn(getPlatform().audioEdit, 'detectSilence').mockImplementation(async () => {
    const current = readVideoEditContentQueries(owner, 'item').at(-1)
    if (current) seen.push(current)
    return { revision: 0, suggestions: [], energy: { resolutionMs: 10, thresholdDb: -40, highThresholdDb: -45, pauses: [] } }
  })
  try {
    const query = { ...input, text: undefined, kinds: ['pause'] }
    await readVideoEditContentIndex(query, context())
    expect(seen.some(value => value.phase === 'reading_documents' && value.totalUnits === 1 && value.completedUnits === 1)).toBe(true)
    expect(seen.some(value => value.phase === 'analyzing_audio' && value.totalUnits === 2 && value.completedUnits === 1 && value.phaseProgress === .5)).toBe(true)
    detect.mockRejectedValueOnce(new Error('解码失败'))
    await expect(readVideoEditContentIndex(query, context())).rejects.toThrow('解码失败')
    expect(readVideoEditContentQueries(owner, 'item').at(-1)).toMatchObject({ state: 'failed', phase: 'analyzing_audio', error: '解码失败' })
    await readVideoEditContentIndex(query, context())
    expect(readVideoEditContentQueries(owner, 'item').at(-1)?.state).toBe('completed')
    expect(seen.every(value => mediaContentQueryProgressSchema.safeParse(value).success)).toBe(true)
  } finally { unsubscribe() }
})

it('取消与等待期间编辑立即阻断旧分析，迟到进度与结果不能复活已取消查询', async () => {
  const { owner, input } = await fixture()
  const controller = new AbortController()
  let accept!: (value: { cutsSeconds: number[]; contentIdentity: string }) => void
  let report!: (event: { requestId: string; progress: number }) => void
  let started!: (id: string) => void
  const ready = new Promise<string>(resolve => { started = resolve })
  vi.mocked(getPlatform().sceneDetection.onProgress).mockImplementation(listener => { report = listener; return () => undefined })
  vi.spyOn(getPlatform().sceneDetection, 'detect').mockImplementation(request => { started(request.requestId); return new Promise(resolve => { accept = resolve }) })
  const cancel = vi.spyOn(getPlatform().sceneDetection, 'cancel').mockResolvedValue()
  const query = readVideoEditContentIndex({ ...input, text: undefined, kinds: ['scene'] }, { signal: controller.signal })
  const rejected = expect(query).rejects.toThrow('关联内容已改变')
  const requestId = await ready
  editVideoProject(owner.document.id, document => { document = structuredClone(document); document.sequences[0].name = '人工修改'; return document })
  expect(cancel).toHaveBeenCalledWith(requestId)
  const stopped = readVideoEditContentQueries(owner, 'item').at(-1)!
  expect(stopped.state).toBe('cancelled')
  report({ requestId, progress: .9 })
  expect(readVideoEditContentQueries(owner, 'item').at(-1)).toEqual(stopped)
  accept({ cutsSeconds: [1], contentIdentity: 'a'.repeat(64) })
  await rejected
  expect(readVideoEditContentQueries(owner, 'item').at(-1)?.state).toBe('cancelled')
})

it('进度只保留有界副本且按素材项隔离；读取授权撤销不交付分析结果', async () => {
  const { owner, input } = await fixture()
  for (let i = 0; i < 10; i++) await readVideoEditContentIndex({ ...input, discoveryScope: 'none' }, context())
  const statuses = readVideoEditContentQueries(owner, 'item')
  expect(statuses).toHaveLength(8)
  statuses[0].message = 'polluted'
  expect(readVideoEditContentQueries(owner, 'item')[0].message).not.toBe('polluted')
  expect(readVideoEditContentQueries(owner, 'other')).toEqual([])
  const grant = createApplicationCallerGrant({ callerId: 'revoked-content' })
  const session = createApplicationCapabilitySession(grant)
  vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockImplementationOnce(async () => { revokeApplicationCallerGrant(grant); return identity })
  expect(await session.execute({ id: 'query_video_edit_content', version: 1, input: { ...input, discoveryScope: 'none' } }, { ...context(), requestId: crypto.randomUUID() })).toMatchObject({ ok: false })
})

it('并发查询有界，取消尚未落定时不让新分析越过容量，结束后可重试', async () => {
  const { owner, input } = await fixture()
  const controllers = Array.from({ length: 8 }, () => new AbortController())
  const accepts: Array<(value: { cutsSeconds: number[]; contentIdentity: string }) => void> = []
  let started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  const detect = vi.spyOn(getPlatform().sceneDetection, 'detect').mockImplementation(() => new Promise(resolve => {
    accepts.push(resolve); if (accepts.length === 8) started()
  }))
  vi.spyOn(getPlatform().sceneDetection, 'cancel').mockResolvedValue()
  const query = { ...input, text: undefined, discoveryScope: 'none', kinds: ['scene'] }
  const running = controllers.map(controller => readVideoEditContentIndex(query, { signal: controller.signal }).then(() => 'completed', () => 'cancelled'))
  await ready
  await expect(readVideoEditContentIndex(query, context())).rejects.toThrow('八项')
  controllers[0].abort()
  await expect(readVideoEditContentIndex(query, context())).rejects.toThrow('八项')
  expect(detect).toHaveBeenCalledTimes(8)
  accepts[0]({ cutsSeconds: [], contentIdentity: 'a'.repeat(64) })
  expect(await running[0]).toBe('cancelled')
  detect.mockResolvedValueOnce({ cutsSeconds: [], contentIdentity: 'a'.repeat(64) })
  await readVideoEditContentIndex(query, context())
  for (const accept of accepts.slice(1)) accept({ cutsSeconds: [], contentIdentity: 'a'.repeat(64) })
  expect((await Promise.all(running)).slice(1)).toEqual(Array(7).fill('completed'))
  expect(readVideoEditContentQueries(owner, 'item')).toHaveLength(8)
})

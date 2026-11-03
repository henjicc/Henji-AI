// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createVideoEditTestProject, openSeededVideoEdit } from './videoEditDocumentTestKit'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { closeVideoEditProject, listVideoEditInstances, undoVideoEdit } from './videoEditService'

beforeEach(() => { installHarnessNativeStorage() })
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); uninstallHarnessNativeStorage() })

it('三维成片渲染按两个标量属性单项改写，写后读回核对通过，只存非默认值，可撤销', async () => {
  const owner = (await createVideoEditTestProject())!
  const target = { kind: 'video_edit.sequence', id: `${owner.document.id}:${owner.activeSequenceId}` }
  const app = createApplicationHarness()
  const write = async (properties: Record<string, unknown>) => {
    const baseline = await app.read(target)
    return app.call('change_application_entities', { summary: '三维成片渲染', changes: [{ kind: 'set_properties', entityType: target.kind, target, properties }] }, baseline.revisions as Record<string, number>)
  }
  expect(await write({ 'video_edit.sequence.final_renderer': 'pathTrace' }), '只写渲染器').toMatchObject({ ok: true })
  expect(owner.document.sequences[0].spaceRender).toEqual({ finalRenderer: 'pathTrace' })
  expect(await write({ 'video_edit.sequence.path_trace_samples': 512 }), '只写采样数').toMatchObject({ ok: true })
  expect(owner.document.sequences[0].spaceRender).toEqual({ finalRenderer: 'pathTrace', pathTraceSamples: 512 })
  expect(await write({ 'video_edit.sequence.final_renderer': 'realtime', 'video_edit.sequence.path_trace_samples': 256 })).toMatchObject({ ok: true })
  expect(owner.document.sequences[0].spaceRender).toBeUndefined()
  undoVideoEdit(owner.document.id)
  expect(owner.document.sequences[0].spaceRender).toEqual({ finalRenderer: 'pathTrace', pathTraceSamples: 512 })
  // 三维效果强度同样单项写入，0 不存。
  expect(await write({ 'video_edit.sequence.space_bloom': 1.2 })).toMatchObject({ ok: true })
  expect(await write({ 'video_edit.sequence.space_ambient_occlusion': .5, 'video_edit.sequence.space_reflections': 0 })).toMatchObject({ ok: true })
  expect(owner.document.sequences[0].spaceRender).toEqual({ finalRenderer: 'pathTrace', pathTraceSamples: 512, bloom: 1.2, ambientOcclusion: .5 })
  // 曝光与色调映射：默认值（0、中性）不存。
  expect(await write({ 'video_edit.sequence.space_exposure': .5, 'video_edit.sequence.space_tone_mapping': 'agx' })).toMatchObject({ ok: true })
  expect(owner.document.sequences[0].spaceRender).toMatchObject({ exposure: .5, toneMapping: 'agx' })
  expect(await write({ 'video_edit.sequence.space_exposure': 0, 'video_edit.sequence.space_tone_mapping': 'neutral' })).toMatchObject({ ok: true })
  expect(owner.document.sequences[0].spaceRender).toEqual({ finalRenderer: 'pathTrace', pathTraceSamples: 512, bloom: 1.2, ambientOcclusion: .5 })
})

it('片段发光强度写入非零值时同一步开启空间，读回核对通过；关键帧同样开启，可撤销', async () => {
  const document = createVideoEditTestDocument('发光'); const sequence = document.sequences[0]
  document.items = [{ id: 'text', name: '文字', kind: 'text' }]
  const clip = makeVideoEditItemClip(document, 'text', sequence.id, { frame: 0, duration: 30 })
  sequence.clips = [clip]
  const owner = await openSeededVideoEdit(document)
  const target = { kind: 'video_edit.clip', id: `${owner.document.id}:${clip.id}` }
  const app = createApplicationHarness()
  const write = async (properties: Record<string, unknown>) => {
    const baseline = await app.read(target)
    return app.call('change_application_entities', { summary: '发光', changes: [{ kind: 'set_properties', entityType: target.kind, target, properties }] }, baseline.revisions as Record<string, number>)
  }
  expect(await write({ 'video_edit.clip.space_emission': 2 })).toMatchObject({ ok: true })
  const lit = owner.document.sequences[0].clips.find(item => item.id === clip.id)!
  expect(lit.spaceEmission).toBe(2)
  expect(lit.spatial).toEqual({ enabled: true })
  undoVideoEdit(owner.document.id)
  expect(owner.document.sequences[0].clips.find(item => item.id === clip.id)!.spatial?.enabled).not.toBe(true)
  expect(await write({ 'video_edit.clip.space_emission.keyframes': [{ time: 0, value: 0, interpolation: 'linear' }, { time: 10, value: 3, interpolation: 'hold' }] })).toMatchObject({ ok: true })
  expect(owner.document.sequences[0].clips.find(item => item.id === clip.id)!.spatial).toEqual({ enabled: true })
})

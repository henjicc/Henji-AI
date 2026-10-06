// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, createVideoEditProject, getActiveVideoEditSequence, listVideoEditInstances } from './videoEditService'
import { resetVideoEditSmartRegionsForTests, startVideoEditSmartRegions } from './videoEditSmartRegions'

// 只替换像素与主进程推理边界；登记、通用事务、区域协调及领域状态为正式实现。
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}
  async updateDocument() {}
  async present() { return { presented: true, bitmap: { close() {} } } }
  async dispose() {}
} }))

beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
  resetVideoEditSmartRegionsForTests()
  vi.spyOn(getPlatform().smartRegions, 'ensure').mockResolvedValue({ state: 'failed', reason: 'model' })
  vi.spyOn(getPlatform().smartRegions, 'cancel').mockResolvedValue(undefined)
  vi.spyOn(getPlatform().smartRegions, 'onProgress').mockReturnValue(() => undefined)
  startVideoEditSmartRegions()
})
afterEach(async () => {
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  resetVideoEditSmartRegionsForTests()
  vi.restoreAllMocks()
  uninstallHarnessNativeStorage()
})
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve() }

async function fixture() {
  const owner = (await createVideoEditProject())!
  const id = owner.document.id
  appendVideoEditMedia(id, { id: 'media', name: '采访', path: 'D:/fixture.mp4', kind: 'video', durationSeconds: 20, width: 1920, height: 1080 })
  appendVideoEditClip(id, 'media')
  const clip = getActiveVideoEditSequence(owner).clips[0]
  const clipRef = { kind: 'video_edit.clip', id: `${id}:${clip.id}` }
  const app = createApplicationHarness()
  const createEffects = async (count: number, mask: unknown) => {
    const baseline = await app.read(clipRef)
    const result = await app.call('change_application_entities', { summary: '核对效果区域', changes: [{ kind: 'create_items', entityType: 'video_edit.effect', parent: clipRef,
      items: Array.from({ length: count }, () => ({ properties: { 'video_edit.effect.definition_id': 'effect:mosaic', 'video_edit.effect.mask': mask } })),
    }] }, baseline.revisions as Record<string, number>)
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
    return getActiveVideoEditSequence(owner).clips[0].effects!.map(effect => ({ kind: 'video_edit.effect', id: `${id}:${effect.id}` }))
  }
  const readProperties = async (ref: { kind: string; id: string }, propertyIds: string[]) => {
    const snapshot = await app.read(ref, propertyIds) as { properties: Record<string, unknown> }
    return snapshot.properties
  }
  return { app, owner, createEffects, readProperties }
}

it('共享智能区域失败时清空单个效果再写回不会重试；状态与公开说明如实反映限制', async () => {
  const { app, createEffects, readProperties } = await fixture()
  try {
    const [ref] = await createEffects(2, { regionId: 'face' })
    await flush()
    const ensure = vi.mocked(getPlatform().smartRegions.ensure)
    expect(ensure).toHaveBeenCalledTimes(1)
    expect((await readProperties(ref, ['video_edit.effect.region_status']))['video_edit.effect.region_status']).toMatch(/^failed:/)
    expect((await app.change(ref, { 'video_edit.effect.mask': null })).ok).toBe(true)
    expect((await app.change(ref, { 'video_edit.effect.mask': { regionId: 'face' } })).ok).toBe(true)
    await flush()
    expect(ensure).toHaveBeenCalledTimes(1)
    expect((await readProperties(ref, ['video_edit.effect.region_status']))['video_edit.effect.region_status']).toMatch(/^failed:/)
    const description = await app.requireResult('describe_application_entities', { entityTypes: ['video_edit.effect'] })
    expect(JSON.stringify(description)).toContain('清空再写回 mask 不保证重试')
  } finally { app.dispose() }
})

it('手绘遮罩经通用实体创建、修改与清空；错误形状被拒，修正后可继续且领域状态一致', async () => {
  const { app, owner, createEffects, readProperties } = await fixture()
  try {
    const mask = { regionId: 'shapes', shapes: [{ id: 'subject', kind: 'ellipse', box: [0.3, 0.3, 0.4, 0.4] }] }
    const [ref] = await createEffects(1, mask)
    const read = async () => (await readProperties(ref, ['video_edit.effect.mask']))['video_edit.effect.mask']
    expect(await read()).toEqual(mask)
    expect(getActiveVideoEditSequence(owner).clips[0].effects![0].mask).toEqual(mask)
    const invalid = await app.change(ref, { 'video_edit.effect.mask': { regionId: 'shapes', shapes: [{ id: 'subject', kind: 'path', box: [0.3, 0.3, 0.4, 0.4] }] } })
    expect(invalid.ok).toBe(false)
    expect(JSON.stringify(invalid)).toContain('钢笔遮罩写 points')
    expect(await read()).toEqual(mask)
    const path = { regionId: 'shapes', shapes: [{ id: 'subject', kind: 'path', points: [[0.2, 0.2, 0, 0, 0, 0], [0.8, 0.2, 0, 0, 0, 0], [0.5, 0.8, 0, 0, 0, 0]], mode: 'subtract', opacity: 70 }] }
    expect((await app.change(ref, { 'video_edit.effect.mask': path })).ok).toBe(true)
    expect(await read()).toEqual(path)
    expect((await app.change(ref, { 'video_edit.effect.mask': null })).ok).toBe(true)
    expect(await read()).toBeNull()
    expect(getActiveVideoEditSequence(owner).clips[0].effects![0].mask).toBeUndefined()
  } finally { app.dispose() }
})

it('过渡换错媒介时返回当前可用种类，修正后能完成而失败不写历史', async () => {
  const { app, owner, readProperties } = await fixture()
  try {
    const sequence = getActiveVideoEditSequence(owner)
    const parent = { kind: 'video_edit.sequence', id: `${owner.document.id}:${sequence.id}` }
    const baseline = await app.read(parent)
    const created = await app.call('change_application_entities', { summary: '片段入点过渡', changes: [{ kind: 'create_items', entityType: 'video_edit.transition', parent,
      items: [{ properties: { 'video_edit.transition.kind': 'wipe', 'video_edit.transition.right_clip_id': sequence.clips[0].id, 'video_edit.transition.duration_frames': 10 } }],
    }] }, baseline.revisions as Record<string, number>)
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    const ref = { kind: 'video_edit.transition', id: `${owner.document.id}:${getActiveVideoEditSequence(owner).transitions![0].id}` }
    const history = owner.past.length
    const rejected = await app.change(ref, { 'video_edit.transition.kind': 'constant_power' })
    expect(rejected.ok).toBe(false)
    expect(JSON.stringify(rejected)).toContain('当前是视频过渡，可用种类：cross_dissolve')
    expect(owner.past).toHaveLength(history)
    expect((await app.change(ref, { 'video_edit.transition.kind': 'push' })).ok).toBe(true)
    expect((await readProperties(ref, ['video_edit.transition.kind']))['video_edit.transition.kind']).toBe('push')
  } finally { app.dispose() }
})

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { videoEditDocumentSchema } from '@/core/videoEdit/document'
import { activeVideoEditAudioEffects, activeVideoEditEffects } from '@/core/videoEdit/compositing'
import { videoEditEffectsRegistry } from '@/core/videoEdit/effectsRegistry'
import { videoEditAudioTransitionGains } from '@/core/videoEdit/transitions'
import { applyVideoEditBuiltinEffect, makeVideoEditBuiltinEffect, updateVideoEditBuiltinEffect, updateVideoEditTransition, reorderVideoEditEffects, deleteVideoEditEffects } from './videoEditCompositing'
import { appendVideoEditClip, appendVideoEditMedia, beginVideoEditGesture, closeVideoEditProject, createVideoEditProject, finishVideoEditGesture, getActiveVideoEditSequence, listVideoEditInstances, undoVideoEdit } from './videoEditService'
import { videoEditEffectDropClips } from '../panels/videoEditEffectDrag'

// 任务 4.7c 音频效果与音频过渡、过渡种类切换与助手单侧过渡：试渲染只替换像素边界，其余都是正式领域实现。
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  async updateDocument() {}
  async present() { return { presented: true, bitmap: { close() {} } } }
  async dispose() {}
} }))

beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/audio-effects.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
})
afterEach(async () => {
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); uninstallHarnessNativeStorage()
})
/** 音频轨上首尾相接的两段声音，加一段画面（文字）片段。 */
async function project() {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditMedia(id, { id: 'sound', name: '对白', path: 'D:/dialog.wav', kind: 'audio', width: 0, height: 0, durationSeconds: 4, hasAudio: true })
  const audioTrack = getActiveVideoEditSequence(owner).tracks.find(track => track.kind === 'audio')!.index
  const videoTrack = getActiveVideoEditSequence(owner).tracks.find(track => track.kind === 'video')!.index
  appendVideoEditClip(id, 'sound', { frame: 0, track: audioTrack })
  const first = getActiveVideoEditSequence(owner).clips[0]
  appendVideoEditClip(id, 'sound', { frame: first.duration, track: audioTrack })
  appendVideoEditClip(id, undefined, { frame: 0, track: videoTrack })
  const sequence = getActiveVideoEditSequence(owner)
  const sounds = sequence.clips.filter(clip => clip.kind === 'audio').map(clip => clip.id); const picture = sequence.clips.find(clip => clip.kind !== 'audio')!.id
  return { owner, id, sequenceId: sequence.id, sounds, picture }
}

it('音频效果登记在“音频效果”文件夹；双击只加到所选的声音片段（画面片段跳过）、一步撤销；落点高亮按媒介', async () => {
  const entries = videoEditEffectsRegistry().filter(entry => entry.category === 'audio_effect')
  expect(entries.map(entry => entry.builtinId)).toEqual(expect.arrayContaining(['parametric_eq', 'compressor', 'limiter', 'noise_reduction', 'reverb', 'pitch_shift', 'gain_balance', 'high_pass', 'low_pass', 'de_esser']))
  expect(entries.every(entry => entry.media === 'audio' && entry.tooltip && entry.params?.every(param => param.tooltip && param.description))).toBe(true)
  const { owner, id, sequenceId, sounds, picture } = await project()
  const history = owner.past.length
  const created = applyVideoEditBuiltinEffect(id, sequenceId, [...sounds, picture], 'noise_reduction')
  expect(created).toHaveLength(2); expect(owner.past).toHaveLength(history + 1)
  const clips = getActiveVideoEditSequence(owner).clips
  expect(clips.filter(clip => clip.kind === 'audio').every(clip => clip.effects?.[0].builtin?.id === 'noise_reduction')).toBe(true)
  expect(clips.find(clip => clip.id === picture)!.effects).toBeUndefined()
  expect(() => applyVideoEditBuiltinEffect(id, sequenceId, [picture], 'reverb')).toThrow('声音片段')
  expect(() => applyVideoEditBuiltinEffect(id, sequenceId, sounds, 'gaussian_blur')).toThrow('画面片段')
  undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips.every(clip => !clip.effects)).toBe(true)
  const sequence = getActiveVideoEditSequence(owner)
  expect(videoEditEffectDropClips(sequence, sounds[0], [...sounds, picture], 'reverb')).toEqual(sounds)
  expect(videoEditEffectDropClips(sequence, picture, [], 'reverb')).toEqual([])
  expect(videoEditEffectDropClips(sequence, picture, [...sounds, picture], 'mosaic')).toEqual([picture])
})

it('文档校验按媒介：音频效果不能挂画面片段、画面效果不能挂声音片段；音频效果不进画面合成', async () => {
  const { owner, sounds, picture } = await project()
  const document = structuredClone(owner.document)
  const clips = document.sequences[0].clips
  clips.find(clip => clip.id === picture)!.effects = [makeVideoEditBuiltinEffect('reverb')]
  expect(videoEditDocumentSchema.safeParse(document).error?.message).toContain('音频效果只能加到声音片段')
  clips.find(clip => clip.id === picture)!.effects = undefined
  clips.find(clip => clip.id === sounds[0])!.effects = [makeVideoEditBuiltinEffect('mosaic')]
  expect(videoEditDocumentSchema.safeParse(document).error?.message).toContain('画面效果不能附加到声音片段')
  const sound = { ...clips.find(clip => clip.id === sounds[0])!, effects: [makeVideoEditBuiltinEffect('compressor'), { ...makeVideoEditBuiltinEffect('limiter'), enabled: false }] }
  expect(activeVideoEditAudioEffects(sound).map(effect => effect.builtin.id)).toEqual(['compressor']); expect(activeVideoEditEffects(sound)).toEqual([])
})

it('效果控件：拖动音频效果参数只记一步撤销并夹进范围；换序、删除走同一效果链', async () => {
  const { owner, id, sequenceId, sounds } = await project()
  const [eq, limiter] = [applyVideoEditBuiltinEffect(id, sequenceId, [sounds[0]], 'parametric_eq')[0], applyVideoEditBuiltinEffect(id, sequenceId, [sounds[0]], 'limiter')[0]]
  const target = { projectId: id, sequenceId, clipId: sounds[0] }
  const effect = () => getActiveVideoEditSequence(owner).clips.find(clip => clip.id === sounds[0])!.effects!.find(value => value.id === eq)!
  const history = owner.past.length
  const drag = beginVideoEditGesture(id)
  for (const low of [3, 9, 40]) updateVideoEditBuiltinEffect(target, eq, { params: { low } }, drag)
  expect(effect().builtin!.params.low).toBe(12); expect(owner.past).toHaveLength(history)
  finishVideoEditGesture(drag); expect(owner.past).toHaveLength(history + 1)
  updateVideoEditBuiltinEffect(target, eq, { params: { preset: 'remove_hum' } })
  expect(effect().builtin!.params).toMatchObject({ preset: 'remove_hum', low: 12 })
  await reorderVideoEditEffects(target, [limiter, eq])
  expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === sounds[0])!.effects!.map(value => value.id)).toEqual([limiter, eq])
  await deleteVideoEditEffects(target, [limiter])
  expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === sounds[0])!.effects!.map(value => value.id)).toEqual([eq])
})

it('助手经通用实体读写音频效果：目录写明适用片段与参数；在声音片段上创建、整体改参数；画面效果加到声音片段被拒并说明', async () => {
  const { owner, id, sounds, picture } = await project()
  const app = createApplicationHarness()
  try {
    const catalog = (await app.read({ kind: 'video_edit.builtin_effect', id: `${id}:effect:noise_reduction` }, ['video_edit.builtin_effect.name', 'video_edit.builtin_effect.description', 'video_edit.builtin_effect.params'])) as { properties: Record<string, unknown> }
    expect(catalog.properties['video_edit.builtin_effect.name']).toBe('降噪'); expect(catalog.properties['video_edit.builtin_effect.description']).toContain('只能加到声音片段')
    expect(catalog.properties['video_edit.builtin_effect.params']).toEqual([expect.objectContaining({ key: 'strength', min: 0, max: 100, default: 80 })])
    const clipRef = { kind: 'video_edit.clip', id: `${id}:${sounds[0]}` }
    const baseline = await app.read(clipRef)
    const created = await app.call('change_application_entities', { summary: '人声均衡', changes: [{ kind: 'create_items', entityType: 'video_edit.effect', parent: clipRef, items: [{ properties: { 'video_edit.effect.definition_id': 'effect:parametric_eq', 'video_edit.effect.parameters': { preset: 'voice_clarity' } } }] }] }, baseline.revisions as Record<string, number>)
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    const effect = getActiveVideoEditSequence(owner).clips.find(clip => clip.id === sounds[0])!.effects![0]
    expect(effect.builtin).toEqual({ id: 'parametric_eq', params: { preset: 'voice_clarity' } })
    const ref = { kind: 'video_edit.effect', id: `${id}:${effect.id}` }
    const changed = await app.change(ref, { 'video_edit.effect.parameters': { preset: 'voice_clarity', high: 3 } }); expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
    expect((await app.read(ref, ['video_edit.effect.parameters'])).properties).toEqual({ 'video_edit.effect.parameters': { preset: 'voice_clarity', high: 3 } })
    const outOfRange = await app.change(ref, { 'video_edit.effect.parameters': { high: 30 } }); expect(outOfRange.ok).toBe(false); expect(JSON.stringify(outOfRange)).toContain('-12–12dB')
    const wrongMedia = await app.call('change_application_entities', { summary: '模糊', changes: [{ kind: 'create_items', entityType: 'video_edit.effect', parent: clipRef, items: [{ properties: { 'video_edit.effect.definition_id': 'effect:gaussian_blur' } }] }] }, (await app.read(clipRef)).revisions as Record<string, number>)
    expect(wrongMedia.ok).toBe(false); expect(JSON.stringify(wrongMedia)).toContain('只能加音频效果')
    const pictureRef = { kind: 'video_edit.clip', id: `${id}:${picture}` }
    const audioOnPicture = await app.call('change_application_entities', { summary: '混响', changes: [{ kind: 'create_items', entityType: 'video_edit.effect', parent: pictureRef, items: [{ properties: { 'video_edit.effect.definition_id': 'effect:reverb' } }] }] }, (await app.read(pictureRef)).revisions as Record<string, number>)
    expect(audioOnPicture.ok).toBe(false); expect(JSON.stringify(audioOnPicture)).toContain('音频效果只能加到声音片段')
  } finally { app.dispose() }
})

it('指数淡化：按分贝线性升降、端点为 0 与 1、交叉中点两侧都约 -30 dB；与其他音频过渡互换', async () => {
  const [out, into] = videoEditAudioTransitionGains('exponential_fade', .5)
  expect(20 * Math.log10(out)).toBeCloseTo(-30, 0); expect(into).toBeCloseTo(out)
  expect(videoEditAudioTransitionGains('exponential_fade', 0)).toEqual([1, 0]); expect(videoEditAudioTransitionGains('exponential_fade', 1)).toEqual([0, 1])
  const quarter = videoEditAudioTransitionGains('exponential_fade', .75)[1]; const half = videoEditAudioTransitionGains('exponential_fade', .5)[1]
  expect(20 * Math.log10(quarter) - 20 * Math.log10(half)).toBeCloseTo(15, 0)
})

it('效果控件换过渡种类：同媒介内切换一步撤销、参数回到新种类默认；助手只给一端即创建单侧过渡，端点错误时列出可用编辑点', async () => {
  const { owner, id, sequenceId, sounds, picture } = await project()
  const app = createApplicationHarness()
  try {
    const sequenceRef = { kind: 'video_edit.sequence', id: `${id}:${sequenceId}` }
    const create = async (properties: Record<string, unknown>) => app.call('change_application_entities', { summary: '过渡', changes: [{ kind: 'create_items', entityType: 'video_edit.transition', parent: sequenceRef, items: [{ properties }] }] }, (await app.read(sequenceRef)).revisions as Record<string, number>)
    const fadeOut = await create({ 'video_edit.transition.kind': 'exponential_fade', 'video_edit.transition.left_clip_id': sounds[1], 'video_edit.transition.duration_frames': 15 })
    expect(fadeOut, JSON.stringify(fadeOut)).toMatchObject({ ok: true })
    const single = getActiveVideoEditSequence(owner).transitions!.find(transition => transition.kind === 'exponential_fade')!
    expect(single.leftClipId).toBe(sounds[1]); expect(single.rightClipId).toBeUndefined()
    const fadeIn = await create({ 'video_edit.transition.kind': 'wipe', 'video_edit.transition.right_clip_id': picture, 'video_edit.transition.duration_frames': 10, 'video_edit.transition.parameters': { direction: 'from_top' } })
    expect(fadeIn, JSON.stringify(fadeIn)).toMatchObject({ ok: true })
    const neither = await create({ 'video_edit.transition.kind': 'constant_power', 'video_edit.transition.duration_frames': 10 })
    expect(neither.ok).toBe(false); expect(JSON.stringify(neither)).toContain('请至少写 left_clip_id 或 right_clip_id'); expect(JSON.stringify(neither)).toContain(`right_clip_id=${sounds[1]}`)
    const wrongMedia = await create({ 'video_edit.transition.kind': 'constant_power', 'video_edit.transition.left_clip_id': picture, 'video_edit.transition.duration_frames': 10 })
    expect(wrongMedia.ok).toBe(false); expect(JSON.stringify(wrongMedia)).toContain('可用的编辑点'); expect(JSON.stringify(wrongMedia)).toContain(`left_clip_id=${sounds[0]}`)
    const wipe = getActiveVideoEditSequence(owner).transitions!.find(transition => transition.kind === 'wipe')!
    expect(wipe).toMatchObject({ rightClipId: picture, parameters: { direction: 'from_top' } })
    const history = owner.past.length
    await updateVideoEditTransition(id, sequenceId, wipe.id, { kind: 'push' })
    expect(owner.past).toHaveLength(history + 1)
    const pushed = getActiveVideoEditSequence(owner).transitions!.find(transition => transition.id === wipe.id)!
    expect(pushed.kind).toBe('push'); expect(pushed.parameters).toBeUndefined()
    await expect(updateVideoEditTransition(id, sequenceId, wipe.id, { kind: 'constant_gain' })).rejects.toThrow()
    undoVideoEdit(id)
    expect(getActiveVideoEditSequence(owner).transitions!.find(transition => transition.id === wipe.id)).toMatchObject({ kind: 'wipe', parameters: { direction: 'from_top' } })
    await updateVideoEditTransition(id, sequenceId, single.id, { kind: 'constant_gain' })
    expect(getActiveVideoEditSequence(owner).transitions!.find(transition => transition.id === single.id)!.kind).toBe('constant_gain')
  } finally { app.dispose() }
})

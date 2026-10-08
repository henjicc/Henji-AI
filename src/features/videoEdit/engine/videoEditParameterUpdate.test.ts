import { expect, it } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition, type VideoEditClip } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS } from '@/core/videoEdit/builtinEffects'
import { applyVideoEditParameterUpdate, videoEditParameterUpdate, videoEditParameterNeedsFonts, videoEditParameterAffectsAudio } from './videoEditParameterUpdate'

function fixture() {
  const project = createVideoEditTestDocument('参数更新')
  project.items = [{ id: 'item', name: '画面', kind: 'text' }]
  project.sequences[0].clips = [makeVideoEditItemClip(project, 'item', project.sequences[0].id, { frame: 0 })]
  return videoEditComposition(project, project.sequences[0].id)
}
it.each(VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.map(effect => [effect.id]))('%s shares the parameter protocol, including shader effects', id => {
  const before = fixture()
  before.clips[0].effects = [{ id: 'effect', name: id, amount: 1, enabled: true, builtin: { id, params: {} } }]
  const next = { ...before, revision: 1, clips: [{ ...before.clips[0], effects: [{ ...before.clips[0].effects[0], amount: .5 }] }] }
  const update = videoEditParameterUpdate(before, next)!
  expect(update.patches).toHaveLength(1)
  expect(applyVideoEditParameterUpdate(before, structuredClone(update)).clips).toEqual(next.clips)
  expect(update.patches[0]).not.toHaveProperty('media')
  expect(videoEditParameterNeedsFonts(before, update)).toBe(false)
  expect(() => applyVideoEditParameterUpdate(next, update)).toThrow('版本')
})
it('structural changes fall back; cancellation and latest skipped revisions preserve exact domain values', () => {
  const before = fixture()
  before.clips[0].effects = [{ id: 'effect', name: '曝光', amount: 1, enabled: true, builtin: { id: 'color_grade', params: {} } }]
  const next = { ...before, revision: 60, clips: [{ ...before.clips[0], effects: [{ ...before.clips[0].effects[0], builtin: { id: 'color_grade', params: { exposure: .5 } } }] }] }
  const applied = applyVideoEditParameterUpdate(before, videoEditParameterUpdate(before, next)!)
  expect(videoEditParameterAffectsAudio(before, videoEditParameterUpdate(before, next)!)).toBe(false)
  expect(videoEditParameterAffectsAudio({ ...before, clips: [{ ...before.clips[0], kind: 'audio' }] }, videoEditParameterUpdate(before, next)!)).toBe(true)
  expect(applied.clips).toEqual(next.clips)
  expect(applyVideoEditParameterUpdate(applied, videoEditParameterUpdate(next, { ...before, revision: 61 })!).clips).toEqual(before.clips)
  expect(videoEditParameterUpdate(before, { ...next, media: [] })).toBeDefined()
  expect(videoEditParameterUpdate(before, { ...next, width: 3840 })).toBeUndefined()
  expect(videoEditParameterUpdate(before, { ...next, clips: [{ ...next.clips[0], start: 2 }] })).toBeUndefined()
  expect(videoEditParameterUpdate(before, { ...next, clips: [{ ...next.clips[0], effects: [] }] })).toBeUndefined()
  expect(videoEditParameterUpdate(before, { ...next, clips: [{ ...next.clips[0], effects: [{ ...next.clips[0].effects[0], builtin: { id: 'glow_pro', params: {} } }] }] })).toBeUndefined()
})
it('numeric code parameters skip font preparation; text/graphic font changes retain preparation', () => {
  const before = fixture(); before.clips[0].code = { definitionId: 'code', versionId: 'v', parameters: { gain: 0, font: 'sans-serif' } }
  const next = (parameters: NonNullable<VideoEditClip['code']>['parameters']) => ({ ...before, revision: 1, clips: [{ ...before.clips[0], code: { ...before.clips[0].code!, parameters } }] })
  expect(videoEditParameterNeedsFonts(before, videoEditParameterUpdate(before, next({ gain: 1, font: 'sans-serif' }))!)).toBe(false)
  expect(videoEditParameterNeedsFonts(before, videoEditParameterUpdate(before, next({ gain: 0, font: '新字体' }))!)).toBe(true)
  const animated = next({ gain: 1, font: 'sans-serif' })
  animated.clips[0].code.curves = { gain: [{ id: 'key', sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, interpolation: 'linear', value: 1 }] }
  expect(videoEditParameterNeedsFonts(before, videoEditParameterUpdate(before, animated)!)).toBe(false)
  expect(videoEditParameterUpdate(before, { ...before, revision: 1, clips: [{ ...before.clips[0], code: { ...before.clips[0].code!, versionId: 'new' } }] })).toBeUndefined()
})

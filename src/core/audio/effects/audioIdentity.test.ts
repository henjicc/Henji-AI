import { expect, it } from 'vitest'
import source from '../../../../tests/fixtures/audio-effect-merge/video_edit.json'
import identities from '../../../../tests/fixtures/audio-effect-merge/sound-identities.json'
import { videoEditAudioContent, videoEditAudioContentIdentities } from '../../videoEdit/audioContent'
import { createVideoEditSequence, videoEditComposition, videoEditDocumentSchema, type VideoEditDocument } from '../../videoEdit/document'
import { mergeVideoEditTextTranscription, videoEditTranscriptWords, videoEditTextMediaIdentity, videoEditTextMediaIdentityMatches } from '../../videoEdit/textTranscript'
import { videoEditSavedContentFacts } from '../../videoEdit/contentIndex'
import { migrateAudioEqualizerModes, migrateAudioMergedEffects } from './mergedEffectsMigration'
import { audioBuiltinIdentity } from './audioIdentity'
import type { VideoEditBuiltinEffectInstance } from '../../videoEdit/compositing'

function fixture(): VideoEditDocument {
  const document = { format: 'henji-video-project', version: 10, ...structuredClone(source.content), id: source.id, name: source.name, revision: 0 } as unknown as VideoEditDocument
  const clip = document.sequences[0].clips.find(clip => clip.kind === 'audio')!
  delete clip.enabled
  for (const effect of clip.effects ?? []) effect.enabled = true
  clip.essentialSound = { type: 'dialogue', repair: { rumble: { enabled: true, amount: 30 } }, clarity: { eq: { enabled: true, amount: 50, preset: 'podcast' } } }
  return document
}
const migrate = (document: VideoEditDocument): VideoEditDocument => videoEditDocumentSchema.parse(migrateAudioEqualizerModes(migrateAudioMergedEffects(document)))

it('与两次迁移前真实版本冻结的声音身份一致，片段、轨道、主轨、基本声音和曲线均保留别名', () => {
  const original = fixture(), frozen = structuredClone(original), document = migrate(original)
  const composition = videoEditComposition(document, document.sequences[0].id)
  const candidates = videoEditAudioContentIdentities(composition)
  expect(candidates).toContain(identities.beforeMerge)
  expect(candidates).toContain(identities.beforeEqualizer)
  expect(candidates).toContain(videoEditAudioContent(composition))
  expect(videoEditAudioContent(composition)).not.toBe(identities.beforeMerge)
  expect(original).toEqual(frozen)
  expect(migrate(document)).toEqual(document)
  expect(videoEditAudioContentIdentities(videoEditComposition(videoEditDocumentSchema.parse(JSON.parse(JSON.stringify(document))), composition.id))).toEqual(candidates)
})

it('旧嵌套文字稿、静音证据和内容索引仍绑定；实际声音改变后不会误用别名', () => {
  const original = fixture(), child = original.sequences[0], soundClip = child.clips.find(clip => clip.kind === 'audio')!
  const parent = createVideoEditSequence('父序列')
  parent.id = 'parent'
  parent.clips = [{ ...soundClip, id: 'nested', itemId: 'nested-item', kind: 'sequence', track: 1, start: 0, duration: 90, sourceInUs: 0, volume: 1, effects: undefined, essentialSound: undefined }]
  original.items.push({ id: 'nested-item', name: '子声音', kind: 'sequence', sequenceId: child.id })
  const mediaIdentity = JSON.stringify([child.id, identities.beforeMerge])
  parent.textTranscription = { audioDocumentId: 'saved', sources: [{ itemId: 'nested-item', mediaIdentity, silences: [{ startFrame: 1_000_000, endFrame: 2_000_000 }], blocks: [{ id: 'word', text: '迁移前文字', startFrame: 0, endFrame: 1_000_000, granularity: 'word', included: true, locked: false }] }] }
  original.sequences.push(parent)
  const document = migrate(original), composition = videoEditComposition(document, parent.id)
  expect(videoEditTextMediaIdentityMatches(composition, 'nested-item', mediaIdentity)).toBe(true)
  expect(videoEditTranscriptWords(composition).map(word => word.text)).toEqual(['迁移前文字'])
  expect(videoEditSavedContentFacts(document, ['nested-item'], document.media[0]).some(fact => fact.text === '迁移前文字')).toBe(true)
  const previous = composition.textTranscription!
  const incoming = structuredClone(previous)
  incoming.sources[0].mediaIdentity = videoEditTextMediaIdentity(composition, 'nested-item')
  incoming.sources[0].blocks[0].text = '重新识别的文字'
  const merged = mergeVideoEditTextTranscription(previous, incoming, composition)
  expect(merged.sources).toHaveLength(1)
  expect(videoEditTranscriptWords({ ...composition, textTranscription: merged }).map(word => word.text)).toEqual(['重新识别的文字'])
  const changes: Array<(value: VideoEditDocument) => void> = [
    value => { value.sequences[0].clips.find(clip => clip.kind === 'audio')!.volume = .4 },
    value => { value.sequences[0].clips.find(clip => clip.kind === 'audio')!.sourceInUs += 100000 },
    value => { value.sequences[0].clips.find(clip => clip.kind === 'audio')!.effects!.find(effect => effect.builtin?.id === 'equalizer')!.builtin!.params.simple_low = 9 },
    value => { value.sequences[0].clips.find(clip => clip.kind === 'audio')!.essentialSound!.repair!.rumble!.amount = 60 },
    value => { value.sequences[0].master!.volumeDb = -12 },
  ]
  for (const change of changes) {
    const changed = structuredClone(document); change(changed)
    const current = videoEditComposition(changed, parent.id)
    expect(videoEditTextMediaIdentityMatches(current, 'nested-item', mediaIdentity)).toBe(false)
    expect(videoEditTranscriptWords(current)).toEqual([])
  }
})

it('贝塞尔控制柄、裁剪锚点与曲线值变化使历史身份失效', () => {
  const previous: VideoEditBuiltinEffectInstance = { id: 'parametric_eq', params: { low: 3 }, curves: { low: [{ time: 0, value: 3, interpolation: 'bezier', bezier: [.2, .3, .7, .8], easeRange: [.1, .9], easeValues: [3, 5] }] } }
  const migrated = migrateAudioEqualizerModes(migrateAudioMergedEffects({ builtin: previous })).builtin
  expect(audioBuiltinIdentity(migrated, 'audio-merge')).toEqual(previous)
  for (const patch of [{ bezier: [.3, .4, .7, .8] }, { easeValues: [4, 5] }, { value: 4 }]) {
    const changed = structuredClone(migrated)
    Object.assign(changed.curves!.simple_low![0], patch)
    expect(audioBuiltinIdentity(changed, 'audio-merge')).not.toEqual(previous)
  }
})

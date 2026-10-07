import { createVideoEditTestDocument as createVideoEditDocument } from './testFixtures'
import { expect, it } from 'vitest'
import { videoEditAudioContent } from './audioContent'
import { createVideoEditSequence, videoEditComposition, type VideoEditDocument } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { nestVideoEditClips } from './nestedSequences'

function fixture(): VideoEditDocument {
  const document = createVideoEditDocument('声音'); const sequence = document.sequences[0]
  document.media = [{ id: 'media', name: '镜头', kind: 'video', path: '/fixture/shot.mp4', width: 64, height: 64, durationSeconds: 20, hasAudio: true }]
  document.items = [{ id: 'item', name: '镜头', kind: 'video', mediaId: 'media' }]
  sequence.clips = [{ ...makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, duration: 60 }), id: 'clip' }]
  return document
}
function sound(document: VideoEditDocument): string { return videoEditAudioContent(videoEditComposition(document, document.sequences[0].id)) }

it('字幕/标记回填、画面编辑、无关序列/素材与对象键顺序不改变声音签名', () => {
  const document = fixture(); const before = sound(document); const sequence = document.sequences[0]
  document.revision++
  sequence.captions = [{ id: 'caption', start: 0, duration: 90, text: '字幕' }]
  sequence.markers = [{ id: 'marker', frame: 100, name: '标记' }]
  sequence.name = '重命名'; sequence.width = 1080; sequence.height = 1920
  Object.assign(sequence.clips[0], { x: .4, rotation: 20, name: '新名称', audioRole: 'dialogue' })
  sequence.clips[0].curves = { x: [{ time: 0, value: .4, interpolation: 'linear' }] }
  sequence.clips[0].sourceRemainder = { denominator: 1, numerator: 0 }
  sequence.tracks.forEach(track => { track.locked = true; track.name = '重命名' })
  document.media[0].name = '重命名'; document.items[0].name = '重命名'
  document.sequences.push(createVideoEditSequence('无关'))
  document.media.push({ ...document.media[0], id: 'unused', path: '/fixture/unused.mp4' })
  expect(sound(document)).toBe(before)
  expect(sound(JSON.parse(JSON.stringify(document)) as VideoEditDocument)).toBe(before)
})

it('音量、时钟、声道、淡化、源身份和声音效果变化必须改变签名', () => {
  const original = fixture()
  Object.assign(original.sequences[0].clips[0], { kind: 'audio', sourceComponent: 'audio', track: 0 })
  const before = sound(original)
  const changes: Array<(document: VideoEditDocument) => void> = [
    document => { document.sequences[0].clips[0].volume = .5 },
    document => { document.sequences[0].clips[0].sourceInUs = 1000000 },
    document => { document.sequences[0].clips[0].speed = { numerator: 2, denominator: 1 } },
    document => { document.sequences[0].clips[0].reverse = true },
    document => { document.sequences[0].clips[0].preservePitch = true },
    document => { document.sequences[0].clips[0].fadeInFrames = 10 },
    document => { document.sequences[0].clips[0].audioMapping = { format: 'mono', sources: [{ stream: 0, channel: 1 }] } },
    document => { document.sequences[0].clips[0].curves = { volume: [{ time: 0, value: .5, interpolation: 'linear' }] } },
    document => { document.sequences[0].tracks[0].muted = true },
    document => { document.sequences[0].sampleRate = 44100 },
    document => { document.sequences[0].channels = 1 },
    document => { document.sequences[0].frameRate = { numerator: 60, denominator: 1 } },
    document => { document.media[0].sourceRevision = 'changed' },
    document => { document.media[0].path = '/fixture/changed.mp4' },
    document => { document.sequences[0].transitions = [{ id: 'fade', kind: 'constant_power', rightClipId: 'clip', durationFrames: 10 }] },
  ]
  for (const [index, change] of changes.entries()) { const document = structuredClone(original); change(document); expect(sound(document), `声音变更 ${index}`).not.toBe(before) }
})

it('递归检测可听子序列，子字幕/画面/无关声音不失效，子混音/静音变化失效', () => {
  const original = fixture(); const document = nestVideoEditClips(original, original.sequences[0].id, ['clip'], '子序列').document
  const child = document.sequences[1]; const before = sound(document)
  child.captions = [{ id: 'caption', start: 0, duration: 20, text: '字幕' }]
  child.clips[0].x = .2
  const unrelated = createVideoEditSequence('其他'); unrelated.clips = [{ ...child.clips[0], id: 'other', volume: .4 }]; document.sequences.push(unrelated)
  expect(sound(document)).toBe(before)
  child.clips[0].volume = .5; expect(sound(document)).not.toBe(before)
  child.clips[0].volume = 1; child.tracks[1].muted = true; expect(sound(document)).not.toBe(before)
})

it('声音关键帧的来源元数据不影响声音，插值和缓动区间仍参与签名', () => {
  const document = fixture(); const clip = document.sequences[0].clips[0]
  clip.curves = { volume: [{ time: 0, value: .5, interpolation: 'linear' }, { time: 30, value: 1, interpolation: 'linear' }] }
  const before = sound(document)
  Object.assign(clip.curves.volume![0], { source: 'ducking', duckingOrigin: { time: 0, value: .5 } })
  expect(sound(document)).toBe(before)
  clip.curves.volume![0].interpolation = 'hold'; expect(sound(document)).not.toBe(before)
  clip.curves.volume![0].interpolation = 'ease'; clip.curves.volume![0].easeRange = [.2, .8]; expect(sound(document)).not.toBe(before)
})

it('声音效果的强度/参数/动画参与签名，名称和未启用效果不参与', () => {
  const document = fixture(); const clip = document.sequences[0].clips[0]
  clip.kind = 'audio'; clip.sourceComponent = 'audio'; clip.track = 0
  const before = sound(document)
  const effect = { id: 'effect', name: '效果', enabled: false, amount: 1, builtin: { id: 'pitch_shift', params: { semitones: 2 } } }
  clip.effects = [effect]
  expect(sound(document)).toBe(before)
  effect.enabled = true; const enabled = sound(document); expect(enabled).not.toBe(before)
  effect.name = '重命名'; effect.id = 'renamed'; expect(sound(document)).toBe(enabled)
  effect.amount = .5; expect(sound(document)).not.toBe(enabled)
  effect.amount = 1; effect.builtin.params.semitones = 3; expect(sound(document)).not.toBe(enabled)
  effect.builtin.params.semitones = 2
  clip.effects[0].builtin!.curves = { semitones: [{ time: 0, value: 4, interpolation: 'linear' }] }
  expect(sound(document)).not.toBe(enabled)
})

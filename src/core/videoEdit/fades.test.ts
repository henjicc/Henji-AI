import { createVideoEditTestDocument as createVideoEditDocument } from './testFixtures'
import { describe, expect, it } from 'vitest'
import { changeVideoEditSequenceSettings, splitVideoEditClip, videoEditDocumentSchema } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { setVideoEditClipFade, videoEditClipFade, videoEditClipFadeOpacity } from './fades'
import { videoEditClipAudioWindows, videoEditTransitionWindow, validateVideoEditTransitions } from './transitions'

function fixture() {
  const document = createVideoEditDocument('淡化')
  document.media = [{ id: 'media', name: '原路径', kind: 'video', path: 'D:/original.mp4', durationSeconds: 10, width: 1920, height: 1080, hasAudio: true }]
  document.items = [{ id: 'item', name: '视频', kind: 'video', mediaId: 'media' }]
  const clip = { ...makeVideoEditItemClip(document, 'item', document.sequences[0].id, { frame: 30, track: 1, duration: 60 }), id: 'clip' }
  document.sequences[0].clips = [clip]
  return { document, clip, sequence: document.sequences[0] }
}
let ids = 0
const id = (): string => `fade-${++ids}`

describe('淡化手柄就是单侧过渡（PR）', () => {
  it('拖手柄新建单侧交叉溶解，再拖只改时长，不足 2 帧去掉；淡入淡出合计不超过片段', () => {
    const { document, sequence } = fixture()
    const withIn = setVideoEditClipFade(sequence, 'clip', 'in', 45, id)
    expect(videoEditClipFade(withIn, 'clip', 'in')).toMatchObject({ kind: 'cross_dissolve', rightClipId: 'clip', durationFrames: 45 })
    expect(videoEditClipFade(withIn, 'clip', 'in')).not.toHaveProperty('leftClipId')
    expect(videoEditClipFade(setVideoEditClipFade(withIn, 'clip', 'out', 100, id), 'clip', 'out')?.durationFrames).toBe(15)
    expect(setVideoEditClipFade(withIn, 'clip', 'in', 1, id).transitions).toEqual([])
    const both = setVideoEditClipFade(withIn, 'clip', 'out', 10, id)
    document.sequences[0] = both
    expect(() => { videoEditDocumentSchema.parse(document); validateVideoEditTransitions(document) }).not.toThrow()
  })
  it('画面淡入从第一帧透明线性到满，淡出到透明；黑场这类不算透明度', () => {
    const { sequence, clip } = fixture()
    const faded = setVideoEditClipFade(setVideoEditClipFade(sequence, 'clip', 'in', 10, id), 'clip', 'out', 20, id)
    expect(videoEditClipFadeOpacity(faded, clip, 30)).toBe(0)
    expect(videoEditClipFadeOpacity(faded, clip, 35)).toBe(.5)
    expect(videoEditClipFadeOpacity(faded, clip, 40)).toBe(1)
    expect(videoEditClipFadeOpacity(faded, clip, 80)).toBe(.5)
    const dip = { ...faded, transitions: faded.transitions!.map(transition => ({ ...transition, kind: 'dip_to_black' as const })) }
    expect(videoEditClipFadeOpacity(dip, clip, 30)).toBe(1)
  })
  it('自带声音的画面片段两端淡化时声音一起淡；拆开的声音片段只看自己的音频过渡', () => {
    const { sequence, clip } = fixture()
    const faded = setVideoEditClipFade(sequence, 'clip', 'out', 10, id)
    const picture = faded.transitions!.map(transition => videoEditTransitionWindow(faded, transition))
    expect(videoEditClipAudioWindows(clip, [], picture)).toHaveLength(1)
    expect(videoEditClipAudioWindows({ ...clip, kind: 'audio' }, [], picture)).toEqual([])
  })
  it('挂着普通过渡的一端不能再淡化，另一端让出过渡占的部分', () => {
    const { sequence, clip } = fixture()
    const next = { ...clip, id: 'next', start: 90 }
    const joined = { ...sequence, clips: [clip, next], transitions: [{ id: 'mix', kind: 'cross_dissolve' as const, leftClipId: 'clip', rightClipId: 'next', durationFrames: 20 }] }
    expect(setVideoEditClipFade(joined, 'clip', 'out', 10, id)).toBe(joined)
    expect(videoEditClipFade(setVideoEditClipFade(joined, 'clip', 'in', 60, id), 'clip', 'in')?.durationFrames).toBe(50)
  })
  it('降帧率后放不下的淡入淡出缩短或去掉，不挡住改帧率', () => {
    const { sequence } = fixture()
    const short = { ...sequence, clips: [{ ...sequence.clips[0], duration: 4 }] }
    const faded = setVideoEditClipFade(setVideoEditClipFade(short, 'clip', 'in', 2, id), 'clip', 'out', 2, id)
    const slower = changeVideoEditSequenceSettings(faded, { frameRate: { numerator: 24, denominator: 1 } })
    expect(slower.clips[0].duration).toBe(3)
    expect(slower.transitions).toHaveLength(1); expect(slower.transitions![0].durationFrames).toBe(2)
  })
  it('拆分后淡入留在左半段开头，淡出跟着右半段结尾', () => {
    const { sequence } = fixture()
    const faded = setVideoEditClipFade(setVideoEditClipFade(sequence, 'clip', 'in', 10, id), 'clip', 'out', 10, id)
    const split = splitVideoEditClip(faded, 'clip', 60)
    const right = split.clips.find(value => value.id !== 'clip')!
    expect(videoEditClipFade(split, 'clip', 'in')?.durationFrames).toBe(10)
    expect(videoEditClipFade(split, right.id, 'out')?.durationFrames).toBe(10)
    expect(videoEditClipFade(split, 'clip', 'out')).toBeUndefined()
  })
})

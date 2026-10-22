import { expect, it } from 'vitest'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, type VideoEditClip, type VideoEditDocument } from './document'
import { addLegacyVideoEditTracks } from './testFixtures'
import { videoEditRenderWindows } from './renderCache'

const dependencies = { fontRevision: 1, analysis: '' }
function project(): VideoEditDocument {
  const document = createVideoEditDocument('预渲染')
  const main = addLegacyVideoEditTracks(createVideoEditSequence('主序列')); main.frameRate = { numerator: 60, denominator: 1 }
  const child = addLegacyVideoEditTracks(createVideoEditSequence('嵌套')); child.frameRate = { numerator: 60, denominator: 1 }
  document.media = [{ id: 'a', name: 'a', path: 'D:/a.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 120 }]
  document.items = [{ id: 'item-a', name: 'a', kind: 'video', mediaId: 'a' }, { id: 'item-child', name: '嵌套', kind: 'sequence', sequenceId: child.id }]
  const clip: VideoEditClip = { id: 'v', itemId: 'item-a', name: 'a', kind: 'video', track: 1, start: 0, duration: 900, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }
  child.clips = [{ ...clip, id: 'child-v' }]
  main.clips = [{ ...clip, duration: 2700 }, { ...clip, id: 'nested', kind: 'sequence', itemId: 'item-child', track: 2, start: 3600, duration: 1800 }]
  document.sequences = [main, child]
  return document
}
const keys = (document: VideoEditDocument): string[] => videoEditRenderWindows(videoEditComposition(document, document.sequences[0].id), dependencies).map(window => window.key)

it('序列按剪辑点切分，长段等分到五秒，空隙仍可手动预渲染', () => {
  const document = project(); const windows = videoEditRenderWindows(videoEditComposition(document, document.sequences[0].id), dependencies)
  expect(windows.map(window => [window.startFrame, window.endFrame])).toEqual(Array.from({ length: 18 }, (_, index) => [index * 300, (index + 1) * 300]))
  expect(windows.map(window => window.heavy)).toEqual([...Array(12).fill(false), ...Array(6).fill(true)])
})

it('修改只让依赖它的窗口失效：片段参数、嵌套序列内容与素材身份；音量和其他窗口不受影响', () => {
  const base = project(); const before = keys(base)
  const moved = structuredClone(base); moved.sequences[0].clips[0].opacity = .5
  expect(keys(moved).map((key, index) => key === before[index])).toEqual([...Array(9).fill(false), ...Array(9).fill(true)])
  const nested = structuredClone(base); nested.sequences[1].clips[0].scale = 2
  expect(keys(nested).map((key, index) => key === before[index])).toEqual([...Array(12).fill(true), ...Array(6).fill(false)])
  const quiet = structuredClone(base); quiet.sequences[0].clips[0].volume = 0; quiet.sequences[1].clips[0].volume = 0
  expect(keys(quiet)).toEqual(before)
  const relinked = structuredClone(base); relinked.media[0].sourceRevision = 'replaced'
  expect(keys(relinked).map((key, index) => key === before[index])).toEqual([...Array(9).fill(false), ...Array(3).fill(true), ...Array(6).fill(false)])
  expect(videoEditRenderWindows(videoEditComposition(base, base.sequences[0].id), { ...dependencies, fontRevision: 2 }).every((window, index) => window.key !== before[index])).toBe(true)
})


it('整体平移保持内容指纹，副本共用键，源入点或关键帧变化使对应段失效', () => {
  const document = project(), sequence = document.sequences[0]
  sequence.clips = [{ ...sequence.clips[0], duration: 240 }]
  const before = keys(document)[0]
  sequence.clips[0].start = 120
  expect(keys(document).at(-1)).toBe(before)
  sequence.clips.push({ ...sequence.clips[0], id: 'copy', start: 360 })
  expect(keys(document).slice(1)).toEqual([before, before])
  sequence.clips[1].sourceInUs = 1_000_000
  expect(keys(document)[2]).not.toBe(before)
  sequence.clips[0].curves = { opacity: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 120, value: 1, interpolation: 'linear' }] }
  expect(keys(document)[1]).not.toBe(before)
})

it('转场余量、字幕及小于半秒片段参与分段，隐藏轨道和关闭字幕不增加边界', () => {
  const document = project(), sequence = document.sequences[0]
  const clip = sequence.clips[0]
  sequence.clips = [{ ...clip, duration: 240 }, { ...clip, id: 'right', start: 240, duration: 240 }]
  sequence.transitions = [{ id: 'fade', kind: 'cross_dissolve', leftClipId: clip.id, rightClipId: 'right', durationFrames: 60 }]
  sequence.captions = [{ id: 'caption', start: 60, duration: 90, text: '字幕' }]
  const windows = () => videoEditRenderWindows(videoEditComposition(document, sequence.id), dependencies)
  expect(windows().map(window => [window.startFrame, window.endFrame])).toEqual([[0, 60], [60, 150], [150, 210], [210, 240], [240, 270], [270, 480]])
  const original = windows().map(window => window.key)
  sequence.clips.forEach(clip => { clip.start += 90 }); sequence.captions[0].start += 90
  expect(windows().slice(1).map(window => window.key)).toEqual(original)
  sequence.transitions = []; sequence.captionTrackEnabled = false
  expect(windows().map(window => window.endFrame - window.startFrame)).toEqual([90, 240, 240])
  sequence.clips.push({ ...clip, id: 'tiny', start: 334, duration: 6, track: 2 })
  expect(windows().every(window => window.endFrame - window.startFrame >= 30 && window.endFrame - window.startFrame <= 300)).toBe(true)
  sequence.tracks.find(track => track.index === 2)!.enabled = false
  expect(windows().map(window => window.endFrame - window.startFrame)).toEqual([90, 240, 240])
})


it('复制效果实例共用预览，隐藏的跟踪来源变化仍使依赖段失效', () => {
  const document = project(), sequence = document.sequences[0], clip = sequence.clips[0]
  const effect = { id: 'effect', name: '模糊', enabled: true, amount: 1, builtin: { id: 'gaussian_blur', params: { radius: 5 } } }
  sequence.clips = [{ ...clip, duration: 120, effects: [effect] }, { ...clip, id: 'copy', start: 120, duration: 120, effects: [{ ...effect, id: 'copied-effect' }] }]
  expect(keys(document)[0]).toBe(keys(document)[1])
  sequence.clips[0].follow = { clipId: 'hidden-source', trackerId: 'tracker', offsetX: 0, offsetY: 0 }
  sequence.clips.push({ ...clip, id: 'hidden-source', track: 2, duration: 240 })
  sequence.tracks.find(track => track.index === 2)!.enabled = false
  const before = keys(document)
  sequence.clips[2].x = 0.5
  expect(keys(document)[0]).not.toBe(before[0])
  expect(keys(document)[1]).toBe(before[1])
})

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

it('序列按三十秒窗口切分，只把含嵌套、代码或多层画面的窗口标为吃力', () => {
  const document = project(); const windows = videoEditRenderWindows(videoEditComposition(document, document.sequences[0].id), dependencies)
  expect(windows.map(window => [window.startFrame, window.endFrame])).toEqual([[0, 1800], [1800, 3600], [3600, 5400]])
  expect(windows.map(window => window.heavy)).toEqual([false, false, true])
})

it('修改只让依赖它的窗口失效：片段参数、嵌套序列内容与素材身份；音量和其他窗口不受影响', () => {
  const base = project(); const before = keys(base)
  const moved = structuredClone(base); moved.sequences[0].clips[0].opacity = .5
  expect(keys(moved).map((key, index) => key === before[index])).toEqual([false, false, true])
  const nested = structuredClone(base); nested.sequences[1].clips[0].scale = 2
  expect(keys(nested).map((key, index) => key === before[index])).toEqual([true, true, false])
  const quiet = structuredClone(base); quiet.sequences[0].clips[0].volume = 0; quiet.sequences[1].clips[0].volume = 0
  expect(keys(quiet)).toEqual(before)
  const relinked = structuredClone(base); relinked.media[0].sourceRevision = 'replaced'
  expect(keys(relinked).every((key, index) => key !== before[index])).toBe(true)
  expect(videoEditRenderWindows(videoEditComposition(base, base.sequences[0].id), { ...dependencies, fontRevision: 2 }).every((window, index) => window.key !== before[index])).toBe(true)
})

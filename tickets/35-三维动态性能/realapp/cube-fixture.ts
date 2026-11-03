import { createVideoEditDocument, createVideoEditSequence, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { addLegacyVideoEditTracks } from '@/core/videoEdit/testFixtures'
// 质感样片「玻璃方块」：纯黑背景 + 三维场景（由脚本经助手接口放入）。
const W = 1920, H = 1080, FPS = 30, LENGTH = 300
export function buildDocument(paths: string[]): import('@/core/videoEdit/document').VideoEditDocument {
  const document = createVideoEditDocument('玻璃方块'), sequence = createVideoEditSequence()
  sequence.id = 'main'; sequence.width = W; sequence.height = H; sequence.frameRate = { numerator: FPS, denominator: 1 }
  addLegacyVideoEditTracks(sequence)
  sequence.clips = [{ sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, rotation: 0, opacity: 1, volume: 0, text: '', start: 0, duration: LENGTH,
    id: 'background', itemId: 'item-background', kind: 'image', name: '背景', track: 1, x: 0, y: 0, scale: 1 } as VideoEditClip]
  sequence.spatialCamera = { curves: { perspective: [{ time: 0, value: -1, interpolation: 'hold' }] } }
  document.media = [{ id: 'm-background', name: '背景', path: paths[0], kind: 'image', width: W, height: H, durationSeconds: 0, hasAudio: false }]
  document.items = [{ id: 'item-background', kind: 'image', name: '背景', mediaId: 'm-background' }] as VideoEditComposition['items']
  document.sequences = [sequence]
  document.id = 't35-glass-cube'
  return document
}

import { expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition, videoEditNestedComposition } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { changeVideoEditMulticamCamera, createVideoEditMulticam } from '@/core/videoEdit/multicam'
import { videoEditNestedFrame, videoEditNestedPictureFrame } from '@/core/videoEdit/nestedSequences'
import { videoEditClipPictureSize, videoEditClipToFrame } from '@/core/videoEdit/clipGeometry'
import { VideoEditGridCells, videoEditMulticamGrid, videoEditMulticamGridDivisor, videoEditPictureDivisorForTarget } from './videoEditMulticamGrid'

function fixture(cameras = 4) {
  const document = createVideoEditTestDocument('多机位网格')
  document.media = Array.from({ length: cameras }, (_, index) => ({ id: `media-${index}`, name: `机位${index}`, path: `D:/${index}.mp4`, kind: 'video' as const, width: 3840, height: 2160, durationSeconds: 20, hasAudio: true }))
  document.items = document.media.map(media => ({ id: `item-${media.id}`, name: media.name, kind: 'video' as const, mediaId: media.id }))
  document.sequences[0].width = 3840; document.sequences[0].height = 2160
  const result = createVideoEditMulticam(document, document.sequences[0].id, { name: '同步', sync: 'in_points', cameras: document.items.map(item => ({ itemId: item.id })), audioCameraIndex: 0 })
  const parent = result.document.sequences[0]
  parent.clips = [{ ...makeVideoEditItemClip(result.document, result.itemId, parent.id, { frame: 30, duration: 300 }), sourceInUs: 2_000_000 }]
  return { document: result.document, parentId: parent.id, source: result.sequence }
}

it('四个机位合成一张 2×2 网格：每格是对应机位的嵌套片段，正好占满自己那一格', () => {
  const { document, parentId, source } = fixture()
  const grid = videoEditMulticamGrid(videoEditComposition(document, parentId), source)
  expect([grid.columns, grid.rows]).toEqual([2, 2])
  expect([grid.composition.width, grid.composition.height]).toEqual([7680, 4320])
  const cameras = source.multicam!.cameras
  grid.composition.clips.forEach((clip, index) => {
    expect(clip.multicamCameraId).toBe(cameras[index].id)
    // 嵌套后只剩这个机位的画面。
    expect(videoEditNestedComposition(grid.composition, clip)!.clips.filter(value => value.kind !== 'audio').map(value => value.id)).toEqual([cameras[index].clipId])
    const picture = videoEditClipPictureSize(grid.composition, clip)
    const column = index % 2, row = Math.floor(index / 2)
    const topLeft = videoEditClipToFrame(clip, picture, grid.composition, 0, 0), bottomRight = videoEditClipToFrame(clip, picture, grid.composition, 1, 1)
    expect(topLeft.x).toBeCloseTo(column / 2); expect(topLeft.y).toBeCloseTo(row / 2)
    expect(bottomRight.x).toBeCloseTo((column + 1) / 2); expect(bottomRight.y).toBeCloseTo((row + 1) / 2)
  })
  // 父序列、无关素材不进网格。
  expect(grid.composition.sequences!.map(sequence => sequence.id)).toEqual([source.id])
  expect(grid.composition.media.map(media => media.id)).toEqual(document.media.map(media => media.id))
})

it('网格时间就是源序列时间：与节目同一播放头取同一幅源画面；切机位、加剪辑点不改网格内容', () => {
  const { document, parentId, source } = fixture()
  const parent = videoEditComposition(document, parentId)
  const grid = videoEditMulticamGrid(parent, source)
  const clip = parent.clips[0]
  const child = videoEditNestedComposition(parent, clip)!
  for (const frame of [30, 31, 200, 329]) expect(videoEditNestedFrame(parent, clip, grid.composition, frame)).toBe(videoEditNestedPictureFrame(parent, clip, child, frame))
  const cut = changeVideoEditMulticamCamera(document, parentId, clip.id, source.multicam!.cameras[2].id, 120)
  const after = videoEditComposition({ ...document, revision: 1, sequences: document.sequences.map(sequence => sequence.id === parentId ? cut : sequence) }, parentId)
  expect(after.clips).toHaveLength(2)
  const next = videoEditMulticamGrid(after, source)
  expect(next.contentKey).toBe(grid.contentKey)
  // 剪辑点两侧的片段映射到连续的网格帧。
  const [first, second] = [...after.clips].sort((a, b) => a.start - b.start)
  expect(videoEditNestedFrame(after, second, next.composition, 120)).toBe(videoEditNestedFrame(after, first, next.composition, 119) + 1)
})

it('网格合成的缩小倍数只看格子显示宽度，有代理也不让合成变大；各路纹理按自己的解码尺寸只缩到格子大小', () => {
  const { document, parentId, source } = fixture()
  const parent = videoEditComposition(document, parentId)
  const grid = videoEditMulticamGrid(parent, source)
  expect(videoEditMulticamGridDivisor(grid, 960)).toBe(4)
  expect(videoEditMulticamGridDivisor(grid, 961)).toBe(2)
  expect(videoEditMulticamGridDivisor(grid, 0)).toBe(8)
  const proxied = videoEditMulticamGrid(parent, source, { 'media-1': { key: 'a'.repeat(64) } })
  expect(proxied.proxyKey).not.toBe(grid.proxyKey)
  expect(proxied.contentKey).toBe(grid.contentKey)
  // 4 个 4K 机位、1 个有 1920 宽代理、格子 960：合成仍是 1920×1080；4K 原片缩 4 倍、代理只缩 2 倍，都正好 960 宽。
  expect(videoEditMulticamGridDivisor(proxied, 960)).toBe(4)
  expect(videoEditPictureDivisorForTarget(3840, 2160, 960, 540)).toBe(4)
  expect(videoEditPictureDivisorForTarget(1920, 1080, 960, 540)).toBe(2)
  // 已经不比格子大多少的画面不缩；竖画面按适合放进格子后的高度取。
  expect(videoEditPictureDivisorForTarget(1280, 720, 960, 540)).toBe(1)
  expect(videoEditPictureDivisorForTarget(1080, 1920, 960, 540)).toBe(2)
  // 9 个 4K 机位是 3×3（11520 宽）：显示再大也至少缩小一半。
  const large = fixture(9)
  expect(videoEditMulticamGridDivisor(videoEditMulticamGrid(videoEditComposition(large.document, large.parentId), large.source), 10_000)).toBe(2)
})

it('Worker 把整张网格按格切给各格子的画布，格子尺寸跟随网格画面', () => {
  const surfaces = Array.from({ length: 3 }, () => { const draw = vi.fn(); return { width: 300, height: 150, draw, getContext: () => ({ drawImage: draw }) } })
  const cells = new VideoEditGridCells(surfaces as unknown as OffscreenCanvas[], 2)
  const picture = { width: 1920, height: 1080 } as ImageBitmap
  cells.present(picture)
  expect(surfaces.map(surface => [surface.width, surface.height])).toEqual([[960, 540], [960, 540], [960, 540]])
  expect(surfaces.map(surface => surface.draw.mock.calls[0])).toEqual([[picture, 0, 0, 960, 540, 0, 0, 960, 540], [picture, 960, 0, 960, 540, 0, 0, 960, 540], [picture, 0, 540, 960, 540, 0, 0, 960, 540]])
  cells.dispose()
  expect(surfaces.map(surface => [surface.width, surface.height])).toEqual([[1, 1], [1, 1], [1, 1]])
})

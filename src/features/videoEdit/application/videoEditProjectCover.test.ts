import { createVideoEditTestDocument as createVideoEditDocument } from '../../../core/videoEdit/testFixtures'
import { beforeEach, expect, it, vi } from 'vitest'
import { type VideoEditClip, type VideoEditDocument } from '@/core/videoEdit/document'
import { updateVideoEditProjectCover, videoEditCoverSource, videoEditFrameSourceAt } from './videoEditProjectCover'
import { addLegacyVideoEditTracks } from '@/core/videoEdit/testFixtures'

/* 剪辑封面：指定的封面帧或第一条序列约 1/3 处最上层的画面，那一帧没有画面时取最早的画面片段；没有画面不写；同一来源不重复生成。 */

const save = vi.hoisted(() => vi.fn())
vi.mock('@/commands/documents', () => ({ saveDocumentCover: save }))
vi.mock('@/features/documents/documentCovers', () => ({ notifyDocumentCoverChanged: vi.fn() }))

function clip(patch: Partial<VideoEditClip> & Pick<VideoEditClip, 'id' | 'itemId' | 'kind' | 'track' | 'start'>): VideoEditClip {
  return { name: patch.id, duration: 30, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', ...patch } as VideoEditClip
}
function withClips(clips: VideoEditClip[]): VideoEditDocument {
  const document = createVideoEditDocument('短片'); addLegacyVideoEditTracks(document.sequences[0])
  return {
    ...document,
    media: [
      { id: 'm-audio', name: '配乐', path: 'D:/素材/配乐.mp3', kind: 'audio', durationSeconds: 10 },
      { id: 'm-video', name: '镜头', path: 'D:/素材/镜头.mp4', kind: 'video', durationSeconds: 10 },
      { id: 'm-image', name: '海报', path: 'D:/素材/海报.png', kind: 'image', durationSeconds: 0 },
    ] as VideoEditDocument['media'],
    items: [
      { id: 'i-audio', name: '配乐', kind: 'audio', mediaId: 'm-audio' },
      { id: 'i-video', name: '镜头', kind: 'video', mediaId: 'm-video' },
      { id: 'i-image', name: '海报', kind: 'image', mediaId: 'm-image' },
    ],
    sequences: [{ ...document.sequences[0], clips }],
  }
}

beforeEach(() => { save.mockReset(); save.mockResolvedValue({ docId: 'x', coverPath: 'C:/covers/x.webp' }) })

it('没有画面时为空；1/3 处没有画面时取最早的画面片段，跳过声音与关闭的轨道', () => {
  expect(videoEditCoverSource(withClips([]))).toBeNull()
  expect(videoEditCoverSource(withClips([clip({ id: 'a', itemId: 'i-audio', kind: 'audio', track: 0, start: 0 })]))).toBeNull()
  // 时长 70 帧，1/3 处是第 23 帧：没有画面，退回最早的视频（第 10 帧起，取开头）
  const document = withClips([
    clip({ id: 'a', itemId: 'i-audio', kind: 'audio', track: 0, start: 0 }),
    clip({ id: 'img', itemId: 'i-image', kind: 'image', track: 1, start: 40 }),
    clip({ id: 'vid', itemId: 'i-video', kind: 'video', track: 2, start: 10, duration: 5 }),
  ])
  expect(videoEditCoverSource(document)).toEqual({ source: 'D:/素材/镜头.mp4', sourceKind: 'video', atSeconds: 0 })
  const disabled = { ...document, sequences: [{ ...document.sequences[0], tracks: document.sequences[0].tracks.map(track => track.index === 2 ? { ...track, enabled: false } : track) }] }
  expect(videoEditCoverSource(disabled)).toEqual({ source: 'D:/素材/海报.png', sourceKind: 'image' })
})

it('取 1/3 处最上层的画面，视频按片段源时间取帧；指定封面帧时用封面帧', () => {
  const document = withClips([
    clip({ id: 'low', itemId: 'i-image', kind: 'image', track: 1, start: 0, duration: 90 }),
    clip({ id: 'top', itemId: 'i-video', kind: 'video', track: 2, start: 0, duration: 90 }),
  ])
  const fps = document.sequences[0].frameRate.numerator / document.sequences[0].frameRate.denominator
  expect(videoEditCoverSource(document)).toEqual({ source: 'D:/素材/镜头.mp4', sourceKind: 'video', atSeconds: Math.round(30 / fps * 1000) / 1000 })
  const poster = { ...document, posterFrame: { sequenceId: document.sequences[0].id, frame: 60 } }
  expect(videoEditCoverSource(poster)?.atSeconds).toBe(Math.round(60 / fps * 1000) / 1000)
})

it('写成通用封面；画面来源没变时不重复生成，没有画面时不写', async () => {
  const document = withClips([clip({ id: 'img', itemId: 'i-image', kind: 'image', track: 1, start: 0 })])
  await updateVideoEditProjectCover(document)
  await updateVideoEditProjectCover(document)
  expect(save).toHaveBeenCalledTimes(1)
  expect(save).toHaveBeenCalledWith({ docId: document.id, sources: [{ source: 'D:/素材/海报.png', sourceKind: 'image' }] })
  // 用户固定了封面帧：自动更新不覆盖
  await updateVideoEditProjectCover({ ...withClips([clip({ id: 'v', itemId: 'i-video', kind: 'video', track: 2, start: 0 })]), posterFrame: { sequenceId: document.sequences[0].id, frame: 0 } })
  expect(save).toHaveBeenCalledTimes(1)
  await updateVideoEditProjectCover(withClips([]))
  expect(save).toHaveBeenCalledTimes(1)
})

it('悬停预览按位置取那一刻最上层的画面，没有画面时为空', () => {
  const document = withClips([
    clip({ id: 'img', itemId: 'i-image', kind: 'image', track: 1, start: 0, duration: 50 }),
    clip({ id: 'vid', itemId: 'i-video', kind: 'video', track: 2, start: 50, duration: 50 }),
  ])
  expect(videoEditFrameSourceAt(document, 0.1)).toEqual({ source: 'D:/素材/海报.png', sourceKind: 'image' })
  expect(videoEditFrameSourceAt(document, 0.9)?.source).toBe('D:/素材/镜头.mp4')
  expect(videoEditFrameSourceAt(withClips([]), 0.5)).toBeNull()
})

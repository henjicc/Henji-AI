import { beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditDocument, type VideoEditClip, type VideoEditDocument } from '@/core/videoEdit/document'
import { updateVideoEditProjectCover, videoEditCoverSource } from './videoEditProjectCover'

/* 剪辑封面：取第一个序列里最早出现的画面片段；没有画面不写；同一来源不重复生成。 */

const save = vi.hoisted(() => vi.fn())
vi.mock('@/commands/documents', () => ({ saveDocumentCover: save }))

function clip(patch: Partial<VideoEditClip> & Pick<VideoEditClip, 'id' | 'itemId' | 'kind' | 'track' | 'start'>): VideoEditClip {
  return { name: patch.id, duration: 30, sourceInUs: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '', ...patch } as VideoEditClip
}
function withClips(clips: VideoEditClip[]): VideoEditDocument {
  const document = createVideoEditDocument('短片')
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

it('取起点最早的画面片段，跳过声音与关闭的轨道；没有画面时为空', () => {
  expect(videoEditCoverSource(withClips([]))).toBeNull()
  expect(videoEditCoverSource(withClips([clip({ id: 'a', itemId: 'i-audio', kind: 'audio', track: 0, start: 0 })]))).toBeNull()
  const document = withClips([
    clip({ id: 'a', itemId: 'i-audio', kind: 'audio', track: 0, start: 0 }),
    clip({ id: 'img', itemId: 'i-image', kind: 'image', track: 1, start: 40 }),
    clip({ id: 'vid', itemId: 'i-video', kind: 'video', track: 2, start: 10 }),
  ])
  expect(videoEditCoverSource(document)).toEqual({ source: 'D:/素材/镜头.mp4', sourceKind: 'video' })
  const disabled = { ...document, sequences: [{ ...document.sequences[0], tracks: document.sequences[0].tracks.map(track => track.index === 2 ? { ...track, enabled: false } : track) }] }
  expect(videoEditCoverSource(disabled)).toEqual({ source: 'D:/素材/海报.png', sourceKind: 'image' })
})

it('写成通用封面；画面来源没变时不重复生成，没有画面时不写', async () => {
  const document = withClips([clip({ id: 'img', itemId: 'i-image', kind: 'image', track: 1, start: 0 })])
  await updateVideoEditProjectCover(document)
  await updateVideoEditProjectCover(document)
  expect(save).toHaveBeenCalledTimes(1)
  expect(save).toHaveBeenCalledWith({ docId: document.id, sources: [{ source: 'D:/素材/海报.png', sourceKind: 'image' }] })
  await updateVideoEditProjectCover(withClips([]))
  expect(save).toHaveBeenCalledTimes(1)
})

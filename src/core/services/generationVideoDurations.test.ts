import { describe, expect, it, vi } from 'vitest'

import { attachVideoDurations, resolveGenerationVideoSources } from './generationVideoDurations'

describe('generation video durations', () => {
  it('使用数量最完整的视频字段，空提交路径不会遮蔽实时输入', () => {
    expect(resolveGenerationVideoSources({
      uploadedVideoFilePaths: [],
      videos: ['a.mp4'],
      uploadedVideos: ['a.mp4', 'b.mp4'],
    })).toEqual(['a.mp4', 'b.mp4'])
  })

  it('生成提交前读取每段真实时长并写入统一计价字段', async () => {
    const readDuration = vi.fn(async (source: string) => source === 'a.mp4' ? 3 : 8)
    await expect(attachVideoDurations({ videos: ['a.mp4', 'b.mp4'] }, readDuration)).resolves.toMatchObject({
      __firstVideoDurationSeconds: 3,
      __videoDurationSeconds: [3, 8],
      __totalVideoDurationSeconds: 11,
    })
    expect(readDuration).toHaveBeenCalledTimes(2)
  })

  it('任一段时长不可读时不写入会造成低估的残缺总时长', async () => {
    const result = await attachVideoDurations(
      { videos: ['a.mp4', 'b.mp4'], __totalVideoDurationSeconds: 99 },
      async (source) => source === 'a.mp4' ? 3 : null
    )
    expect(result.__firstVideoDurationSeconds).toBe(3)
    expect(result.__videoDurationSeconds).toBeUndefined()
    expect(result.__totalVideoDurationSeconds).toBeUndefined()
  })
})

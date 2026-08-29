import { describe, expect, it } from 'vitest'

import { resolveUploadedVideoDurationSeconds } from '../../src/catalog/shared/mediaPresence'

describe('resolveUploadedVideoDurationSeconds', () => {
  it('优先累计每段真实时长，并允许空的提交路径回退到实时视频数组', () => {
    expect(resolveUploadedVideoDurationSeconds({
      uploadedVideoFilePaths: [],
      uploadedVideos: ['a.mp4', 'b.mp4'],
      __videoDurationSeconds: [3, 8],
      __totalVideoDurationSeconds: 99,
      __firstVideoDurationSeconds: 20,
    })).toBe(11)
  })

  it('逐段时长不完整时依次回退总时长、首段兼容估算和单段默认值', () => {
    const videos = ['a.mp4', 'b.mp4']
    expect(resolveUploadedVideoDurationSeconds({
      videos,
      __videoDurationSeconds: [3],
      __totalVideoDurationSeconds: 13,
    })).toBe(13)
    expect(resolveUploadedVideoDurationSeconds({ videos, __firstVideoDurationSeconds: 4 })).toBe(8)
    expect(resolveUploadedVideoDurationSeconds({ videos }, 5)).toBe(10)
  })

  it('没有视频输入时不使用残留时长', () => {
    expect(resolveUploadedVideoDurationSeconds({ __totalVideoDurationSeconds: 13 }, 5)).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildMediaSourceIndex,
  classifyMediaKey,
  inheritMediaKind,
  isLocalMediaSource,
  isRemoteHttpUrl,
  normalizeLocalSource,
  resolveMediaKind,
} from '../src/upload/media-fields'

const IMAGE_A = 'C:\\Users\\demo\\Uploads\\a.png'
const IMAGE_B = 'C:\\Users\\demo\\Uploads\\b.png'
const VIDEO_A = 'C:\\Users\\demo\\Uploads\\clip.mp4'
const AUDIO_A = '/home/demo/uploads/voice.mp3'

describe('buildMediaSourceIndex', () => {
  it('按标准 params key 归类媒体源', () => {
    const index = buildMediaSourceIndex({
      uploadedFilePaths: [IMAGE_A, IMAGE_B],
      uploadedVideoFilePaths: [VIDEO_A],
      uploadedAudioFilePaths: [AUDIO_A],
    })
    expect(index.get(IMAGE_A)).toBe('image')
    expect(index.get(IMAGE_B)).toBe('image')
    expect(index.get(VIDEO_A)).toBe('video')
    expect(index.get(AUDIO_A)).toBe('audio')
  })

  it('收录 data URI 与 henji-media 本地协议', () => {
    const index = buildMediaSourceIndex({
      images: ['data:image/png;base64,AAAA'],
      videos: ['henji-media://local/C:/demo/x.mp4'],
    })
    expect(index.get('data:image/png;base64,AAAA')).toBe('image')
    expect(index.get('henji-media://local/C:/demo/x.mp4')).toBe('video')
  })

  it('不收录远程 URL 和普通字符串，避免误判', () => {
    const index = buildMediaSourceIndex({
      images: ['https://cdn.example.com/a.png', '', '   '],
      prompt: 'a cat eating',
    })
    expect(index.size).toBe(0)
  })

  it('params 没有媒体时返回空索引', () => {
    expect(buildMediaSourceIndex({ prompt: 'hello', duration: 5 }).size).toBe(0)
  })
})

describe('resolveMediaKind', () => {
  const index = buildMediaSourceIndex({
    uploadedFilePaths: [IMAGE_A],
    uploadedVideoFilePaths: [VIDEO_A],
  })

  it('回归：字段名未命中 hint 时仍按值识别出图片', () => {
    // kie-seedance-2.0-fast 曾把本地路径写进 first_frame_url，
    // 该字段名不含任何图片 hint，导致本地路径原样发给上游。
    expect(resolveMediaKind(index, 'unknown', IMAGE_A)).toBe('image')
    expect(resolveMediaKind(index, 'unknown', VIDEO_A)).toBe('video')
  })

  it('字段名 hint 已给出类型时优先沿用', () => {
    expect(resolveMediaKind(index, 'image', 'whatever')).toBe('image')
  })

  it('值两侧空白不影响匹配', () => {
    expect(resolveMediaKind(index, 'unknown', `  ${IMAGE_A}  `)).toBe('image')
  })

  it('非媒体值保持 unknown', () => {
    expect(resolveMediaKind(index, 'unknown', 'a cat eating')).toBe('unknown')
    expect(resolveMediaKind(index, 'unknown', 'https://cdn.example.com/a.png')).toBe('unknown')
  })
})

describe('classifyMediaKey', () => {
  it('识别常见媒体字段名', () => {
    expect(classifyMediaKey('image_url')).toBe('image')
    expect(classifyMediaKey('first_frame_url')).toBe('image')
    expect(classifyMediaKey('last_frame_url')).toBe('image')
    expect(classifyMediaKey('reference_image_urls')).toBe('image')
    expect(classifyMediaKey('video_url')).toBe('video')
    expect(classifyMediaKey('first_clip_url')).toBe('video')
    expect(classifyMediaKey('reference_audio_urls')).toBe('audio')
  })

  it('非媒体字段名不误判', () => {
    for (const key of ['prompt', 'duration', 'resolution', 'aspect_ratio', 'seed', 'web_search']) {
      expect(classifyMediaKey(key)).toBe('unknown')
    }
  })
})

describe('inheritMediaKind', () => {
  it('裸 url 字段不凭空成为媒体', () => {
    expect(inheritMediaKind('unknown', 'url')).toBe('unknown')
  })

  it('父级类型在子字段没有线索时继承', () => {
    expect(inheritMediaKind('image', 'url')).toBe('image')
  })

  it('子字段自带线索时覆盖父级', () => {
    expect(inheritMediaKind('image', 'video_url')).toBe('video')
  })
})

describe('本地源判定', () => {
  it('识别 Windows / POSIX / UNC 路径', () => {
    expect(isLocalMediaSource(IMAGE_A)).toBe(true)
    expect(isLocalMediaSource(AUDIO_A)).toBe(true)
    expect(isLocalMediaSource('\\\\server\\share\\a.png')).toBe(true)
  })

  it('远程 URL 不算本地源', () => {
    expect(isLocalMediaSource('https://cdn.example.com/a.png')).toBe(false)
    expect(isRemoteHttpUrl('https://cdn.example.com/a.png')).toBe(true)
  })

  it('本地协议还原成文件系统路径', () => {
    expect(normalizeLocalSource('henji-media://local/C:/demo/a.png')).toBe('C:/demo/a.png')
    expect(normalizeLocalSource('file:///C:/demo/a.png')).toBe('C:/demo/a.png')
    expect(normalizeLocalSource('a cat eating')).toBeUndefined()
  })

  it('asset.localhost 仍按本地源处理', () => {
    expect(isRemoteHttpUrl('http://asset.localhost/C:/demo/a.png')).toBe(false)
    expect(isLocalMediaSource('http://asset.localhost/C:/demo/a.png')).toBe(true)
  })
})

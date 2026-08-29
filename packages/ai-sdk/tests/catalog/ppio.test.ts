import { describe, expect, it } from 'vitest'

import type { JsonObject } from '../../src/types/runtime'
import { kling30Model } from '../../src/catalog/ppio/kling-3.0.model'
import { minimaxSpeechModel } from '../../src/catalog/ppio/minimax-speech.model'
import { wan27Model } from '../../src/catalog/ppio/wan-2.7.model'

/** 直接执行 SDK catalog 中的真实 selector / builder，覆盖主进程实际消费路径。 */
async function select(params: JsonObject): Promise<string> {
  const endpoints = kling30Model.endpoints
  expect(typeof endpoints).toBe('object')
  expect(typeof (typeof endpoints === 'object' && endpoints?.selector)).toBe('function')
  return await (typeof endpoints === 'object' && endpoints?.selector ? endpoints.selector(params) : '')
}

async function build(params: JsonObject): Promise<JsonObject> {
  expect(kling30Model.request?.builder).toBeTypeOf('function')
  return await kling30Model.request!.builder!(params)
}

describe('Kling 3.0 派欧云路由覆盖', () => {
  const cases: Array<[string, JsonObject, string]> = [
    ['Standard 文生视频', { ppioKling30Resolution: '720P' }, '/async/kling-v3.0-std-t2v'],
    ['Standard 图生视频', { ppioKling30Resolution: '720P', uploadedFilePaths: ['a.png'] }, '/async/kling-v3.0-std-i2v'],
    ['Pro 文生视频', { ppioKling30Resolution: '1080P' }, '/async/kling-v3.0-pro-t2v'],
    ['Pro 图生视频', { ppioKling30Resolution: '1080P', uploadedFilePaths: ['a.png'] }, '/async/kling-v3.0-pro-i2v'],
    ['4K 文生视频', { ppioKling30Resolution: '4K' }, '/async/kling-v3.0-4k-t2v'],
    ['4K 图生视频', { ppioKling30Resolution: '4K', uploadedFilePaths: ['a.png'] }, '/async/kling-v3.0-4k-i2v'],
    ['动作控制', { ppioKling30Mode: 'motion-control', ppioKling30Resolution: '720P' }, '/async/kling-v3.0-motion-control'],
  ]

  it.each(cases)('%s', async (_name, params, expected) => {
    await expect(select(params)).resolves.toBe(expected)
  })

  it('画布节点的 images 键也能触发 i2v 路由', async () => {
    await expect(select({ ppioKling30Resolution: '720P', images: ['a.png'] }))
      .resolves.toBe('/async/kling-v3.0-std-i2v')
  })
})

describe('Kling 3.0 请求构建', () => {
  it('文生视频带 aspect_ratio，不带 image', async () => {
    const body = await build({ prompt: 'p', ppioKling30Resolution: '720P', ppioKling30AspectRatio: '9:16' })
    expect(body.aspect_ratio).toBe('9:16')
    expect(body.image).toBeUndefined()
  })

  it('图生视频带 image 且不带 aspect_ratio（官方 i2v 无该字段）', async () => {
    const body = await build({ prompt: 'p', ppioKling30Resolution: '720P', uploadedFilePaths: ['first.png'] })
    expect(body.image).toBe('first.png')
    expect(body.aspect_ratio).toBeUndefined()
  })

  it('传两张图时第二张映射为 end_image（首尾帧）', async () => {
    const body = await build({ prompt: 'p', ppioKling30Resolution: '1080P', uploadedFilePaths: ['first.png', 'last.png'] })
    expect(body.image).toBe('first.png')
    expect(body.end_image).toBe('last.png')
  })

  it('动作控制按分辨率下发 model_name', async () => {
    const shared = { ppioKling30Mode: 'motion-control', uploadedFilePaths: ['a.png'], uploadedVideoFilePaths: ['v.mp4'] }
    expect((await build({ ...shared, ppioKling30Resolution: '720P' })).model_name).toBe('kling-v3-0-std')
    expect((await build({ ...shared, ppioKling30Resolution: '1080P' })).model_name).toBe('kling-v3-0-pro')
  })
})

describe('派欧云按真实输入时长计价', () => {
  it('Kling 3.0 动作控制优先使用逐段参考视频真实时长', () => {
    const price = kling30Model.pricing.calculator?.({
      ppioKling30Mode: 'motion-control',
      ppioKling30Resolution: '720P',
      ppioKling30CharacterOrientation: 'video',
      uploadedVideoFilePaths: ['reference.mp4'],
      __videoDurationSeconds: [12.5],
      __totalVideoDurationSeconds: 20,
      __firstVideoDurationSeconds: 25,
    })
    expect(price).toBeCloseTo(11.25)
  })

  it('Kling 3.0 人物朝向为图片时仍固定按 5 秒计价', () => {
    const price = kling30Model.pricing.calculator?.({
      ppioKling30Mode: 'motion-control',
      ppioKling30Resolution: '1080P',
      ppioKling30CharacterOrientation: 'image',
      uploadedVideoFilePaths: ['reference.mp4'],
      __videoDurationSeconds: [12.5],
    })
    expect(price).toBeCloseTo(6)
  })

  it('Wan 2.7 视频编辑 duration=0 时按输入视频真实时长计价', () => {
    const price = wan27Model.pricing.calculator?.({
      ppioWan27Mode: 'video-edit',
      ppioWan27Resolution: '1080P',
      ppioWan27Duration: 0,
      uploadedVideoFilePaths: ['source.mp4'],
      __videoDurationSeconds: [7.4],
    })
    expect(price).toBeCloseTo(7.4)
  })

  it('Wan 2.7 在逐段时长不完整时回退宿主提供的总时长', () => {
    const price = wan27Model.pricing.calculator?.({
      ppioWan27Mode: 'video-edit',
      ppioWan27Resolution: '720P',
      ppioWan27Duration: 0,
      uploadedVideoFilePaths: ['source.mp4'],
      __videoDurationSeconds: [],
      __totalVideoDurationSeconds: 6.25,
    })
    expect(price).toBeCloseTo(3.75)
  })
})

describe('MiniMax Speech 单次请求向上取整到分', () => {
  it('HD 与 Turbo 都按官方规则向上取整', () => {
    expect(minimaxSpeechModel.pricing.calculator?.({ text: '甲'.repeat(100), minimaxAudioSpec: 'hd' }))
      .toBe(0.04)
    expect(minimaxSpeechModel.pricing.calculator?.({ text: '甲'.repeat(60), minimaxAudioSpec: 'turbo' }))
      .toBe(0.02)
  })

  it('声音克隆试听先向上取整字符费，再叠加音色费', () => {
    const price = minimaxSpeechModel.pricing.calculator?.({
      minimaxMode: 'voice-clone',
      minimaxVoiceClonePanel: {
        previewText: '甲'.repeat(60),
        previewModel: 'speech-2.8-turbo',
      },
    })
    expect(price).toBe(9.92)
  })

  it('空文本不产生语音合成字符费，纯克隆仍是固定音色费', () => {
    expect(minimaxSpeechModel.pricing.calculator?.({ text: '' })).toBe(0)
    expect(minimaxSpeechModel.pricing.calculator?.({ minimaxMode: 'voice-clone' })).toBe(9.9)
  })
})

import { describe, expect, it } from 'vitest'

import type { JsonObject } from '../../src/types/runtime'
import { kling30Model } from '../../src/catalog/ppio/kling-3.0.model'

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

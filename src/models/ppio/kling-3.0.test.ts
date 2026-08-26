import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

/**
 * Kling 3.0 在派欧云上共 7 条路由（std/pro/4k × t2v/i2v + 动作控制），
 * 由 endpoints.selector 按「分辨率档位 + 是否上传图片」拼出来。
 *
 * 这里直接跑 manifest 里序列化后的 selectorJs / builderJs，而不是导入模型文件——
 * 运行时执行的就是这份，源码正确不代表序列化后正确。
 */

interface ManifestModel {
  modelId: string
  endpoints?: { selectorJs?: string; defaultRoute?: string }
  request?: { builderJs?: string }
}

function loadModel(): ManifestModel {
  const manifest = JSON.parse(
    readFileSync(resolve(__dirname, '../../../resources/model-manifest.json'), 'utf-8')
  ) as { models: ManifestModel[] }
  const model = manifest.models.find((m) => m.modelId === 'ppio-kling-3.0')
  expect(model).toBeDefined()
  return model as ManifestModel
}

function run(source: string, params: Record<string, unknown>): unknown {
  const context = vm.createContext({ __p: params })
  return vm.runInContext(`(${source})(__p)`, context)
}

const model = loadModel()

describe('Kling 3.0 派欧云路由覆盖', () => {
  const selector = () => {
    const js = model.endpoints?.selectorJs
    expect(js).toBeTruthy()
    return js as string
  }

  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['Standard 文生视频', { ppioKling30Resolution: '720P' }, '/async/kling-v3.0-std-t2v'],
    [
      'Standard 图生视频',
      { ppioKling30Resolution: '720P', uploadedFilePaths: ['a.png'] },
      '/async/kling-v3.0-std-i2v'
    ],
    ['Pro 文生视频', { ppioKling30Resolution: '1080P' }, '/async/kling-v3.0-pro-t2v'],
    [
      'Pro 图生视频',
      { ppioKling30Resolution: '1080P', uploadedFilePaths: ['a.png'] },
      '/async/kling-v3.0-pro-i2v'
    ],
    ['4K 文生视频', { ppioKling30Resolution: '4K' }, '/async/kling-v3.0-4k-t2v'],
    [
      '4K 图生视频',
      { ppioKling30Resolution: '4K', uploadedFilePaths: ['a.png'] },
      '/async/kling-v3.0-4k-i2v'
    ],
    [
      '动作控制',
      { ppioKling30Mode: 'motion-control', ppioKling30Resolution: '720P' },
      '/async/kling-v3.0-motion-control'
    ]
  ]

  it.each(cases)('%s -> %s', (_name, params, expected) => {
    expect(run(selector(), params)).toBe(expected)
  })

  it('画布节点的 images 键也能触发 i2v 路由', () => {
    expect(run(selector(), { ppioKling30Resolution: '720P', images: ['a.png'] })).toBe(
      '/async/kling-v3.0-std-i2v'
    )
  })
})

describe('Kling 3.0 请求构建', () => {
  const builder = () => {
    const js = model.request?.builderJs
    expect(js).toBeTruthy()
    return js as string
  }

  it('文生视频带 aspect_ratio，不带 image', () => {
    const body = run(builder(), {
      prompt: 'p',
      ppioKling30Resolution: '720P',
      ppioKling30AspectRatio: '9:16'
    }) as Record<string, unknown>
    expect(body.aspect_ratio).toBe('9:16')
    expect(body.image).toBeUndefined()
  })

  it('图生视频带 image 且不带 aspect_ratio（官方 i2v 无该字段）', () => {
    const body = run(builder(), {
      prompt: 'p',
      ppioKling30Resolution: '720P',
      uploadedFilePaths: ['first.png']
    }) as Record<string, unknown>
    expect(body.image).toBe('first.png')
    expect(body.aspect_ratio).toBeUndefined()
  })

  it('传两张图时第二张映射为 end_image（首尾帧）', () => {
    const body = run(builder(), {
      prompt: 'p',
      ppioKling30Resolution: '1080P',
      uploadedFilePaths: ['first.png', 'last.png']
    }) as Record<string, unknown>
    expect(body.image).toBe('first.png')
    expect(body.end_image).toBe('last.png')
  })

  it('动作控制按分辨率下发 model_name', () => {
    const std = run(builder(), {
      ppioKling30Mode: 'motion-control',
      ppioKling30Resolution: '720P',
      uploadedFilePaths: ['a.png'],
      uploadedVideoFilePaths: ['v.mp4']
    }) as Record<string, unknown>
    expect(std.model_name).toBe('kling-v3-0-std')

    const pro = run(builder(), {
      ppioKling30Mode: 'motion-control',
      ppioKling30Resolution: '1080P',
      uploadedFilePaths: ['a.png'],
      uploadedVideoFilePaths: ['v.mp4']
    }) as Record<string, unknown>
    expect(pro.model_name).toBe('kling-v3-0-pro')
  })
})

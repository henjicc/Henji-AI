import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

import {
  buildModelscopeRequest,
  MODELSCOPE_CREATE_TASK_ENDPOINT,
  resolveModelscopeSize
} from './utils'

/**
 * 这里同时验证两件事：
 * 1. utils.ts 本身的行为；
 * 2. `js-runtime.ts` 的 JS_PRELUDE 里那份手工副本与 utils.ts 行为一致。
 *
 * 之所以要第 2 条：模型的 request.builder 会被序列化成 builderJs，真正执行的是
 * PRELUDE 里的副本。历史上 utils.ts 加了 uploadedFilePaths 兜底但没同步 PRELUDE，
 * 导致修复静默失效，生成页上传的图仍然被丢弃。
 */

describe('魔搭提交路由', () => {
  it('用官方的 /v1/images/generations，不是 KIE 的 createTask', () => {
    expect(MODELSCOPE_CREATE_TASK_ENDPOINT).toBe('/v1/images/generations')
  })

  it('manifest 生成器里的镜像常量与源码一致', () => {
    const script = readFileSync(
      resolve(__dirname, '../../../scripts/generate-model-manifest.cjs'),
      'utf-8'
    )
    const match = script.match(/MODELSCOPE_CREATE_TASK_ENDPOINT:\s*'([^']+)'/)
    expect(match?.[1]).toBe(MODELSCOPE_CREATE_TASK_ENDPOINT)
  })
})

describe('resolveModelscopeSize 尺寸边界', () => {
  it('FLUX 的上界是 1024，不会算出超过官方上限的边长', () => {
    const size = resolveModelscopeSize(
      'black-forest-labs/FLUX.1-Krea-dev',
      '1:1',
      2048,
      { min: 64, max: 1024 }
    )
    const [w, h] = (size ?? '').split('x').map(Number)
    expect(w).toBeLessThanOrEqual(1024)
    expect(h).toBeLessThanOrEqual(1024)
  })

  it('Z-Image 的下界是 512，不会算出低于官方下限的边长', () => {
    const size = resolveModelscopeSize('Tongyi-MAI/Z-Image-Turbo', '1:1', 64, {
      min: 512,
      max: 2048
    })
    const [w, h] = (size ?? '').split('x').map(Number)
    expect(w).toBeGreaterThanOrEqual(512)
    expect(h).toBeGreaterThanOrEqual(512)
  })
})

describe('buildModelscopeRequest 图片来源', () => {
  const options = { modelId: 'Qwen/Qwen-Image-Edit-2509', allowImage: true }

  it('读生成页提交用的 uploadedFilePaths', () => {
    const req = buildModelscopeRequest(
      { prompt: 'p', uploadedFilePaths: ['a.png', 'b.png'] },
      options
    )
    expect(req.image_url).toEqual(['a.png', 'b.png'])
  })

  it('读画布节点用的 images', () => {
    const req = buildModelscopeRequest({ prompt: 'p', images: ['c.png'] }, options)
    expect(req.image_url).toEqual(['c.png'])
  })

  it('uploadedFilePaths 优先于 images', () => {
    const req = buildModelscopeRequest(
      { prompt: 'p', uploadedFilePaths: ['a.png'], images: ['c.png'] },
      options
    )
    expect(req.image_url).toEqual(['a.png'])
  })

  it('allowImage 为 false 时不发送图片', () => {
    const req = buildModelscopeRequest(
      { prompt: 'p', uploadedFilePaths: ['a.png'] },
      { modelId: 'Qwen/Qwen-Image', allowImage: false }
    )
    expect(req.image_url).toBeUndefined()
  })
})

describe('JS_PRELUDE 里的副本与 utils.ts 行为一致', () => {
  /** 从 js-runtime.ts 里取出 PRELUDE 源码，在真实 VM 里跑一遍 */
  function runInPrelude(expression: string, params: unknown, opts: unknown): unknown {
    const source = readFileSync(
      resolve(__dirname, '../../../electron/main/services/ai-runtime/js-runtime.ts'),
      'utf-8'
    )
    // 取出整个 JS_PRELUDE 模板字符串（含全部 helper，顺序与运行时一致）
    const start = source.indexOf('const JS_PRELUDE = `')
    expect(start).toBeGreaterThan(-1)
    const bodyStart = source.indexOf('`', start) + 1
    const bodyEnd = source.indexOf('`', bodyStart)
    expect(bodyEnd).toBeGreaterThan(bodyStart)
    const prelude = source.slice(bodyStart, bodyEnd)

    const context = vm.createContext({ __params: params, __opts: opts })
    return vm.runInContext(`${prelude}\n;(${expression})(__params, __opts)`, context)
  }

  it('buildModelscopeRequest 同样读 uploadedFilePaths', () => {
    const params = { prompt: 'p', uploadedFilePaths: ['a.png', 'b.png'] }
    const opts = { modelId: 'Qwen/Qwen-Image-Edit-2509', allowImage: true }

    const fromPrelude = runInPrelude('buildModelscopeRequest', params, opts) as Record<
      string,
      unknown
    >
    const fromUtils = buildModelscopeRequest(params, opts)

    expect(fromPrelude.image_url).toEqual(['a.png', 'b.png'])
    expect(fromPrelude).toEqual(fromUtils)
  })

  it('resolveModelscopeSize 的边界行为一致（FLUX 上界 1024）', () => {
    const params = { prompt: 'p', modelscopeImageSize: '1:1', resolutionBaseSize: 2048 }
    const opts = {
      modelId: 'black-forest-labs/FLUX.1-Krea-dev',
      allowImage: false,
      sizeBounds: { min: 64, max: 1024 }
    }

    const fromPrelude = runInPrelude('buildModelscopeRequest', params, opts) as Record<
      string,
      unknown
    >
    const fromUtils = buildModelscopeRequest(params, opts)

    expect(fromPrelude.size).toBe(fromUtils.size)
    const [w] = String(fromPrelude.size).split('x').map(Number)
    expect(w).toBeLessThanOrEqual(1024)
  })
})

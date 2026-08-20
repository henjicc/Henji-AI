import { afterEach, describe, expect, it, vi } from 'vitest'

import * as bailian from './bailian'
import * as volcengine from './volcengine'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('official image providers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('百炼同步请求附带鉴权并解析 choices 图片', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      output: {
        choices: [{ message: { content: [
          { image: 'https://example.com/a.png' },
          { image: 'https://example.com/b.png' },
        ] } }],
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(bailian.execute({
      apiKey: 'dashscope-secret',
      route: '/api/v1/services/aigc/multimodal-generation/generation',
      method: 'POST',
      body: { model: 'qwen-image-3.0' },
      requestId: 'request-bailian',
    })).resolves.toMatchObject({
      status: 'completed',
      url: 'https://example.com/a.png|||https://example.com/b.png',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer dashscope-secret' }),
      })
    )
  })

  it('百炼业务错误保留供应商消息', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      code: 'InvalidParameter',
      message: 'size is invalid',
    })))

    await expect(bailian.execute({
      apiKey: 'secret', route: '/generation', method: 'POST', body: {}, requestId: 'request-error',
    })).rejects.toMatchObject({
      code: 'provider_task_failed',
      message: expect.stringContaining('size is invalid'),
    })
  })

  it('火山方舟同步请求附带鉴权并解析 data 图片', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      model: 'doubao-seedream-5-0-260128',
      data: [
        { url: 'https://example.com/one.png' },
        { url: 'https://example.com/two.png' },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(volcengine.execute({
      apiKey: 'ark-secret',
      route: '/api/v3/images/generations',
      method: 'POST',
      body: { model: 'doubao-seedream-5-0-260128' },
      requestId: 'request-ark',
    })).resolves.toMatchObject({
      status: 'completed',
      url: 'https://example.com/one.png|||https://example.com/two.png',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://ark.cn-beijing.volces.com/api/v3/images/generations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer ark-secret' }),
      })
    )
  })

  it('火山方舟业务错误保留供应商消息', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      error: { code: 'InvalidParameter', message: 'unsupported size' },
    })))

    await expect(volcengine.execute({
      apiKey: 'secret', route: '/api/v3/images/generations', method: 'POST', body: {}, requestId: 'request-error',
    })).rejects.toMatchObject({
      code: 'provider_task_failed',
      message: expect.stringContaining('unsupported size'),
    })
  })
})

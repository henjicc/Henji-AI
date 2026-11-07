import { describe, expect, it, vi } from 'vitest'

import * as bailian from '../src/providers/bailian'
import type { CredentialStore, RuntimeContext, Transport } from '../src/runtime'
import type { JsonValue } from '../src/types/runtime'
import { preprocessRequestBody } from '../src/upload/preprocess'
import policyFixture from './fixtures/bailian/asr-upload-policy.json'

// 供应商不收本地文件时的两条托管路径：通用文件上传服务（KIE / Fal，按设置首选与换用）
// 和百炼按模型签发的临时存储。上传响应按官方字段构造（KIE downloadUrl、Fal initiate、百炼 getPolicy 官方示例）。

const VIDEO = 'data:video/mp4;base64,AAAA'
const IMAGE = 'data:image/png;base64,AQID'

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function runtime(fetch: Transport['fetch'], keys: Record<string, string>): RuntimeContext {
  const credentials: CredentialStore = { get: (_scope, providerId) => keys[providerId] }
  return {
    transport: { fetch },
    credentials,
    media: { read: () => { throw new Error('media.read should not be called for data: sources') } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
}

const kieOk = () => json({ data: { downloadUrl: 'https://kie.invalid/v.mp4' } })

describe('通用文件上传服务', () => {
  it('首选 Fal 失败后按设置换用 KIE', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('fal')) return json({ detail: 'down' }, 503)
      return kieOk()
    })
    const body = await preprocessRequestBody('ppio', '/v3/async/kling-v3.0-motion-control', { video: VIDEO }, runtime(fetch, { fal: 'f', kie: 'k' }), { __upload_provider: 'fal', __upload_fallback: true })
    expect(body).toEqual({ video: 'https://kie.invalid/v.mp4' })
    expect(fetch.mock.calls[0][0]).toContain('fal')
  })

  it('关掉换用时首选失败就报错，不碰另一家', async () => {
    const fetch = vi.fn(async () => json({ detail: 'down' }, 503))
    await expect(preprocessRequestBody('modelscope', '/v1/images/generations', { image_url: IMAGE }, runtime(fetch, { fal: 'f', kie: 'k' }), { __upload_provider: 'fal', __upload_fallback: false }))
      .rejects.toMatchObject({ code: 'public_media_url_required', message: expect.stringContaining('Fal 上传失败') })
    expect(fetch.mock.calls.every(([url]) => String(url).includes('fal'))).toBe(true)
  })

  it('一家都没配置时不发任何请求，提示去设置里配置', async () => {
    const fetch = vi.fn()
    await expect(preprocessRequestBody('volcengine', '/api/v3/contents/generations/tasks', { content: [{ type: 'video_url', video_url: { url: VIDEO } }] }, runtime(fetch, {}), {}))
      .rejects.toMatchObject({ code: 'public_media_url_required', message: expect.stringContaining('设置 → 通用文件上传服务') })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('火山方舟只把视频托管成公网地址，图片和音频仍发 Base64', async () => {
    const fetch = vi.fn(async () => kieOk())
    const body = await preprocessRequestBody('volcengine', '/api/v3/contents/generations/tasks', {
      content: [
        { type: 'image_url', image_url: { url: IMAGE } },
        { type: 'video_url', video_url: { url: VIDEO } },
        { type: 'audio_url', audio_url: { url: 'data:audio/mpeg;base64,AAAA' } },
      ],
    }, runtime(fetch, { kie: 'k' }), { __upload_provider: 'kie' }) as { content: Array<Record<string, { url: string }>> }
    expect(body.content[0].image_url.url).toBe(IMAGE)
    expect(body.content[1].video_url.url).toBe('https://kie.invalid/v.mp4')
    expect(body.content[2].audio_url.url).toBe('data:audio/mpeg;base64,AAAA')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('百炼临时存储', () => {
  it('视频按请求里的模型申请凭证并上传成 oss://，图片仍是 Data URI', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('/uploads?action=getPolicy')) return json(policyFixture.payload)
      return new Response('', { status: 200 })
    })
    const body = await preprocessRequestBody('bailian', '/api/v1/services/aigc/video-generation/video-synthesis', {
      model: 'wan3.0-video',
      input: { media: [{ type: 'reference_image', url: IMAGE }, { type: 'reference_video', url: VIDEO }] },
    }, runtime(fetch, { bailian: 'b' }), { uploadedFilePaths: [IMAGE], uploadedVideoFilePaths: [VIDEO] }, undefined, 'req-1') as { input: { media: Array<{ url: string }> } }
    expect(fetch.mock.calls[0][0]).toBe('https://dashscope.aliyuncs.com/api/v1/uploads?action=getPolicy&model=wan3.0-video')
    expect(fetch.mock.calls[1][0]).toBe('https://oss.example/upload')
    expect(body.input.media[0].url).toBe(IMAGE)
    expect(body.input.media[1].url).toMatch(/^oss:\/\/tmp\/req-1-\d+-/)
  })

  it('请求体里有 oss:// 地址时提交带上解析头，没有时不带', async () => {
    const fetch = vi.fn(async () => json({ output: { task_id: 't', task_status: 'PENDING' } }))
    const input = (body: JsonValue) => ({ apiKey: 'k', route: '/api/v1/services/aigc/video-generation/video-synthesis', method: 'POST' as const, body, requestId: 'r', runtime: runtime(fetch, {}) })
    await bailian.execute(input({ model: 'wan3.0-video', input: { media: [{ type: 'reference_video', url: 'oss://tmp/a.mp4' }] } }))
    await bailian.execute(input({ model: 'wan3.0-video', input: { prompt: 'x' } }))
    const headers = fetch.mock.calls.map(([, init]) => (init as RequestInit).headers as Record<string, string>)
    expect(headers[0]['X-DashScope-OssResourceResolve']).toBe('enable')
    expect(headers[1]).not.toHaveProperty('X-DashScope-OssResourceResolve')
  })
})

describe('大语言模型对话不走生成用的托管', () => {
  it.each(['bailian', 'volcengine'])('%s 对话消息里的本地视频仍是 Data URI，不上传', async (providerId) => {
    const fetch = vi.fn()
    const body = await preprocessRequestBody(providerId, '/v1/chat/completions', {
      messages: [{ role: 'user', content: [{ type: 'video_url', video_url: { url: VIDEO } }] }],
    }, runtime(fetch, {}), { uploadedVideoFilePaths: [VIDEO] }, undefined, undefined, undefined, 'llm') as { messages: Array<{ content: Array<{ video_url: { url: string } }> }> }
    expect(body.messages[0].content[0].video_url.url).toBe(VIDEO)
    expect(fetch).not.toHaveBeenCalled()
  })
})

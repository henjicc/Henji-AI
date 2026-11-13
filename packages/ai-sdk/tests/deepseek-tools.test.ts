import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { createCapabilityClient } from '../src/capabilities'
import {
  createDeepSeekDocumentOcrModule,
  createDeepSeekFilesClient,
  createDeepSeekWebFetchModule,
  createDeepSeekWebSearchModule,
} from '../src/capabilities/deepseek'
import { createDeepSeekAsrModule, deepSeekAsr } from '../src/capabilities/speech-recognition/deepseek'
import { deepseekTtsBillingCharacters, deepseekTtsModel } from '../src/catalog/deepseek/deepseek-tts.model'
import { appendProviderWebTools } from '../src/llm/providerProtocolCore'
import type { RuntimeContext } from '../src/runtime'

interface Fixture { status: number; payload?: unknown; body?: string }

function fixture(name: string): Fixture {
  return JSON.parse(readFileSync(new URL(`./fixtures/deepseek-tools/${name}`, import.meta.url), 'utf8')) as Fixture
}

function respond(name: string): Response {
  const value = fixture(name)
  return new Response(value.body ?? JSON.stringify(value.payload), { status: value.status })
}

function runtime(fetch: RuntimeContext['transport']['fetch']): RuntimeContext {
  return {
    transport: { fetch },
    credentials: { get: async (_scope, providerId) => providerId === 'deepseek' ? 'fixture-key' : undefined },
    media: { read: async ref => ({ bytes: new Uint8Array([1, 2, 3, 4]), mimeType: ref.endsWith('.pdf') ? 'application/pdf' : 'audio/wav', filename: ref }) },
  }
}

function formFrom(init: RequestInit | undefined): FormData {
  expect(init?.body).toBeInstanceOf(FormData)
  return init?.body as FormData
}

describe('DeepSeek 语音识别', () => {
  it('multipart 只发 file 字段，解析官方响应', async () => {
    const fetch = vi.fn<RuntimeContext['transport']['fetch']>(async () => respond('asr-success.json'))
    const client = createCapabilityClient({ runtime: runtime(fetch), modules: [createDeepSeekAsrModule(deepSeekAsr)] })
    const output = await client.execute(deepSeekAsr.id, { audio: { kind: 'media-ref', ref: 'speech.wav' } })
    expect(output).toMatchObject({ text: '今天上海的天气怎么样？', durationMs: 3200 })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/v1/tools/asr')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-key')
    expect([...formFrom(init).keys()]).toEqual(['file'])
  })

  it('不支持的格式与时间戳要求在上传前拒绝', async () => {
    const fetch = vi.fn<RuntimeContext['transport']['fetch']>()
    const client = createCapabilityClient({ runtime: runtime(fetch), modules: [createDeepSeekAsrModule(deepSeekAsr)] })
    await expect(client.execute(deepSeekAsr.id, { audio: { kind: 'bytes', bytes: new Uint8Array([1]), mediaType: 'audio/mpeg' } })).rejects.toThrow('16 位 PCM WAV 或 Ogg Opus')
    await expect(client.execute(deepSeekAsr.id, { audio: { kind: 'media-ref', ref: 'a.wav' }, timestamps: true })).rejects.toThrow('时间戳')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('DeepSeek 网页搜索与抓取', () => {
  it('搜索请求字段与结果映射对应官方示例', async () => {
    const fetch = vi.fn<RuntimeContext['transport']['fetch']>(async () => respond('search-success.json'))
    const client = createCapabilityClient({ runtime: runtime(fetch), modules: [createDeepSeekWebSearchModule()] })
    const output = await client.execute('deepseek.web-search', { query: 'DeepSeek V4 模型 发布', count: 5, includeContent: true })
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ query: 'DeepSeek V4 模型 发布', count: 5, need_content: true })
    expect(output).toEqual({ results: [expect.objectContaining({ url: 'https://example.com/deepseek-v4', siteName: 'Example News', publishedAt: '2026-06-01T00:00:00+00:00', rerankScore: 2.4, authority: 3 })] })
  })

  it('官方错误体带出服务端说明', async () => {
    const client = createCapabilityClient({ runtime: runtime(async () => respond('search-error.json')), modules: [createDeepSeekWebSearchModule()] })
    await expect(client.execute('deepseek.web-search', { query: 'x' })).rejects.toThrow("'count' must be between 1 and 50")
  })

  it('越界参数在请求前拒绝', async () => {
    const fetch = vi.fn<RuntimeContext['transport']['fetch']>()
    const client = createCapabilityClient({ runtime: runtime(fetch), modules: [createDeepSeekWebSearchModule(), createDeepSeekWebFetchModule()] })
    await expect(client.execute('deepseek.web-search', { query: 'x'.repeat(129) })).rejects.toThrow('1–128')
    await expect(client.execute('deepseek.web-fetch', { url: 'https://user:pass@example.com' })).rejects.toThrow('用户名或密码')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('抓取返回标题与 Markdown 正文', async () => {
    const client = createCapabilityClient({ runtime: runtime(async () => respond('fetch-success.json')), modules: [createDeepSeekWebFetchModule()] })
    await expect(client.execute('deepseek.web-fetch', { url: 'https://api-docs.deepseek.com/zh-cn/' })).resolves.toMatchObject({ title: '首次调用 API | DeepSeek API Docs' })
  })
})

describe('DeepSeek OCR 与文件', () => {
  it('purpose 写在 file 之前，跳过保活换行解析按页结果', async () => {
    const fetch = vi.fn<RuntimeContext['transport']['fetch']>(async () => respond('ocr-success.json'))
    const client = createCapabilityClient({ runtime: runtime(fetch), modules: [createDeepSeekDocumentOcrModule()] })
    const output = await client.execute('deepseek.document-ocr', { file: { kind: 'media-ref', ref: 'doc.pdf' }, layout: 'rich_layout' })
    expect([...formFrom(fetch.mock.calls[0][1]).entries()].map(([key, value]) => [key, typeof value === 'string' ? value : 'file'])).toEqual([['purpose', 'rich_layout_recognition'], ['file', 'file']])
    expect(output).toEqual({ pageCount: 2, pages: [{ index: 0, text: '...', finishReason: 'stop' }, { index: 1, text: '...', finishReason: 'length' }] })
  })

  it('识别开始后的 200 错误体按失败处理', async () => {
    const client = createCapabilityClient({ runtime: runtime(async () => respond('ocr-error-after-start.json')), modules: [createDeepSeekDocumentOcrModule()] })
    await expect(client.execute('deepseek.document-ocr', { file: { kind: 'media-ref', ref: 'doc.pdf' } })).rejects.toThrow('OCR did not finish in time')
  })

  it('文件上传返回官方文件对象', async () => {
    const fetch = vi.fn<RuntimeContext['transport']['fetch']>(async () => respond('file-object.json'))
    const files = createDeepSeekFilesClient(runtime(fetch))
    await expect(files.upload({ kind: 'media-ref', ref: 'doc.pdf' }, 'text_recognition')).resolves.toEqual({
      id: 'file-api-0a1b2c3d4e5f60718293a4b5c6d7e8f9', bytes: 102400, createdAt: 1700000000, filename: 'image.jpg', purpose: 'user_data',
    })
    expect(fetch.mock.calls[0][0]).toBe('https://api.deepseek.com/files')
  })
})

describe('DeepSeek 语音合成', () => {
  it('汉字按 2 个计费字符，请求只发文本与音色', () => {
    expect(deepseekTtsBillingCharacters('你好 ab')).toBe(7)
    expect(deepseekTtsModel.request.builder({ text: '你好', deepseekTtsVoice: 'tide' })).toEqual({ text: '你好', voice_id: 'tide' })
    expect(() => deepseekTtsModel.request.builder({ text: '字'.repeat(5001) })).toThrow('10000')
  })
})

describe('DeepSeek 服务端联网工具', () => {
  it('flash 两种协议都挂搜索与读链接，pro 只在 Responses 挂 web_search', () => {
    const tools = [{ type: 'function', name: 'f' }]
    for (const protocol of ['openai-responses', 'openai-compatible'] as const) {
      expect(appendProviderWebTools('deepseek', undefined, { model: 'deepseek-flash', tools }, protocol).tools)
        .toEqual([...tools, { type: 'deepseek_web_search' }, { type: 'deepseek_read_url' }])
    }
    expect(appendProviderWebTools('deepseek', undefined, { model: 'deepseek-v4-pro' }, 'openai-responses').tools).toEqual([{ type: 'web_search' }])
    expect(appendProviderWebTools('deepseek', undefined, { model: 'deepseek-v4-pro' }, 'openai-compatible')).toEqual({ model: 'deepseek-v4-pro' })
  })

  it('Responses 挂联网工具时把工具结果里的图片挪到随后的 user 消息，工具结果只留文字', () => {
    const image = { type: 'input_image', detail: 'auto', image_url: 'data:image/jpeg;base64,AAAA' }
    const call = (id: string) => ({ type: 'function_call', call_id: id, name: 'f', arguments: '{}' })
    const input = [
      { role: 'user', content: [{ type: 'input_text', text: '看图' }] },
      call('a'), call('b'),
      { type: 'function_call_output', call_id: 'a', output: [{ type: 'input_text', text: '预览' }, image] },
      { type: 'function_call_output', call_id: 'b', output: '纯文字' },
      { type: 'message', role: 'assistant', content: [] },
    ]
    const body = appendProviderWebTools('deepseek', undefined, { model: 'deepseek-flash', input }, 'openai-responses')
    expect(body.input).toEqual([
      input[0], input[1], input[2],
      { type: 'function_call_output', call_id: 'a', output: '预览\n（图片见随后的用户消息）' },
      input[4],
      { role: 'user', content: [{ type: 'input_text', text: '以上工具结果附带的图片：' }, image] },
      input[5],
    ])
    // 不挂联网工具（其他供应商）时原样保留，图片仍在工具结果里
    const untouched = { model: 'deepseek-flash', input }
    expect(appendProviderWebTools('kimi', undefined, untouched, 'openai-responses')).toBe(untouched)
  })

  it('结构化输出与其他供应商不挂', () => {
    const structured = { model: 'deepseek-flash', text: { format: { type: 'json_schema' } } }
    expect(appendProviderWebTools('deepseek', undefined, structured, 'openai-responses')).toBe(structured)
    const other = { model: 'deepseek-flash' }
    expect(appendProviderWebTools('kimi', undefined, other, 'openai-responses')).toBe(other)
  })
})

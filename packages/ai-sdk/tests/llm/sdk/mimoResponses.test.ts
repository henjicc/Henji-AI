import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { adaptMimoResponses } from '../../../src/llm/sdk/mimoResponses'
import { applyProviderReasoningRequestBody } from '../../../src/llm/providerReasoningRequest'

const fixture = JSON.parse(readFileSync(new URL('../../fixtures/llm/mimo-responses.json', import.meta.url), 'utf8')) as { events: Array<Record<string, unknown>> }
const response = (text: string) => new Response(text, { headers: { 'content-type': 'text/event-stream' } })

describe('MiMo Responses SSE 事件边界', () => {
  it('UTF-8 单字节分块、注释、多行 data 与未知事件不丢失正文', async () => {
    const source = new TextEncoder().encode(`:heartbeat\r\n\r\n${fixture.events.map(event => `data: ${JSON.stringify(event, null, 2).split('\n').join('\ndata: ')}`).join('\n\n')}\n\ndata:{"type":"future-event"}\n\n`)
    let offset = 0
    const body = new ReadableStream<Uint8Array>({ pull(controller) { if (offset === source.length) controller.close(); else controller.enqueue(source.slice(offset, ++offset)) } })
    const parsed = await adaptMimoResponses(new Response(body, { headers: { 'content-type': 'text/event-stream' } })).text()
    expect(parsed).toContain('分析')
    expect(parsed).toContain('完成')
    expect(parsed).toContain('response.reasoning_summary_text.delta')
    expect(parsed).toContain('future-event')
  })

  it('合成负例：提前 EOF、畸形数据不能被当成正常完成', async () => {
    await expect(adaptMimoResponses(response('data:{"type":"response.in_progress"}\n\n')).text()).rejects.toThrow('terminal')
    await expect(adaptMimoResponses(response('data:{broken}\n\n')).text()).rejects.toThrow()
    const error = new Response('unauthorized', { status: 401 })
    expect(adaptMimoResponses(error)).toBe(error)
  })

  it('取消适配后的 reader 会释放上游流', async () => {
    const cancel = vi.fn()
    const adapted = adaptMimoResponses(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'text/event-stream' } }))
    await adapted.body!.cancel()
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })

  it('多轮思考回传使用 MiMo content，不发送 OpenAI summary', () => {
    const body = applyProviderReasoningRequestBody('mimo', 'openai', { input: [{ id: 'rs_1', type: 'reasoning', summary: [{ type: 'summary_text', text: '分析' }], encrypted_content: null }] }, { enabled: true, effort: 'high' }, 'openai-responses')
    expect(body.input).toEqual([{ id: 'rs_1', type: 'reasoning', content: [{ type: 'reasoning_text', text: '分析' }] }])
  })
})

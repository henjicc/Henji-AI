import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as kie from '../../src/providers/kie'
import * as fal from '../../src/providers/fal'
import * as apimart from '../../src/providers/apimart'
import * as grsai from '../../src/providers/grsai'
import { fakeRuntimeContext } from './test-helpers'

interface Fixture {
  examples: Record<string, unknown>[]
  responses: Record<string, { content: { 'application/json': { example: Record<string, unknown> } } }>
}
function fixture(name: string): Fixture {
  return JSON.parse(readFileSync(resolve(__dirname, '../fixtures/gpt-image-2.5', `${name}.json`), 'utf8'))
}
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
const officialResponse = (name: string, code = '200') => fixture(name).responses[code].content['application/json'].example
const input = { apiKey: 'fixture-only', route: '/v1/images/generations', taskId: 'fixture-task', requestId: 'local-fixture', polling: { interval: 0, maxAttempts: 1 } }

describe('GPT Image 2.5 官方响应进入现有 provider', () => {
  it('APIMart 新模型的文档提交与完成样本无需新解析分支', async () => {
    const submitted = fixture('apimart').examples.find(e => Array.isArray(e.data))!
    const completed = fixture('apimart-poll').examples[0]
    const fetch = vi.fn().mockResolvedValueOnce(response(submitted)).mockResolvedValueOnce(response(completed))
    const runtime = fakeRuntimeContext(fetch)
    const task = await apimart.execute({ ...input, method: 'POST', body: { model: 'gpt-image-2.5-flare', prompt: 'cat' }, runtime })
    expect(task).toMatchObject({ status: 'pending', taskId: 'task_01KXXXXXXXXXXXXXXX' })
    await expect(apimart.continuePolling({ ...input, runtime })).resolves.toMatchObject({ status: 'completed', url: expect.stringContaining('https://upload.apimart.ai/') })
  })

  it.each(['flare', 'sunburst'])('Fal %s 两种模式的真实文档结果均能解析', async variant => {
    for (const mode of ['t2i', 'i2i']) {
      const result = fixture(`fal-${variant}-${mode}`).examples.find(e => Array.isArray(e.images))!
      // 队列事件为契约推导样本，最终媒体响应保持官方原样。
      const fetch = vi.fn().mockResolvedValueOnce(response({ status: 'COMPLETED', response_url: 'https://queue.fal.run/openai/gpt-image-2.5/requests/fixture-task' })).mockResolvedValueOnce(response(result))
      await expect(fal.continuePolling({ ...input, route: `openai/gpt-image-2.5/${variant}/${mode === 't2i' ? 'text-to-image' : 'edit'}`, taskId: 'https://queue.fal.run/openai/gpt-image-2.5/requests/fixture-task/status', runtime: fakeRuntimeContext(fetch) })).resolves.toMatchObject({ status: 'completed', url: expect.stringContaining('https://') })
    }
  })

  it('Grsai 官方成功与失败示例分别完成和拒绝', async () => {
    await expect(grsai.continuePolling({ ...input, runtime: fakeRuntimeContext(vi.fn().mockResolvedValue(response(officialResponse('grsai-poll')))) })).resolves.toMatchObject({ status: 'completed', url: expect.stringContaining('https://file1.') })
    await expect(grsai.continuePolling({ ...input, runtime: fakeRuntimeContext(vi.fn().mockResolvedValue(response(officialResponse('grsai-poll', '400')))) })).rejects.toMatchObject({ code: 'provider_task_failed' })
  })

  it('KIE 保留官方矛盾示例并拒绝业务错误，正常 code=200 则解析成功', async () => {
    const literal = officialResponse('kie-poll')
    expect(literal.code).toBe(505)
    await expect(kie.continuePolling({ ...input, runtime: fakeRuntimeContext(vi.fn().mockResolvedValue(response(literal))) })).rejects.toBeDefined()
    // 明确的合成正例：只修正文档示例的业务码，未冒充官方原样或真网日志。
    await expect(kie.continuePolling({ ...input, runtime: fakeRuntimeContext(vi.fn().mockResolvedValue(response({ ...literal, code: 200 }))) })).resolves.toMatchObject({ status: 'completed', url: 'https://example.com/generated-content.jpg' })
    await expect(kie.execute({ ...input, method: 'POST', body: { model: 'gpt-image-2-5-flare-text-to-image', input: { prompt: 'cat' } }, runtime: fakeRuntimeContext(vi.fn().mockResolvedValue(response(officialResponse('kie-flare-t2i')))) })).resolves.toMatchObject({ status: 'pending', taskId: 'task_gptimage_1765180586443' })
  })
})

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { applicationScriptTool, runApplicationScript, scriptOperationId, type ApplicationScriptHost } from './applicationScript'
import type { EmbeddedTool } from './contracts'

const tools: EmbeddedTool[] = [
  { name: 'read_application_entity', description: '读取实体。', inputSchema: { type: 'object', properties: { ref: { type: 'object' } }, required: ['ref'] } },
  { name: 'change_application_entities', description: '修改实体。', inputSchema: { type: 'object',
    properties: { operationId: { type: 'string' }, summary: { type: 'string' }, changes: { type: 'array' } }, required: ['operationId', 'summary', 'changes'] } },
  { name: 'generate_video_edit_in_place', description: '就地生成。', inputSchema: { type: 'object', properties: { operationId: { type: 'string' } }, required: ['operationId'] } },
]

function hostWith(respond: (name: string, input: Record<string, unknown>, id: string) => unknown) {
  const calls: Array<{ id: string; name: string; input: Record<string, unknown> }> = []
  const host: ApplicationScriptHost = { tools, call: async (id, name, input) => { calls.push({ id, name, input }); return respond(name, input, id) } }
  return { host, calls }
}
const run = (source: string, host: ApplicationScriptHost, extra: { timeoutMs?: number; idleMs?: number; signal?: AbortSignal } = {}) =>
  runApplicationScript({ runId: 'session:call-1', source, ...extra }, host).then(outcome => ({ ...outcome, report: JSON.parse(outcome.text) }))

describe('run_application_script', () => {
  it('脚本环境里没有宿主接口，拿不到进程里的密钥', async () => {
    process.env.HENJI_SCRIPT_TEST_SECRET = 'sk-secret'
    const { host } = hostWith(() => ({ ok: true }))
    const { report } = await run(`return {
      process: typeof process, require: typeof require, fetch: typeof fetch, timer: typeof setTimeout, wasm: typeof WebAssembly,
      viaFunction: (() => { try { return typeof Function('return process')() } catch (error) { return 'threw' } })(),
      globals: Object.getOwnPropertyNames(globalThis).filter(name => /process|require|module|^Buffer|fetch|XMLHttp|import/i.test(name)),
    }`, host)
    delete process.env.HENJI_SCRIPT_TEST_SECRET
    expect(report.ok).toBe(true)
    expect(report.value).toEqual({ process: 'undefined', require: 'undefined', fetch: 'undefined', timer: 'undefined', wasm: 'undefined', viaFunction: 'threw', globals: [] })
    expect(JSON.stringify(report)).not.toContain('sk-secret')
  })

  it('每次调用都走宿主给的统一出口，写工具按运行标识与序号补确定的操作标识，只把 log 与 return 交回', async () => {
    const { host, calls } = hostWith((name, input) => name === 'read_application_entity'
      ? { ok: true, data: { properties: { opacity: 1, big: 'x'.repeat(5000) } }, baselineId: 'baseline-1' }
      // 写工具的真实回执：结果包在 result.data 里
      : { ok: true, operationId: input.operationId, executionState: 'completed', verificationState: 'verified', result: { ok: true, data: { undoRef: `undo-${String(input.summary)}`, effects: [] } } })
    const { report, isError } = await run(`
      const read = await app.call('read_application_entity', { ref: { kind: 'clip', id: 'a' } })
      const undos = []
      for (const index of [1, 2]) undos.push((await app.call('change_application_entities', { summary: 's' + index, changes: [{ opacity: read.data.properties.opacity / 2 }] })).data.undoRef)
      console.log('done', undos.join(','), read.baselineId)
      return { halved: true }`, host)
    expect(isError).toBe(false)
    // 读与写都从 .data 取；写入各步的 undoRef 进回报
    expect(report).toEqual({ ok: true, value: { halved: true }, log: ['done undo-s1,undo-s2 baseline-1'], calls: 3,
      undoRefs: [{ call: 2, tool: 'change_application_entities', undoRef: 'undo-s1' }, { call: 3, tool: 'change_application_entities', undoRef: 'undo-s2' }] })
    expect(calls.map(call => call.name)).toEqual(['read_application_entity', 'change_application_entities', 'change_application_entities'])
    expect(calls[0].input).toEqual({ ref: { kind: 'clip', id: 'a' } })
    expect(calls[1].input.operationId).toBe(scriptOperationId('session:call-1', 2))
    expect(calls[2].input.operationId).toBe(scriptOperationId('session:call-1', 3))
    expect(calls[1].input.operationId).not.toBe(calls[2].input.operationId)
    expect(z.string().uuid().safeParse(calls[1].input.operationId).success).toBe(true)
    expect(calls[1].input.changes).toEqual([{ opacity: 0.5 }])
  })

  it('并发发起的调用按发起顺序逐个交给应用', async () => {
    let active = 0
    let overlapped = false
    const host: ApplicationScriptHost = { tools, call: async (_id, _name, input) => {
      if (++active > 1) overlapped = true
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
      return { ok: true, data: { n: (input.ref as { id: string }).id } }
    } }
    const { report } = await run(`const results = await Promise.all(['a', 'b', 'c'].map(id => app.call('read_application_entity', { ref: { id } })))
      return results.map(result => result.data.n)`, host)
    expect(report.value).toEqual(['a', 'b', 'c'])
    expect(overlapped).toBe(false)
  })

  it('调用失败时回报出错行、第几次调用、哪个工具、错误原文和已完成步骤的撤销引用，不重放', async () => {
    const failure = { ok: false, error: { code: 'INVALID_INPUT', message: 'opacity 应在 0 到 1 之间。这个工具接受：summary、changes' } }
    const { host, calls } = hostWith((_name, input) => input.summary === 'bad' ? failure : { ok: true, data: { undoRef: 'undo-1' } })
    const { report, isError } = await run([
      `await app.call('change_application_entities', { summary: 'good', changes: [] })`,
      `await app.call('change_application_entities', { summary: 'bad', changes: [] })`,
      `await app.call('change_application_entities', { summary: 'never', changes: [] })`,
    ].join('\n'), host)
    expect(isError).toBe(true)
    expect(calls).toHaveLength(2)
    expect(report.error).toMatchObject({ kind: 'script', line: 2, sourceLine: `await app.call('change_application_entities', { summary: 'bad', changes: [] })` })
    expect(report.error.message).toContain('opacity 应在 0 到 1 之间')
    expect(report.failedCall).toMatchObject({ call: 2, tool: 'change_application_entities', status: 'error', operationId: scriptOperationId('session:call-1', 2) })
    expect(report.failedCall.signature).toContain('summary:')
    expect(report.completed).toEqual([{ call: 1, tool: 'change_application_entities', operationId: scriptOperationId('session:call-1', 1), undoRef: 'undo-1' }])
  })

  it('脚本可以接住失败继续；语法错误与写错的工具名给出可改正的事实', async () => {
    const { host } = hostWith(() => ({ ok: false, error: { code: 'NOT_FOUND', message: '没有这个实体' } }))
    const caught = await run(`try { await app.call('read_application_entity', { ref: {} }) } catch (error) { return JSON.parse(error.message).error.code }`, host)
    expect(caught.report).toMatchObject({ ok: true, value: 'NOT_FOUND' })
    const syntax = await run(`const a = 1\nconst b = = 2`, host)
    expect(syntax.report.error).toMatchObject({ kind: 'script', name: 'SyntaxError', line: 2 })
    const unknown = await run(`await app.call('change_entities', {})`, host)
    expect(unknown.report.error.message).toContain('change_application_entities')
    expect(unknown.report.completed).toEqual([])
  })

  it('已经执行、核对没通过的写入不报成未生效，带上撤销引用', async () => {
    const unverified = (input: Record<string, unknown>, executionState: string) => ({ ok: false, operationId: input.operationId, executionState, verificationState: 'unresolved',
      result: { ok: true, data: { undoRef: `undo-${String(input.summary)}`, verification: { verified: false } } } })
    const { host } = hostWith((_name, input) => input.summary === 'caught' ? unverified(input, 'completed') : input.summary === 'half' ? unverified(input, 'partial') : { ok: true, data: { undoRef: 'undo-ok' } })
    const caught = await run(`try { await app.call('change_application_entities', { summary: 'caught', changes: [] }) } catch {}\nreturn 1`, host)
    expect(caught.isError).toBe(false)
    expect(caught.report.failedCalls).toBeUndefined()
    expect(caught.report.unverified).toMatchObject([{ call: 1, executionState: 'completed', undoRef: 'undo-caught' }])
    expect(caught.report.undoRefs).toEqual([{ call: 1, tool: 'change_application_entities', undoRef: 'undo-caught' }])
    const thrown = await run(`await app.call('change_application_entities', { summary: 'ok', changes: [] })\nawait app.call('change_application_entities', { summary: 'half', changes: [] })`, host)
    expect(thrown.isError).toBe(true)
    expect(thrown.report.failedCall).toMatchObject({ call: 2, status: 'unverified', executionState: 'partial', undoRef: 'undo-half' })
    expect(thrown.report.error.message).toContain('只执行了一部分')
    expect(thrown.report.next).toContain('不要当成没生效')
    // 改上了但没保存：要补存，不是读回就算完
    const unsaved = hostWith((_name, input) => ({ ...unverified(input, 'partial'), result: { ok: false, error: { details: { persistence: { state: 'failed' } } } } }))
    const save = await run(`await app.call('change_application_entities', { summary: 'x', changes: [] })`, unsaved.host)
    expect(save.report.error.message).toContain('retry_application_operation_save')
    const billed = hostWith((_name, input) => ({ ...unverified(input, 'partial'), result: { ok: false, error: { details: { execution: { billing: 'submitted' } } } } }))
    expect((await run(`await app.call('generate_video_edit_in_place', {})`, billed.host)).report.error.message).toContain('get_application_operation')
    // 结果没能确认：照协调器的恢复说明办
    const lost = hostWith((_name, input) => ({ ...unverified(input, 'unknown'), recovery: '先读取目标看改没改上，没改上就直接重做。' }))
    expect((await run(`await app.call('change_application_entities', { summary: 'x', changes: [] })`, lost.host)).report.error.message).toContain('没改上就直接重做')
  })

  it('需要用户确认的付费调用让脚本停下，不继续后面的步骤', async () => {
    const { host, calls } = hostWith((_name, input) => ({ ok: false, executionState: 'awaiting_user_confirmation', operationId: input.operationId }))
    const { report, isError } = await run(`await app.call('generate_video_edit_in_place', {})\nawait app.call('change_application_entities', { summary: 'after', changes: [] })`, host)
    expect(isError).toBe(true)
    expect(calls).toHaveLength(1)
    expect(report.failedCall).toMatchObject({ call: 1, tool: 'generate_video_edit_in_place', status: 'awaiting_user_confirmation' })
    expect(report.error.message).toContain(scriptOperationId('session:call-1', 1))
  })

  it('死循环与超时都会停下，并报告结果未知的调用', async () => {
    const { host } = hostWith(() => ({ ok: true }))
    const spin = await run(`while (true) {}`, host, { idleMs: 200 })
    expect(spin.report.error.message).toContain('死循环')
    const slow: ApplicationScriptHost = { tools, call: (_id, _name, _input, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')))) }
    const timeout = await run(`await app.call('change_application_entities', { summary: 'slow', changes: [] })`, slow, { timeoutMs: 300 })
    expect(timeout.report.error.kind).toBe('timeout')
    expect(timeout.report.unfinished).toEqual([{ call: 1, tool: 'change_application_entities', operationId: scriptOperationId('session:call-1', 1) }])
  })

  it('没有 await 的调用在脚本结束时被取消，回报为失败并列出结果未知的调用；要看画面的工具不进脚本', async () => {
    const { host } = hostWith(() => new Promise(resolve => setTimeout(() => resolve({ ok: true, data: {} }), 20)))
    const { report, isError } = await run(["['a', 'b'].forEach(async summary => { await app.call('change_application_entities', { summary, changes: [] }) })", "return 'done'"].join(String.fromCharCode(10)), host)
    expect(isError).toBe(true)
    expect(report).toMatchObject({ ok: false, value: 'done', completed: [] })
    expect(report.unfinished.map((step: { call: number }) => step.call)).toEqual([1, 2])
    const media = await run(`await app.call('read_application_media', { ref: {} })`, { ...host, tools: [...tools, { name: 'read_application_media', inputSchema: { type: 'object' } }] })
    expect(media.report.error.message).toContain('不能在脚本里调用')
    // 没等结果、且在交给应用之前就被拒绝的调用，也不能让回报看起来一切正常
    const dropped = await run(`app.call('nope', {}); return 'done'`, host)
    expect(dropped.report).toMatchObject({ ok: true, calls: 0, failedCalls: [{ call: 1, tool: 'nope', status: 'error' }] })
  })

  it('失败回报指向抛出的那次调用，并列出此前被接住的失败；每次执行的操作标识互不相同', async () => {
    const { host, calls } = hostWith((name) => name === 'read_application_entity' ? { ok: false, error: { code: 'NOT_FOUND', message: '没有这个实体' } } : { ok: true, data: {} })
    const { report } = await run([
      `try { await app.call('read_application_entity', { ref: {} }) } catch (error) {}`,
      `await app.call('read_application_entity', { ref: {} })`,
    ].join(String.fromCharCode(10)), host)
    expect(report.error.line).toBe(2)
    expect(report.failedCall).toMatchObject({ call: 2 })
    expect(report.failedCalls).toMatchObject([{ call: 1, tool: 'read_application_entity', status: 'error' }])
    const tool = applicationScriptTool(host)
    const execute = () => tool.execute('same-call-id', { summary: '写', source: `await app.call('change_application_entities', { summary: 's', changes: [] })` } as never, undefined, undefined, {} as never)
    await execute(); await execute()
    const [first, second] = calls.filter(call => call.name === 'change_application_entities').map(call => call.input.operationId)
    expect(first).not.toBe(second)
  })

  it('app.describe 返回 TypeScript 签名，operationId 不要求脚本提供', async () => {
    const { host, calls } = hostWith(() => ({ ok: true }))
    const { report } = await run(`return await app.describe('change_application_entities')`, host)
    expect(report.value).toContain('change_application_entities(args:')
    expect(report.value).toContain('operationId?:')
    expect(report.value).toContain('summary:')
    expect(calls).toHaveLength(0)
  })

  it('工具定义把失败作为错误抛给 Pi，成功只返回回报文字', async () => {
    const { host } = hostWith(() => ({ ok: true, data: {} }))
    const tool = applicationScriptTool(host)
    const execute = (source: string) => tool.execute('call-9', { summary: '测试', source } as never, undefined, undefined, {} as never)
    await expect(execute(`return 1`)).resolves.toMatchObject({ content: [{ type: 'text', text: JSON.stringify({ ok: true, value: 1, calls: 0 }) }] })
    await expect(execute(`throw new Error('boom')`)).rejects.toThrow(/boom/)
  })
})

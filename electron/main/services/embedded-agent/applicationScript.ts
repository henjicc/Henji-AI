import { createHash, randomUUID } from 'node:crypto'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { EmbeddedTool } from './contracts'

type ToolResult = Awaited<ReturnType<ToolDefinition['execute']>>
type CallTool = (id: string, name: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>

export const APPLICATION_SCRIPT_TOOL = 'run_application_script'
/** 含等待应用工具的时间：导出、生成等待这类调用本身就要几分钟到十几分钟。 */
const SCRIPT_TIMEOUT_MS = 30 * 60_000
/** 脚本自己连续计算、既不调用应用也不结束的最长时间：编排脚本的计算量是毫秒级，到这里只可能是死循环。 */
const SCRIPT_IDLE_MS = 60_000
const SCRIPT_MEMORY_BYTES = 256 * 1024 * 1024
/** 结果要由模型亲眼看图、或直接调用时宿主另有处理的工具：脚本拿到的只是字节或未经处理的回执，所以只能直接调用。 */
const DIRECT_ONLY_TOOLS = new Set(['read_application_media', 'read_intent_recording', 'interpret_intent'])

export interface ApplicationScriptHost {
  /** 脚本能调用的应用工具，与模型直接调用的是同一份目录。 */
  tools: readonly EmbeddedTool[]
  /** 与模型直接调用同一个出口：交给主进程的统一派发入口，付费策略、外来代码确认、回收区与幂等都在那一侧。 */
  call: CallTool
}

interface ScriptStep { call: number; tool: string; status: 'ok' | 'error' | 'awaiting_user_confirmation' | 'cancelled'; operationId?: string; undoRef?: string; error?: string }

/** 写工具的操作标识由“脚本运行标识 + 调用序号”决定：同一次运行里的同一次调用永远是同一个值，账本据此拒绝重复执行。 */
export function scriptOperationId(runId: string, call: number): string {
  const hex = createHash('sha256').update(`${runId}:${call}`).digest('hex')
  const variant = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/**
 * 占脚本之前的第一行：应用调用的失败是宿主异步送回的，错误本身不带脚本位置，这里在发起调用时记下调用处，失败时接到堆栈后面。
 * 独占一行后脚本的行号整体加一，列号不受影响。
 */
const CALL_SITE_PRELUDE = 'const NL = String.fromCharCode(10), app = (host => Object.freeze({ describe: host.describe, call: (name, input) => { const site = String(new Error().stack).split(NL).slice(1).join(NL); return host.call(name, input).catch(error => { error.stack = String(error.stack) + NL + site; throw error }) } }))(globalThis.app);'

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const acceptsOperationId = (tool: EmbeddedTool): boolean => 'operationId' in record(tool.inputSchema.properties)

/** 名字写错时给出目录里相近的工具名，模型下一轮就能改对。 */
function similarNames(name: string, tools: readonly EmbeddedTool[]): string[] {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2)
  return tools.map(tool => ({ name: tool.name, score: words.filter(word => tool.name.includes(word)).length }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 8).map(item => item.name)
}

/**
 * 在只带应用工具的隔离环境里运行模型写的脚本，返回交回模型的回报文字。
 *
 * 脚本跑在 QuickJS（WebAssembly）里，另起线程：环境里没有 Node 接口、文件、网络与定时器，唯一的出口是下面注册的
 * app.call / app.describe，所以拿不到本进程持有的模型密钥。沿用 Pi 自带脚本工具的同一个沙箱包。
 */
export async function runApplicationScript(input: { runId: string; source: string; signal?: AbortSignal; timeoutMs?: number; idleMs?: number },
  host: ApplicationScriptHost): Promise<{ text: string; isError: boolean }> {
  const { CodemodeSandbox, renderToolSample } = await import('@earendil-works/pi-codemode')
  const steps: ScriptStep[] = []
  const stop = new AbortController()
  let stopReason: 'idle' | undefined
  const forward = (): void => stop.abort()
  input.signal?.addEventListener('abort', forward, { once: true })
  if (input.signal?.aborted) stop.abort()

  let inFlight = 0
  let finished = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const watchIdle = (): void => {
    clearTimeout(idleTimer)
    if (inFlight === 0 && !finished) idleTimer = setTimeout(() => { stopReason = 'idle'; stop.abort() }, input.idleMs ?? SCRIPT_IDLE_MS)
  }
  // 调用按发起顺序逐个交给应用：与模型直接调用时的串行一致，序号也因此稳定。
  let queue: Promise<unknown> = Promise.resolve()

  const callApplication = async (args: unknown, signal: AbortSignal): Promise<unknown> => {
    const [name, rawInput] = Array.isArray(args) ? args as unknown[] : []
    // 先登记再校验：脚本没有 await 的调用即使在这里就被拒绝，回报里也要看得到它。
    const step: ScriptStep = { call: steps.length + 1, tool: String(name), status: 'cancelled' }
    steps.push(step)
    const reject = (message: string): never => { step.status = 'error'; step.error = message; throw new Error(message) }
    if (typeof name !== 'string') return reject('app.call 的第一个参数是工具名（字符串），第二个参数是该工具的输入对象。')
    const tool = host.tools.find(item => item.name === name)
    if (!tool) {
      const similar = similarNames(name, host.tools)
      return reject(`没有名为 ${name} 的应用工具。${similar.length ? `相近的有：${similar.join('、')}。` : ''}工具名见 load_application_tools 的说明。`)
    }
    if (DIRECT_ONLY_TOOLS.has(name)) return reject(`${name} 的结果要由你直接查看，不能在脚本里调用；脚本结束后直接调用它。`)
    if (rawInput !== undefined && (rawInput === null || typeof rawInput !== 'object' || Array.isArray(rawInput))) return reject(`${name} 的输入必须是对象：app.call(${JSON.stringify(name)}, { … })。`)
    const toolInput = { ...record(rawInput) }
    if (acceptsOperationId(tool) && toolInput.operationId === undefined) toolInput.operationId = scriptOperationId(input.runId, step.call)
    if (typeof toolInput.operationId === 'string') step.operationId = toolInput.operationId
    inFlight++; watchIdle()
    const run = queue.then(async () => {
      signal.throwIfAborted()
      const result = record(await host.call(`${input.runId}:${step.call}`, name, toolInput, signal))
      if (result.ok === true) {
        step.status = 'ok'
        const undoRef = record(result.data).undoRef
        if (typeof undoRef === 'string') step.undoRef = undoRef
        return result
      }
      if (result.executionState === 'awaiting_user_confirmation') {
        step.status = 'awaiting_user_confirmation'
        throw new Error(step.error = `AWAITING_USER_CONFIRMATION:${name} 需要用户在痕迹AI里确认后才会执行，脚本在此停下。确认后应用自动继续，用 get_application_operation 查询 operationId=${String(result.operationId ?? step.operationId)}，不要重新提交。`)
      }
      throw new Error(JSON.stringify(result))
    })
    queue = run.catch(() => undefined)
    try { return await run } catch (error) {
      if (step.status === 'cancelled' && !signal.aborted) { step.status = 'error'; step.error = error instanceof Error ? error.message : String(error) }
      throw error
    } finally { inFlight--; watchIdle() }
  }

  const describeTools = (args: unknown): unknown => {
    const [target] = Array.isArray(args) ? args as unknown[] : []
    const names = Array.isArray(target) ? target : [target]
    const described = names.map((name) => {
      const tool = host.tools.find(item => item.name === name)
      if (!tool) return `没有名为 ${String(name)} 的应用工具。${similarNames(String(name), host.tools).join('、')}`
      // operationId 由宿主补上，签名里不再要求脚本提供。
      const required = Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required.filter(key => key !== 'operationId') : undefined
      return renderToolSample({ name: tool.name, description: tool.description, inputSchema: { ...tool.inputSchema, ...(required ? { required } : {}) } })
    })
    return Array.isArray(target) ? described : described[0]
  }

  const sandbox = new CodemodeSandbox({ timeoutMs: input.timeoutMs ?? SCRIPT_TIMEOUT_MS, memoryLimitBytes: SCRIPT_MEMORY_BYTES, globals: [
    { name: 'app.call', spread: true, execute: (args, context) => callApplication(args, context.signal) },
    { name: 'app.describe', spread: true, execute: args => describeTools(args) },
  ] })
  watchIdle()
  let result: Awaited<ReturnType<typeof sandbox.execute>>
  try {
    result = await sandbox.execute(`${CALL_SITE_PRELUDE}\n${input.source}`, { signal: stop.signal })
  } finally {
    finished = true
    clearTimeout(idleTimer)
    input.signal?.removeEventListener('abort', forward)
    void sandbox.close()
  }
  if (input.signal?.aborted) throw new Error('脚本已随本轮回复停止；已提交的应用操作请用 get_application_operation 查询结果。')

  const log = result.output.flatMap(item => item.type === 'text' ? [item.text] : [])
  const undoRefs = steps.flatMap(step => step.undoRef ? [{ call: step.call, tool: step.tool, undoRef: step.undoRef }] : [])
  const unfinished = steps.filter(step => step.status === 'cancelled').map(({ call, tool, operationId }) => ({ call, tool, ...(operationId ? { operationId } : {}) }))
  const completed = steps.filter(step => step.status === 'ok').map(({ call, tool, operationId, undoRef }) => ({ call, tool, ...(operationId ? { operationId } : {}), ...(undoRef ? { undoRef } : {}) }))
  // 没有生效的调用在成功与失败的回报里都列出：脚本可能接住了它，也可能根本没等它，宿主分不出来，只报事实。
  const failed = steps.filter(step => step.status === 'error' || step.status === 'awaiting_user_confirmation')
  const failedCalls = failed.map(({ call, tool, status, operationId, error }) => ({ call, tool, status, ...(operationId ? { operationId } : {}), ...(error ? { error: error.slice(0, 500) } : {}) }))
  if (result.ok && !unfinished.length) {
    return { isError: false, text: JSON.stringify({ ok: true, ...(result.value === undefined ? {} : { value: result.value }),
      ...(log.length ? { log } : {}), calls: completed.length, ...(failedCalls.length ? { failedCalls, note: 'failedCalls 里的调用尚未生效；等待用户确认的见各自的 error，不要重新提交。' } : {}), ...(undoRefs.length ? { undoRefs } : {}) }) }
  }
  if (result.ok) {
    // 脚本结束时沙箱会取消还没结束的调用；不当成失败回报，模型会以为这些调用都做完了。
    return { isError: true, text: JSON.stringify({ ok: false,
      error: { kind: 'script', message: `脚本结束时还有 ${unfinished.length} 次 app.call 没有等到结果（多半是漏写 await，或在 forEach 里用了 async 回调），已被取消。改用 for…of 加 await，或 await Promise.all(…)。` },
      ...(result.value === undefined ? {} : { value: result.value }), completed, unfinished, ...(failedCalls.length ? { failedCalls } : {}), ...(log.length ? { log } : {}),
      next: 'completed 里的调用已经生效，不要整段重跑。unfinished 里的调用结果未知：带 operationId 的先用 get_application_operation 查询，查到没执行再补做；不带的读回现状核对。' }) }
  }
  // 第一行是调用处记录的包装代码，脚本自己的位置从第二行起。
  const location = [...(result.error.stack ?? '').matchAll(/codemode\.js:(\d+):(\d+)/g)].find(match => Number(match[1]) > 1)
  const line = location ? Number(location[1]) - 1 : undefined
  // 抛出脚本的通常是最近一次失败；错误文字相同时取最后一次。
  const cause = [...failed].reverse().find(step => step.error && result.error.message.includes(step.error))
  const otherFailed = failedCalls.filter(step => step.call !== cause?.call)
  const message = result.error.kind === 'timeout' ? `脚本超过 ${Math.round((input.timeoutMs ?? SCRIPT_TIMEOUT_MS) / 60_000)} 分钟仍未结束，已停止。`
    : result.error.kind === 'aborted' && stopReason === 'idle' ? '脚本连续计算却不调用应用也不结束（多半是死循环），已停止。'
    : result.error.message
  return { isError: true, text: JSON.stringify({ ok: false,
    error: { kind: result.error.kind, ...(result.error.name ? { name: result.error.name } : {}), message,
      ...(line && line > 0 ? { line, column: Number(location![2]), sourceLine: input.source.split('\n')[line - 1]?.trim().slice(0, 300) } : {}) },
    ...(cause ? { failedCall: { call: cause.call, tool: cause.tool, status: cause.status, ...(cause.operationId ? { operationId: cause.operationId } : {}),
      // 参数写错是最常见的失败：把签名随回报给出，下一段脚本就能改对，不必再查一轮。
      ...(cause.status === 'error' && !DIRECT_ONLY_TOOLS.has(cause.tool) && host.tools.some(tool => tool.name === cause.tool) ? { signature: describeTools([cause.tool]) } : {}) } } : {}),
    completed, ...(otherFailed.length ? { failedCalls: otherFailed } : {}), ...(unfinished.length ? { unfinished } : {}),
    ...(log.length ? { log } : {}),
    next: 'completed 里的调用已经生效，不会回滚，也不要整段重跑：改正后从出错处续做，或用各自的 undoRef 撤销。unfinished 里的调用结果未知，带 operationId 的用 get_application_operation 查询。',
  }) }
}

/** 交给模型的脚本工具；嵌套调用不进对话，只有回报文字进。 */
export function applicationScriptTool(host: ApplicationScriptHost): ToolDefinition {
  return {
    name: APPLICATION_SCRIPT_TOOL, label: '运行脚本',
    description: [
      '用一段 JavaScript 编排多次应用工具调用：循环、条件和中间数据留在脚本里，只有 console.log 与 return 的内容回到对话。同一件事要连续调用三次以上、要批量处理一组对象、或要先读再按结果决定怎么改时用它；单次调用直接用工具。',
      'source 是异步函数体，直接写 await 和 return；没有 import、require、文件、网络和定时器。',
      'app.call(name, input)：调用任一应用工具（包括不在工具列表里的），返回该工具的结果对象（{ ok: true, data, … }）；失败时抛出 Error，message 是工具给出的错误原文，可以 try/catch。写工具的 operationId 省略，由应用按本次脚本和调用次序生成。调用按发起顺序逐个执行，每次都要 await。读图（read_application_media）和随手摆讲解这类要你看画面的工具不能在脚本里调用。',
      'app.describe(name 或 name 数组)：返回工具说明与 TypeScript 参数签名；参数不清楚时先用一段只含 return await app.describe([...]) 的脚本查。',
      '多项实体修改尽量合进一次 change_application_entities，整组只有一个 undoRef。脚本中途出错不会回滚已完成的调用：回报里有出错行、第几次调用、哪个工具、错误原文和已完成各步的 undoRef，据此续做或撤销，不要整段重跑。需要用户确认付费或信任外来代码时脚本停下并报告。',
      '只 return 下一步要用的事实（引用、数量、核对结果），不要把整份读取结果原样返回。',
    ].join('\n'),
    parameters: { type: 'object', properties: {
      summary: { type: 'string', description: '一句话说明这段脚本要做什么。' },
      source: { type: 'string', description: '异步函数体的 JavaScript 源码。' },
    }, required: ['summary', 'source'], additionalProperties: false } as ToolDefinition['parameters'],
    executionMode: 'sequential',
    execute: async (_id, args, signal): Promise<ToolResult> => {
      const { source } = args as { source: string }
      // 运行标识每次执行新取：供应商给的工具调用标识可能为空或按回合重复，不能拿来保证操作标识唯一。
      const outcome = await runApplicationScript({ runId: randomUUID(), source, signal }, host)
      if (outcome.isError) throw new Error(outcome.text)
      return { content: [{ type: 'text', text: outcome.text }], details: undefined }
    },
  }
}

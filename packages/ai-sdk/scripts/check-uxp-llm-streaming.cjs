#!/usr/bin/env node

const path = require('path')
const vm = require('vm')
const { buildSync } = require('esbuild')

const sourceRoot = path.resolve(__dirname, '..', 'src')

function fail(message) {
  console.error(`✘ UXP LLM streaming 门禁失败：${message}`)
  process.exit(1)
}

function bundle(format) {
  const result = buildSync({
    stdin: {
      contents: "export * from './llm/streaming/index'",
      resolveDir: sourceRoot,
      sourcefile: 'uxp-llm-streaming.ts',
      loader: 'ts',
    },
    bundle: true,
    format,
    globalName: format === 'iife' ? 'HenjiUxpLlmStreaming' : undefined,
    platform: 'browser',
    target: 'es2020',
    treeShaking: false,
    minify: true,
    metafile: true,
    write: false,
    logLevel: 'silent',
  })
  const code = result.outputFiles?.[0]?.text
  if (!code) fail(`${format} 未生成代码`)
  const inputs = Object.keys(result.metafile.inputs).map((value) => value.replaceAll('\\', '/'))
  const forbiddenInputs = inputs.filter((input) => (
    input.includes('/zod/')
    || input.includes('/node_modules/ai/')
    || input.includes('/node_modules/@ai-sdk/')
    || input.includes('/llm/modelStep.')
    || input.includes('/llm/sdk/')
    || /(?:^|\/)node_modules\/(?:@vercel\/)?ai\//.test(input)
    || /(?:^|\/)(?:node:)?(?:buffer|process|stream)(?:\/|\.)/.test(input)
  ))
  if (forbiddenInputs.length > 0) {
    fail(`${format} 静态图含禁用模块：${forbiddenInputs.join(', ')}`)
  }

  const forbiddenCode = [
    ['eval', /\beval\s*\(/],
    ['new Function', /\bnew\s+Function\s*\(/],
    ['Function constructor', /(?:^|[^.$\w])Function\s*\(/],
    ['Buffer', /\bBuffer\b/],
    ['process', /\bprocess\b/],
    ['direct TextDecoder constructor', /\bnew\s+TextDecoder\b/],
    ['global fetch', /(?:\bglobalThis|\bwindow|\bself)\.fetch\b|(?:^|[^.$\w])fetch\s*\(/],
    ['TransformStream', /\bTransformStream\b/],
    ['WritableStream', /\bWritableStream\b/],
  ].filter(([, pattern]) => pattern.test(code)).map(([name]) => name)
  if (forbiddenCode.length > 0) fail(`${format} 代码含禁用能力：${forbiddenCode.join(', ')}`)
  return { code, bytes: code.length, modules: inputs.length }
}

function utf8Response() {
  const source = [
    'data: {"choices":[{"delta":{"reasoning_content":"思考"},"finish_reason":null}]}',
    '',
    'data: {"choices":[{"delta":{"content":"完成✅"},"finish_reason":null}]}',
    '',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7,"prompt_tokens_details":{"cached_tokens":1},"completion_tokens_details":{"reasoning_tokens":2}}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n')
  const bytes = encodeUtf8Fixture(source)
  const multiByteStart = bytes.findIndex((value, index) => value === 0xe6 && bytes[index + 1] === 0x80)
  const cuts = [multiByteStart + 1, multiByteStart + 2, multiByteStart + 13, bytes.length]
  let offset = 0
  return new Response(new ReadableStream({
    start(controller) {
      for (const cut of cuts) {
        controller.enqueue(bytes.slice(offset, cut))
        offset = cut
      }
      controller.close()
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function encodeUtf8Fixture(input) {
  const bytes = []
  for (const symbol of input) {
    const codePoint = symbol.codePointAt(0)
    if (codePoint <= 0x7f) {
      bytes.push(codePoint)
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f))
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      )
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      )
    }
  }
  return Uint8Array.from(bytes)
}

async function main() {
  const iife = bundle('iife')
  const esm = bundle('esm')
  const context = vm.createContext({
    AbortController,
    DOMException,
    Headers,
    Promise,
    ReadableStream,
    Response,
    Uint8Array,
    setTimeout,
    clearTimeout,
  })
  const utf8Globals = vm.runInContext('[typeof TextEncoder, typeof TextDecoder]', context)
  if (JSON.stringify(utf8Globals) !== JSON.stringify(['undefined', 'undefined'])) {
    fail(`受限 VM 意外提供 UTF-8 DOM 全局：${JSON.stringify(utf8Globals)}`)
  }
  new vm.Script(iife.code, { filename: 'uxp-llm-streaming.iife.js' }).runInContext(context)
  const api = vm.runInContext('HenjiUxpLlmStreaming', context)

  let networkCalls = 0
  api.cancelLlmChatTask('lifecycle-only')
  if (networkCalls !== 0) fail(`import/cancel 生命周期触发 ${networkCalls} 次网络`)

  const events = []
  const outcome = await api.runLlmChatStream({
    requestId: 'uxp-gate-fixture',
    providerId: 'openai',
    modelId: 'fixture-model',
    baseUrl: 'https://fixture.invalid/v1',
    messages: [{ role: 'user', content: '你好' }],
  }, 'uxp-gate-fixture', (event) => events.push(event), {
    transport: { fetch: async () => { networkCalls += 1; return utf8Response() } },
    credentials: { get: async () => 'fixture-key' },
    media: { read: async () => { throw new Error('media forbidden') } },
  })
  if (networkCalls !== 1) fail(`scripted Transport 调用数不是 1：${networkCalls}`)
  if (JSON.stringify(events) !== JSON.stringify([
    { type: 'ReasoningToken', data: '思考' },
    { type: 'Token', data: '完成✅' },
  ])) fail(`stream events 不匹配：${JSON.stringify(events)}`)
  if (outcome.output !== '完成✅' || outcome.reasoningOutput !== '思考' || outcome.finishReason !== 'stop') {
    fail(`text/reasoning/stop 不匹配：${JSON.stringify(outcome)}`)
  }
  if (outcome.usage?.inputTokens !== 3 || outcome.usage?.outputTokens !== 4
    || outcome.usage?.reasoningTokens !== 2 || outcome.usage?.totalTokens !== 7) {
    fail(`usage 不匹配：${JSON.stringify(outcome.usage)}`)
  }

  let abortStarted
  const started = new Promise((resolve) => { abortStarted = resolve })
  const aborting = api.runLlmChatStream({
    requestId: 'uxp-gate-abort',
    providerId: 'openai',
    modelId: 'fixture-model',
    baseUrl: 'https://fixture.invalid/v1',
    messages: [{ role: 'user', content: 'cancel' }],
  }, 'uxp-gate-abort', () => undefined, {
    transport: {
      fetch: async (_url, init) => {
        abortStarted()
        return await new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
        })
      },
    },
    credentials: { get: async () => 'fixture-key' },
    media: { read: async () => { throw new Error('media forbidden') } },
  })
  await started
  api.cancelLlmChatTask('uxp-gate-abort')
  let abortMessage = ''
  try {
    await aborting
  } catch (error) {
    abortMessage = error instanceof Error ? error.message : String(error)
  }
  if (!abortMessage.endsWith('[task_cancelled] LLM task cancelled: uxp-gate-abort')) {
    fail(`Abort 归一化不匹配：${abortMessage}`)
  }

  console.log(`✔ UXP LLM streaming 门禁通过：${JSON.stringify({
    iife: { bytes: iife.bytes, modules: iife.modules },
    esm: { bytes: esm.bytes, modules: esm.modules },
    lifecycleNetworkCalls: 0,
    fixtureTransportCalls: networkCalls,
    abortTransportCalls: 1,
  })}`)
}

main().catch((error) => fail(error instanceof Error ? error.stack ?? error.message : String(error)))

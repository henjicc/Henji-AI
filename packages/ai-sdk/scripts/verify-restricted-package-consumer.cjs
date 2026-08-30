#!/usr/bin/env node

const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')
const { spawnSync } = require('child_process')
const { buildSync } = require('esbuild')

const packageRoot = path.resolve(__dirname, '..')
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-sdk-restricted-consumer-'))
const packRoot = path.join(temporaryRoot, 'pack')
const consumerRoot = path.join(temporaryRoot, 'consumer')

function fail(message) {
  throw new Error(`受限宿主发布包门禁失败：${message}`)
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: process.env })
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    process.exit(result.status ?? 1)
  }
  return result.stdout
}

function installPackage() {
  fs.mkdirSync(packRoot, { recursive: true })
  fs.mkdirSync(consumerRoot, { recursive: true })
  fs.writeFileSync(path.join(consumerRoot, 'package.json'), JSON.stringify({
    name: 'henji-sdk-restricted-consumer-probe',
    private: true,
  }))
  let installSpec = process.env.HENJI_SDK_INSTALL_SPEC
  if (!installSpec) {
    const packed = JSON.parse(run('npm', [
      'pack', '--json', '--ignore-scripts', '--pack-destination', packRoot,
    ], packageRoot))
    installSpec = path.join(packRoot, packed[0].filename)
  }
  const args = [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', installSpec,
  ]
  if (process.env.HENJI_SDK_NPM_USERCONFIG) {
    args.push('--userconfig', process.env.HENJI_SDK_NPM_USERCONFIG)
  }
  run('npm', args, consumerRoot)
  const installed = JSON.parse(fs.readFileSync(
    path.join(consumerRoot, 'node_modules', '@henjicc', 'ai-sdk', 'package.json'),
    'utf8',
  ))
  const expected = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
  if (installed.name !== expected.name || installed.version !== expected.version) {
    fail(`安装坐标不是 ${expected.name}@${expected.version}`)
  }
  return `${installed.name}@${installed.version}`
}

function bundle(name, specifier, globalName, forbiddenFragments) {
  const result = buildSync({
    stdin: {
      contents: `export * from '${specifier}'`,
      resolveDir: consumerRoot,
      sourcefile: `${name}.js`,
      loader: 'js',
    },
    bundle: true,
    format: 'iife',
    globalName,
    platform: 'browser',
    target: 'es2020',
    treeShaking: false,
    minify: true,
    metafile: true,
    write: false,
    logLevel: 'silent',
  })
  const code = result.outputFiles?.[0]?.text
  if (!code) fail(`${name} 没有 IIFE 产物`)
  const inputs = Object.keys(result.metafile.inputs).map((input) => input.replaceAll('\\', '/'))
  const forbiddenInputs = inputs.filter((input) => forbiddenFragments.some((part) => input.includes(part)))
  if (forbiddenInputs.length > 0) fail(`${name} 带入无关模块：${forbiddenInputs.join(', ')}`)
  if (/\b(?:require\s*\(|eval\s*\(|new\s+Function\s*\()|["']node:|["']electron["']/.test(code)) {
    fail(`${name} 含 require/eval/new Function/Node/Electron`)
  }
  return { code, inputs, bytes: code.length }
}

function restrictedContext() {
  const context = vm.createContext({
    AbortController,
    Blob,
    DOMException,
    FormData,
    Headers,
    Promise,
    ReadableStream,
    Request,
    Response,
    URL,
    URLSearchParams,
    Uint8Array,
    atob,
    btoa,
    clearTimeout,
    setTimeout,
  })
  const codecs = vm.runInContext('[typeof TextEncoder, typeof TextDecoder]', context)
  if (JSON.stringify(codecs) !== JSON.stringify(['undefined', 'undefined'])) {
    fail(`VM 意外存在文本编解码全局：${JSON.stringify(codecs)}`)
  }
  vm.runInContext('delete Array.prototype.at', context)
  if (vm.runInContext('typeof Array.prototype.at', context) !== 'undefined') {
    fail('VM 未能模拟缺少 Array.prototype.at 的 ES2020 宿主')
  }
  return context
}

function evaluate(context, artifact, globalName) {
  new vm.Script(artifact.code, { filename: `${globalName}.iife.js` }).runInContext(context)
  return vm.runInContext(globalName, context)
}

async function verify() {
  const packageId = installPackage()
  const commonForbidden = ['/dist/generation', '/dist/catalog/']
  const asr = bundle(
    'BailianAsr',
    '@henjicc/ai-sdk/capabilities/speech-recognition/bailian',
    'HenjiPackedBailianAsr',
    [...commonForbidden, '/dist/capabilities/speech-recognition/bailian/realtime/', '/dist/capabilities/translation/', '/dist/llm/'],
  )
  const realtime = bundle(
    'BailianRealtimeAsr',
    '@henjicc/ai-sdk/capabilities/speech-recognition/bailian/realtime',
    'HenjiPackedBailianRealtimeAsr',
    [...commonForbidden, '/dist/capabilities/translation/', '/dist/llm/'],
  )
  const volcengineAsr = bundle(
    'VolcengineAsr',
    '@henjicc/ai-sdk/capabilities/speech-recognition/volcengine',
    'HenjiPackedVolcengineAsr',
    [
      ...commonForbidden,
      '/dist/capabilities/speech-recognition/volcengine/realtime/',
      '/dist/capabilities/speech-recognition/bailian/',
      '/dist/capabilities/speech-recognition/siliconflow/',
      '/dist/capabilities/speech-recognition/groq/',
      '/dist/capabilities/translation/',
      '/dist/llm/',
    ],
  )
  const volcengineRealtime = bundle(
    'VolcengineRealtimeAsr',
    '@henjicc/ai-sdk/capabilities/speech-recognition/volcengine/realtime',
    'HenjiPackedVolcengineRealtimeAsr',
    [
      ...commonForbidden,
      '/dist/capabilities/speech-recognition/bailian/',
      '/dist/capabilities/speech-recognition/siliconflow/',
      '/dist/capabilities/speech-recognition/groq/',
      '/dist/capabilities/translation/',
      '/dist/llm/',
    ],
  )
  const siliconFlowAsr = bundle(
    'SiliconFlowAsr',
    '@henjicc/ai-sdk/capabilities/speech-recognition/siliconflow',
    'HenjiPackedSiliconFlowAsr',
    [
      ...commonForbidden,
      '/dist/capabilities/speech-recognition/bailian/',
      '/dist/capabilities/speech-recognition/volcengine/',
      '/dist/capabilities/speech-recognition/groq/',
      '/dist/capabilities/translation/',
      '/dist/llm/',
    ],
  )
  const groqAsr = bundle(
    'GroqAsr',
    '@henjicc/ai-sdk/capabilities/speech-recognition/groq',
    'HenjiPackedGroqAsr',
    [
      ...commonForbidden,
      '/dist/capabilities/speech-recognition/bailian/',
      '/dist/capabilities/speech-recognition/volcengine/',
      '/dist/capabilities/speech-recognition/siliconflow/',
      '/dist/capabilities/translation/',
      '/dist/llm/',
    ],
  )
  const translation = bundle(
    'BailianTranslation',
    '@henjicc/ai-sdk/capabilities/translation/bailian',
    'HenjiPackedBailianTranslation',
    [...commonForbidden, '/dist/capabilities/speech-recognition/', '/dist/llm/'],
  )
  const groq = bundle(
    'Groq',
    '@henjicc/ai-sdk/llm/groq',
    'HenjiPackedGroq',
    [...commonForbidden, '/dist/capabilities/'],
  )
  const bigmodel = bundle(
    'Bigmodel',
    '@henjicc/ai-sdk/llm/bigmodel',
    'HenjiPackedBigmodel',
    [...commonForbidden, '/dist/capabilities/', '/dist/llm/groq/', '/dist/llm/modules/'],
  )
  const llmModules = bundle(
    'LlmModules',
    '@henjicc/ai-sdk/llm/modules',
    'HenjiPackedLlmModules',
    [
      ...commonForbidden,
      '/dist/capabilities/speech-recognition/',
      '/dist/capabilities/translation/',
      '/dist/llm/groq/',
      '/dist/llm/chat.js',
      '/dist/llm/streaming.js',
    ],
  )

  const context = restrictedContext()
  const asrApi = evaluate(context, asr, 'HenjiPackedBailianAsr')
  const realtimeApi = evaluate(context, realtime, 'HenjiPackedBailianRealtimeAsr')
  const volcengineAsrApi = evaluate(context, volcengineAsr, 'HenjiPackedVolcengineAsr')
  const volcengineRealtimeApi = evaluate(context, volcengineRealtime, 'HenjiPackedVolcengineRealtimeAsr')
  const siliconFlowAsrApi = evaluate(context, siliconFlowAsr, 'HenjiPackedSiliconFlowAsr')
  const groqAsrApi = evaluate(context, groqAsr, 'HenjiPackedGroqAsr')
  const translationApi = evaluate(context, translation, 'HenjiPackedBailianTranslation')
  const groqApi = evaluate(context, groq, 'HenjiPackedGroq')
  const bigmodelApi = evaluate(context, bigmodel, 'HenjiPackedBigmodel')
  const llmModuleApi = evaluate(context, llmModules, 'HenjiPackedLlmModules')

  if (asrApi.bailianNonRealtimeAsrPresets.length !== 5) fail('非实时 ASR 不是 5 个')
  if (realtimeApi.bailianRealtimeAsrPresets.length !== 4) fail('实时 ASR 不是 4 个')
  if (volcengineAsrApi.volcengineFileAsrPresets.length !== 1) fail('火山文件 ASR 不是 1 个')
  if (volcengineRealtimeApi.volcengineRealtimeAsrPresets.length !== 1) fail('火山实时 ASR 不是 1 个')
  if (siliconFlowAsrApi.siliconFlowAsrPresets.length !== 2) fail('硅基流动 ASR 不是 2 个')
  if (groqAsrApi.groqAsrPresets.length !== 2) fail('Groq ASR 不是 2 个')
  if (Object.keys(translationApi.BAILIAN_QWEN_MT_PRESETS).length !== 3) fail('Qwen-MT 不是 3 个')
  if (!asrApi.bailianNonRealtimeAsrPresets.every((preset) => (
    preset.id === `bailian.speech-recognition.${preset.modelId}`
    && preset.descriptor.providerIds[0] === 'bailian'
  ))) fail('非实时 ASR 坐标不规范')
  if (!realtimeApi.bailianRealtimeAsrPresets.every((preset) => (
    preset.id === `bailian.speech-recognition.${preset.modelId}`
    && preset.descriptor.providerIds[0] === 'bailian'
  ))) fail('实时 ASR 坐标不规范')
  for (const [label, presets, providerId] of [
    ['火山文件 ASR', volcengineAsrApi.volcengineFileAsrPresets, 'volcengine'],
    ['火山实时 ASR', volcengineRealtimeApi.volcengineRealtimeAsrPresets, 'volcengine'],
    ['硅基流动 ASR', siliconFlowAsrApi.siliconFlowAsrPresets, 'siliconflow'],
    ['Groq ASR', groqAsrApi.groqAsrPresets, 'groq'],
  ]) {
    if (!presets.every((preset) => (
      preset.id === `${providerId}.speech-recognition.${preset.modelId}`
      && preset.descriptor.providerIds[0] === providerId
    ))) fail(`${label} 坐标不规范`)
  }
  const groqWordOnly = groqAsrApi.parseGroqTranscription({
    text: 'restricted host fixture',
    words: [
      { word: 'restricted', start: 0, end: 0.4 },
      { word: 'host', start: 0.4, end: 0.8 },
    ],
  })
  if (groqWordOnly.segments?.[0]?.endMs !== 800
    || groqWordOnly.segments[0].words?.length !== 2) {
    fail('Groq 词级响应在无 Array.prototype.at 宿主中归一化失败')
  }
  if (groqApi.GROQ_DEFAULT_MODEL_CONFIG.providerId !== 'groq'
    || groqApi.GROQ_DEFAULT_MODEL_CONFIG.modelId !== 'openai/gpt-oss-20b') {
    fail('Groq 默认模型坐标不匹配')
  }
  const globalBigmodel = bigmodelApi.createBigmodelProvider({ endpointProfile: 'global' })
  if (globalBigmodel.providerFamilyId !== 'bigmodel'
    || globalBigmodel.credentialId !== 'bigmodel-global'
    || globalBigmodel.baseUrl !== 'https://api.z.ai/api/paas/v4') {
    fail('BigModel Global endpoint profile 身份不匹配')
  }
  const groqRequest = groqApi.createGroqChatRequest({ messages: [] })
  if (groqRequest.providerId !== 'groq' || groqRequest.modelId !== 'openai/gpt-oss-20b') {
    fail('Groq 请求未使用规范默认坐标')
  }
  const llmEvents = []
  const llmClient = llmModuleApi.createLlmModuleClient({
    runtime: {
      transport: { fetch: async () => { throw new Error('network forbidden') } },
      credentials: { get: async () => undefined },
      media: { read: async () => { throw new Error('media forbidden') } },
    },
    modules: [groqApi.createGroqLlmModule(), {
      descriptor: {
        id: 'fixture.external.llm',
        source: { kind: 'plugin', namespace: 'com.example.restricted' },
        providerId: 'fixture',
        modelId: 'fixture-model',
        capabilities: {
          text: true, image: false, video: false, audio: false, streaming: false,
          toolCall: false, parallelTools: false, jsonOutput: false,
          structuredOutputMode: 'none', reasoning: false, sampling: false,
          contextWindow: null, maxOutputTokens: null, usage: true,
        },
        executionModes: ['request-response'],
      },
      execute: async () => ({
        output: 'ok', reasoningOutput: '', finishReason: 'stop',
        usage: {
          inputTokens: 1, outputTokens: 1, reasoningTokens: null,
          cacheReadTokens: null, cacheWriteTokens: null, totalTokens: 2,
        },
      }),
    }],
  })
  let rejectedGroqShadow = false
  try {
    llmClient.register({
      descriptor: {
        ...groqApi.createGroqLlmModule().descriptor,
        id: 'plugin.shadow.groq',
        source: { kind: 'plugin', namespace: 'com.example.shadow' },
      },
      execute: async () => ({ output: '', reasoningOutput: '', usage: null, finishReason: null }),
    })
  } catch (error) {
    rejectedGroqShadow = String(error).includes('com.example.shadow')
      && String(error).includes('@henjicc/ai-sdk')
  }
  if (!rejectedGroqShadow) fail('外部 LLM module 未拒绝遮蔽内置 Groq')
  const llmOutcome = await llmClient.execute('fixture.external.llm', {
    messages: [{ role: 'user', content: 'fixture' }],
  }, {
    mode: 'request-response',
    onEvent: (event) => { llmEvents.push(event.type) },
  })
  if (llmOutcome.output !== 'ok' || llmEvents.join(',') !== 'Usage,Finish,Done') {
    fail(`外部 LLM module 生命周期异常：${JSON.stringify(llmEvents)}`)
  }
  await llmClient.dispose()

  console.log(`✔ 受限宿主发布包门禁通过：${JSON.stringify({
    packageId,
    textEncoder: false,
    textDecoder: false,
    asr: { models: 5, bytes: asr.bytes, modules: asr.inputs.length },
    realtimeAsr: { models: 4, bytes: realtime.bytes, modules: realtime.inputs.length },
    volcengineAsr: { models: 1, bytes: volcengineAsr.bytes, modules: volcengineAsr.inputs.length },
    volcengineRealtimeAsr: { models: 1, bytes: volcengineRealtime.bytes, modules: volcengineRealtime.inputs.length },
    siliconFlowAsr: { models: 2, bytes: siliconFlowAsr.bytes, modules: siliconFlowAsr.inputs.length },
    groqAsr: { models: 2, bytes: groqAsr.bytes, modules: groqAsr.inputs.length },
    translation: { models: 3, bytes: translation.bytes, modules: translation.inputs.length },
    groq: { models: 1, bytes: groq.bytes, modules: groq.inputs.length },
    bigmodel: { models: 1, bytes: bigmodel.bytes, modules: bigmodel.inputs.length },
    llmModules: { models: 1, bytes: llmModules.bytes, modules: llmModules.inputs.length },
    networkCalls: 0,
  })}`)
}

verify()
  .finally(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

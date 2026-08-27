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
  return context
}

function evaluate(context, artifact, globalName) {
  new vm.Script(artifact.code, { filename: `${globalName}.iife.js` }).runInContext(context)
  return vm.runInContext(globalName, context)
}

function verify() {
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

  const context = restrictedContext()
  const asrApi = evaluate(context, asr, 'HenjiPackedBailianAsr')
  const realtimeApi = evaluate(context, realtime, 'HenjiPackedBailianRealtimeAsr')
  const translationApi = evaluate(context, translation, 'HenjiPackedBailianTranslation')
  const groqApi = evaluate(context, groq, 'HenjiPackedGroq')

  if (asrApi.bailianNonRealtimeAsrPresets.length !== 5) fail('非实时 ASR 不是 5 个')
  if (realtimeApi.bailianRealtimeAsrPresets.length !== 4) fail('实时 ASR 不是 4 个')
  if (Object.keys(translationApi.BAILIAN_QWEN_MT_PRESETS).length !== 3) fail('Qwen-MT 不是 3 个')
  if (!asrApi.bailianNonRealtimeAsrPresets.every((preset) => (
    preset.id === `bailian.speech-recognition.${preset.modelId}`
    && preset.descriptor.providerIds[0] === 'bailian'
  ))) fail('非实时 ASR 坐标不规范')
  if (!realtimeApi.bailianRealtimeAsrPresets.every((preset) => (
    preset.id === `bailian.speech-recognition.${preset.modelId}`
    && preset.descriptor.providerIds[0] === 'bailian'
  ))) fail('实时 ASR 坐标不规范')
  if (groqApi.GROQ_DEFAULT_MODEL_CONFIG.providerId !== 'groq'
    || groqApi.GROQ_DEFAULT_MODEL_CONFIG.modelId !== 'openai/gpt-oss-20b') {
    fail('Groq 默认模型坐标不匹配')
  }
  const groqRequest = groqApi.createGroqChatRequest({ messages: [] })
  if (groqRequest.providerId !== 'groq' || groqRequest.modelId !== 'openai/gpt-oss-20b') {
    fail('Groq 请求未使用规范默认坐标')
  }

  console.log(`✔ 受限宿主发布包门禁通过：${JSON.stringify({
    packageId,
    textEncoder: false,
    textDecoder: false,
    asr: { models: 5, bytes: asr.bytes, modules: asr.inputs.length },
    realtimeAsr: { models: 4, bytes: realtime.bytes, modules: realtime.inputs.length },
    translation: { models: 3, bytes: translation.bytes, modules: translation.inputs.length },
    groq: { models: 1, bytes: groq.bytes, modules: groq.inputs.length },
    networkCalls: 0,
  })}`)
}

try {
  verify()
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

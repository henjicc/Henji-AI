#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { buildSync } = require('esbuild')

const packageRoot = path.resolve(__dirname, '..')
const sourceRoot = path.join(packageRoot, 'src')
const catalogRoot = path.join(sourceRoot, 'catalog')
const packsRoot = path.join(sourceRoot, 'packs')
const toolModelRoot = path.join(packsRoot, 'tool-models', 'fal')

function fail(message) {
  console.error(`✘ modular bundle 门禁失败：${message}`)
  process.exit(1)
}

function walk(directory, predicate) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(absolute, predicate)
    return entry.isFile() && predicate(absolute) ? [absolute] : []
  })
}

function normalizeInputs(result) {
  return Object.keys(result.metafile.inputs).map((input) => input.replaceAll('\\', '/'))
}

function bundle(name, source, expected) {
  const results = {}
  for (const format of ['iife', 'esm']) {
    const result = buildSync({
      stdin: { contents: source, resolveDir: sourceRoot, sourcefile: `${name}.ts`, loader: 'ts' },
      bundle: true,
      format,
      globalName: format === 'iife' ? `Henji${name.replace(/[^A-Za-z0-9]/g, '')}` : undefined,
      platform: 'browser',
      target: 'es2020',
      treeShaking: false,
      minify: true,
      metafile: true,
      write: false,
      logLevel: 'silent',
    })
    const code = result.outputFiles?.[0]?.text
    if (!code) fail(`${name}/${format} 没有构建产物`)
    const inputs = normalizeInputs(result)
    expected(inputs, format)
    if (/\b(?:require\s*\(|eval\s*\(|new\s+Function\s*\()/.test(code) || /["']node:/.test(code)) {
      fail(`${name}/${format} 含 require/eval/new Function/node:`)
    }
    results[format] = { bytes: code.length, modules: inputs.length, code }
  }
  return results
}

const modelFiles = walk(catalogRoot, (file) => file.endsWith('.model.ts'))
const generatedModelPacks = walk(path.join(packsRoot, 'models'), (file) => file.endsWith('.ts'))
const providerDirectories = [...new Set(modelFiles.map((file) => path.relative(catalogRoot, file).split(path.sep)[0]))]
const generatedProviderAdapters = walk(path.join(packsRoot, 'provider-adapters'), (file) => file.endsWith('.ts'))
const generatedProviderPacks = walk(path.join(packsRoot, 'provider-packs'), (file) => file.endsWith('.ts'))
const toolModelPacks = walk(toolModelRoot, (file) => file.endsWith('.ts'))
if (modelFiles.length !== 99 || generatedModelPacks.length !== 99) {
  fail(`单模型导出不完整：catalog=${modelFiles.length}, packs=${generatedModelPacks.length}`)
}
if (generatedProviderAdapters.length !== providerDirectories.length || generatedProviderPacks.length !== providerDirectories.length) {
  fail(
    `供应商导出不完整：providers=${providerDirectories.length}, adapters=${generatedProviderAdapters.length}, ` +
    `packs=${generatedProviderPacks.length}`
  )
}
if (toolModelPacks.length !== 3) fail(`Fal erase 单工具导出不是3：${toolModelPacks.length}`)
for (const modelFile of modelFiles) {
  const relative = path.relative(catalogRoot, modelFile)
  const provider = relative.split(path.sep)[0]
  const stem = path.basename(modelFile).replace(/\.model\.ts$/, '')
  const generated = path.join(packsRoot, 'models', provider, `${stem}.ts`)
  if (!fs.existsSync(generated)) fail(`缺少单模型 pack：${provider}/${stem}`)
  const source = fs.readFileSync(generated, 'utf8')
  if (!source.includes(`catalog/${provider}/${stem}.model`) || !source.includes('preprocess')) {
    fail(`单模型 pack 未引用唯一 schema 或 provider-scoped preprocessor：${provider}/${stem}`)
  }
}
for (const provider of providerDirectories) {
  const adapter = path.join(packsRoot, 'provider-adapters', `${provider}.ts`)
  const pack = path.join(packsRoot, 'provider-packs', `${provider}.ts`)
  if (!fs.existsSync(adapter) || !fs.existsSync(pack)) fail(`缺少供应商导出：${provider}`)
  const adapterSource = fs.readFileSync(adapter, 'utf8')
  if (!adapterSource.includes(`providers/${provider}`) || !adapterSource.includes('preprocess')) {
    fail(`供应商 adapter 未包含执行与预处理：${provider}`)
  }
  const expectedModels = modelFiles.filter((file) => provider === path.relative(catalogRoot, file).split(path.sep)[0])
  const packSource = fs.readFileSync(pack, 'utf8')
  for (const modelFile of expectedModels) {
    const stem = path.basename(modelFile).replace(/\.model\.ts$/, '')
    if (!packSource.includes(`catalog/${provider}/${stem}.model`)) {
      fail(`供应商 pack 漏模型：${provider}/${stem}`)
    }
  }
}

const builtinsPattern = /\/src\/(?:catalog\/[^/]+\/[^/]+\.model\.ts|providers\/(?:apimart|bailian|fal|grsai|kie|modelscope|ppio|volcengine)\.ts)$/
const modelPattern = /\/src\/catalog\/([^/]+)\/[^/]+\.model\.ts$/
const providerPattern = /\/src\/providers\/(apimart|bailian|fal|grsai|kie|modelscope|ppio|volcengine)\.ts$/
const toolModelPattern = /\/src\/tool-packs\/fal-erase\/models\/[^/]+\.model\.ts$/

const bare = bundle('GenerationCore', [
  "import { createModularGenerationClient } from './generation/core'",
  'export { createModularGenerationClient }',
].join('\n'), (inputs) => {
  const forbidden = inputs.filter((input) => builtinsPattern.test(`/${input}`))
  if (forbidden.length > 0) fail(`bare 静态带入内置模型/provider：${forbidden.join(', ')}`)
})

const single = bundle('KieZImage', [
  "import { createModularGenerationClient } from './generation/core'",
  "import { pack } from './packs/models/kie/z-image'",
  'export { createModularGenerationClient, pack }',
].join('\n'), (inputs) => {
  const models = inputs.filter((input) => modelPattern.test(`/${input}`))
  const providers = inputs.filter((input) => providerPattern.test(`/${input}`))
  if (models.length !== 1 || !models[0].endsWith('/catalog/kie/z-image.model.ts')) {
    fail(`单模型图不是唯一 KIE Z-Image：${models.join(', ')}`)
  }
  if (providers.length !== 1 || !providers[0].endsWith('/providers/kie.ts')) {
    fail(`单模型图含其他 provider：${providers.join(', ')}`)
  }
})

const kiePack = bundle('KieProviderPack', [
  "import { createModularGenerationClient } from './generation/core'",
  "import { pack } from './packs/provider-packs/kie'",
  'export { createModularGenerationClient, pack }',
].join('\n'), (inputs) => {
  const models = inputs.filter((input) => modelPattern.test(`/${input}`))
  const providers = inputs.filter((input) => providerPattern.test(`/${input}`))
  if (models.length !== 27 || models.some((input) => !input.includes('/catalog/kie/'))) {
    fail(`KIE provider pack 模型图异常：count=${models.length}`)
  }
  if (providers.length !== 1 || !providers[0].endsWith('/providers/kie.ts')) {
    fail(`KIE provider pack 含其他 provider：${providers.join(', ')}`)
  }
})

const singleErase = bundle('FalFluxErase', [
  "import { createModularGenerationClient } from './generation/core'",
  "import { pack } from './packs/tool-models/fal/flux-pro-erase'",
  'export { createModularGenerationClient, pack }',
].join('\n'), (inputs) => {
  const ordinaryModels = inputs.filter((input) => modelPattern.test(`/${input}`))
  const tools = inputs.filter((input) => toolModelPattern.test(`/${input}`))
  const providers = inputs.filter((input) => providerPattern.test(`/${input}`))
  if (ordinaryModels.length !== 0 || tools.length !== 1 || !tools[0].endsWith('/flux-pro-erase.model.ts')) {
    fail(`单Fal消除工具静态图异常：ordinary=${ordinaryModels.length}, tools=${tools.join(', ')}`)
  }
  if (providers.length !== 1 || !providers[0].endsWith('/providers/fal.ts')) {
    fail(`单Fal消除工具含其他provider：${providers.join(', ')}`)
  }
})

const falErasePack = bundle('FalEraseToolPack', [
  "import { createModularGenerationClient } from './generation/core'",
  "import { pack } from './packs/tool-packs/fal-image-edit-tools'",
  'export { createModularGenerationClient, pack }',
].join('\n'), (inputs) => {
  const ordinaryModels = inputs.filter((input) => modelPattern.test(`/${input}`))
  const tools = inputs.filter((input) => toolModelPattern.test(`/${input}`))
  const providers = inputs.filter((input) => providerPattern.test(`/${input}`))
  if (ordinaryModels.length !== 0 || tools.length !== 3) {
    fail(`Fal erase tool pack静态图异常：ordinary=${ordinaryModels.length}, tools=${tools.length}`)
  }
  if (providers.length !== 1 || !providers[0].endsWith('/providers/fal.ts')) {
    fail(`Fal erase tool pack含其他provider：${providers.join(', ')}`)
  }
})

const defaultGeneration = bundle('DefaultGeneration', [
  "export * from './generation'",
].join('\n'), (inputs) => {
  const models = inputs.filter((input) => modelPattern.test(`/${input}`))
  const tools = inputs.filter((input) => toolModelPattern.test(`/${input}`))
  if (models.length !== 99 || tools.length !== 0) {
    fail(`默认generation目录不再严格99或误入工具：models=${models.length}, tools=${tools.length}`)
  }
})

const llm = bundle('LlmOnly', [
  "export * from './llm/index'",
].join('\n'), (inputs) => {
  const forbidden = inputs.filter((input) => (
    modelPattern.test(`/${input}`) ||
    toolModelPattern.test(`/${input}`) ||
    providerPattern.test(`/${input}`) ||
    input.includes('/src/generation')
  ))
  if (forbidden.length > 0) fail(`LLM-only 图带入 generation/catalog/provider：${forbidden.join(', ')}`)
})

const capabilityCommon = bundle('CapabilityCommon', [
  "export * from './capabilities/index'",
].join('\n'), (inputs) => {
  const forbidden = inputs.filter((input) => (
    modelPattern.test(`/${input}`) ||
    providerPattern.test(`/${input}`) ||
    input.includes('/src/generation') ||
    input.includes('/src/llm/')
  ))
  if (forbidden.length > 0) fail(`capabilities 公共入口带入模型执行内核：${forbidden.join(', ')}`)
})

const speechCapability = bundle('SpeechRecognitionCapability', [
  "export * from './capabilities/speech-recognition/index'",
].join('\n'), (inputs) => {
  const forbidden = inputs.filter((input) => (
    input.includes('/capabilities/speech-recognition/bailian/') ||
    input.includes('/capabilities/translation/') ||
    modelPattern.test(`/${input}`) ||
    providerPattern.test(`/${input}`) ||
    input.includes('/src/generation') ||
    input.includes('/src/llm/')
  ))
  if (forbidden.length > 0) fail(`ASR 按需入口带入无关能力/模型：${forbidden.join(', ')}`)
})

const bailianAsrCapability = bundle('BailianAsrCapability', [
  "export * from './capabilities/speech-recognition/bailian/index'",
].join('\n'), (inputs) => {
  const forbidden = inputs.filter((input) => (
    input.includes('/capabilities/speech-recognition/bailian/realtime/') ||
    input.includes('/capabilities/translation/') ||
    modelPattern.test(`/${input}`) ||
    providerPattern.test(`/${input}`) ||
    input.includes('/src/generation') ||
    input.includes('/src/llm/')
  ))
  if (forbidden.length > 0) fail(`百炼 ASR 按需入口带入无关能力/模型：${forbidden.join(', ')}`)
  if (!inputs.some((input) => input.includes('/capabilities/speech-recognition/bailian/module.ts'))) {
    fail('百炼 ASR 按需入口未包含执行模块')
  }
})

const bailianRealtimeAsrCapability = bundle('BailianRealtimeAsrCapability', [
  "export * from './capabilities/speech-recognition/bailian/realtime/index'",
].join('\n'), (inputs) => {
  const forbidden = inputs.filter((input) => (
    input.includes('/capabilities/translation/') ||
    modelPattern.test(`/${input}`) ||
    providerPattern.test(`/${input}`) ||
    input.includes('/src/generation') ||
    input.includes('/src/llm/')
  ))
  if (forbidden.length > 0) fail(`百炼实时 ASR 按需入口带入无关能力/模型：${forbidden.join(', ')}`)
  if (!inputs.some((input) => input.includes('/capabilities/speech-recognition/bailian/realtime/module.ts'))) {
    fail('百炼实时 ASR 按需入口未包含执行模块')
  }
})

const translationCapability = bundle('TranslationCapability', [
  "export * from './capabilities/translation/index'",
].join('\n'), (inputs) => {
  const forbidden = inputs.filter((input) => (
    input.includes('/capabilities/speech-recognition/') ||
    input.includes('/capabilities/translation/bailian/') ||
    modelPattern.test(`/${input}`) ||
    providerPattern.test(`/${input}`) ||
    input.includes('/src/generation') ||
    input.includes('/src/llm/')
  ))
  if (forbidden.length > 0) fail(`翻译按需入口带入无关能力/模型：${forbidden.join(', ')}`)
})

const bailianTranslationCapability = bundle('BailianTranslationCapability', [
  "export * from './capabilities/translation/bailian/index'",
].join('\n'), (inputs) => {
  const forbidden = inputs.filter((input) => (
    input.includes('/capabilities/speech-recognition/') ||
    modelPattern.test(`/${input}`) ||
    providerPattern.test(`/${input}`) ||
    input.includes('/src/generation') ||
    input.includes('/src/llm/')
  ))
  if (forbidden.length > 0) fail(`百炼翻译按需入口带入无关能力/模型：${forbidden.join(', ')}`)
  if (!inputs.some((input) => input.includes('/capabilities/translation/bailian/module.ts'))) {
    fail('百炼翻译按需入口未包含执行模块')
  }
})

const groqLlm = bundle('GroqLlm', [
  "export * from './llm/groq/index'",
].join('\n'), (inputs) => {
  const forbidden = inputs.filter((input) => (
    input.includes('/src/capabilities/') ||
    modelPattern.test(`/${input}`) ||
    providerPattern.test(`/${input}`) ||
    input.includes('/src/generation')
  ))
  if (forbidden.length > 0) fail(`Groq 按需入口带入 ASR/翻译/generation/provider：${forbidden.join(', ')}`)
  if (!inputs.some((input) => input.includes('/src/llm/groq/preset.ts'))) {
    fail('Groq 按需入口未包含 Groq preset')
  }
})

let networkCalls = 0
const context = vm.createContext({
  AbortController,
  clearTimeout,
  console,
  Date,
  Promise,
  Response,
  setTimeout,
  URL,
  Uint8Array,
})
new vm.Script(bare.iife.code, { filename: 'generation-core.iife.js' }).runInContext(context)
const bareApi = vm.runInContext('HenjiGenerationCore', context)
const client = bareApi.createModularGenerationClient({
  runtime: {
    transport: { fetch: async () => { networkCalls += 1; throw new Error('network forbidden') } },
    credentials: { get: async () => undefined },
    media: { read: async () => { throw new Error('media forbidden') } },
  },
})
if (client.catalog.list().length !== 0) fail('bare client 不是 0 模型')
client.dispose()
for (const [name, artifact, globalName] of [
  ['single erase', singleErase, 'HenjiFalFluxErase'],
  ['Fal erase tool pack', falErasePack, 'HenjiFalEraseToolPack'],
]) {
  new vm.Script(artifact.iife.code, { filename: `${name}.iife.js` }).runInContext(context)
  const api = vm.runInContext(globalName, context)
  const modular = api.createModularGenerationClient({
    runtime: {
      transport: { fetch: async () => { networkCalls += 1; throw new Error('network forbidden') } },
      credentials: { get: async () => undefined },
      media: { read: async () => { throw new Error('media forbidden') } },
    },
    packs: [api.pack],
  })
  if (modular.catalog.list().length !== (name === 'single erase' ? 1 : 3)) fail(`${name}目录数量异常`)
  modular.dispose()
}
if (networkCalls !== 0) fail(`bare lifecycle 触发 ${networkCalls} 次网络`)

const metrics = {
  bare: { iife: bare.iife.bytes, esm: bare.esm.bytes, modules: bare.iife.modules },
  singleKieZImage: { iife: single.iife.bytes, esm: single.esm.bytes, modules: single.iife.modules },
  kieProviderPack: { iife: kiePack.iife.bytes, esm: kiePack.esm.bytes, modules: kiePack.iife.modules },
  singleFalErase: { iife: singleErase.iife.bytes, esm: singleErase.esm.bytes, modules: singleErase.iife.modules },
  falEraseToolPack: { iife: falErasePack.iife.bytes, esm: falErasePack.esm.bytes, modules: falErasePack.iife.modules },
  defaultGeneration: { iife: defaultGeneration.iife.bytes, esm: defaultGeneration.esm.bytes, modules: defaultGeneration.iife.modules },
  llmOnly: { iife: llm.iife.bytes, esm: llm.esm.bytes, modules: llm.iife.modules },
  capabilityCommon: { iife: capabilityCommon.iife.bytes, esm: capabilityCommon.esm.bytes, modules: capabilityCommon.iife.modules },
  speechRecognitionCapability: { iife: speechCapability.iife.bytes, esm: speechCapability.esm.bytes, modules: speechCapability.iife.modules },
  bailianAsrCapability: { iife: bailianAsrCapability.iife.bytes, esm: bailianAsrCapability.esm.bytes, modules: bailianAsrCapability.iife.modules },
  bailianRealtimeAsrCapability: { iife: bailianRealtimeAsrCapability.iife.bytes, esm: bailianRealtimeAsrCapability.esm.bytes, modules: bailianRealtimeAsrCapability.iife.modules },
  translationCapability: { iife: translationCapability.iife.bytes, esm: translationCapability.esm.bytes, modules: translationCapability.iife.modules },
  bailianTranslationCapability: { iife: bailianTranslationCapability.iife.bytes, esm: bailianTranslationCapability.esm.bytes, modules: bailianTranslationCapability.iife.modules },
  groqLlm: { iife: groqLlm.iife.bytes, esm: groqLlm.esm.bytes, modules: groqLlm.iife.modules },
  networkCalls,
}
console.log(`✔ modular bundle 门禁通过：${JSON.stringify(metrics)}`)

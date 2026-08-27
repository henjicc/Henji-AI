#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { buildSync } = require('esbuild')

const packageRoot = path.resolve(__dirname, '..')
const sourceRoot = path.join(packageRoot, 'src')
const catalogRoot = path.join(sourceRoot, 'catalog')
const packsRoot = path.join(sourceRoot, 'packs')

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
if (modelFiles.length !== 99 || generatedModelPacks.length !== 99) {
  fail(`单模型导出不完整：catalog=${modelFiles.length}, packs=${generatedModelPacks.length}`)
}
if (generatedProviderAdapters.length !== providerDirectories.length || generatedProviderPacks.length !== providerDirectories.length) {
  fail(
    `供应商导出不完整：providers=${providerDirectories.length}, adapters=${generatedProviderAdapters.length}, ` +
    `packs=${generatedProviderPacks.length}`
  )
}
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

const llm = bundle('LlmOnly', [
  "export * from './llm/index'",
].join('\n'), (inputs) => {
  const forbidden = inputs.filter((input) => (
    modelPattern.test(`/${input}`) ||
    providerPattern.test(`/${input}`) ||
    input.includes('/src/generation')
  ))
  if (forbidden.length > 0) fail(`LLM-only 图带入 generation/catalog/provider：${forbidden.join(', ')}`)
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
if (networkCalls !== 0) fail(`bare lifecycle 触发 ${networkCalls} 次网络`)

const metrics = {
  bare: { iife: bare.iife.bytes, esm: bare.esm.bytes, modules: bare.iife.modules },
  singleKieZImage: { iife: single.iife.bytes, esm: single.esm.bytes, modules: single.iife.modules },
  kieProviderPack: { iife: kiePack.iife.bytes, esm: kiePack.esm.bytes, modules: kiePack.iife.modules },
  llmOnly: { iife: llm.iife.bytes, esm: llm.esm.bytes, modules: llm.iife.modules },
  networkCalls,
}
console.log(`✔ modular bundle 门禁通过：${JSON.stringify(metrics)}`)

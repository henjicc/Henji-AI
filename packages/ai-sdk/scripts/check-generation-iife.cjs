#!/usr/bin/env node

const path = require('path')
const fs = require('fs')
const vm = require('vm')
const { buildSync } = require('esbuild')

const packageRoot = path.resolve(__dirname, '..')
const entry = path.join(packageRoot, 'src', 'generation.ts')
const catalogRoot = path.join(packageRoot, 'src', 'catalog')

// 期望数量从 catalog 源码派生：默认 generation 目录必须装入全部 *.model.ts，增删模型无需改门禁。
function countModelFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, item) => {
    const absolute = path.join(directory, item.name)
    if (item.isDirectory()) return total + countModelFiles(absolute)
    return total + (item.isFile() && item.name.endsWith('.model.ts') ? 1 : 0)
  }, 0)
}
const expectedModelCount = countModelFiles(catalogRoot)

function fail(message) {
  console.error(`✘ generation IIFE 门禁失败：${message}`)
  process.exit(1)
}

const result = buildSync({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  globalName: 'HenjiGeneration',
  platform: 'browser',
  target: 'es2020',
  // 关闭摇树后仍必须干净，避免 barrel 的“当前未使用导出”掩盖真实静态依赖图。
  treeShaking: false,
  minify: true,
  metafile: true,
  write: false,
  logLevel: 'silent',
})

const code = result.outputFiles?.[0]?.text
if (!code) fail('esbuild 没有生成 IIFE')

const forbiddenInputs = Object.keys(result.metafile.inputs).filter((input) => (
  /(?:^|\/)src\/llm\//.test(input) ||
  /(?:^|\/)node_modules\/(?:ai|@ai-sdk\/[^/]+)\//.test(input) ||
  /(?:^|\/)node_modules\/@fal-ai\/client\//.test(input) ||
  /(?:^|\/)node_modules\/(?:fs|path|stream|buffer)\//.test(input)
))
if (forbiddenInputs.length > 0) {
  fail(`静态依赖图含禁止模块：${forbiddenInputs.join(', ')}`)
}

const forbiddenSyntax = [
  ['static import', /\bimport\s+["'{*]/],
  ['dynamic import', /\bimport\s*\(/],
  ['require', /\brequire\s*\(/],
  ['node:', /["']node:/],
  ['eval', /\beval\s*\(/],
  ['new Function', /\bnew\s+Function\s*\(/],
  ['Buffer', /\bBuffer\b/],
  ['process', /\bprocess\b/],
  ['global fetch', /(?<![.\w])fetch\s*\(/],
  ['ReadableStream', /\bReadableStream\b/],
  ['TransformStream', /\bTransformStream\b/],
  ['WritableStream', /\bWritableStream\b/],
  ['File', /\bFile\b/],
  ['btoa', /\bbtoa\b/],
  ['atob', /\batob\b/],
]
const violations = forbiddenSyntax.filter(([, pattern]) => pattern.test(code)).map(([label]) => label)
if (violations.length > 0) fail(`IIFE 含禁止语法/全局：${violations.join(', ')}`)

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
new vm.Script(code, { filename: 'generation.iife.js' }).runInContext(context)
const api = vm.runInContext('HenjiGeneration', context)
if (typeof api.createGenerationClient !== 'function') fail('IIFE 未导出 createGenerationClient')

const client = api.createGenerationClient({
  runtime: {
    transport: {
      fetch: async () => {
        networkCalls += 1
        throw new Error('generation lifecycle gate forbids network')
      },
    },
    credentials: { get: async () => undefined },
    media: { read: async () => { throw new Error('generation lifecycle gate forbids media reads') } },
  },
})
const modelCount = client.catalog.list().length
if (expectedModelCount === 0) fail('catalog 源码中没有找到 *.model.ts')
if (modelCount !== expectedModelCount) fail(`catalog 数量与源码不一致：期望 ${expectedModelCount}，实际 ${modelCount}`)
client.dispose()
if (networkCalls !== 0) fail(`import/create/catalog/dispose 触发 ${networkCalls} 次网络请求`)

console.log(
  `✔ generation IIFE 门禁通过（${code.length} bytes，${Object.keys(result.metafile.inputs).length} modules，` +
  `${modelCount} models，networkCalls=0，风险计数=0）`
)

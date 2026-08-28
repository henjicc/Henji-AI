import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const result = await build({
  entryPoints: ['index.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  treeShaking: false,
  metafile: true,
  write: false,
  logLevel: 'silent',
})

const inputs = Object.keys(result.metafile.inputs).map((input) => input.replaceAll('\\', '/'))
const forbidden = inputs.filter((input) => (
  input.includes('/@henjicc/ai-sdk/dist/generation')
  || input.includes('/@henjicc/ai-sdk/dist/catalog/')
  || input.endsWith('/@henjicc/ai-sdk/dist/client.js')
  || input.endsWith('/@henjicc/ai-sdk/dist/index.js')
  || input.includes('/@henjicc/ai-sdk/dist/capabilities/')
  || input.includes('/@henjicc/ai-sdk/dist/llm/groq/')
  || input.includes('/@henjicc/ai-sdk/dist/llm/modules/')
  || /\/@henjicc\/ai-sdk\/dist\/llm\/bigmodel\/(?:index|models|preset|pricing)\.js$/.test(input)
))

if (forbidden.length > 0) {
  throw new Error(`llm/streaming bundle 带入无关模块：${forbidden.join(', ')}`)
}
if (!inputs.some((input) => input.endsWith('/@henjicc/ai-sdk/dist/llm/streaming/index.js'))) {
  throw new Error('bundle 未消费发布包的 llm/streaming 公开入口')
}

console.log(JSON.stringify({
  entry: '@henjicc/ai-sdk/llm/streaming',
  modules: inputs.length,
  bytes: result.outputFiles.reduce((sum, file) => sum + file.contents.byteLength, 0),
  forbiddenModules: 0,
}))

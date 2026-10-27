#!/usr/bin/env node
/**
 * 渲染层主包与 Worker 子构建的产物文件名必须互不相交。
 *
 * Vite 把每个 Worker 单独打包，产物在主包生成阶段按固定文件名并入同一 out/renderer/assets 目录。
 * 两边命名规则相同时，同一模块（例如只导出数据、内容完全一致的 glTransitionShaders.generated）得到同一个
 * `[name]-[hash].js`，并入时覆盖主包的同名 chunk，主包随后在 vite:build-import-analysis 读不到被覆盖 chunk 的依赖，
 * 报 `Cannot read properties of undefined (reading 'forEach')`（2026-10-27，提交 9dd7eb1d0 引入第一个这样的模块）。
 *
 * 推送 CI 不跑完整渲染层构建，这里只校验 electron.vite.config.ts 里的命名约定，秒级完成：
 * - 主包每条规则以 `[hash]` 紧跟唯一扩展名（`.js` 或 `[extname]`）结尾；
 * - Worker 每条规则以 `[hash].worker` 再接扩展名结尾。
 * 哈希不含点号，所以主包文件名里“哈希后到结尾”只有一个扩展名，Worker 文件名在那里一定还多一个 `.worker`，
 * 任何模块名、任何哈希都不可能让两边同名。真实构建另由 rollup 的 FILE_NAME_CONFLICT 警告升级为失败兜底。
 */
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const KINDS = ['entryFileNames', 'chunkFileNames', 'assetFileNames']
const MAIN_TAIL = /\[hash(?::\d+)?\](?:\.js|\[extname\])$/
const WORKER_TAIL = /\[hash(?::\d+)?\]\.worker(?:\.js|\[extname\])$/

/** 单个 rollup output 配置的三条命名规则；缺失或写成函数都视为无法静态证明。 */
function namePatterns(output, label, problems) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    problems.push(`${label} 必须是单个 output 对象并显式写出 ${KINDS.join('、')}`)
    return {}
  }
  const patterns = {}
  for (const kind of KINDS) {
    const value = output[kind]
    if (typeof value !== 'string') problems.push(`${label}.${kind} 必须是字符串命名规则（当前为 ${value === undefined ? '未设置' : typeof value}）`)
    else patterns[kind] = value
  }
  return patterns
}

/** 返回违反约定的说明；空数组表示两边命名结构上不相交。 */
function checkRendererOutputNames(renderer) {
  const problems = []
  const main = namePatterns(renderer?.build?.rollupOptions?.output, 'renderer.build.rollupOptions.output', problems)
  const worker = namePatterns(renderer?.worker?.rollupOptions?.output, 'renderer.worker.rollupOptions.output', problems)
  for (const [kind, pattern] of Object.entries(main)) {
    if (!MAIN_TAIL.test(pattern)) problems.push(`主包 ${kind}「${pattern}」必须以 [hash] 紧跟 .js 或 [extname] 结尾`)
  }
  for (const [kind, pattern] of Object.entries(worker)) {
    if (!WORKER_TAIL.test(pattern)) problems.push(`Worker ${kind}「${pattern}」必须以 [hash].worker 再接 .js 或 [extname] 结尾`)
  }
  return problems
}

async function loadRendererConfig() {
  const { loadConfigFromFile } = await import('electron-vite')
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(repoRoot, 'electron.vite.config.ts'), repoRoot, 'silent')
  const renderer = loaded.config.renderer
  return typeof renderer === 'function' ? renderer({ command: 'build', mode: 'production' }) : renderer
}

async function main() {
  const problems = checkRendererOutputNames(await loadRendererConfig())
  if (problems.length) {
    console.error('✖ 渲染层主包与 Worker 产物命名可能相撞：')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
    return
  }
  console.log('✔ 渲染层主包与 Worker 产物命名互不相交')
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[check:renderer-output-names] ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    process.exitCode = 1
  })
}

module.exports = { checkRendererOutputNames }

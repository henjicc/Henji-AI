#!/usr/bin/env node
/**
 * 主进程 / preload 只能引用「传递依赖里没有 `@/` 别名」的 src 模块。
 *
 * `@` → `src` 的别名只配在 electron.vite.config.ts 的 renderer 块里，main 与 preload 块没有。
 * 于是主进程一旦引到某个 src 模块，而它的依赖链上任何一层写了 `@/xxx`，Rollup 就会在
 * `npm run electron:dev` / `electron:build` 阶段报 "Failed to resolve import"。
 *
 * 关键在于：`tsc`（两个工程都配了 paths）和 `vitest`（走 vite 的 alias）**全都能通过**。
 * 这类问题此前只有跑完整 electron-vite build 才暴露，而那一步慢、容易被跳过。
 * 本脚本做同一件事的静态版本，秒级完成，可以挂进日常检查。
 */
const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const mainRoots = ['electron/main', 'electron/preload']
const srcRoot = path.join(repoRoot, 'src')

/*
 * 一条正则覆盖四种写法：`from 'x'`、`import 'x'`、`import('x')`、`require('x')`。
 *
 * 不要退回「从 import 关键字开始一路匹配到 from」的写法：那样必须限制中间不能跨行，
 * 于是 `import type {\n  A,\n  B,\n} from './types'` 这种最常见的多行导入会被整条漏掉，
 * 检查器自己变成"看起来在跑、其实什么都没查"。
 */
const SPECIFIER_PATTERN = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"]([^'"\n]+)['"]/g
const COMMENT_PATTERN = /\/\*[\s\S]*?\*\/|(?<![:'"`\\])\/\/[^\n]*/g

function listFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      listFiles(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function readSpecifiers(file) {
  const source = fs.readFileSync(file, 'utf8').replace(COMMENT_PATTERN, '')
  const specifiers = []
  SPECIFIER_PATTERN.lastIndex = 0
  let match
  while ((match = SPECIFIER_PATTERN.exec(source)) !== null) specifiers.push(match[1])
  return specifiers
}

/** 把一个 import 说明符解析成磁盘上的实际文件；解析不到（三方包、样式等）返回 null。 */
function resolveSpecifier(fromFile, specifier) {
  if (specifier.startsWith('@/')) {
    return { aliased: true, file: null }
  }
  if (!specifier.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return { aliased: false, file: candidate }
    }
  }
  return null
}

function relative(file) {
  return path.relative(repoRoot, file).replace(/\\/g, '/')
}

/** 从主进程入口出发，沿 src 内部依赖做广度优先遍历，返回第一条通向 `@/` 的路径。 */
function findAliasPath(entryFile, cache) {
  const queue = [[entryFile]]
  const seen = new Set([entryFile])
  while (queue.length > 0) {
    const chain = queue.shift()
    const current = chain[chain.length - 1]
    let edges = cache.get(current)
    if (!edges) {
      edges = readSpecifiers(current).map((specifier) => ({
        specifier,
        resolved: resolveSpecifier(current, specifier),
      }))
      cache.set(current, edges)
    }
    for (const edge of edges) {
      if (!edge.resolved) continue
      if (edge.resolved.aliased) return [...chain, `${edge.specifier}  ← 别名导入`]
      const next = edge.resolved.file
      if (!next.startsWith(srcRoot) || seen.has(next)) continue
      seen.add(next)
      queue.push([...chain, next])
    }
  }
  return null
}

const violations = []
const cache = new Map()
const mainFiles = mainRoots.flatMap((root) => listFiles(path.join(repoRoot, root)))

for (const file of mainFiles) {
  for (const specifier of readSpecifiers(file)) {
    if (specifier.startsWith('@/')) {
      violations.push({
        file,
        specifier,
        chain: [`${specifier}  ← 主进程直接使用了别名导入`],
      })
      continue
    }
    const resolved = resolveSpecifier(file, specifier)
    if (!resolved || resolved.aliased || !resolved.file) continue
    if (!resolved.file.startsWith(srcRoot)) continue
    const chain = findAliasPath(resolved.file, cache)
    if (chain) violations.push({ file, specifier, chain })
  }
}

if (violations.length === 0) {
  console.log(`✔ 主进程 import 边界检查通过（扫描 ${mainFiles.length} 个 main/preload 文件）`)
  process.exit(0)
}

console.error(`✘ 主进程 import 边界检查失败：${violations.length} 处\n`)
for (const violation of violations) {
  console.error(`  ${relative(violation.file)}`)
  console.error(`    import '${violation.specifier}'`)
  console.error('    依赖链：')
  for (const [index, step] of violation.chain.entries()) {
    const label = step.includes('←') ? step : relative(step)
    console.error(`      ${'  '.repeat(index)}└ ${label}`)
  }
  console.error('')
}
console.error('`@/` 别名只配在 electron.vite.config.ts 的 renderer 块，main/preload 解析不了。')
console.error('把主进程需要的常量/类型移进依赖链为零的模块，再由渲染层反向引用。')
process.exit(1)

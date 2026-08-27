#!/usr/bin/env node
/**
 * packages/ai-sdk 是要给非 Electron 运行时（Tauri、Photoshop UXP）复用的独立源码包，
 * 任务 1.1 的运行时验证已经确认：UXP 没有 `node:vm`、默认 CSP 禁用 `eval`/`new Function`、
 * 也没有运行时 Node 模块解析器（见 docs/task/模型SDK抽离/重要记录.md 记录 002、010）。
 *
 * 本脚本静态扫描 `packages/ai-sdk/src/**\/*.ts`，从骨架阶段起就挡住会让包在这些运行时里
 * 跑不起来的写法：
 *   - `@/` 别名（本仓库特有，脱离本仓库无意义）
 *   - `node:` 内置模块（UXP 没有 Node 运行时）
 *   - `from 'electron'`（UXP、Tauri 都没有 Electron API）
 *   - `import.meta.glob`（Vite 特有的构建时文件系统扫描）
 *   - `new Function(...)` / `eval(...)` / `from 'vm'`（UXP 禁用动态代码生成）
 *
 * 写法参照 scripts/check-main-imports.cjs 的 SPECIFIER_PATTERN：一条正则覆盖
 * `from 'x'` / `import 'x'` / `import('x')` / `require('x')` 四种写法，且不要求中间不跨行，
 * 否则 `import type {\n  A,\n} from 'node:xxx'` 这类多行 import 会被漏检。
 */
const fs = require('fs')
const path = require('path')
const { builtinModules } = require('module')

const repoRoot = path.resolve(__dirname, '..')
const sdkSrcRoot = path.join(repoRoot, 'packages', 'ai-sdk', 'src')

const SPECIFIER_PATTERN = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"]([^'"\n]+)['"]/g
const COMMENT_PATTERN = /\/\*[\s\S]*?\*\/|(?<![:'"`\\])\/\/[^\n]*/g
const DYNAMIC_EVAL_PATTERN = /\bnew\s+Function\s*\(|\beval\s*\(/g
const NODE_GLOBAL_PATTERN = /\b(?:Buffer|process|__dirname|__filename)\b/g
const NODE_BUILTINS = new Set(builtinModules.flatMap((specifier) => {
  const bare = specifier.replace(/^node:/, '')
  return [bare, `node:${bare}`]
}))

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

function relative(file) {
  return path.relative(repoRoot, file).replace(/\\/g, '/')
}

/** @returns {{ line: number, kind: string, detail: string }[]} */
function checkSource(raw) {
  const source = raw.replace(COMMENT_PATTERN, (match) => match.replace(/[^\n]/g, ' '))
  const violations = []

  SPECIFIER_PATTERN.lastIndex = 0
  let match
  while ((match = SPECIFIER_PATTERN.exec(source)) !== null) {
    const specifier = match[1]
    const line = source.slice(0, match.index).split('\n').length
    if (specifier.startsWith('@/')) {
      violations.push({ line, kind: '`@/` 别名', detail: specifier })
    } else if (specifier === 'node:' || specifier.startsWith('node:') || NODE_BUILTINS.has(specifier)) {
      violations.push({ line, kind: 'Node 内置模块', detail: specifier })
    } else if (specifier === 'electron') {
      violations.push({ line, kind: "`from 'electron'`", detail: specifier })
    } else if (specifier === 'vm') {
      violations.push({ line, kind: "`from 'vm'`", detail: specifier })
    }
  }

  if (source.includes('import.meta.glob')) {
    const idx = source.indexOf('import.meta.glob')
    const line = source.slice(0, idx).split('\n').length
    violations.push({ line, kind: '`import.meta.glob`', detail: 'import.meta.glob' })
  }

  DYNAMIC_EVAL_PATTERN.lastIndex = 0
  while ((match = DYNAMIC_EVAL_PATTERN.exec(source)) !== null) {
    const line = source.slice(0, match.index).split('\n').length
    violations.push({ line, kind: '动态代码生成', detail: match[0].trim() })
  }

  NODE_GLOBAL_PATTERN.lastIndex = 0
  while ((match = NODE_GLOBAL_PATTERN.exec(source)) !== null) {
    const line = source.slice(0, match.index).split('\n').length
    violations.push({ line, kind: 'Node 专属全局量', detail: match[0] })
  }

  return violations
}

function checkFile(file) {
  return checkSource(fs.readFileSync(file, 'utf8'))
}

const selfTestCases = [
  "import { readFile } from 'node:fs/promises'",
  "import { readFile } from 'fs/promises'",
  "const payload = Buffer.from('unsafe')",
  "const mode = process.env.NODE_ENV",
]
for (const source of selfTestCases) {
  if (checkSource(source).length === 0) {
    console.error(`✘ 可移植性检查自检失败，未拦截：${source}`)
    process.exit(1)
  }
}

const files = listFiles(sdkSrcRoot)

if (files.length === 0) {
  console.error(`✘ 可移植性检查未扫描到任何文件：${relative(sdkSrcRoot)} 不存在或为空`)
  process.exit(1)
}

const allViolations = []
for (const file of files) {
  for (const violation of checkFile(file)) {
    allViolations.push({ file, ...violation })
  }
}

if (allViolations.length === 0) {
  console.log(`✔ SDK 可移植性检查通过（扫描 ${files.length} 个 packages/ai-sdk/src 文件）`)
  process.exit(0)
}

console.error(`✘ SDK 可移植性检查失败：${allViolations.length} 处\n`)
for (const violation of allViolations) {
  console.error(`  ${relative(violation.file)}:${violation.line}`)
  console.error(`    ${violation.kind}: ${violation.detail}`)
}
console.error('')
console.error('packages/ai-sdk 要能在 UXP / Tauri 等无 Node 运行时下被静态打包使用，')
console.error('不能出现 `@/` 别名、Node 内置模块/全局量、`electron` 导入或动态代码生成写法。')
console.error('详见 packages/ai-sdk/README.md「可移植性约束」一节。')
process.exit(1)

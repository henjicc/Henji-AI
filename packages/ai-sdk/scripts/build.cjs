#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const packageRoot = path.resolve(__dirname, '..')
const distRoot = path.join(packageRoot, 'dist')

fs.rmSync(distRoot, { recursive: true, force: true })

const tscBin = require.resolve('typescript/bin/tsc')
const result = spawnSync(process.execPath, [tscBin, '-p', 'tsconfig.build.json'], {
  cwd: packageRoot,
  stdio: 'inherit',
})
if (result.status !== 0) process.exit(result.status ?? 1)

function listModuleFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) listModuleFiles(absolute, output)
    else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts'))) output.push(absolute)
  }
  return output
}

function emittedSpecifier(importer, specifier) {
  if (!specifier.startsWith('.')) return specifier
  const base = path.resolve(path.dirname(importer), specifier)
  if (fs.existsSync(`${base}.js`)) return `${specifier}.js`
  if (fs.existsSync(path.join(base, 'index.js'))) return `${specifier.replace(/\/$/, '')}/index.js`
  throw new Error(`构建产物缺少相对导入目标：${path.relative(packageRoot, importer)} -> ${specifier}`)
}

const specifierPattern = /(\b(?:from|import)\s*\(?\s*['"])(\.{1,2}(?:\/[^'"\n]+)?)(['"])/g
for (const file of listModuleFiles(distRoot)) {
  const source = fs.readFileSync(file, 'utf8')
  const rewritten = source.replace(specifierPattern, (_match, prefix, specifier, suffix) => (
    `${prefix}${emittedSpecifier(file, specifier)}${suffix}`
  ))
  fs.writeFileSync(file, rewritten)
}

const moduleCount = listModuleFiles(distRoot).filter((file) => file.endsWith('.js')).length
console.log(`✔ SDK ESM 构建完成（保留 ${moduleCount} 个模块及对应类型声明）`)

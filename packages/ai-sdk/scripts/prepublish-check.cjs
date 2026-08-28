#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const packageRoot = path.resolve(__dirname, '..')
const repositoryRoot = path.resolve(packageRoot, '..', '..')
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
const readme = fs.readFileSync(path.join(packageRoot, 'README.md'), 'utf8')

function run(label, command, args, cwd = repositoryRoot) {
  console.log(`\n[prepublish] ${label}`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function listFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) listFiles(absolute, output)
    else if (entry.isFile()) output.push(absolute)
  }
  return output
}

function fail(message) {
  console.error(`✘ ${message}`)
  process.exit(1)
}

run('SDK 可移植性检查', 'npm', ['run', 'check:sdk'])
run('SDK 全量测试', 'npm', ['test', '-w', 'packages/ai-sdk'])
run('SDK 构建', 'npm', ['run', 'build', '-w', 'packages/ai-sdk'])
run('仓库外标准 Vite dev 消费方解析', process.execPath, [path.join(packageRoot, 'scripts', 'verify-vite-consumer.cjs')])
run('仓库外无 TextEncoder/TextDecoder 按需能力消费', process.execPath, [
  path.join(packageRoot, 'scripts', 'verify-restricted-package-consumer.cjs'),
])

const distRoot = path.join(packageRoot, 'dist')
if (!fs.existsSync(distRoot)) fail('构建后 packages/ai-sdk/dist 不存在')

const forbiddenSpecifier = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"](?:node:|electron['"])/
for (const file of listFiles(distRoot)) {
  if (!/\.(?:js|d\.ts)$/.test(file)) continue
  const source = fs.readFileSync(file, 'utf8')
  if (forbiddenSpecifier.test(source)) {
    fail(`构建产物含 Node/Electron 导入：${path.relative(packageRoot, file)}`)
  }
}

const requiredEntries = [
  '.',
  './providers',
  './generation',
  './generation/core',
  './catalog',
  './llm',
  './llm/streaming',
  './llm/groq',
  './llm/modules',
  './runtime',
  './capabilities',
  './capabilities/speech-recognition',
  './capabilities/speech-recognition/bailian',
  './capabilities/speech-recognition/bailian/realtime',
  './capabilities/translation',
  './capabilities/translation/bailian',
  './capabilities/realtime',
  './discovery',
]
for (const entry of requiredEntries) {
  const definition = manifest.exports?.[entry]
  if (!definition) fail(`package.json 缺少 exports 入口 ${entry}`)
  for (const condition of ['types', 'import', 'default']) {
    const target = definition[condition]
    if (typeof target !== 'string') fail(`${entry} 缺少 ${condition} 导出`)
    if (!fs.existsSync(path.resolve(packageRoot, target))) {
      fail(`${entry}.${condition} 指向不存在的文件：${target}`)
    }
  }
}

const patternEntries = [
  './models/*',
  './provider-adapters/*',
  './provider-packs/*',
  './tool-models/*',
  './tool-packs/*',
]
for (const entry of patternEntries) {
  const definition = manifest.exports?.[entry]
  if (!definition) fail(`package.json 缺少按需 exports 入口 ${entry}`)
  for (const condition of ['types', 'import', 'default']) {
    const target = definition[condition]
    if (typeof target !== 'string' || !target.includes('*')) {
      fail(`${entry}.${condition} 不是 dist 通配导出`)
    }
  }
}

if (manifest.name !== '@henjicc/ai-sdk' || manifest.version !== '0.2.3') {
  fail(`发布坐标不匹配：${manifest.name}@${manifest.version}`)
}
if (manifest.publishConfig?.registry !== 'https://npm.pkg.github.com') {
  fail('publishConfig.registry 不是 https://npm.pkg.github.com')
}
if (manifest.sideEffects !== false) fail('sideEffects 必须明确为 false')
if (!readme.includes(`SDK \`${manifest.version}\``)) {
  fail(`README 快速开始版本未同步为 ${manifest.version}`)
}
if (!readme.includes(`npm install @henjicc/ai-sdk@${manifest.version}`)) {
  fail(`README 安装命令版本未同步为 ${manifest.version}`)
}

console.log('\n✔ SDK 发布前门禁通过')

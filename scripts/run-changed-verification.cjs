#!/usr/bin/env node

const path = require('node:path')
const { spawn } = require('node:child_process')
const {
  buildChangedVerificationPlan,
  parseChangedVerificationArgs,
} = require('./lib/changedVerificationPlan.cjs')

const root = path.resolve(__dirname, '..')

function printHelp() {
  console.log(`Henji-AI 局部验证

用法：
  npm run verify:changed -- --level L0 docs/rules/testing.md
  npm run verify:changed -- --level L1 src/features/example.ts src/features/example.test.ts
  npm run verify:changed -- --level L2 electron/main/example.ts

必须显式列出本次文件，不会读取整个 git diff。支持 --dry-run 只查看计划。
L0 只核查非运行时文件；L1 跑精确/相关测试与局部 ESLint；L2 再追加受影响工程的增量类型检查。
`)
}

function renderCommand(item) {
  return [item.command, ...item.args].map((value) => JSON.stringify(value)).join(' ')
}

function runStep(item) {
  return new Promise((resolve, reject) => {
    const npmExecPath = process.env.npm_execpath?.trim()
    const shouldUseCurrentNpm = process.platform === 'win32'
      && item.command.toLowerCase() === 'npm.cmd'
      && npmExecPath
    const command = shouldUseCurrentNpm ? process.execPath : item.command
    const args = shouldUseCurrentNpm ? [npmExecPath, ...item.args] : item.args
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env },
      stdio: 'inherit',
      windowsHide: true,
      shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command),
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)))
  })
}

async function main() {
  const options = parseChangedVerificationArgs(process.argv.slice(2), root)
  if (options.help) {
    printHelp()
    return
  }
  const plan = buildChangedVerificationPlan(options, root)
  console.log(`验证级别 ${options.level}；显式文件 ${options.files.length} 个。`)
  if (plan.length === 0) {
    console.log('无需运行 ESLint、TypeScript 或测试。')
    return
  }
  if (options.dryRun) {
    for (const item of plan) console.log(`- ${item.label}: ${renderCommand(item)}`)
    return
  }
  for (const [index, item] of plan.entries()) {
    console.log(`\n[局部验证 ${index + 1}/${plan.length}] ${item.label}`)
    const code = await runStep(item)
    if (code !== 0) throw new Error(`${item.label}未通过（退出码 ${code}）`)
  }
  console.log(`\n局部验证通过：${plan.map((item) => item.label).join('、')}`)
}

main().catch((error) => {
  console.error(`[verify:changed] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

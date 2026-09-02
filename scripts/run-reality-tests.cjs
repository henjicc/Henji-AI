#!/usr/bin/env node

const path = require('node:path')
const { spawn } = require('node:child_process')
const { buildRealityTestPlan, parseRealityTestArgs } = require('./lib/realityTestPlan.cjs')

const ROOT = path.resolve(__dirname, '..')

function printHelp() {
  console.log(`Henji-AI 真实性测试

用法：
  npm run test:reality -- --suite unit --test src/path/example.test.ts
  npm run test:reality -- --suite integration
  npm run test:reality -- --build --suite ui --only 3D --size 1440x900
  npm run test:reality -- --build --suite ui --profile real --only 设置
  npm run test:reality -- --build --suite live --profile real --allow-paid --allow-writes --only camera

测试层：
  unit        精确、确定、零外部副作用的单元测试
  integration 真注册表/真 Gateway/真执行器的助手运行时 harness，仅替换进程边界
  ui          真实 Electron + Playwright 操作与截图，并通过应用接口收集本场景日志
  ui-audit    真实 Electron DOM 规则审计，并收集同样的运行时证据
  live        复用真实模型配置、API 密钥和业务数据的真机验收

数据与副作用：
  --build                   UI / UI Audit / live 前只生成最新 Electron 产物，不跑完整质量门禁
  --profile temporary|real  默认 temporary；real 复用当前应用资料与系统密钥链
  --real-data               --profile real 的别名
  --allow-writes            允许真实资料模式写业务数据
  --allow-paid              允许真实 API 付费请求（live 必需）

场景缩小：--only、--size、--out；live 另支持 --probe、--skip-generation、--visible。
可重复传入 --suite，但任一层失败后立即停止。
`)
}

function runStep(step) {
  return new Promise((resolve, reject) => {
    const npmExecPath = process.env.npm_execpath?.trim()
    const shouldUseCurrentNpm = process.platform === 'win32'
      && step.command.toLowerCase() === 'npm.cmd'
      && npmExecPath
    const command = shouldUseCurrentNpm ? process.execPath : step.command
    const args = shouldUseCurrentNpm ? [npmExecPath, ...step.args] : step.args
    const child = spawn(command, args, {
      cwd: ROOT,
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
  const options = parseRealityTestArgs(process.argv.slice(2))
  if (options.help || options.suites.length === 0) {
    printHelp()
    return
  }
  const plan = buildRealityTestPlan(options, ROOT)
  for (const [index, step] of plan.entries()) {
    console.log(`\n[真实性测试 ${index + 1}/${plan.length}] ${step.label}`)
    const code = await runStep(step)
    if (code !== 0) throw new Error(`${step.label}未通过（退出码 ${code}）`)
  }
  console.log(`\n真实性测试通过：${plan.map((step) => step.label).join('、')}`)
}

main().catch((error) => {
  console.error(`[test:reality] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

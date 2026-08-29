#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { buildAssistantProductionTestPlan } = require('./lib/assistantProductionTestPlan.cjs')

const root = path.resolve(__dirname, '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

function runStep(item) {
  return new Promise((resolve, reject) => {
    const child = spawn(item.command, item.args, {
      cwd: root,
      env: { ...process.env },
      stdio: 'inherit',
      windowsHide: true,
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)))
  })
}

async function main() {
  const plan = buildAssistantProductionTestPlan(packageJson, root)
  for (const [index, item] of plan.entries()) {
    console.log(`\n[助手生产验收 ${index + 1}/${plan.length}] ${item.label}`)
    const code = await runStep(item)
    if (code !== 0) throw new Error(`${item.label}未通过（退出码 ${code}）`)
  }
  console.log('\n助手生产验收通过。')
}

main().catch((error) => {
  console.error(`[test:assistant-production] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

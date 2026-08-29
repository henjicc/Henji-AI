#!/usr/bin/env node

const path = require('node:path')
const { spawn } = require('node:child_process')
const { buildElectronBundlePlan } = require('./lib/electronBundlePlan.cjs')
const { readElectronDevState } = require('./lib/electronDevState.cjs')
const { acquireProcessLock } = require('./lib/processLock.cjs')

const root = path.resolve(__dirname, '..')

function runStep(item) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const child = spawn(item.command, item.args, {
      cwd: root,
      env: { ...process.env },
      stdio: 'inherit',
      windowsHide: true,
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => resolve({
      code: signal ? 1 : (code ?? 1),
      durationMs: Date.now() - startedAt,
    }))
  })
}

async function main() {
  const devState = readElectronDevState(root)
  if (devState && process.env.HENJI_ALLOW_BUNDLE_WITH_DEV !== '1') {
    throw new Error(
      `检测到当前仓库 electron:dev 正在运行（PID ${devState.pid}）。\n`
      + '构建会改写其正在加载的 out/；请先结束该开发实例，再重新运行。',
    )
  }

  const releaseLock = acquireProcessLock(
    path.join(root, 'node_modules', '.henji-electron-bundle.lock'),
    'Electron 轻量构建',
  )
  process.on('exit', releaseLock)
  const plan = buildElectronBundlePlan(root)
  try {
    const totalStartedAt = Date.now()
    for (const [index, item] of plan.entries()) {
      console.log(`\n[轻量构建 ${index + 1}/${plan.length}] ${item.label}`)
      const result = await runStep(item)
      console.log(`[轻量构建] ${item.label} ${(result.durationMs / 1000).toFixed(2)}s`)
      if (result.code !== 0) throw new Error(`${item.label}未通过（退出码 ${result.code}）`)
    }
    console.log(`\n✔ Electron 运行产物已更新，总耗时 ${((Date.now() - totalStartedAt) / 1000).toFixed(2)}s`)
  } finally {
    releaseLock()
  }
}

main().catch((error) => {
  console.error(`[electron:bundle] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

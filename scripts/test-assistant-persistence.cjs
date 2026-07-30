const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const workspaceRoot = path.resolve(__dirname, '..')
const electronExecutable = require('electron')
const vitestEntry = path.join(workspaceRoot, 'node_modules', 'vitest', 'vitest.mjs')
const reportDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-agent-persistence-'))
const reportPath = path.join(reportDirectory, 'result.json')
const testFiles = [
  path.join(
    workspaceRoot,
    'electron',
    'main',
    'services',
    'agent-runtime',
    'persistence',
    'permission-audit-store.test.ts'
  ),
  path.join(
    workspaceRoot,
    'electron',
    'main',
    'services',
    'agent-runtime',
    'persistence',
    'artifact-store.test.ts'
  ),
  path.join(
    workspaceRoot,
    'electron',
    'main',
    'services',
    'agent-runtime',
    'persistence',
    'store.test.ts'
  ),
  path.join(
    workspaceRoot,
    'electron',
    'main',
    'services',
    'agent-runtime',
    'persistence',
    'session-store.test.ts'
  ),
  path.join(
    workspaceRoot,
    'electron',
    'main',
    'services',
    'agent-runtime',
    'persistence',
    'external-wait-store.test.ts'
  ),
  path.join(
    workspaceRoot,
    'electron',
    'main',
    'services',
    'assistant',
    'memory-store.test.ts'
  ),
  path.join(
    workspaceRoot,
    'electron',
    'main',
    'services',
    'logging',
    'agent-trace-store.test.ts'
  ),
]

function cleanup() {
  fs.rmSync(reportDirectory, { recursive: true, force: true })
}

function waitForReport(timeoutMs = 60_000) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (fs.existsSync(reportPath)) {
        resolve()
        return
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('Electron 持久化测试未在限定时间内生成报告'))
        return
      }
      setTimeout(poll, 50)
    }
    poll()
  })
}

async function main() {
  const child = spawn(
    electronExecutable,
    [
      vitestEntry,
      'run',
      ...testFiles,
      '--pool=forks',
      '--poolOptions.forks.singleFork=true',
      '--reporter=json',
      `--outputFile=${reportPath}`,
    ],
    {
      cwd: workspaceRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore',
      windowsHide: true,
    }
  )

  child.on('error', (error) => {
    console.error(`无法启动 Electron 持久化测试：${error.message}`)
  })
  await waitForReport()
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  if (!report.success) {
    const failures = report.testResults
      .flatMap((suite) => suite.assertionResults)
      .filter((test) => test.status === 'failed')
      .map((test) => `${test.fullName}\n${test.failureMessages.join('\n')}`)
    throw new Error(`Electron 持久化测试失败：\n${failures.join('\n\n')}`)
  }
  console.log(`Electron 持久化测试通过：${report.numPassedTests}/${report.numTotalTests}`)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
  .finally(cleanup)

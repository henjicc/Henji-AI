const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { NATIVE_TEST_FILES } = require('./lib/testSuites.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
const OUTPUT_LIMIT_BYTES = 16 * 1024
const REPORT_LIMIT_BYTES = 16 * 1024 * 1024

function bounded(value, limit = OUTPUT_LIMIT_BYTES) {
  const buffer = Buffer.from(String(value))
  return buffer.length > limit ? buffer.subarray(-limit).toString() : String(value)
}

function validateNativeReport(report, testFiles, root = workspaceRoot) {
  if (!report || report.success !== true || !Array.isArray(report.testResults)) throw new Error('原生 SQLite 报告缺失或未通过')
  const expected = testFiles.map((file) => path.resolve(root, file)).sort()
  const actual = report.testResults.map((suite) => typeof suite.name === 'string' ? path.resolve(root, suite.name) : '')
  if (!expected.length || new Set(expected).size !== expected.length
    || new Set(actual).size !== actual.length || JSON.stringify([...actual].sort()) !== JSON.stringify(expected)) {
    throw new Error('原生 SQLite 报告文件清单缺失、重复或包含未登记文件')
  }
  let passed = 0
  for (const suite of report.testResults) {
    if (suite.status !== 'passed' || !Array.isArray(suite.assertionResults) || !suite.assertionResults.length) {
      throw new Error(`原生 SQLite 文件失败或没有执行用例：${path.relative(root, suite.name)}`)
    }
    for (const assertion of suite.assertionResults) {
      if (assertion.status !== 'passed' || (Array.isArray(assertion.failureMessages) && assertion.failureMessages.length)) {
        throw new Error(`原生 SQLite 用例不能失败、跳过或待办：${assertion.fullName ?? assertion.title ?? suite.name}`)
      }
      passed += 1
    }
  }
  for (const field of ['numFailedTests', 'numPendingTests', 'numTodoTests', 'numFailedTestSuites',
    'numPendingTestSuites', 'numRuntimeErrorTestSuites']) {
    // 可选统计缺省不替代证据；上面仍逐项校验实际文件与断言状态。
    if (report[field] !== undefined && report[field] !== 0) throw new Error(`原生 SQLite 报告存在未通过项：${field}`)
  }
  if (report.numTotalTests !== passed || report.numPassedTests !== passed) throw new Error('原生 SQLite 报告统计与实际通过断言不一致')
  return { files: expected.length, passed }
}

function reportFailureDetails(report) {
  if (!Array.isArray(report?.testResults)) return ''
  const messages = []
  for (const suite of report.testResults) {
    if (suite.message) messages.push(String(suite.message))
    for (const item of suite.assertionResults ?? []) {
      if (item.status !== 'passed') messages.push(`${item.fullName ?? item.title}: ${item.status}\n${(item.failureMessages ?? []).join('\n')}`)
    }
  }
  return bounded(messages.join('\n'))
}

function observeChild(child) {
  const state = { closed: false, result: null, output: Buffer.alloc(0) }
  const append = (chunk) => { state.output = Buffer.concat([state.output, Buffer.from(chunk)]).subarray(-OUTPUT_LIMIT_BYTES) }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  state.closedPromise = new Promise((resolve) => {
    child.once('close', (code, signal) => { state.closed = true; state.result = { code, signal }; resolve(state.result) })
  })
  state.completion = new Promise((resolve, reject) => {
    child.once('error', reject)
    state.closedPromise.then(resolve)
  })
  // timeout/signal 先结束时，迟到的 spawn error 不能成为 unhandled rejection。
  state.completion.catch(() => undefined)
  return state
}

async function within(promise, timeoutMs, message) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs) })]) }
  finally { clearTimeout(timer) }
}

function groupAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false
  try { process.kill(-pid, 0); return true }
  catch (error) { if (error.code === 'ESRCH') return false; throw error }
}

async function terminateOwnedChild(child, state, { platform = process.platform, graceMs = 2000 } = {}) {
  // 仅本次 spawn 的 child；POSIX detached 创建的组ID是 child.pid，不按进程名扫全机。
  const pid = child.pid
  if (!Number.isInteger(pid) || pid <= 1) {
    if (!state.closed) await within(state.closedPromise, graceMs, '启动失败进程未确认关闭')
    return
  }
  if (platform === 'win32') {
    if (!state.closed) {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      await within(observeChild(killer).completion, graceMs, '无法在期限内结束原生测试进程树')
    }
    await within(state.closedPromise, graceMs, '原生测试进程未确认关闭')
    return
  }
  const signalGroup = (signal) => {
    try { process.kill(-pid, signal) }
    catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  if (groupAlive(pid)) signalGroup('SIGTERM')
  const deadline = Date.now() + graceMs
  while ((!state.closed || groupAlive(pid)) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
  if (groupAlive(pid)) signalGroup('SIGKILL')
  await within(state.closedPromise, graceMs, '原生测试进程未确认关闭，保留报告目录')
  const forceDeadline = Date.now() + graceMs
  while (groupAlive(pid) && Date.now() < forceDeadline) await new Promise((resolve) => setTimeout(resolve, 20))
  if (groupAlive(pid)) throw new Error('原生测试进程组仍存活，保留报告目录')
}

async function runNativePersistence({
  executable = require('electron'), root = workspaceRoot, testFiles = NATIVE_TEST_FILES,
  timeoutMs = 60000, graceMs = 2000, signal,
  // 自检仅替换子进程命令；正式入口仍唯一使用已安装的 Electron + Vitest。
  createArguments = (reportPath) => [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--mode=native',
    ...testFiles.map((file) => path.resolve(root, file)), '--pool=forks', '--poolOptions.forks.singleFork=true',
    '--reporter=json', `--outputFile=${reportPath}`],
  onDirectory,
} = {}) {
  if (signal?.aborted) throw new Error('原生 SQLite 验证已取消')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-native-sqlite-'))
  const reportPath = path.join(directory, 'result.json')
  let child; let state; let failure; let summary; let removeAbort
  try {
    onDirectory?.(directory)
    child = spawn(executable, createArguments(reportPath), { cwd: root,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' })
    state = observeChild(child)
    const interrupted = new Promise((_, reject) => {
      const onAbort = () => reject(new Error('原生 SQLite 验证已取消'))
      signal?.addEventListener('abort', onAbort, { once: true })
      removeAbort = () => signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) onAbort()
    })
    const result = await within(Promise.race([state.completion, interrupted]), timeoutMs, '原生 SQLite 验证超时')
    if (result.code !== 0 || result.signal) throw new Error(`原生 SQLite 子进程异常退出：code=${result.code}, signal=${result.signal}`)
    if (process.platform !== 'win32' && groupAlive(child.pid)) throw new Error('原生 SQLite 主进程退出后仍有存活子进程')
    const bytes = fs.statSync(reportPath).size
    if (bytes > REPORT_LIMIT_BYTES) throw new Error('原生 SQLite 报告超过16MiB，拒绝读取')
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    try { summary = validateNativeReport(report, testFiles, root) }
    catch (error) { throw new Error(`${error.message}\n${reportFailureDetails(report)}`) }
  } catch (error) { failure = error }
  finally {
    removeAbort?.()
    let stopped = !child
    try {
      if (child && state) { await terminateOwnedChild(child, state, { graceMs }); stopped = true }
    } catch (error) { failure = new Error(`${failure?.message ?? ''}\n${error.message}；报告保留于 ${directory}`) }
    if (stopped) fs.rmSync(directory, { recursive: true, force: true })
  }
  if (failure) throw new Error(`${bounded(failure.message, OUTPUT_LIMIT_BYTES / 2)}\n${bounded(state?.output.toString() ?? '', OUTPUT_LIMIT_BYTES / 2)}`)
  return summary
}

async function main() {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel)
  try {
    const result = await runNativePersistence({ signal: controller.signal })
    console.log(`Electron 原生 SQLite 验证通过：${result.files} 文件，${result.passed} 用例，0 跳过`)
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel) }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1 })

module.exports = { validateNativeReport, runNativePersistence, OUTPUT_LIMIT_BYTES }

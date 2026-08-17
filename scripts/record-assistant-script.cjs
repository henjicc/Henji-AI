/**
 * `npm run assistant:record -- --run <runId>` 的入口。
 *
 * better-sqlite3 是按 Electron 的 ABI 编译的，普通 node 加载会报 NODE_MODULE_VERSION 不匹配，
 * 所以这里用 ELECTRON_RUN_AS_NODE 起 Electron 的 node 来跑真正的录制逻辑。
 * 与 `test-assistant-persistence.cjs` 同一手法。
 */
const path = require('node:path')
const { spawn } = require('node:child_process')

const electronExecutable = require('electron')
const worker = path.join(__dirname, 'lib', 'recordAssistantScript.cjs')

const child = spawn(electronExecutable, [worker, ...process.argv.slice(2)], {
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
  windowsHide: true,
})

child.on('error', (error) => {
  process.stderr.write(`无法启动录制器：${error.message}\n`)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1)
})

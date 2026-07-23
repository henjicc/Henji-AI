const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const workspaceRoot = path.resolve(__dirname, '..')
const utilityEntry = path.join(workspaceRoot, 'out', 'main', 'agent-utility.cjs')
if (!fs.existsSync(utilityEntry)) {
  console.error('缺少 out/main/agent-utility.cjs，请先运行 npm run electron:build')
  process.exit(1)
}

const child = spawn(
  require('electron'),
  [path.join(__dirname, 'electron-agent-utility-smoke-app.cjs')],
  {
    cwd: workspaceRoot,
    stdio: 'inherit',
    windowsHide: true,
  }
)
child.on('error', (error) => {
  console.error(`无法启动 Agent utility process 冒烟测试：${error.message}`)
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})

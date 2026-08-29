const { existsSync } = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')
const mainEntry = path.join(projectRoot, 'out', 'main', 'index.cjs')

if (!existsSync(mainEntry)) {
  process.stderr.write('未找到 Electron 构建产物。请先执行 npm run electron:bundle。\n')
  process.exitCode = 1
} else {
  const electron = require('electron')
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  const child = spawn(electron, [projectRoot, '--assistant-cli', ...process.argv.slice(2)], {
    cwd: projectRoot,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  })
  child.on('error', (error) => {
    process.stderr.write(`无法启动命令行助手：${error.message}\n`)
    process.exitCode = 1
  })
  child.on('exit', (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1)
  })
}

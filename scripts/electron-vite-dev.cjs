const { spawn } = require('node:child_process')
const path = require('node:path')
const { clearElectronDevState, writeElectronDevState } = require('./lib/electronDevState.cjs')

const root = path.resolve(__dirname, '..')
const electronViteBin = path.join(root, 'node_modules/electron-vite/bin/electron-vite.js')
const electronArgs = process.argv.slice(2)
const electronViteArgs = [electronViteBin, 'dev']

if (electronArgs.length > 0) {
  electronViteArgs.push('--', ...electronArgs)
}

const env = {
  ...process.env,
}

if (env.ELECTRON_RUN_AS_NODE) {
  delete env.ELECTRON_RUN_AS_NODE
  console.log('[electron:dev] cleared ELECTRON_RUN_AS_NODE for Electron launch')
}

const child = spawn(process.execPath, electronViteArgs, {
  cwd: root,
  env,
  stdio: 'inherit',
})

writeElectronDevState(root)
process.on('exit', () => clearElectronDevState(root))

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

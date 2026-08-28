const { spawn } = require('node:child_process')
const path = require('node:path')

const electronViteBin = path.resolve(__dirname, '../node_modules/electron-vite/bin/electron-vite.js')
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
  cwd: path.resolve(__dirname, '..'),
  env,
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

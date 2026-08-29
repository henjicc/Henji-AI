const fs = require('node:fs')
const path = require('node:path')

function electronDevStatePath(root) {
  return path.join(root, 'node_modules', '.henji-electron-dev.json')
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function readElectronDevState(root) {
  const statePath = electronDevStatePath(root)
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    if (state.root === root && isProcessAlive(state.pid)) return state
    fs.rmSync(statePath, { force: true })
    return null
  } catch {
    return null
  }
}

function writeElectronDevState(root, pid = process.pid) {
  const state = { pid, root, startedAt: new Date().toISOString() }
  fs.writeFileSync(electronDevStatePath(root), `${JSON.stringify(state)}\n`)
  return state
}

function clearElectronDevState(root, pid = process.pid) {
  const state = readElectronDevState(root)
  if (!state || state.pid === pid) fs.rmSync(electronDevStatePath(root), { force: true })
}

module.exports = {
  clearElectronDevState,
  electronDevStatePath,
  isProcessAlive,
  readElectronDevState,
  writeElectronDevState,
}

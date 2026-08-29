const crypto = require('node:crypto')
const fs = require('node:fs')
const { isProcessAlive } = require('./electronDevState.cjs')

function readLock(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  } catch {
    return null
  }
}

function acquireProcessLock(lockPath, label) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = crypto.randomUUID()
    const state = { label, pid: process.pid, startedAt: new Date().toISOString(), token }
    try {
      const descriptor = fs.openSync(lockPath, 'wx')
      fs.writeFileSync(descriptor, `${JSON.stringify(state)}\n`)
      fs.closeSync(descriptor)
      return () => {
        if (readLock(lockPath)?.token === token) fs.rmSync(lockPath, { force: true })
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const current = readLock(lockPath)
      if (current && isProcessAlive(current.pid)) {
        throw new Error(`${current.label || label} 已在运行（PID ${current.pid}），不重复启动`)
      }
      fs.rmSync(lockPath, { force: true })
    }
  }
  throw new Error(`无法取得 ${label} 独占锁`)
}

module.exports = { acquireProcessLock, readLock }

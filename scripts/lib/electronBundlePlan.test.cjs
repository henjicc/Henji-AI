const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { buildElectronBundlePlan } = require('./electronBundlePlan.cjs')
const { acquireProcessLock, readLock } = require('./processLock.cjs')
const {
  clearElectronDevState,
  readElectronDevState,
  writeElectronDevState,
} = require('./electronDevState.cjs')

test('轻量构建计划只生成运行产物', () => {
  const plan = buildElectronBundlePlan('/workspace')
  assert.deepEqual(plan.map((item) => item.label), [
    '媒体二进制权限',
    '生成进度种子',
    '生成模型目录索引',
    '准备 SDK 产物',
    '构建 Electron main/preload/renderer',
  ])
  const serialized = JSON.stringify(plan)
  assert.doesNotMatch(serialized, /check:|vitest|\btsc\b|\blint\b|electron:build/)
})

test('开发实例状态只接受仍存活的当前仓库进程', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-electron-dev-state-'))
  fs.mkdirSync(path.join(root, 'node_modules'))
  writeElectronDevState(root, process.pid)
  assert.equal(readElectronDevState(root)?.pid, process.pid)
  clearElectronDevState(root, process.pid)
  assert.equal(readElectronDevState(root), null)

  writeElectronDevState(root, 99999999)
  assert.equal(readElectronDevState(root), null)
})

test('轻量构建锁拒绝同一进程重复占用并可释放', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-electron-bundle-lock-'))
  const lockPath = path.join(root, 'bundle.lock')
  const release = acquireProcessLock(lockPath, '测试构建')
  assert.equal(readLock(lockPath)?.pid, process.pid)
  assert.throws(() => acquireProcessLock(lockPath, '测试构建'), /已在运行/)
  release()
  assert.equal(readLock(lockPath), null)
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  calculateSdkInputDigest,
  isSdkBuildCurrent,
  writeSdkBuildStamp,
} = require('./sdkBuildFreshness.cjs')

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-sdk-freshness-'))
  fs.mkdirSync(path.join(root, 'input'), { recursive: true })
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  fs.mkdirSync(path.join(root, 'packages', 'ai-sdk', 'dist'), { recursive: true })
  fs.writeFileSync(path.join(root, 'input', 'source.ts'), 'export const value = 1\n')
  fs.writeFileSync(path.join(root, 'packages', 'ai-sdk', 'dist', 'index.js'), 'export {}\n')
  return root
}

test('SDK 输入摘要只随内容变化，不随 mtime 变化', () => {
  const root = fixture()
  const input = path.join(root, 'input', 'source.ts')
  const first = calculateSdkInputDigest(root, ['input'])
  const now = new Date()
  fs.utimesSync(input, now, now)
  assert.equal(calculateSdkInputDigest(root, ['input']), first)
  fs.writeFileSync(input, 'export const value = 2\n')
  assert.notEqual(calculateSdkInputDigest(root, ['input']), first)
})

test('SDK 构建缓存同时要求 dist 入口与匹配摘要', () => {
  const root = fixture()
  const digest = calculateSdkInputDigest(root, ['input'])
  writeSdkBuildStamp(root, digest)
  assert.equal(isSdkBuildCurrent(root, digest), true)
  fs.rmSync(path.join(root, 'packages', 'ai-sdk', 'dist', 'index.js'))
  assert.equal(isSdkBuildCurrent(root, digest), false)
})

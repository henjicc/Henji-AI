#!/usr/bin/env node

const path = require('node:path')
const { spawnSync } = require('node:child_process')
const {
  calculateSdkInputDigest,
  isSdkBuildCurrent,
  writeSdkBuildStamp,
} = require('./lib/sdkBuildFreshness.cjs')

const root = path.resolve(__dirname, '..')
const force = process.argv.includes('--force')
const before = calculateSdkInputDigest(root)

if (!force && isSdkBuildCurrent(root, before)) {
  console.log('✔ SDK 输入未变化，复用现有 dist')
  process.exit(0)
}

console.log(force ? '构建 SDK（显式强制）' : 'SDK 输入已变化，重新构建')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(npmCommand, ['run', 'build', '-w', 'packages/ai-sdk'], {
  cwd: root,
  stdio: 'inherit',
})
if (result.status !== 0) process.exit(result.status ?? 1)

const after = calculateSdkInputDigest(root)
writeSdkBuildStamp(root, after)
console.log(`✔ SDK 构建缓存已更新（${after.slice(0, 12)}）`)

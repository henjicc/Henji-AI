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
const npmArgs = ['run', 'build', '-w', 'packages/ai-sdk']
const npmExecPath = process.env.npm_execpath?.trim()
const result = npmExecPath
  ? spawnSync(process.execPath, [npmExecPath, ...npmArgs], {
      cwd: root,
      stdio: 'inherit',
    })
  : spawnSync(npmCommand, npmArgs, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
if (result.error) {
  console.error(`SDK 构建进程启动失败：${result.error.message}`)
}
if (result.status !== 0) process.exit(result.status ?? 1)

const after = calculateSdkInputDigest(root)
writeSdkBuildStamp(root, after)
console.log(`✔ SDK 构建缓存已更新（${after.slice(0, 12)}）`)

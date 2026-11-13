#!/usr/bin/env node
/**
 * 构建原生画面采集进程（native/screen-capture）。
 *
 * 链接与视频解码服务同一份随包 FFmpeg（scripts/video-decoder-ffmpeg.cjs 固定的构建），FFmpeg 的获取、
 * MSVC 环境与静态 C 运行时都复用那里的做法；产物旁边放一份 FFmpeg 库，开发时可以直接运行。
 *
 * 用法：
 *   node scripts/build-screen-capture.cjs            发布构建
 *   node scripts/build-screen-capture.cjs --debug    调试构建
 *   node scripts/build-screen-capture.cjs --test     跑单元测试（其后的参数原样传给 cargo test）
 *
 * 目前只有 Windows x64 的平台层；其他平台输出说明后以 0 退出。
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { cargoEnv, ensureFfmpeg, isSupportedPlatform, runtimeFiles } = require('./video-decoder-ffmpeg.cjs')

const root = path.resolve(__dirname, '..')
const crate = path.join(root, 'native', 'screen-capture')
const LIBRARY = /\.dll$/i

async function main() {
  if (!isSupportedPlatform()) {
    console.log(`[screen-capture] 当前平台 ${process.platform}-${process.arch} 还没有平台层，已跳过。`)
    return
  }
  await ensureFfmpeg()
  const args = process.argv.slice(2)
  const test = args.includes('--test')
  const profile = args.includes('--debug') ? 'debug' : 'release'
  const cargoArgs = test
    ? ['test', '--locked', '--release', '--manifest-path', path.join(crate, 'Cargo.toml'), ...args.filter((arg) => arg !== '--test')]
    : ['build', '--locked', ...(profile === 'release' ? ['--release'] : []), '--manifest-path', path.join(crate, 'Cargo.toml')]
  const result = spawnSync('cargo', cargoArgs, { cwd: root, env: cargoEnv(), stdio: 'inherit', windowsHide: true })
  if (result.error || result.status !== 0) throw result.error ?? new Error(`cargo ${cargoArgs[0]} 失败（退出码 ${result.status}）`)
  if (test) return
  const targetDir = path.join(crate, 'target', profile)
  for (const file of runtimeFiles().filter((name) => LIBRARY.test(name))) {
    const destination = path.join(targetDir, path.basename(file))
    const source = fs.statSync(file)
    const existing = fs.existsSync(destination) ? fs.statSync(destination) : null
    if (!existing || existing.size !== source.size || existing.mtimeMs < source.mtimeMs) fs.copyFileSync(file, destination)
  }
  console.log(`[screen-capture] 构建完成（${profile}）：${path.join(targetDir, 'henji-screen-capture.exe')}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })

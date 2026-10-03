#!/usr/bin/env node
/**
 * 构建随包音频处理程序 native/audio-worker（npm run build:audio-worker）。
 * Windows 上静态链接 MSVC C 运行时，避免干净机器缺 VCRUNTIME140.dll 无法启动（scripts/lib/nativeCrt.cjs，任务 3.3）。
 */

const path = require('node:path')
const { spawn } = require('node:child_process')
const { withStaticMsvcCrt } = require('./lib/nativeCrt.cjs')

const root = path.resolve(__dirname, '..')
const manifest = path.join(root, 'native', 'audio-worker', 'Cargo.toml')
const child = spawn('cargo', ['build', '--release', '--manifest-path', manifest, ...process.argv.slice(2)], {
  cwd: root,
  env: withStaticMsvcCrt(process.env),
  stdio: 'inherit',
  windowsHide: true,
})
child.on('error', (error) => {
  console.error(`[audio-worker] 无法运行 cargo：${error.message}`)
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})

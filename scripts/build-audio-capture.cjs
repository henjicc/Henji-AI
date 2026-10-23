#!/usr/bin/env node
// 固定官方源码与摘要；vendor 仅供编译，不提交、不分发。
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { downloadWithRetry } = require('./video-decoder-ffmpeg.cjs')
const { withStaticMsvcCrt } = require('./lib/nativeCrt.cjs')
const root = path.resolve(__dirname, '..')
const crate = path.join(root, 'native/audio-capture')
const vendor = path.join(crate, 'vendor')
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:/Windows', 'System32/tar.exe') : 'tar'
const SOURCES = Object.freeze({
  portaudio: { version: '19.7.0', url: 'https://files.portaudio.com/archives/pa_stable_v190700_20210406.tgz', file: 'portaudio.tar.gz', sha256: '47efbf42c77c19a05d22e627d42873e991ec0c1357219c0d74ce6a2948cb2def' },
  asio: { version: '2.3.4-2025-10-15', url: 'https://download.steinberg.net/sdk_downloads/ASIO-SDK_2.3.4_2025-10-15.zip', file: 'asio.zip', sha256: 'd5ebf0c20dd2c5f43771fd0c1418f4b361bf52434ee670097cfa6b3a335e2eca' },
})
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true })
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} 失败：${result.status}`)
}
async function obtain(source) {
  const file = path.join(vendor, source.file)
  if (!fs.existsSync(file)) await downloadWithRetry(source.url, file)
  if (crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== source.sha256) throw new Error(`${source.file} SHA256 不匹配，请移除损坏的下载文件后重试`)
  return file
}
async function main() {
  const win = process.platform === 'win32' && process.arch === 'x64'
  if (!win && !(process.platform === 'darwin' && process.arch === 'arm64')) {
    console.log('[audio-capture] 仅支持 Windows x64 / macOS arm64，跳过当前平台')
    return
  }
  fs.mkdirSync(vendor, { recursive: true })
  run(tar, ['-xf', await obtain(SOURCES.portaudio), '-C', vendor])
  let asio = false
  if (win && !process.argv.includes('--without-asio')) {
    try {
      const archive = await obtain(SOURCES.asio)
      fs.mkdirSync(path.join(vendor, 'asio'), { recursive: true })
      run(tar, ['-xf', archive, '-C', path.join(vendor, 'asio')])
      asio = true
    } catch (error) {
      console.warn(`[audio-capture] ASIO SDK 获取失败，本次不含 ASIO：${error.message}`)
    }
  }
  if (win && (process.argv.includes('--require-asio') || process.env.HENJI_AUDIO_CAPTURE_REQUIRE_ASIO === '1') && !asio) throw new Error('正式 Windows 构建必须包含 ASIO')
  fs.writeFileSync(path.join(vendor, 'asio-enabled'), asio ? '1' : '0')
  run('cmake', ['-S', path.join(vendor, 'portaudio'), '-B', path.join(vendor, 'build'), ...(win ? ['-A', 'x64'] : []),
    '-DCMAKE_POLICY_VERSION_MINIMUM=3.5', '-DCMAKE_BUILD_TYPE=Release', '-DPA_BUILD_SHARED=OFF', '-DPA_BUILD_STATIC=ON', '-DPA_BUILD_TESTS=OFF', '-DPA_BUILD_EXAMPLES=OFF', '-DPA_DLL_LINK_WITH_STATIC_RUNTIME=ON',
    `-DPA_USE_ASIO=${asio ? 'ON' : 'OFF'}`, ...(asio ? [`-DASIOSDK_ROOT_DIR=${path.join(vendor, 'asio/ASIOSDK')}`] : [])])
  run('cmake', ['--build', path.join(vendor, 'build'), '--config', 'Release', '--target', 'portaudio_static', '--parallel', '4'])
  const cargoEnv = { ...withStaticMsvcCrt(process.env) }
  // 本机 .cargo/config.toml 的 [env] 可能写着 CC = "cl.exe"（只在开发者命令行里可用），会让 cc 跳过 MSVC 自动定位；
  // 环境里没有显式指定时传空值（cargo 的 [env] 不覆盖已有变量），交给 cc 自己找编译器。
  if (win) { cargoEnv.CC ??= ''; cargoEnv.CXX ??= '' }
  run('cargo', [process.argv.includes('--test') ? 'test' : 'build', '--locked', '--release', '--manifest-path', path.join(crate, 'Cargo.toml')], cargoEnv)
  fs.writeFileSync(path.join(crate, 'target/release/audio-capture-build.json'), JSON.stringify({ asio, sources: SOURCES }, null, 2))
  console.log(`[audio-capture] 构建完成；ASIO=${asio}`)
}
module.exports = { SOURCES }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })

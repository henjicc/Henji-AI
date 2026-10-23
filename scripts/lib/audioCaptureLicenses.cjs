const fs = require('node:fs')
const path = require('node:path')
const { SOURCES } = require('../build-audio-capture.cjs')
// 发布前填写可下载完整对应源码（本程序、构建脚本、锁文件与依赖源码）的公开地址。
const HENJI_AUDIO_CAPTURE_SOURCE_URL = process.env.HENJI_AUDIO_CAPTURE_SOURCE_URL || 'HENJI_AUDIO_CAPTURE_SOURCE_URL（发布前填写）'
function audioCaptureLicenseData(root, platform, strict = false) {
  const read = name => fs.readFileSync(path.join(root, 'scripts/third-party-licenses', name), 'utf8')
  const metadataPath = path.join(root, 'native/audio-capture/target/release/audio-capture-build.json')
  const metadata = fs.existsSync(metadataPath) ? JSON.parse(fs.readFileSync(metadataPath, 'utf8')) : null
  const asio = platform === 'win32' && metadata?.asio === true
  if (strict && platform === 'win32' && !asio) throw new Error('Windows 正式录音引擎必须包含 ASIO；请运行 build:audio-capture -- --require-asio')
  if (strict && !/^https:\/\//.test(HENJI_AUDIO_CAPTURE_SOURCE_URL)) throw new Error('发布前必须设置 HENJI_AUDIO_CAPTURE_SOURCE_URL，指向完整对应源码下载地址')
  const notice = `henji-audio-capture\nCopyright (C) 2026 Henji AI\nGPL-3.0-only；本独立录音程序按 GNU GPL 第三版分发，无担保。\n对应源码 / Complete Corresponding Source: ${HENJI_AUDIO_CAPTURE_SOURCE_URL}\n源码下载须包含本程序、构建脚本、Cargo.lock 与全部链接依赖的对应源码；安装包不包含源码。\nPortAudio ${SOURCES.portaudio.version}: MIT, ${SOURCES.portaudio.url}\nSHA256: ${SOURCES.portaudio.sha256}\nASIO compiled: ${asio}\n${asio ? `ASIO SDK ${SOURCES.asio.version}: 选择 GPLv3 许可，不采用专有许可。\n${SOURCES.asio.url}\nSHA256: ${SOURCES.asio.sha256}\nASIO is a trademark of Steinberg Media Technologies GmbH.\n` : ''}构建入口：node scripts/build-audio-capture.cjs；Windows 使用静态 MSVC CRT。\n`
  return { notice, asio, portaudio: read('PortAudio-MIT.txt'), gpl: read('GPL-3.0.txt'), asioLicense: read('ASIO-SDK-LICENSE.txt') }
}
module.exports = { audioCaptureLicenseData, HENJI_AUDIO_CAPTURE_SOURCE_URL }

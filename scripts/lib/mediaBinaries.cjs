/**
 * 脚本侧（Reality 场景、基准、样本生成）FFmpeg CLI 定位，与主进程
 * electron/main/services/video/ffmpeg-loader.ts 同一约定（重要记录 014）：
 * - Windows：原生解码服务同一份 BtbN 9.0 GPL 共享构建的 bin 目录（scripts/video-decoder-ffmpeg.cjs 固定版本）。
 * - 其他平台：维持 ffmpeg-ffprobe-static。
 */
const fs = require('node:fs')
const path = require('node:path')

function locate() {
  if (process.platform === 'win32') {
    const { ffmpegBinDir } = require('../video-decoder-ffmpeg.cjs')
    return { binDir: ffmpegBinDir, ffmpegPath: path.join(ffmpegBinDir, 'ffmpeg.exe'), ffprobePath: path.join(ffmpegBinDir, 'ffprobe.exe') }
  }
  const { ffmpegPath, ffprobePath } = require('ffmpeg-ffprobe-static')
  return { binDir: ffmpegPath ? path.dirname(ffmpegPath) : null, ffmpegPath, ffprobePath }
}

const located = locate()

function checked(binary) {
  if (!binary || !fs.existsSync(binary)) {
    throw new Error(`FFmpeg CLI 不可用：${binary ?? '(当前平台无)'}。请先运行 node scripts/video-decoder-ffmpeg.cjs ensure（或 npm run prepare:media-binaries）。`)
  }
  return binary
}

module.exports = {
  get binDir() { return located.binDir },
  get ffmpegPath() { return checked(located.ffmpegPath) },
  get ffprobePath() { return checked(located.ffprobePath) },
}

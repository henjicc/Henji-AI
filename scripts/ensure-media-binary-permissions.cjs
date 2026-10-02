const fs = require('node:fs')

// 媒体二进制就绪检查（postinstall / electron:dev / electron:build / electron:bundle 共用入口）。
if (process.platform === 'win32') {
  // Windows 只用原生解码服务同一份 FFmpeg（重要记录 014）：缺失时下载并校验，写入开发定位指针。
  const { ensureFfmpeg, isSupportedPlatform } = require('./video-decoder-ffmpeg.cjs')
  if (isSupportedPlatform()) {
    ensureFfmpeg()
      .then((directory) => console.log(`[media-binaries] FFmpeg 已就绪：${directory}`))
      .catch((error) => {
        console.error(`[media-binaries] ${error instanceof Error ? error.message : String(error)}`)
        process.exitCode = 1
      })
  }
} else {
  const { ffmpegPath, ffprobePath } = require('ffmpeg-ffprobe-static')
  const binaries = [
    ffmpegPath,
    ffprobePath,
  ]
  for (const binaryPath of binaries) {
    if (!binaryPath) throw new Error('当前平台没有可用的 ffmpeg / ffprobe 二进制')
    fs.chmodSync(binaryPath, 0o755)
    fs.accessSync(binaryPath, fs.constants.X_OK)
  }
  console.log('[media-binaries] ffmpeg / ffprobe 可执行权限已确认。')
}

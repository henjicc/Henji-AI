const fs = require('node:fs')

if (process.platform !== 'win32') {
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

/**
 * electron-builder afterPack 钩子（electron-builder.yml `afterPack`）：解包目录生成后、制作安装包前核对随包资源，
 * 不符即中止打包。核对内容见 scripts/lib/packagedResources.cjs（任务 3.3）。
 */

const path = require('node:path')
const { listPackage } = require('@electron/asar')
const { VIDEO_DECODER_EXECUTABLE, verifyPackagedResources } = require('./lib/packagedResources.cjs')

const root = path.resolve(__dirname, '..')

function videoDecoderSources() {
  const { FFMPEG_BUILD, crateDir, isReady, runtimeFiles } = require('./video-decoder-ffmpeg.cjs')
  if (!isReady()) throw new Error('FFmpeg 尚未就绪，无法核对随包原生解码服务（先运行 npm run build:video-decoder）')
  const releaseDir = path.join(crateDir, 'target', 'release')
  return {
    ffmpegVersion: FFMPEG_BUILD.version,
    sources: [
      { name: VIDEO_DECODER_EXECUTABLE, source: path.join(releaseDir, VIDEO_DECODER_EXECUTABLE) },
      // 随包文件来自 target/release（build:video-decoder 从 BtbN 包复制），以 BtbN 包原件为准核对。
      ...runtimeFiles().map((file) => ({ name: path.basename(file), source: file })),
    ],
  }
}

module.exports = async function afterPack(context) {
  const platform = context.electronPlatformName
  const windows = platform === 'win32'
  const decoder = windows ? videoDecoderSources() : { sources: [], ffmpegVersion: undefined }
  const problems = verifyPackagedResources({
    appOutDir: context.appOutDir,
    platform,
    productFilename: context.packager.appInfo.productFilename,
    videoDecoderSources: decoder.sources,
    ffmpegVersion: decoder.ffmpegVersion,
    listAsar: (asarPath) => listPackage(asarPath, { isPack: false }),
  })
  if (problems.length > 0) {
    throw new Error(`随包资源核对失败（${path.relative(root, context.appOutDir) || context.appOutDir}）：\n  - ${problems.join('\n  - ')}`)
  }
  console.log(`  • [after-pack] 随包资源核对通过（${platform}${windows ? `：原生解码服务与 FFmpeg ${decoder.sources.length} 个文件、许可文件` : '：许可文件'}）`)
}

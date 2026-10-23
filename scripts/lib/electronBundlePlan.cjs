const path = require('node:path')

function buildElectronBundlePlan(root) {
  return [
    { label: '媒体二进制权限', command: process.execPath, args: [path.join(root, 'scripts/ensure-media-binary-permissions.cjs')] },
    // 与 npm run build:video-decoder 同一入口：FFmpeg 已就绪时不重复下载，cargo 增量构建；非 Windows 自动跳过。
    { label: '构建原生视频解码服务', command: process.execPath, args: [path.join(root, 'scripts/video-decoder-ffmpeg.cjs'), 'build'] },
    // 音频处理程序（频谱、修复、去爆音）随运行产物一起增量构建：Rust 源码改了而程序没重编时，主进程会用旧程序算出错误结果。
    { label: '构建音频处理程序', command: process.execPath, args: [path.join(root, 'scripts/build-audio-worker.cjs')] },
    { label: '构建原生录音引擎', command: process.execPath, args: [path.join(root, 'scripts/build-audio-capture.cjs')] },
    // 第三方许可清单在 FFmpeg 就绪后生成（读取包内许可与构建配置）；渲染层“关于”页面与安装包共用这份产物。
    { label: '生成第三方许可清单', command: process.execPath, args: [path.join(root, 'scripts/generate-third-party-licenses.cjs')] },
    { label: '生成进度种子', command: process.execPath, args: [path.join(root, 'scripts/generate-progress-seeds.cjs')] },
    { label: '生成模型目录索引', command: process.execPath, args: [path.join(root, 'scripts/generate-catalog-index.cjs')] },
    { label: '准备 SDK 产物', command: process.execPath, args: [path.join(root, 'scripts/build-sdk-if-needed.cjs')] },
    {
      label: '构建 Electron main/preload/renderer',
      command: process.execPath,
      // electron-vite build 总把 NODE_ENV 固定为 production；开发巡检产物用 HENJI_BUNDLE_MODE=development 传 --mode，
      // 渲染层以 import.meta.env.MODE 判断（Vite 静态替换，正式构建仍可裁掉开发页）。
      args: [path.join(root, 'node_modules/electron-vite/bin/electron-vite.js'), 'build', ...(process.env.HENJI_BUNDLE_MODE ? ['--mode', process.env.HENJI_BUNDLE_MODE] : [])],
    },
  ]
}

module.exports = { buildElectronBundlePlan }

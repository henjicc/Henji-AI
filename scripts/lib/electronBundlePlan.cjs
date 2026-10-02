const path = require('node:path')

function buildElectronBundlePlan(root) {
  return [
    { label: '媒体二进制权限', command: process.execPath, args: [path.join(root, 'scripts/ensure-media-binary-permissions.cjs')] },
    // 与 npm run build:video-decoder 同一入口：FFmpeg 已就绪时不重复下载，cargo 增量构建；非 Windows 自动跳过。
    { label: '构建原生视频解码服务', command: process.execPath, args: [path.join(root, 'scripts/video-decoder-ffmpeg.cjs'), 'build'] },
    // 第三方许可清单在 FFmpeg 就绪后生成（读取包内许可与构建配置）；渲染层“关于”页面与安装包共用这份产物。
    { label: '生成第三方许可清单', command: process.execPath, args: [path.join(root, 'scripts/generate-third-party-licenses.cjs')] },
    { label: '生成进度种子', command: process.execPath, args: [path.join(root, 'scripts/generate-progress-seeds.cjs')] },
    { label: '生成模型目录索引', command: process.execPath, args: [path.join(root, 'scripts/generate-catalog-index.cjs')] },
    { label: '准备 SDK 产物', command: process.execPath, args: [path.join(root, 'scripts/build-sdk-if-needed.cjs')] },
    {
      label: '构建 Electron main/preload/renderer',
      command: process.execPath,
      args: [path.join(root, 'node_modules/electron-vite/bin/electron-vite.js'), 'build'],
    },
  ]
}

module.exports = { buildElectronBundlePlan }

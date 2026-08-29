const path = require('node:path')

function buildElectronBundlePlan(root) {
  return [
    { label: '媒体二进制权限', command: process.execPath, args: [path.join(root, 'scripts/ensure-media-binary-permissions.cjs')] },
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

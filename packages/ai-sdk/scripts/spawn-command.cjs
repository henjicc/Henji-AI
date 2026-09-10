const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')

// Windows 的 npm 是 .cmd，不能直接用无 shell 的 spawnSync 启动。
// 调用 npm CLI 的 JS 入口，保留参数数组，避免路径和参数经过 shell 二次解析。
function spawnSync(command, args, options) {
  if (command === 'npm' && process.platform === 'win32') {
    const cli = process.env.npm_execpath
      ?? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (!fs.existsSync(cli)) throw new Error(`找不到 npm CLI：${cli}；请从 npm run 执行发布门禁`)
    return childProcess.spawnSync(process.execPath, [cli, ...args], options)
  }
  return childProcess.spawnSync(command, args, options)
}

module.exports = { spawnSync }

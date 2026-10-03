/**
 * 自动化启动的目标解析（scripts/lib/electronLaunch.cjs 使用，无重依赖，便于单测）。
 *
 * 默认：仓库 node_modules 里的 Electron + out/ 构建产物（主入口或 appPath），行为与以往完全相同。
 * 可选：`executablePath` 参数或 `HENJI_ELECTRON_EXECUTABLE` 环境变量指向打包产物的可执行文件
 * （如 release/win-unpacked/痕迹AI.exe），用于在安装包内容上跑同一套场景（任务 3.3/3.2）。此时：
 *   - 不传主入口/appPath——打包产物加载自己的 app.asar；
 *   - 不检查 out/ 的构建新鲜度（打包产物不读 out/）；
 *   - 工作目录默认改为可执行文件所在目录，避免进程借仓库 cwd 找到开发目录下的依赖。
 */

const fs = require('node:fs')
const path = require('node:path')

const PACKAGED_EXECUTABLE_ENV = 'HENJI_ELECTRON_EXECUTABLE'

function resolveLaunchTarget({ executablePath = null, defaultExecutable, mainEntry, appPath = null, cwd, env = process.env, exists = fs.existsSync }) {
  const requested = executablePath ?? (env[PACKAGED_EXECUTABLE_ENV]?.trim() || null)
  if (!requested) {
    return { packaged: false, executable: defaultExecutable, entryArgs: [appPath ?? mainEntry], cwd }
  }
  const executable = path.resolve(requested)
  if (!exists(executable)) {
    throw new Error(`打包产物可执行文件不存在：${executable}（来自 ${executablePath ? 'executablePath 参数' : PACKAGED_EXECUTABLE_ENV}）`)
  }
  return { packaged: true, executable, entryArgs: [], cwd: path.dirname(executable) }
}

module.exports = { PACKAGED_EXECUTABLE_ENV, resolveLaunchTarget }

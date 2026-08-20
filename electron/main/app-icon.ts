import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

function isReadableFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

// 窗口图标在开发态取仓库 resources/，打包态取随包 resources/ 副本
function iconCandidates(fileName: string): string[] {
  const roots = [app.getAppPath(), process.resourcesPath]
  return roots
    .filter((root): root is string => typeof root === 'string' && root.length > 0)
    .map((root) => path.join(root, 'resources', 'icons', fileName))
}

/**
 * 解析应用窗口图标路径。Windows 优先 .ico（任务栏/托盘多尺寸），其余平台用 png。
 * 找不到时返回 undefined，由 Electron 回退到默认图标，不阻塞窗口创建。
 */
export function resolveAppIconPath(): string | undefined {
  const fileNames = process.platform === 'win32' ? ['icon.ico', 'icon.png'] : ['icon.png']
  for (const fileName of fileNames) {
    const found = iconCandidates(fileName).find(isReadableFile)
    if (found) return found
  }
  return undefined
}

/**
 * 开发态 macOS 不会从 electron-builder 的 mac.icon 配置读取 Dock 图标，
 * 因此在应用就绪后显式复用仓库里的图标。打包态仍由 icon.icns 负责应用图标。
 */
export function configureMacDockIcon(): void {
  if (process.platform !== 'darwin') return
  const iconPath = resolveAppIconPath()
  if (!iconPath) return
  app.dock?.setIcon(iconPath)
}

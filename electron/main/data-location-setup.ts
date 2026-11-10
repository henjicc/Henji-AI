import { app, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import { DATA_ROOT_FOLDER, getDefaultDataRoot, hasDataAt, writeDataLocation } from './services/appBasePaths'
import { USER_ROOT_FOLDER_NAMES } from './services/appPaths'

/*
 * 数据目录还没确定时（全新安装，或位置文件丢失而默认位置没有数据）的启动选择。
 * 发生在主窗口与数据库之前，只用系统对话框；选定后写位置文件并重新启动，正常启动流程从头按新位置走。
 * 这里不打开数据库、不写日志：此刻还没有可写的数据目录。
 */

const TEXT = {
  zh: {
    title: '痕迹AI',
    message: '选择数据目录',
    detail: (root: string) => `项目、生成结果、设置与密钥都保存在数据目录里。\n\n默认位置：${root}\n\n以前用过痕迹AI、想继续用原来的数据，请选“打开已有的数据目录”。`,
    createDefault: '在默认位置新建',
    createElsewhere: '选择其他位置新建…',
    openExisting: '打开已有的数据目录…',
    quit: '退出',
    ok: '好',
    pickNew: '选择放数据目录的文件夹',
    pickExisting: '选择已有的数据目录（HenjiAI 文件夹）',
    notData: (folder: string) => `这个文件夹里没有痕迹AI的数据：\n${folder}\n\n请选择以前的数据目录（一般叫 HenjiAI，里面有 Projects、Generated 等文件夹）。`,
    failed: (reason: string) => `没能使用这个位置：${reason}`,
  },
  en: {
    title: 'Henji AI',
    message: 'Choose a data folder',
    detail: (root: string) => `Projects, generated results, settings and keys are all stored in the data folder.\n\nDefault location: ${root}\n\nIf you used Henji AI before and want your existing data, choose “Open an existing data folder”.`,
    createDefault: 'Create at default location',
    createElsewhere: 'Create somewhere else…',
    openExisting: 'Open an existing data folder…',
    quit: 'Quit',
    ok: 'OK',
    pickNew: 'Choose where to put the data folder',
    pickExisting: 'Choose an existing data folder (the HenjiAI folder)',
    notData: (folder: string) => `No Henji AI data was found in:\n${folder}\n\nChoose your previous data folder (usually named HenjiAI, containing Projects, Generated, …).`,
    failed: (reason: string) => `Couldn't use this location: ${reason}`,
  },
} as const

function isEmptyOrMissing(folder: string): boolean {
  try { return fs.readdirSync(folder).length === 0 } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' }
}

/** 用户选的文件夹：本身是数据目录或其上一级里有数据目录就用那一份；否则空文件夹直接用，有内容的在里面新建 HenjiAI。 */
export function resolveChosenDataRoot(folder: string): { root: string; existing: boolean } {
  const chosen = path.resolve(folder)
  const nested = path.join(chosen, DATA_ROOT_FOLDER)
  if (hasDataAt(chosen)) return { root: chosen, existing: true }
  for (const name of USER_ROOT_FOLDER_NAMES) {
    if (hasDataAt(path.join(chosen, name))) return { root: path.join(chosen, name), existing: true }
  }
  const usable = path.basename(chosen).toLowerCase() === DATA_ROOT_FOLDER.toLowerCase() || isEmptyOrMissing(chosen)
  return { root: usable ? chosen : nested, existing: false }
}

async function pickFolder(title: string): Promise<string | null> {
  const result = await dialog.showOpenDialog({ title, properties: ['openDirectory', 'createDirectory'] })
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

/** 让用户确定数据目录并写下位置；返回 false 表示用户选择退出。 */
export async function runDataLocationSetup(): Promise<boolean> {
  const text = app.getLocale().toLowerCase().startsWith('zh') ? TEXT.zh : TEXT.en
  const defaultRoot = getDefaultDataRoot()
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: text.title,
      message: text.message,
      detail: text.detail(defaultRoot),
      buttons: [text.createDefault, text.createElsewhere, text.openExisting, text.quit],
      defaultId: 0,
      cancelId: 3,
      noLink: true,
    })
    if (response === 3) return false
    let root = defaultRoot
    if (response !== 0) {
      const folder = await pickFolder(response === 1 ? text.pickNew : text.pickExisting)
      if (!folder) continue
      const resolved = resolveChosenDataRoot(folder)
      if (response === 2 && !resolved.existing) {
        await dialog.showMessageBox({ type: 'warning', title: text.title, message: text.notData(folder), buttons: [text.ok] })
        continue
      }
      root = resolved.root
    }
    try {
      fs.mkdirSync(root, { recursive: true })
      // 确认这里真的能写：选到只读位置时现在就说，不要等重启后每次都启动失败。
      const probe = path.join(root, `.write-test-${process.pid}`)
      fs.writeFileSync(probe, '')
      fs.rmSync(probe, { force: true })
      writeDataLocation({ root })
      return true
    } catch (error) {
      await dialog.showMessageBox({ type: 'error', title: text.title, message: text.failed(error instanceof Error ? error.message : String(error)), buttons: [text.ok] })
    }
  }
}

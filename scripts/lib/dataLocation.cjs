'use strict'
/**
 * 脚本侧读取数据目录位置，与主进程 electron/main/services/appBasePaths.ts 同一套规则：
 * HENJI_DATA_ROOT > 用户主目录的位置文件 > 默认的 <主目录>/Documents/HenjiAI。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function readDataLocation() {
  const explicit = process.env.HENJI_DATA_ROOT && process.env.HENJI_DATA_ROOT.trim()
  if (explicit) return { root: path.resolve(explicit) }
  try {
    const value = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.henji-ai', 'location.json'), 'utf8'))
    if (typeof value.root === 'string' && path.isAbsolute(value.root)) {
      return { root: value.root, systemDir: typeof value.systemDir === 'string' ? value.systemDir : undefined }
    }
  } catch { /* 没有位置文件时用默认位置。 */ }
  return { root: path.join(os.homedir(), 'Documents', 'HenjiAI') }
}

/** 程序资料目录（数据库、日志等）。 */
function getProgramDataDir() {
  const location = readDataLocation()
  return location.systemDir || path.join(location.root, '.system')
}

module.exports = { readDataLocation, getProgramDataDir }

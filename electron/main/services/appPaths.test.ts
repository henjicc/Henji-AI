import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  base: '',
  languages: ['zh-CN'] as string[],
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => path.join(state.base, name),
    getPreferredSystemLanguages: () => state.languages,
    getLocale: () => state.languages[0] ?? '',
  },
}))
vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os')>()
  return { ...actual, default: { ...actual, homedir: () => path.join(state.base, 'home') }, homedir: () => path.join(state.base, 'home') }
})
vi.mock('./logging/main-logger', () => ({
  createMainLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { beginDataLocationSetup, completePendingSystemMove, inspectDataLocation, readDataLocation, writeDataLocation } from './appBasePaths'
import {
  getAppDirectories,
  getProgramDataDir,
  getProgramStoreDir,
  getUserDataLayout,
  getUserFolderDir,
  resetAppPathsForTest,
  setUserFolderLanguageHint,
} from './appPaths'

const FOLDERS = ['Projects', 'Generated', 'Uploads', 'Exports', 'Skills']
const locationFile = (): string => path.join(state.base, 'home', '.henji-ai', 'location.json')
const readLocationFile = (): Record<string, unknown> => JSON.parse(fs.readFileSync(locationFile(), 'utf8')) as Record<string, unknown>

describe('数据目录位置', () => {
  beforeEach(() => {
    state.base = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-app-paths-'))
    state.languages = ['zh-CN']
    resetAppPathsForTest()
    vi.stubEnv('HENJI_DATA_ROOT', '')
    vi.stubEnv('HENJI_ISOLATED_APP_DATA', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    fs.rmSync(state.base, { recursive: true, force: true })
  })

  it('新安装：位置由用户决定，不悄悄在默认位置建数据；选定后建英文分类文件夹，程序资料在其中的 .system', () => {
    const root = path.join(state.base, 'documents', 'HenjiAI')
    expect(inspectDataLocation()).toBe('needs_choice')
    expect(fs.existsSync(locationFile())).toBe(false)

    fs.mkdirSync(root, { recursive: true })
    writeDataLocation({ root })
    expect(inspectDataLocation()).toBe('ready')
    const layout = getUserDataLayout()
    expect(layout.root).toBe(root)
    expect(layout.isCustom).toBe(false)
    expect(layout.locale).toBe('zh')
    for (const name of FOLDERS) expect(fs.statSync(path.join(root, name)).isDirectory()).toBe(true)
    expect(getProgramDataDir()).toBe(path.join(root, '.system'))
    expect(getProgramStoreDir('logs')).toBe(path.join(root, '.system', 'logs'))
    expect(readLocationFile()).toMatchObject({ root, locale: 'zh' })
    expect(getAppDirectories().folderNames.generated).toBe('Generated')
  })

  it('位置文件丢失：默认位置已有数据就直接用并补写位置文件', () => {
    const root = path.join(state.base, 'documents', 'HenjiAI')
    fs.mkdirSync(path.join(root, '.system'), { recursive: true })
    fs.writeFileSync(path.join(root, '.system', 'henji.db'), 'db')
    expect(inspectDataLocation()).toBe('ready')
    expect(readLocationFile()).toMatchObject({ root })
  })

  it('位置文件读不懂：交给用户决定，原文件不被覆盖', () => {
    fs.mkdirSync(path.dirname(locationFile()), { recursive: true })
    fs.writeFileSync(locationFile(), '{ 坏掉的内容')
    expect(inspectDataLocation()).toBe('needs_choice')
    expect(getProgramDataDir()).toBe(path.join(state.base, 'documents', 'HenjiAI', '.system'))
    expect(fs.readFileSync(locationFile(), 'utf8')).toBe('{ 坏掉的内容')
  })

  it('位置文件读不懂时即使默认位置有数据也由用户决定；选定后原文件另存一份', () => {
    const root = path.join(state.base, 'documents', 'HenjiAI')
    fs.mkdirSync(path.join(root, '.system'), { recursive: true })
    fs.writeFileSync(path.join(root, '.system', 'henji.db'), 'db')
    fs.mkdirSync(path.dirname(locationFile()), { recursive: true })
    fs.writeFileSync(locationFile(), '{ 坏掉的内容')
    expect(inspectDataLocation()).toBe('needs_choice')
    getUserDataLayout()
    expect(fs.readFileSync(locationFile(), 'utf8')).toBe('{ 坏掉的内容')

    writeDataLocation({ root })
    expect(fs.readFileSync(`${locationFile()}.bad`, 'utf8')).toBe('{ 坏掉的内容')
    expect(inspectDataLocation()).toBe('ready')
  })

  it('位置文件指向的数据目录已经不在了：由用户决定', () => {
    fs.mkdirSync(path.dirname(locationFile()), { recursive: true })
    fs.writeFileSync(locationFile(), JSON.stringify({ version: 1, root: path.join(state.base, '拔掉的盘', 'HenjiAI') }))
    expect(inspectDataLocation()).toBe('needs_choice')
  })

  it('等用户选数据目录期间位置指向临时文件夹；没走启动流程的进程不会写出位置文件', () => {
    expect(getUserDataLayout().root).toBe(path.join(state.base, 'documents', 'HenjiAI'))
    expect(fs.existsSync(locationFile())).toBe(false)
    resetAppPathsForTest()
    const temporary = beginDataLocationSetup()
    expect(getProgramDataDir()).toBe(path.join(temporary, '.system'))
    expect(fs.existsSync(locationFile())).toBe(false)
    fs.rmSync(temporary, { recursive: true, force: true })
  })

  it('起名语言按界面语言确定一次，分类文件夹名不随它变化', () => {
    writeDataLocation({ root: path.join(state.base, 'documents', 'HenjiAI') })
    state.languages = ['zh-CN']
    setUserFolderLanguageHint('en-US')
    expect(getUserDataLayout().locale).toBe('en')
    resetAppPathsForTest()
    setUserFolderLanguageHint('zh-CN')
    const layout = getUserDataLayout()
    expect(layout.locale).toBe('en')
    expect(path.basename(getUserFolderDir('uploads'))).toBe('Uploads')
  })

  it('位置文件指向别处时用它，默认位置变化不影响已有数据', () => {
    const root = path.join(state.base, '数据盘', 'HenjiAI')
    fs.mkdirSync(path.dirname(locationFile()), { recursive: true })
    fs.writeFileSync(locationFile(), JSON.stringify({ version: 1, root, locale: 'zh' }))
    const layout = getUserDataLayout()
    expect(layout.root).toBe(root)
    expect(layout.isCustom).toBe(true)
    expect(getProgramDataDir()).toBe(path.join(root, '.system'))
  })

  it('更换数据目录后程序资料先留在原处，下次启动搬进新目录并删掉旧目录空壳', () => {
    const oldRoot = path.join(state.base, 'old', 'HenjiAI')
    const newRoot = path.join(state.base, 'new', 'HenjiAI')
    const oldSystem = path.join(oldRoot, '.system')
    fs.mkdirSync(oldSystem, { recursive: true })
    fs.writeFileSync(path.join(oldSystem, 'henji.db'), 'db')
    writeDataLocation({ root: newRoot, systemDir: oldSystem, locale: 'zh' })

    expect(getProgramDataDir()).toBe(oldSystem)
    expect(completePendingSystemMove()).toEqual({ from: oldSystem, to: path.join(newRoot, '.system') })
    expect(fs.readFileSync(path.join(newRoot, '.system', 'henji.db'), 'utf8')).toBe('db')
    expect(fs.existsSync(oldRoot)).toBe(false)
    expect(readDataLocation()).toEqual({ root: newRoot, locale: 'zh' })
    expect(readLocationFile()).not.toHaveProperty('systemDir')
    expect(completePendingSystemMove()).toBeNull()
  })

  it('指定了隔离数据目录时不读写用户主目录的位置文件', () => {
    const isolated = path.join(state.base, 'isolated')
    vi.stubEnv('HENJI_DATA_ROOT', isolated)
    expect(getUserDataLayout().root).toBe(isolated)
    expect(getProgramDataDir()).toBe(path.join(isolated, '.system'))
    expect(fs.existsSync(locationFile())).toBe(false)
  })
})

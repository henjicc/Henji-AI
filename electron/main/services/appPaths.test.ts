import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  base: '',
  languages: ['zh-CN'] as string[],
  settings: new Map<string, string>(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => path.join(state.base, name),
    getPreferredSystemLanguages: () => state.languages,
    getLocale: () => state.languages[0] ?? '',
  },
}))
vi.mock('./dataRoot', () => ({
  readUserDataRootSettings: () => ({
    customRoot: state.settings.get('custom_data_directory') ?? null,
    persistedDefault: state.settings.get('user_data_root') ?? null,
  }),
  writePersistedDefaultUserDataRoot: (value: string) => { state.settings.set('user_data_root', value) },
}))
vi.mock('./logging/main-logger', () => ({
  createMainLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import {
  getAppDirectories,
  getProgramDataDir,
  getProgramStoreDir,
  getUserDataLayout,
  getUserFolderDir,
  resetAppPathsForTest,
  resolveUserDataLayout,
  setUserFolderLanguageHint,
} from './appPaths'

const ZH_FOLDERS = ['项目', '图片文档', '生成结果', '上传素材', '导出', '助手技能']
const EN_FOLDERS = ['Projects', 'Image Documents', 'Generated', 'Uploads', 'Exports', 'Assistant Skills']

describe('应用目录唯一来源', () => {
  beforeEach(() => {
    state.base = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-app-paths-'))
    state.languages = ['zh-CN']
    state.settings.clear()
    resetAppPathsForTest()
    vi.stubEnv('HENJI_ISOLATED_APP_DATA', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    fs.rmSync(state.base, { recursive: true, force: true })
  })

  it('中文系统新安装：文档/痕迹AI 下建立中文分类文件夹并记住选择', () => {
    const layout = getUserDataLayout()
    const expectedRoot = path.join(state.base, 'documents', '痕迹AI')
    expect(layout.root).toBe(expectedRoot)
    expect(layout.isCustom).toBe(false)
    expect(fs.readdirSync(expectedRoot).sort()).toEqual([...ZH_FOLDERS].sort())
    expect(JSON.parse(state.settings.get('user_data_root') ?? '')).toEqual({ root: expectedRoot, locale: 'zh' })
    expect(getUserFolderDir('generated')).toBe(path.join(expectedRoot, '生成结果'))
  })

  it('英文界面新安装：文档/Henji AI 下建立英文分类文件夹', () => {
    state.languages = ['zh-CN']
    setUserFolderLanguageHint('en-US')
    const layout = getUserDataLayout()
    const expectedRoot = path.join(state.base, 'documents', 'Henji AI')
    expect(layout.root).toBe(expectedRoot)
    expect(fs.readdirSync(expectedRoot).sort()).toEqual([...EN_FOLDERS].sort())
    expect(layout.folders.uploads).toBe(path.join(expectedRoot, 'Uploads'))
  })

  it('首次确定后不随界面语言变化', () => {
    const first = getUserDataLayout()
    resetAppPathsForTest()
    state.languages = ['en-US']
    setUserFolderLanguageHint('en-US')
    const second = getUserDataLayout()
    expect(second.root).toBe(first.root)
    expect(second.folders).toEqual(first.folders)
    expect(fs.existsSync(path.join(state.base, 'documents', 'Henji AI'))).toBe(false)
  })

  it('设置了数据目录时分类文件夹建在该目录下，默认目录仍记录在案', () => {
    const custom = path.join(state.base, 'custom root')
    state.settings.set('custom_data_directory', custom)
    const directories = getAppDirectories()
    expect(directories.userRoot).toBe(custom)
    expect(directories.isCustomUserRoot).toBe(true)
    expect(directories.defaultUserRoot).toBe(path.join(state.base, 'documents', '痕迹AI'))
    expect(fs.readdirSync(custom).sort()).toEqual([...ZH_FOLDERS].sort())
    expect(directories.folders.skills).toBe(path.join(custom, '助手技能'))
  })

  it('内部数据留在程序目录，不随用户目录移动', () => {
    state.settings.set('custom_data_directory', path.join(state.base, 'custom'))
    const directories = getAppDirectories()
    expect(directories.programDir).toBe(getProgramDataDir())
    expect(directories.thumbnailsDir).toBe(path.join(getProgramDataDir(), 'Thumbnails'))
    expect(getProgramStoreDir('imageEditor')).toBe(path.join(getProgramDataDir(), 'ImageEditorV3'))
    expect(directories.thumbnailsDir.startsWith(directories.userRoot)).toBe(false)
  })

  it('隔离资料目录下不写系统真实“文档”', () => {
    const isolated = path.join(state.base, 'isolated')
    vi.stubEnv('HENJI_ISOLATED_APP_DATA', isolated)
    expect(getUserDataLayout().root).toBe(path.join(isolated, 'Documents', '痕迹AI'))
    expect(fs.existsSync(path.join(state.base, 'documents'))).toBe(false)
  })

  it('程序目录：Windows 用 LOCALAPPDATA，其他平台用 appData', () => {
    const local = path.join(state.base, 'local')
    vi.stubEnv('LOCALAPPDATA', local)
    const expected = process.platform === 'win32'
      ? path.join(local, 'com.henji.ai', 'Henji-AI')
      : path.join(state.base, 'appData', 'com.henji.ai', 'Henji-AI')
    expect(getProgramDataDir()).toBe(expected)
  })

  it('已记录的设置损坏时重新确定，而不是返回非法路径', () => {
    const resolved = resolveUserDataLayout({
      customRoot: null,
      persisted: null,
      documentsDir: () => path.join(state.base, 'docs'),
      languages: () => [undefined, '', 'en-GB'],
    })
    expect(resolved.persist).toEqual({ root: path.join(state.base, 'docs', 'Henji AI'), locale: 'en' })
    state.settings.set('user_data_root', '{"root":"relative","locale":"zh"}')
    expect(getUserDataLayout().root).toBe(path.join(state.base, 'documents', '痕迹AI'))
  })
})

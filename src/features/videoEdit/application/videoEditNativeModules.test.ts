import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { prepareVideoEditNativeModules } from './videoEditNativeModules'
import { directAuthorBundle, installAuthorNativeModules, prepareAuthorModuleUrls } from '../engine/videoEditAuthorModules'

const state = vi.hoisted(() => ({ directory: '' }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ system: {
  paths: { tempDir: async () => state.directory, join: async (...parts: string[]) => path.join(...parts) },
  fs: { mkdir: fs.mkdir, writeTextFile: fs.writeFile, remove: (target: string) => fs.rm(target, { recursive: true, force: true }) },
} }) }))
vi.mock('@/services/imageSource', () => ({ toFetchableMediaUrl: (target: string) => pathToFileURL(target).href }))
beforeEach(async () => { state.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-module-test-')); installAuthorNativeModules(prepareVideoEditNativeModules) })
afterEach(async () => { await fs.rm(state.directory, { recursive: true, force: true }) })

it('循环 ESM 保留实时绑定、动态模块与顶层 await，不启动转译器，释放后删除临时图', async () => {
  const files = { entry: 'main.js', files: {
    'main.js': 'import { value } from "./b.js"; export let count=2; export function increment(){count++} export const result=()=>value(); export const lazy=name=>import(`./${name}.js`); await Promise.resolve();',
    'b.js': 'import { count } from "./main.js"; export const value=()=>count*3;',
  } }
  const loaded = await prepareAuthorModuleUrls(directAuthorBundle(files)!)
  // 独立 Node 原生 ESM 实际求值，避免 Vitest 的模块改写替我们处理循环。
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', 'const m=await import(process.argv[1]);const first=m.result();m.increment();console.log(JSON.stringify([first,(await m.lazy("b")).value()]));', loaded.url])
  expect(JSON.parse(result.stdout)).toEqual([6, 9])
  expect(Object.values(files.files).every(source => !source.includes('file:'))).toBe(true)
  loaded.dispose(); loaded.dispose()
  await vi.waitFor(async () => expect(await fs.readdir(path.join(state.directory, 'henji-code-modules'))).toEqual([]))
})

it('图中缺失文件不会留下临时文件', async () => {
  await expect(prepareVideoEditNativeModules({ entry: 'main.js', files: { 'main.js': 'import "./missing.js"' } })).rejects.toThrow('找不到模块')
  expect(await fs.readdir(path.join(state.directory, 'henji-code-modules'))).toEqual([])
})

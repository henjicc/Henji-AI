import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { computeRenderEngineVersion } from './renderEngineVersion.mjs'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'render-engine-'))
  const write = (file, text) => fs.writeFileSync(path.join(root, file), text)
  write('entry.ts', "import { blend } from './dep'\nexport const draw = (value: number): number => blend(value)\n")
  write('dep.ts', 'export function blend(value: number): number {\n  return value * 2\n}\n')
  write('session.ts', "import { helper } from './appOnly'\nexport const run = () => helper()\n")
  write('appOnly.ts', 'export const helper = () => 1\n')
  write('outside.ts', 'export const unrelated = 1\n')
  return { root, write, version: async () => (await computeRenderEngineVersion({ root, closures: ['entry.ts'], files: ['session.ts'] })).version }
}

test('闭包内的运行逻辑变了版本就变；只改注释、空白或类型不变', async t => {
  const { root, write, version } = fixture()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const initial = await version()
  write('dep.ts', '// 混合两层\nexport function blend(value: number):   number {\n\n  /* 乘二 */ return value * 2 // 原样\n}\n')
  assert.equal(await version(), initial)
  write('dep.ts', 'export function blend(value: number): number {\n  return value * 3\n}\n')
  assert.notEqual(await version(), initial)
})

test('闭包外的文件，以及只散列自身的文件所引用的文件，改了都不影响版本', async t => {
  const { root, write, version } = fixture()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const initial = await version()
  write('outside.ts', 'export const unrelated = 2\n')
  write('appOnly.ts', 'export const helper = () => 2\n')
  assert.equal(await version(), initial)
  write('session.ts', "import { helper } from './appOnly'\nexport const run = () => helper() + 1\n")
  assert.notEqual(await version(), initial)
})

test('闭包止于边界：日志经平台桥接引到的 IPC 适配器改了，版本不变', async t => {
  const { root, write } = fixture()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'src/core/logging'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src/platform/adapters/electron'), { recursive: true })
  write('src/core/logging/index.ts', "import { getPlatform } from '@/platform/runtime'\nexport const createLogger = () => getPlatform()\n")
  write('src/platform/runtime.ts', "import { adapter } from './adapters/electron/index'\nexport const getPlatform = () => adapter\n")
  write('src/platform/adapters/electron/index.ts', 'export const adapter = { updater: 1 }\n')
  write('entry.ts', "import { createLogger } from '@/core/logging'\nimport { blend } from './dep'\nexport const draw = (value: number): number => { createLogger(); return blend(value) }\n")
  const version = async () => (await computeRenderEngineVersion({ root, closures: ['entry.ts'], files: [] }))
  const initial = await version()
  assert.ok(!initial.files.some(file => file.includes('adapters')))
  write('src/platform/adapters/electron/index.ts', 'export const adapter = { updater: 2, webReplay: 1 }\n')
  write('src/core/logging/index.ts', "import { getPlatform } from '@/platform/runtime'\nexport const createLogger = () => getPlatform() && 1\n")
  assert.equal((await version()).version, initial.version)
})

test('持久化的迁移实现在闭包里：渲染时会用到，改了版本就变；错误文案仍是边界', async t => {
  const { root, write } = fixture()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'src/core/persistence'), { recursive: true })
  write('src/core/persistence/messages.ts', "export const persistenceMessage = (code: string) => `无法读取：${code}`\n")
  write('src/core/persistence/formatMigrations.ts', "import { persistenceMessage } from './messages'\nexport const formatMigrations = (id: string) => id === 'code-component' ? [(value: unknown) => value] : persistenceMessage(id)\n")
  write('entry.ts', "import { formatMigrations } from '@/core/persistence/formatMigrations'\nexport const expand = () => formatMigrations('code-component')\n")
  const version = async () => (await computeRenderEngineVersion({ root, closures: ['entry.ts'], files: [] })).version
  const initial = await version()
  write('src/core/persistence/messages.ts', "export const persistenceMessage = (code: string) => `读不了：${code}`\n")
  assert.equal(await version(), initial)
  write('src/core/persistence/formatMigrations.ts', "import { persistenceMessage } from './messages'\nexport const formatMigrations = (id: string) => id === 'code-component' ? [(value: unknown) => ({ value })] : persistenceMessage(id)\n")
  assert.notEqual(await version(), initial)
})

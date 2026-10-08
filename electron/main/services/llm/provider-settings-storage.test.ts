import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LlmConfigState } from '@henjicc/ai-sdk'

const state = vi.hoisted(() => ({ root: '' }))
vi.mock('../appPaths', () => ({ getProgramDataDir: () => state.root }))
import { createProviderSettingsFileStorage } from './provider-settings-storage'

beforeEach(async () => { state.root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-config-persistence-')) })
afterEach(async () => { await fsp.rm(state.root, { recursive: true, force: true }) })
const config: LlmConfigState = { providers: [], models: [], promptProfiles: [], textProcessingPromptTemplates: [], agentProfiles: [], tools: [], policy: { allowedTools: [], requireHumanConfirmation: false }, memory: {} }

it('真实原子写入带版本配置与事务记录，读取不改写内容', async () => {
  const storage = createProviderSettingsFileStorage()
  await storage.writeConfig(config)
  const file = path.join(state.root, 'llm-config.json')
  const original = await fsp.readFile(file, 'utf8')
  expect(JSON.parse(original)).toEqual({ version: 1, content: config })
  expect(await storage.readConfig()).toEqual(config)
  expect(await fsp.readFile(file, 'utf8')).toBe(original)
  const journal = { version: 1 as const, configBefore: config, credentialBefore: { storeKey: 'provider:sample', encrypted: null } }
  await storage.writeJournal(journal)
  expect(await storage.readJournal()).toEqual(journal)
})

it('未版本化旧配置、更新版本和损坏JSON分别拒绝，原文件保留', async () => {
  const storage = createProviderSettingsFileStorage()
  const file = path.join(state.root, 'llm-config.json')
  for (const [raw, message] of [[JSON.stringify(config), '旧版本格式'], [JSON.stringify({ version: 2, content: config }), '更新版本'], ['{truncated', '损坏']]) {
    await fsp.writeFile(file, raw)
    await expect(storage.readConfig()).rejects.toThrow(message)
    expect(await fsp.readFile(file, 'utf8')).toBe(raw)
  }
})

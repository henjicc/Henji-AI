import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LlmConfigState } from '@henjicc/ai-sdk'

const state = vi.hoisted(() => ({ root: '' }))
vi.mock('../appPaths', () => ({ getProgramDataDir: () => state.root }))
vi.mock('../recycle/runtime', () => ({ preserveUserFile: vi.fn(async () => {}) }))
import { createProviderSettingsFileStorage } from './provider-settings-storage'

beforeEach(async () => { state.root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-config-persistence-')) })
afterEach(async () => { await fsp.rm(state.root, { recursive: true, force: true }) })
const config: LlmConfigState = { providers: [], models: [], promptProfiles: [], textProcessingPromptTemplates: [], agentProfiles: [], tools: [], policy: { allowedTools: [], requireHumanConfirmation: false }, memory: {} }

it('真实原子写入带版本配置与事务记录，读取不改写内容', async () => {
  const storage = createProviderSettingsFileStorage()
  await storage.writeConfig(config)
  const file = path.join(state.root, 'llm-config.json')
  const original = await fsp.readFile(file, 'utf8')
  expect(JSON.parse(original)).toEqual({ version: 2, minReaderVersion: 1, content: config })
  expect(await storage.readConfig()).toEqual(config)
  expect(await fsp.readFile(file, 'utf8')).toBe(original)
  const journal = { version: 2 as const, configBefore: config, credentialBefore: { storeKey: 'provider:sample', encrypted: null } }
  await storage.writeJournal(journal)
  expect(await storage.readJournal()).toEqual(journal)
})

it('版本外壳引入前的配置照常读取且不改写原文件，下次保存补上版本', async () => {
  const storage = createProviderSettingsFileStorage()
  const file = path.join(state.root, 'llm-config.json')
  const legacy = JSON.stringify({ ...config, providers: [{ providerId: 'p' }] })
  await fsp.writeFile(file, legacy)
  expect(await storage.readConfig()).toMatchObject({ providers: [{ providerId: 'p' }] })
  expect(await fsp.readFile(file, 'utf8')).toBe(legacy)
  await storage.writeConfig(await storage.readConfig() as LlmConfigState)
  expect(JSON.parse(await fsp.readFile(file, 'utf8'))).toMatchObject({ version: 2, content: { providers: [{ providerId: 'p' }] } })
})

it('第 1 版配置读取时加入智能优化并设为默认，原有方案与自建方案的选择保留', async () => {
  const storage = createProviderSettingsFileStorage()
  const file = path.join(state.root, 'llm-config.json')
  const general = { id: 'default-general-optimizer', name: '通用', providerId: 'p', modelId: 'm', systemPrompt: '改过的', userTemplate: '{{prompt}}', capabilities: { text: true, image: false, video: false }, isDefault: true, enabled: true, createdAt: 't', updatedAt: 't' }
  await fsp.writeFile(file, JSON.stringify({ version: 1, minReaderVersion: 1, content: { ...config, promptProfiles: [general], selectedPromptProfileId: general.id } }))
  const read = await storage.readConfig() as LlmConfigState
  expect(read.promptProfiles.map(profile => [profile.id, profile.isDefault])).toEqual([['smart-prompt-optimizer', true], ['default-general-optimizer', false]])
  expect(read.promptProfiles[1].systemPrompt).toBe('改过的')
  expect(read.selectedPromptProfileId).toBe('smart-prompt-optimizer')
})

it('无法识别的旧内容、更新版本和损坏JSON分别拒绝，原文件保留', async () => {
  const storage = createProviderSettingsFileStorage()
  const file = path.join(state.root, 'llm-config.json')
  for (const [raw, message] of [[JSON.stringify({ unknown: true }), '早于当前版本可读取的最低版本'], [JSON.stringify({ version: 3, content: config }), '更新版本'], ['{truncated', '损坏']]) {
    await fsp.writeFile(file, raw)
    await expect(storage.readConfig()).rejects.toThrow(message)
    expect(await fsp.readFile(file, 'utf8')).toBe(raw)
  }
})

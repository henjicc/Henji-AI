/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/config'

import type {
  AssistantSkillManifest,
  AssistantSkillMetadata,
} from '@/core/assistant/skills'

const listSkills = vi.hoisted(() => vi.fn())
const installSkill = vi.hoisted(() => vi.fn())
const uninstallSkill = vi.hoisted(() => vi.fn())
const setSkillEnabled = vi.hoisted(() => vi.fn())
const openSkillsDirectory = vi.hoisted(() => vi.fn())

vi.mock('@/commands/assistant', () => ({
  listAssistantSkills: listSkills,
  installAssistantSkill: installSkill,
  uninstallAssistantSkill: uninstallSkill,
  setAssistantSkillEnabled: setSkillEnabled,
  openAssistantSkillsDirectory: openSkillsDirectory,
}))

vi.mock('@/platform/desktopApi', () => ({
  extname: (value: string) => value.slice(value.lastIndexOf('.')),
  getPathForFile: () => '',
  openDialog: vi.fn(),
}))

import AgentSkillsSection from './AgentSkillsSection'

function skill(
  name: string,
  source: AssistantSkillMetadata['source'],
  overrides: Partial<AssistantSkillMetadata> = {}
): AssistantSkillMetadata {
  return {
    name,
    description: `${name} 的用途`,
    source,
    overridesBuiltin: false,
    enabled: true,
    bodyBytes: 100,
    referencePaths: [],
    updatedAt: '2026-08-03T00:00:00.000Z',
    ...overrides,
  }
}

function manifest(skills: AssistantSkillMetadata[], invalid: { path: string; reason: string }[] = []): AssistantSkillManifest {
  return { schemaVersion: 'assistant-skill/v1', skills, invalid }
}

// 文案走 i18n（任务 5.8，B-39）：断言按中文界面
beforeAll(async () => {
  await i18n.changeLanguage('zh-CN')
})

beforeEach(() => {
  listSkills.mockResolvedValue(manifest([
    skill('image-generation', 'builtin'),
    skill('my-workflow', 'user', { overridesBuiltin: false }),
  ]))
  setSkillEnabled.mockImplementation(() => Promise.resolve(manifest([])))
  uninstallSkill.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
  cleanup()
})

describe('AgentSkillsSection', () => {
  it('按来源分组，只有用户技能可以删除', async () => {
    render(<AgentSkillsSection />)
    await screen.findByText('my-workflow')

    expect(screen.getByText('我的技能')).toBeTruthy()
    expect(screen.getByText('内置技能')).toBeTruthy()
    expect(screen.queryByLabelText('删除技能 my-workflow')).toBeTruthy()
    expect(screen.queryByLabelText('删除技能 image-generation')).toBeNull()
  })

  it('停用内置技能直接生效', async () => {
    render(<AgentSkillsSection />)
    await screen.findByText('image-generation')
    fireEvent.click(screen.getByLabelText('启用技能 image-generation'))
    await waitFor(() => expect(setSkillEnabled).toHaveBeenCalledWith({ name: 'image-generation', enabled: false }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('停用用户技能不弹窗，直接生效', async () => {
    render(<AgentSkillsSection />)
    await screen.findByText('my-workflow')

    fireEvent.click(screen.getByLabelText('启用技能 my-workflow'))
    await waitFor(() => expect(setSkillEnabled).toHaveBeenCalledWith({
      name: 'my-workflow',
      enabled: false,
    }))
    expect(screen.queryByText(/停用内置技能/)).toBeNull()
  })

  it('卸载用户技能直接交给可恢复的存储入口', async () => {
    render(<AgentSkillsSection />)
    await screen.findByText('my-workflow')
    fireEvent.click(screen.getByLabelText('删除技能 my-workflow'))
    await waitFor(() => expect(uninstallSkill).toHaveBeenCalledWith('my-workflow'))
  })

  it('展示解析失败的技能与原因', async () => {
    listSkills.mockResolvedValue(manifest(
      [skill('image-generation', 'builtin')],
      [{ path: 'D:/data/assistant/skills/broken', reason: '第 3 行：frontmatter 缺少 name' }]
    ))
    render(<AgentSkillsSection />)

    await screen.findByText('解析失败')
    expect(screen.getByText('第 3 行：frontmatter 缺少 name')).toBeTruthy()
    // 失败条目带出本地绝对路径，助手观察画面时可直接看到。
    expect(screen.getByText('D:/data/assistant/skills/broken')).toBeTruthy()
  })

  it('安装结果里的被跳过文件会展示出来', async () => {
    installSkill.mockResolvedValue({
      installed: ['new-skill'],
      replaced: [],
      skippedFiles: [{ path: 'new-skill/setup.py', reason: '不是纯文本文件，只允许 .md 与 .txt' }],
    })
    const { openDialog } = await import('@/platform/desktopApi')
    vi.mocked(openDialog).mockResolvedValue('D:/downloads/new-skill.zip')

    render(<AgentSkillsSection />)
    await screen.findByText('my-workflow')
    fireEvent.click(screen.getByText('选择文件安装'))

    await screen.findByText(/new-skill\/setup.py/)
    expect(installSkill).toHaveBeenCalledWith({
      sourcePath: 'D:/downloads/new-skill.zip',
    })
  })

  it('安装交给同一可恢复替换入口，不通过确认后重试', async () => {
    installSkill.mockResolvedValueOnce({ installed: ['my-workflow'], replaced: ['my-workflow'], skippedFiles: [] })
    const { openDialog } = await import('@/platform/desktopApi')
    vi.mocked(openDialog).mockResolvedValue('/downloads/skill.zip')
    render(<AgentSkillsSection />)
    await screen.findByText('my-workflow')
    fireEvent.click(screen.getByText('选择文件安装'))
    await waitFor(() => expect(installSkill).toHaveBeenCalledOnce())
    expect(installSkill).toHaveBeenCalledWith({ sourcePath: '/downloads/skill.zip' })
  })
})


it('首次加载不提前呈现空列表，读取失败可重试并恢复技能列表', async () => {
  let reject: (error: Error) => void = () => {}
  listSkills.mockReturnValueOnce(new Promise((_, fail) => { reject = fail }))
  render(<AgentSkillsSection />)
  expect(screen.getByRole('status')).toBeTruthy()
  expect(screen.queryByText('我的技能')).toBeNull()
  reject(new Error('技能目录暂时无法读取'))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  await screen.findByText('my-workflow')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(listSkills).toHaveBeenCalledTimes(2)
})

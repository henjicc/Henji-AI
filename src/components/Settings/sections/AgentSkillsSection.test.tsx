/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('停用内置技能要二次确认，取消后不写入', async () => {
    render(<AgentSkillsSection />)
    await screen.findByText('image-generation')

    fireEvent.click(screen.getByLabelText('启用技能 image-generation'))
    await screen.findByText('停用内置技能「image-generation」')
    expect(setSkillEnabled).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('取消'))
    await waitFor(() => expect(screen.queryByText('停用内置技能「image-generation」')).toBeNull())
    expect(setSkillEnabled).not.toHaveBeenCalled()
  })

  it('确认后才真正停用内置技能', async () => {
    render(<AgentSkillsSection />)
    await screen.findByText('image-generation')

    fireEvent.click(screen.getByLabelText('启用技能 image-generation'))
    await screen.findByText('停用内置技能「image-generation」')
    fireEvent.click(screen.getByText('停用'))

    await waitFor(() => expect(setSkillEnabled).toHaveBeenCalledWith({
      name: 'image-generation',
      enabled: false,
    }))
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

  it('删除用户技能需要确认', async () => {
    render(<AgentSkillsSection />)
    await screen.findByText('my-workflow')

    fireEvent.click(screen.getByLabelText('删除技能 my-workflow'))
    await screen.findByText('删除技能「my-workflow」')
    expect(uninstallSkill).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('删除'))
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
    // 失败条目会带出本地绝对路径，必须标记为观察敏感区域。
    const pathNode = screen.getByText('D:/data/assistant/skills/broken')
    expect(pathNode.closest('[data-observation-sensitive]')).not.toBeNull()
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
      overwrite: false,
    })
  })

  it('同名冲突时弹确认，确认后带 overwrite 重试', async () => {
    installSkill
      .mockRejectedValueOnce(new Error('同名技能已存在：new-skill'))
      .mockResolvedValueOnce({ installed: ['new-skill'], replaced: ['new-skill'], skippedFiles: [] })
    const { openDialog } = await import('@/platform/desktopApi')
    vi.mocked(openDialog).mockResolvedValue('D:/downloads/new-skill.zip')

    render(<AgentSkillsSection />)
    await screen.findByText('my-workflow')
    fireEvent.click(screen.getByText('选择文件安装'))

    await screen.findByText('替换同名技能')
    fireEvent.click(screen.getByText('替换'))

    await waitFor(() => expect(installSkill).toHaveBeenLastCalledWith({
      sourcePath: 'D:/downloads/new-skill.zip',
      overwrite: true,
    }))
  })
})

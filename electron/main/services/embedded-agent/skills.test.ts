import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ disabled: [] as string[] }))
vi.mock('../assistant/skills/registry', async importOriginal => {
  const actual = await importOriginal<typeof import('../assistant/skills/registry')>()
  const dirs = () => ({ builtinDir: path.resolve('resources/assistant-skills'), userDir: '', disabledNames: state.disabled })
  return { ...actual,
    listEnabledAssistantSkills: async () => (await actual.scanAssistantSkills(dirs())).skills.filter(skill => skill.enabled),
    loadAssistantSkill: (name: string, relativePath?: string) => actual.loadAssistantSkillFrom(dirs(), name, relativePath),
  }
})
import { embeddedSkillCatalog, callEmbeddedSkill } from './skills'
afterEach(() => { state.disabled = [] })
const signal = new AbortController().signal

describe('内置提示词技能使用正式文件注册与读取', () => {
  it('首轮只有元数据，主文件只引导，参考内容分开加载', async () => {
    const catalog = await embeddedSkillCatalog()
    expect(catalog.tools.map(tool => tool.name)).toEqual(['load_assistant_skill'])
    expect(catalog.instructions).toContain('prompt-optimization')
    expect(catalog.instructions).not.toContain('三维镜头构图')
    expect(catalog.instructions).not.toContain('最小必要修改')
    const main = (await callEmbeddedSkill({ name: 'prompt-optimization', reason: '准备生成' }, signal)).structuredContent
    expect(main.referencePaths).toEqual(expect.arrayContaining(['references/image.md', 'references/video.md']))
    expect(main.content).not.toContain('将图片1人物的黑色外套改为浅灰色羊毛大衣')
    for (const reference of main.referencePaths as string[]) {
      const result = (await callEmbeddedSkill({ name: 'prompt-optimization', path: reference, reason: '按需指导' }, signal)).structuredContent
      expect(result.path).toBe(reference)
      expect(result.content).toContain('trust=builtin')
      expect(result.bytes).toBeGreaterThan(100)
    }
  })
  it('关闭设置后清单消失，旧工具调用也不能读取；恢复立即可用', async () => {
    state.disabled = ['prompt-optimization']
    expect(await embeddedSkillCatalog()).toEqual({ tools: [], instructions: '' })
    await expect(callEmbeddedSkill({ name: 'prompt-optimization', reason: '旧调用' }, signal)).rejects.toThrow('停用')
    state.disabled = []
    expect((await embeddedSkillCatalog()).tools).toHaveLength(1)
  })
  it('拒绝旧协议技能、越界路径及取消后的读取', async () => {
    await expect(callEmbeddedSkill({ name: '图片生成', reason: '旧技能' }, signal)).rejects.toThrow('尚未适配')
    await expect(callEmbeddedSkill({ name: 'prompt-optimization', path: 'references/../../secret.txt', reason: '越界' }, signal)).rejects.toThrow()
    const controller = new AbortController(); controller.abort(new Error('已停止'))
    await expect(callEmbeddedSkill({ name: 'prompt-optimization', reason: '取消' }, controller.signal)).rejects.toThrow('已停止')
  })
})

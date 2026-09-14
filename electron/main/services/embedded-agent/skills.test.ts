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
  it('创作索引与每个可路由模块有界，主文件链接都能经正式加载入口读取', async () => {
    const catalog = await embeddedSkillCatalog()
    expect(Buffer.byteLength(catalog.instructions, 'utf8')).toBeLessThan(2000)
    for (const name of ['prompt-optimization', 'cinematic-director', 'short-drama']) {
      const main = (await callEmbeddedSkill({ name, reason: '验证路由' }, signal)).structuredContent
      expect(main.bytes).toBeLessThan(4500)
      const links = [...main.content.matchAll(/\]\((references\/[^)]+)\)/g)].map(match => match[1])
      expect(new Set(links)).toEqual(new Set(main.referencePaths))
      for (const reference of links) {
        const result = (await callEmbeddedSkill({ name, path: reference, reason: '验证单模块读取' }, signal)).structuredContent
        expect(result.bytes).toBeLessThan(4000)
        expect(result.path).toBe(reference)
      }
    }
  })
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
    state.disabled = ['prompt-optimization', 'cinematic-director', 'short-drama']
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

  it('导演索引不携带正文，走位与返修分别读取，停用不影响其他技能', async () => {
    const catalog = await embeddedSkillCatalog()
    expect(catalog.instructions).toContain('cinematic-director')
    expect(catalog.instructions).not.toContain('接触动作描述接近')
    const main = (await callEmbeddedSkill({ name: 'cinematic-director', reason: '设计走位' }, signal)).structuredContent
    expect(main.referencePaths).toContain('references/blocking.md')
    expect(main.content).not.toContain('接触动作描述接近')
    const blocking = (await callEmbeddedSkill({ name: 'cinematic-director', path: 'references/blocking.md', reason: '双人交接' }, signal)).structuredContent
    expect(blocking.content).toContain('接触动作描述接近')
    expect(blocking.content).not.toContain('像幻灯片')
    state.disabled = ['cinematic-director']
    expect((await embeddedSkillCatalog()).instructions).not.toContain('cinematic-director')
    expect((await embeddedSkillCatalog()).instructions).toContain('prompt-optimization')
    await expect(callEmbeddedSkill({ name: 'cinematic-director', reason: '旧调用' }, signal)).rejects.toThrow('停用')
  })
})

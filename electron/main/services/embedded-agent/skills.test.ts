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

/**
 * 按需加载的技能正文与参考只防事故（误把整份资料或生成物塞进技能），不做逐篇预算：它们只在助手用到时加载一次，
 * 十几 KB 相对每次请求十几万 token 的工具定义微不足道；为卡字节数去删有用内容得不偿失。
 * 该不该拆分按主题相关性判断（一次任务用不到的内容才拆出去），不按字节。
 */
const ON_DEMAND_SKILL_FILE_MAX_BYTES = 64 * 1024
/** 技能索引属于每次请求都带的常驻前缀，保留预算；常驻前缀的总量由 tickets/46-正式使用链路/证据/payload-audit/run.sh 的总账把关。 */
const SKILL_INDEX_MAX_BYTES = 6000

function skillBudgetBytes(result: { bytes: number; content: string }): number {
  // bytes 只计原文；运行时包裹标记使用 LF，每个原文 CRLF 规范化后减少一个 UTF-8 字节。
  return result.bytes - (result.content.match(/\r\n/g)?.length ?? 0)
}

describe('内置提示词技能使用正式文件注册与读取', () => {
  it('创作索引与每个可路由模块有界，主文件链接都能经正式加载入口读取', async () => {
    const catalog = await embeddedSkillCatalog()
    // 技能仍只披露名称与触发条件，与外部 MCP 元数据索引一致
    expect(Buffer.byteLength(catalog.instructions, 'utf8')).toBeLessThan(SKILL_INDEX_MAX_BYTES)
    for (const name of ['prompt-optimization', 'cinematic-director', 'short-drama']) {
      const main = (await callEmbeddedSkill({ name, reason: '验证路由' }, signal)).data
      expect(skillBudgetBytes(main)).toBeLessThanOrEqual(ON_DEMAND_SKILL_FILE_MAX_BYTES)
      const links = [...main.content.matchAll(/\]\((references\/[^)]+)\)/g)].map(match => match[1])
      expect(new Set(links)).toEqual(new Set(main.referencePaths))
      for (const reference of links) {
        const result = (await callEmbeddedSkill({ name, path: reference, reason: '验证单模块读取' }, signal)).data
        expect(skillBudgetBytes(result)).toBeLessThanOrEqual(ON_DEMAND_SKILL_FILE_MAX_BYTES)
        expect(result.path).toBe(reference)
      }
    }
  })
  it('首轮只有元数据，主文件只引导，参考内容分开加载', async () => {
    const catalog = await embeddedSkillCatalog()
    expect(catalog.tools.map(tool => tool.name)).toEqual(['load_assistant_skill'])
    expect(catalog.instructions).toContain('prompt-optimization')
    expect(catalog.instructions).not.toContain('生成排障')
    expect(catalog.instructions).not.toContain('最小必要修改')
    const main = (await callEmbeddedSkill({ name: 'prompt-optimization', reason: '准备生成' }, signal)).data
    expect(main.referencePaths).toEqual(expect.arrayContaining(['references/image.md', 'references/video.md']))
    expect(main.content).not.toContain('将图片1人物的黑色外套改为浅灰色羊毛大衣')
    for (const reference of main.referencePaths as string[]) {
      const result = (await callEmbeddedSkill({ name: 'prompt-optimization', path: reference, reason: '按需指导' }, signal)).data
      expect(result.path).toBe(reference)
      expect(result.content).toContain('trust=builtin')
      expect(result.bytes).toBeGreaterThan(100)
    }
  })
  it('关闭设置后清单消失，旧工具调用也不能读取；恢复立即可用', async () => {
    state.disabled = ['prompt-optimization', 'cinematic-director', 'short-drama', 'video-edit-code-creation', 'video-edit-workbench', 'image-edit-workbench', 'color-grading', 'audio-edit-workbench', '三维镜头构图']
    expect(await embeddedSkillCatalog()).toEqual({ tools: [], instructions: '', names: [] })
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
    const main = (await callEmbeddedSkill({ name: 'cinematic-director', reason: '设计走位' }, signal)).data
    expect(main.referencePaths).toContain('references/blocking.md')
    expect(main.content).not.toContain('接触动作描述接近')
    const blocking = (await callEmbeddedSkill({ name: 'cinematic-director', path: 'references/blocking.md', reason: '双人交接' }, signal)).data
    expect(blocking.content).toContain('接触动作描述接近')
    expect(blocking.content).not.toContain('像幻灯片')
    state.disabled = ['cinematic-director']
    expect((await embeddedSkillCatalog()).instructions).not.toContain('cinematic-director')
    expect((await embeddedSkillCatalog()).instructions).toContain('prompt-optimization')
    await expect(callEmbeddedSkill({ name: 'cinematic-director', reason: '旧调用' }, signal)).rejects.toThrow('停用')
  })

  it('剪辑工作台能从首轮索引选中，八份参考按需读取，停用不影响代码创作', async () => {
    const catalog = await embeddedSkillCatalog()
    expect(catalog.instructions).toContain('video-edit-workbench')
    expect(catalog.instructions).toContain('粗剪')
    expect(catalog.instructions).toContain('写代码画面用 video-edit-code-creation')
    expect(catalog.instructions).not.toContain('片段响度测量')
    const main = (await callEmbeddedSkill({ name: 'video-edit-workbench', reason: '普通剪辑与跨工作区交付' }, signal)).data
    expect(main.content).toContain('trust=builtin')
    expect(skillBudgetBytes(main)).toBeLessThanOrEqual(ON_DEMAND_SKILL_FILE_MAX_BYTES)
    expect(main.referencePaths).toEqual([
      'references/captions.md', 'references/color-transitions.md', 'references/cross-workspace.md',
      'references/deliver.md', 'references/rhythm.md', 'references/screen-recording.md', 'references/sound.md', 'references/timeline.md',
    ])
    const links = [...main.content.matchAll(/\]\((references\/[^)]+)\)/g)].map(match => match[1])
    expect(new Set(links)).toEqual(new Set(main.referencePaths))
    for (const reference of main.referencePaths) {
      const result = (await callEmbeddedSkill({ name: 'video-edit-workbench', path: reference, reason: '当前剪辑步骤' }, signal)).data
      expect(result.path).toBe(reference)
      expect(result.content).toContain('trust=builtin')
      expect(skillBudgetBytes(result)).toBeLessThanOrEqual(ON_DEMAND_SKILL_FILE_MAX_BYTES)
    }
    await expect(callEmbeddedSkill({ name: 'video-edit-workbench', path: 'references/missing.md', reason: '错误路径' }, signal)).rejects.toThrow('references/timeline.md')
    state.disabled = ['video-edit-workbench']
    expect((await embeddedSkillCatalog()).instructions).not.toMatch(/"name"\s*:\s*"video-edit-workbench"/)
    expect((await embeddedSkillCatalog()).instructions).toContain('video-edit-code-creation')
    await expect(callEmbeddedSkill({ name: 'video-edit-workbench', reason: '旧调用' }, signal)).rejects.toThrow('停用')
    state.disabled = []
    expect((await callEmbeddedSkill({ name: 'video-edit-workbench', reason: '恢复启用' }, signal)).data.name).toBe('video-edit-workbench')
  })

  it('图片编辑从元数据触发，四篇参考按需读取，停用与取消保持原契约', async () => {
    const catalog = await embeddedSkillCatalog()
    expect(catalog.instructions).toContain('image-edit-workbench')
    expect(catalog.instructions).toContain('修补瑕疵')
    expect(catalog.instructions).not.toContain('params.exposure')
    const main = (await callEmbeddedSkill({ name: 'image-edit-workbench', reason: '修图并交付' }, signal)).data
    const references = ['references/adjust.md', 'references/layers-export.md', 'references/repair.md', 'references/select.md']
    expect(main.name).toBe('image-edit-workbench')
    expect(main.source).toBe('builtin')
    expect(main.content).toContain('trust=builtin')
    expect(skillBudgetBytes(main)).toBeLessThanOrEqual(ON_DEMAND_SKILL_FILE_MAX_BYTES)
    expect(main.referencePaths).toEqual(references)
    expect(main.content).not.toContain('params.exposure')
    for (const reference of references) {
      const result = (await callEmbeddedSkill({ name: 'image-edit-workbench', path: reference, reason: '当前修图步骤' }, signal)).data
      expect(result.path).toBe(reference)
      expect(result.content).toContain('trust=builtin')
      expect(skillBudgetBytes(result)).toBeLessThanOrEqual(ON_DEMAND_SKILL_FILE_MAX_BYTES)
    }
    await expect(callEmbeddedSkill({ name: 'image-edit-workbench', path: 'references/../SKILL.md', reason: '越界' }, signal)).rejects.toThrow()
    await expect(callEmbeddedSkill({ name: 'image-edit-workbench', path: 'references/missing.md', reason: '错误路径' }, signal)).rejects.toThrow('references/repair.md')
    const cancelled = new AbortController(); cancelled.abort(new Error('停止修图'))
    await expect(callEmbeddedSkill({ name: 'image-edit-workbench', reason: '已取消' }, cancelled.signal)).rejects.toThrow('停止修图')
    state.disabled = ['image-edit-workbench']
    expect((await embeddedSkillCatalog()).instructions).not.toMatch(/"name"\s*:\s*"image-edit-workbench"/)
    expect((await embeddedSkillCatalog()).instructions).toContain('video-edit-workbench')
    await expect(callEmbeddedSkill({ name: 'image-edit-workbench', reason: '旧调用' }, signal)).rejects.toThrow('停用')
    state.disabled = []
    expect((await callEmbeddedSkill({ name: 'image-edit-workbench', reason: '恢复' }, signal)).data.name).toBe('image-edit-workbench')
  })

  it('剪辑代码素材技能进入索引，正文只路由，参考按需读取，停用后不可用且其他技能不受影响', async () => {
    const catalog = await embeddedSkillCatalog()
    expect(catalog.instructions).toContain('video-edit-code-creation')
    expect(catalog.instructions).not.toContain('smoothstep')
    const main = (await callEmbeddedSkill({ name: 'video-edit-code-creation', reason: '写新的代码素材' }, signal)).data
    expect(skillBudgetBytes(main)).toBeLessThanOrEqual(ON_DEMAND_SKILL_FILE_MAX_BYTES)
    expect(main.content).toContain('trust=builtin')
    expect(main.content).not.toContain('smoothstep')
    const links = [...main.content.matchAll(/\]\((references\/[^)]+)\)/g)].map(match => match[1])
    expect(new Set(links)).toEqual(new Set(main.referencePaths))
    expect(main.referencePaths).toEqual(expect.arrayContaining([
      'references/author-api-media.md', 'references/approach.md', 'references/recipes-text.md', 'references/recipes-text-data.md', 'references/recipes-text-words.md',
      'references/recipes-captions.md', 'references/recipes-glass-lines.md', 'references/recipes-particles.md', 'references/performance.md', 'references/recipes-3d.md', 'references/review-ai.md',
    ]))
    for (const reference of main.referencePaths) {
      const result = (await callEmbeddedSkill({ name: 'video-edit-code-creation', path: reference, reason: '当前步骤' }, signal)).data
      expect(result.path).toBe(reference)
      expect(skillBudgetBytes(result), reference).toBeLessThanOrEqual(ON_DEMAND_SKILL_FILE_MAX_BYTES)
    }
    await expect(callEmbeddedSkill({ name: 'video-edit-code-creation', path: 'references/missing.md', reason: '猜测' }, signal)).rejects.toThrow('references/author-api.md')
    state.disabled = ['video-edit-code-creation']
    expect((await embeddedSkillCatalog()).instructions).not.toMatch(/"name"\s*:\s*"video-edit-code-creation"/)
    expect((await embeddedSkillCatalog()).instructions).toContain('cinematic-director')
    await expect(callEmbeddedSkill({ name: 'video-edit-code-creation', reason: '旧调用' }, signal)).rejects.toThrow('停用')
  })
})


it('图片核对说明与当前公开调用面一致，明确截图缺口并给出结果媒体路径', async () => {
  for (const relativePath of [undefined, 'references/layers-export.md']) {
    const content = (await callEmbeddedSkill({ name: 'image-edit-workbench', path: relativePath, reason: '核对真实调用面' }, signal)).data.content
    expect(content).not.toContain('内置 Pi 可用 `observe_application_surface`')
    expect(content).toContain('read_application_media')
    expect(content).toContain('缺口')
  }
})

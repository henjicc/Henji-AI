import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILL_MAX_BODY_BYTES,
  ASSISTANT_SKILL_MAX_COUNT,
  isAssistantSkillError,
} from '../../../../../src/core/assistant/skills'
import { scanAssistantSkills, readAssistantSkillFrom, type SkillDirectorySet } from './registry'

let rootDir = ''
let builtinDir = ''
let userDir = ''

function dirs(disabledNames: string[] = []): SkillDirectorySet {
  return { builtinDir, userDir, disabledNames }
}

function skillFile(name: string, description: string, body = '正文', extra = ''): string {
  return ['---', `name: ${name}`, `description: ${description}`, extra, '---', '', body, ''].join('\n')
}

async function writeSkill(parentDir: string, folder: string, content: string): Promise<string> {
  const skillDir = path.join(parentDir, folder)
  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf8')
  return skillDir
}

async function writeReference(skillDir: string, relativePath: string, content: string): Promise<void> {
  const target = path.join(skillDir, relativePath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content, 'utf8')
}

async function expectSkillError(action: () => Promise<unknown>): Promise<string> {
  try {
    await action()
  } catch (error) {
    if (isAssistantSkillError(error)) return error.code
    throw error
  }
  throw new Error('预期抛出技能错误，但执行成功了')
}

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-skills-'))
  builtinDir = path.join(rootDir, 'builtin')
  userDir = path.join(rootDir, 'user')
  await fs.mkdir(builtinDir, { recursive: true })
  await fs.mkdir(userDir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(rootDir, { recursive: true, force: true })
})

describe('scanAssistantSkills', () => {
  it('两个目录都不存在时返回空清单且不创建目录', async () => {
    const missingRoot = path.join(rootDir, 'missing')
    const manifest = await scanAssistantSkills({
      builtinDir: path.join(missingRoot, 'builtin'),
      userDir: path.join(missingRoot, 'user'),
      disabledNames: [],
    })
    expect(manifest.skills).toEqual([])
    expect(manifest.invalid).toEqual([])
    await expect(fs.access(missingRoot)).rejects.toThrow()
  })

  it('扫出内置技能并按名称升序返回', async () => {
    await writeSkill(builtinDir, 'zeta-skill', skillFile('zeta-skill', '最后一个'))
    await writeSkill(builtinDir, 'alpha-skill', skillFile('alpha-skill', '第一个'))

    const manifest = await scanAssistantSkills(dirs())
    expect(manifest.skills.map((skill) => skill.name)).toEqual(['alpha-skill', 'zeta-skill'])
    expect(manifest.skills[0]).toMatchObject({
      description: '第一个',
      source: 'builtin',
      overridesBuiltin: false,
      enabled: true,
      referencePaths: [],
    })
  })

  it('同名时用户技能整个覆盖内置并标记 overridesBuiltin', async () => {
    const builtinSkill = await writeSkill(builtinDir, 'demo-skill', skillFile('demo-skill', '内置版', '内置正文'))
    await writeReference(builtinSkill, 'references/builtin-only.md', '内置引用')
    const userSkill = await writeSkill(userDir, 'demo-skill', skillFile('demo-skill', '用户版', '用户正文'))
    await writeReference(userSkill, 'references/user-only.md', '用户引用')

    const manifest = await scanAssistantSkills(dirs())
    expect(manifest.skills).toHaveLength(1)
    expect(manifest.skills[0]).toMatchObject({
      description: '用户版',
      source: 'user',
      overridesBuiltin: true,
      referencePaths: ['references/user-only.md'],
    })

    const detail = await readAssistantSkillFrom(dirs(), 'demo-skill')
    expect(detail.content).toBe('用户正文')
    expect(detail.source).toBe('user')
    expect(await expectSkillError(() => readAssistantSkillFrom(dirs(), 'demo-skill', 'references/builtin-only.md')))
      .toBe('SKILL_REFERENCE_NOT_FOUND')
  })

  it('五种非法情况都进 invalid 并带可读原因，不进 skills', async () => {
    await writeSkill(builtinDir, 'missing-name', ['---', 'description: 只有描述', '---', '正文'].join('\n'))
    await writeSkill(builtinDir, 'missing-desc', ['---', 'name: missing-desc', '---', '正文'].join('\n'))
    await writeSkill(builtinDir, 'folder-mismatch', skillFile('other-name', '名字对不上'))
    await writeSkill(builtinDir, 'long-desc', skillFile('long-desc', '描'.repeat(201)))
    await writeSkill(
      builtinDir,
      'huge-body',
      skillFile('huge-body', '正文超限', 'x'.repeat(ASSISTANT_SKILL_MAX_BODY_BYTES + 1))
    )
    await fs.mkdir(path.join(builtinDir, 'no-entry'), { recursive: true })

    const manifest = await scanAssistantSkills(dirs())
    expect(manifest.skills).toEqual([])
    expect(manifest.invalid).toHaveLength(6)
    const reasons = manifest.invalid.map((entry) => entry.reason).join('\n')
    expect(reasons).toContain('缺少 name')
    expect(reasons).toContain('缺少 description')
    expect(reasons).toContain('与文件夹名')
    expect(reasons).toContain('超过 200')
    expect(reasons).toContain('超过上限')
    expect(reasons).toContain('缺少 SKILL.md')
    // frontmatter 类错误（缺 name、缺 description、description 超长）都带行号。
    expect(manifest.invalid.filter((entry) => entry.reason.startsWith('第 '))).toHaveLength(3)
  })

  it('未知 frontmatter 字段不影响加载且不出现在返回值里', async () => {
    await writeSkill(
      builtinDir,
      'standard-skill',
      [
        '---',
        'name: standard-skill',
        'description: 外部标准技能',
        'allowed-tools: Read, Bash',
        'license: MIT',
        'metadata:',
        '  author: someone',
        '---',
        '',
        '正文',
      ].join('\n')
    )
    await writeSkill(
      builtinDir,
      'list-tools-skill',
      [
        '---',
        'name: list-tools-skill',
        'allowed-tools:',
        '  - Read',
        '  - Write',
        'description: 工具字段写成列表的技能',
        '---',
        '',
        '正文',
      ].join('\n')
    )

    const manifest = await scanAssistantSkills(dirs())
    expect(manifest.skills.map((skill) => skill.name)).toEqual(['list-tools-skill', 'standard-skill'])
    expect(JSON.stringify(manifest)).not.toContain('allowed-tools')
    expect(JSON.stringify(manifest)).not.toContain('MIT')

    const detail = await readAssistantSkillFrom(dirs(), 'standard-skill')
    expect(detail.content).toBe('正文')
    expect(detail.content).not.toContain('allowed-tools')
  })

  it('references 只索引白名单扩展名，支持多级子目录', async () => {
    const skillDir = await writeSkill(builtinDir, 'ref-skill', skillFile('ref-skill', '带引用'))
    await writeReference(skillDir, 'references/api.md', 'API 说明')
    await writeReference(skillDir, 'references/notes.txt', '笔记')
    await writeReference(skillDir, 'references/deep/nested/table.md', '深层表格')
    await writeReference(skillDir, 'references/script.js', 'console.log(1)')
    await writeReference(skillDir, 'references/diagram.png', 'binary')

    const manifest = await scanAssistantSkills(dirs())
    expect(manifest.skills[0]?.referencePaths).toEqual([
      'references/api.md',
      'references/deep/nested/table.md',
      'references/notes.txt',
    ])
  })

  it('中文技能名可以扫描、覆盖、读取正文与引用文件', async () => {
    const builtinSkill = await writeSkill(builtinDir, '图片生成', skillFile('图片生成', '内置版', '内置正文'))
    await writeReference(builtinSkill, 'references/参数对照.md', '内置引用')
    const userSkill = await writeSkill(userDir, '图片生成', skillFile('图片生成', '用户版', '用户正文'))
    await writeReference(userSkill, 'references/参数对照.md', '用户引用')

    const manifest = await scanAssistantSkills(dirs())
    expect(manifest.skills).toHaveLength(1)
    expect(manifest.skills[0]).toMatchObject({
      name: '图片生成',
      description: '用户版',
      source: 'user',
      overridesBuiltin: true,
      referencePaths: ['references/参数对照.md'],
    })

    const detail = await readAssistantSkillFrom(dirs(), '图片生成')
    expect(detail.content).toBe('用户正文')
    const reference = await readAssistantSkillFrom(dirs(), '图片生成', 'references/参数对照.md')
    expect(reference.content).toBe('用户引用')
  })

  it('停用的技能仍在清单里但 enabled 为 false', async () => {
    await writeSkill(builtinDir, 'demo-skill', skillFile('demo-skill', '说明'))
    const manifest = await scanAssistantSkills(dirs(['demo-skill']))
    expect(manifest.skills[0]?.enabled).toBe(false)
  })

  it('能扫出仓库内的内置示例技能', async () => {
    const manifest = await scanAssistantSkills({
      builtinDir: path.resolve(process.cwd(), 'resources', 'assistant-skills'),
      userDir,
      disabledNames: [],
    })
    expect(manifest.invalid).toEqual([])
    // 不断言顺序：中文名的排序结果依赖 localeCompare 的实现，跨环境不稳定。
    expect(new Set(manifest.skills.map((skill) => skill.name)))
      .toEqual(new Set(['三维镜头构图', '生成排障', '图片生成']))
    expect(manifest.skills.every((skill) => skill.source === 'builtin' && skill.enabled)).toBe(true)
    expect(manifest.skills.every((skill) => skill.description.length > 0)).toBe(true)
  })

  it('技能总数超过上限时截断', async () => {
    for (let index = 0; index < ASSISTANT_SKILL_MAX_COUNT + 3; index += 1) {
      const name = `skill-${String(index).padStart(3, '0')}`
      await writeSkill(builtinDir, name, skillFile(name, `第 ${index} 个`))
    }
    const manifest = await scanAssistantSkills(dirs())
    expect(manifest.skills).toHaveLength(ASSISTANT_SKILL_MAX_COUNT)
    expect(manifest.skills[0]?.name).toBe('skill-000')
  })
})

describe('readAssistantSkillFrom', () => {
  beforeEach(async () => {
    const skillDir = await writeSkill(builtinDir, 'demo-skill', skillFile('demo-skill', '说明', '# 标题\n正文'))
    await writeReference(skillDir, 'references/api.md', '引用内容')
  })

  it('不传路径时返回不含 frontmatter 的正文', async () => {
    const detail = await readAssistantSkillFrom(dirs(), 'demo-skill')
    expect(detail).toMatchObject({ name: 'demo-skill', source: 'builtin', path: null, content: '# 标题\n正文' })
    expect(detail.content).not.toContain('description:')
    expect(detail.bytes).toBe(Buffer.byteLength('# 标题\n正文', 'utf8'))
  })

  it('传引用路径时返回该文件内容', async () => {
    const detail = await readAssistantSkillFrom(dirs(), 'demo-skill', 'references/api.md')
    expect(detail.content).toBe('引用内容')
    expect(detail.path).toBe('references/api.md')
  })

  it('技能不存在、名称非法都返回 SKILL_NOT_FOUND', async () => {
    expect(await expectSkillError(() => readAssistantSkillFrom(dirs(), 'no-such-skill'))).toBe('SKILL_NOT_FOUND')
    expect(await expectSkillError(() => readAssistantSkillFrom(dirs(), '../demo-skill'))).toBe('SKILL_NOT_FOUND')
  })

  it('被停用时返回 SKILL_DISABLED', async () => {
    expect(await expectSkillError(() => readAssistantSkillFrom(dirs(['demo-skill']), 'demo-skill')))
      .toBe('SKILL_DISABLED')
  })

  it('引用文件不存在时返回 SKILL_REFERENCE_NOT_FOUND', async () => {
    expect(await expectSkillError(() => readAssistantSkillFrom(dirs(), 'demo-skill', 'references/missing.md')))
      .toBe('SKILL_REFERENCE_NOT_FOUND')
  })

  it('四种越界路径都被 SKILL_PATH_REJECTED 拒绝', async () => {
    const rejected = [
      '../../../etc/passwd',
      '/abs/path.md',
      'references/../../x.md',
      'references/x.js',
    ]
    for (const relativePath of rejected) {
      expect(await expectSkillError(() => readAssistantSkillFrom(dirs(), 'demo-skill', relativePath)))
        .toBe('SKILL_PATH_REJECTED')
    }
  })
})

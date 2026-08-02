import { describe, expect, it } from 'vitest'

import { AssistantSkillError, isAssistantSkillError } from '../../../../../src/core/assistant/skills'
import { parseSkillFrontmatter } from './frontmatter'

function expectFrontmatterError(source: string): AssistantSkillError {
  try {
    parseSkillFrontmatter(source)
  } catch (error) {
    if (isAssistantSkillError(error)) return error
    throw error
  }
  throw new Error('预期解析失败，但解析成功了')
}

describe('parseSkillFrontmatter', () => {
  it('解析出 name、description 与不含 frontmatter 的正文', () => {
    const parsed = parseSkillFrontmatter(
      ['---', 'name: image-generation', 'description: 生成图片时使用', '---', '', '# 图片生成', '正文', ''].join('\n')
    )
    expect(parsed.name).toBe('image-generation')
    expect(parsed.description).toBe('生成图片时使用')
    expect(parsed.body).toBe('# 图片生成\n正文')
    expect(parsed.body).not.toContain('description:')
  })

  it('兼容 CRLF、BOM 与引号包裹的标量', () => {
    const parsed = parseSkillFrontmatter(
      '﻿---\r\nname: "demo-skill"\r\ndescription: \'带引号的描述\'\r\n---\r\n正文\r\n'
    )
    expect(parsed.name).toBe('demo-skill')
    expect(parsed.description).toBe('带引号的描述')
    expect(parsed.body).toBe('正文')
  })

  it('跳过注释与未知标量键，且不出现在返回值里', () => {
    const parsed = parseSkillFrontmatter(
      [
        '---',
        '# 这是注释',
        'name: demo-skill',
        'license: MIT',
        'allowed-tools: Read, Write',
        'description: 说明',
        '---',
        '正文',
      ].join('\n')
    )
    expect(parsed).toEqual({ name: 'demo-skill', description: '说明', body: '正文' })
  })

  it('跳过未知键的 YAML 列表与缩进块', () => {
    const parsed = parseSkillFrontmatter(
      [
        '---',
        'name: demo-skill',
        'allowed-tools:',
        '  - Read',
        '  - Write',
        'metadata:',
        '  author: someone',
        '  tags:',
        '    - a',
        '',
        '  version: 2',
        'description: 说明',
        '---',
        '正文',
      ].join('\n')
    )
    expect(parsed).toEqual({ name: 'demo-skill', description: '说明', body: '正文' })
  })

  it('缺少起始分隔符时报第 1 行错误', () => {
    const error = expectFrontmatterError('name: demo-skill\n')
    expect(error.code).toBe('SKILL_FRONTMATTER_INVALID')
    expect(error.line).toBe(1)
    expect(error.message).toContain('第 1 行')
  })

  it('缺少结束分隔符时报错', () => {
    const error = expectFrontmatterError('---\nname: demo-skill\ndescription: 说明\n')
    expect(error.message).toContain('缺少结束的 ---')
  })

  it('缺少 name 或 description 都报错并带行号', () => {
    expect(expectFrontmatterError('---\ndescription: 说明\n---\n').message).toContain('缺少 name')
    const missingDescription = expectFrontmatterError('---\nname: demo-skill\n---\n')
    expect(missingDescription.message).toContain('缺少 description')
    expect(missingDescription.line).toBe(3)
  })

  it('name 重复、格式非法、超长都带行号报错', () => {
    expect(expectFrontmatterError('---\nname: a\nname: b\ndescription: 说明\n---\n').line).toBe(3)
    expect(expectFrontmatterError('---\nname: Demo_Skill\ndescription: 说明\n---\n').message).toContain('小写字母')
    const longName = `${'a'.repeat(65)}`
    expect(expectFrontmatterError(`---\nname: ${longName}\ndescription: 说明\n---\n`).message).toContain('超过 64')
  })

  it('description 超长与为空都报错', () => {
    const longDescription = '描'.repeat(201)
    expect(expectFrontmatterError(`---\nname: demo-skill\ndescription: ${longDescription}\n---\n`).message)
      .toContain('超过 200')
    expect(expectFrontmatterError('---\nname: demo-skill\ndescription:\n---\n').message).toContain('不能为空')
  })

  it('description 使用块标量或列表写法时报错', () => {
    expect(expectFrontmatterError('---\nname: demo-skill\ndescription: >\n  折行说明\n---\n').message)
      .toContain('块标量')
    expect(expectFrontmatterError('---\nname: demo-skill\ndescription: [a, b]\n---\n').message)
      .toContain('列表或映射')
  })

  it('name 与 description 之后出现缩进行时报错', () => {
    const error = expectFrontmatterError('---\nname: demo-skill\n  extra: 1\ndescription: 说明\n---\n')
    expect(error.line).toBe(3)
  })

  it('无法识别的行报错', () => {
    expect(expectFrontmatterError('---\nname: demo-skill\n这不是键值对\ndescription: 说明\n---\n').message)
      .toContain('无法解析')
  })

  it('description 中的冒号与井号原样保留', () => {
    const parsed = parseSkillFrontmatter('---\nname: demo-skill\ndescription: 用于 A: B #1 场景\n---\n正文')
    expect(parsed.description).toBe('用于 A: B #1 场景')
  })
})

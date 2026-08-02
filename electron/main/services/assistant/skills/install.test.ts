import { ZipArchive } from 'archiver'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILL_MAX_BODY_BYTES,
  ASSISTANT_SKILL_MAX_FILE_COUNT,
  ASSISTANT_SKILL_MAX_TOTAL_BYTES,
  isAssistantSkillError,
} from '../../../../../src/core/assistant/skills'
import { installAssistantSkillTo, uninstallAssistantSkillFrom, type SkillInstallTarget } from './install'
import { scanAssistantSkills } from './registry'

let rootDir = ''
let target: SkillInstallTarget
let sourceDir = ''

interface ArchiveFile {
  name: string
  content?: string
  symlinkTo?: string
}

function skillMarkdown(name: string, description = '测试技能', body = '正文'): string {
  return ['---', `name: ${name}`, `description: ${description}`, '---', '', body, ''].join('\n')
}

async function writeArchive(fileName: string, files: ArchiveFile[]): Promise<string> {
  const archivePath = path.join(sourceDir, fileName)
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(archivePath)
    const archive = new ZipArchive({ zlib: { level: 0 } })
    output.on('close', () => resolve())
    output.on('error', reject)
    archive.on('error', reject)
    archive.pipe(output)
    for (const file of files) {
      if (file.symlinkTo) {
        archive.symlink(file.name, file.symlinkTo)
        continue
      }
      archive.append(file.content ?? '', { name: file.name })
    }
    void archive.finalize()
  })
  return archivePath
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(buffer: Buffer): number {
  let crc = 0xFFFFFFFF
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xFF] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

/**
 * archiver 会把 `../` 和前导 `/` 规范化掉，用它造不出穿越路径的包。
 * 这里手写一个最小的 STORE 方式 zip，才能真的验证 zip-slip 防护生效。
 */
async function writeRawArchive(
  fileName: string,
  files: { name: string; content: string }[]
): Promise<string> {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8')
    const data = Buffer.from(file.content, 'utf8')
    const checksum = crc32(data)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034B50, 0)
    localHeader.writeUInt16LE(10, 4)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(data.byteLength, 18)
    localHeader.writeUInt32LE(data.byteLength, 22)
    localHeader.writeUInt16LE(nameBytes.byteLength, 26)
    locals.push(localHeader, nameBytes, data)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014B50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(10, 6)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(data.byteLength, 20)
    centralHeader.writeUInt32LE(data.byteLength, 24)
    centralHeader.writeUInt16LE(nameBytes.byteLength, 28)
    centralHeader.writeUInt32LE(offset, 42)
    centrals.push(centralHeader, nameBytes)

    offset += localHeader.byteLength + nameBytes.byteLength + data.byteLength
  }

  const central = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(central.byteLength, 12)
  end.writeUInt32LE(offset, 16)

  const archivePath = path.join(sourceDir, fileName)
  await fs.writeFile(archivePath, Buffer.concat([...locals, central, end]))
  return archivePath
}

async function writeMarkdownSource(fileName: string, content: string): Promise<string> {
  const filePath = path.join(sourceDir, fileName)
  await fs.writeFile(filePath, content, 'utf8')
  return filePath
}

async function install(sourcePath: string, overwrite = false) {
  return installAssistantSkillTo(target, { sourcePath, overwrite })
}

async function expectErrorCode(action: () => Promise<unknown>): Promise<string> {
  try {
    await action()
  } catch (error) {
    if (isAssistantSkillError(error)) return error.code
    throw error
  }
  throw new Error('预期安装失败，但执行成功了')
}

async function listUserDir(): Promise<string[]> {
  try {
    return (await fs.readdir(target.userDir)).sort()
  } catch {
    return []
  }
}

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-skill-install-'))
  target = { builtinDir: path.join(rootDir, 'builtin'), userDir: path.join(rootDir, 'user') }
  sourceDir = path.join(rootDir, 'source')
  await fs.mkdir(target.builtinDir, { recursive: true })
  await fs.mkdir(target.userDir, { recursive: true })
  await fs.mkdir(sourceDir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(rootDir, { recursive: true, force: true })
})

describe('installAssistantSkillTo', () => {
  it('安装单个 .md 后技能进入清单且来源是 user', async () => {
    const source = await writeMarkdownSource('anything.md', skillMarkdown('demo-skill', '说明', '流程正文'))
    const result = await install(source)
    expect(result).toEqual({ installed: ['demo-skill'], replaced: [], skippedFiles: [] })

    const manifest = await scanAssistantSkills({ ...target, disabledNames: [] })
    expect(manifest.skills).toHaveLength(1)
    expect(manifest.skills[0]).toMatchObject({ name: 'demo-skill', source: 'user', description: '说明' })
    // 目录名以 frontmatter 的 name 为准，与源文件名无关。
    expect(await listUserDir()).toEqual(['demo-skill'])
  })

  it('安装含多个技能文件夹的压缩包', async () => {
    const source = await writeArchive('pack.zip', [
      { name: 'alpha-skill/SKILL.md', content: skillMarkdown('alpha-skill') },
      { name: 'beta-skill/SKILL.md', content: skillMarkdown('beta-skill') },
      { name: 'beta-skill/references/api.md', content: '引用内容' },
    ])
    const result = await install(source)
    expect(result.installed.sort()).toEqual(['alpha-skill', 'beta-skill'])

    const manifest = await scanAssistantSkills({ ...target, disabledNames: [] })
    expect(manifest.skills.map((skill) => skill.name)).toEqual(['alpha-skill', 'beta-skill'])
    expect(manifest.skills[1]?.referencePaths).toEqual(['references/api.md'])
  })

  it('安装根目录直接是 SKILL.md 的压缩包，references 多级结构完整保留', async () => {
    const source = await writeArchive('single.zip', [
      { name: 'SKILL.md', content: skillMarkdown('single-skill') },
      { name: 'references/api.md', content: '一级引用' },
      { name: 'references/deep/nested/table.md', content: '深层引用' },
    ])
    await install(source)

    const manifest = await scanAssistantSkills({ ...target, disabledNames: [] })
    expect(manifest.skills[0]?.referencePaths).toEqual([
      'references/api.md',
      'references/deep/nested/table.md',
    ])
    expect(await fs.readFile(
      path.join(target.userDir, 'single-skill', 'references', 'deep', 'nested', 'table.md'),
      'utf8'
    )).toBe('深层引用')
  })

  it('路径穿越与绝对路径整包拒绝且不留落盘文件', async () => {
    const cases: { fileName: string; escapeName: string }[] = [
      { fileName: 'traversal.zip', escapeName: '../escape.md' },
      { fileName: 'traversal-inner.zip', escapeName: 'demo-skill/references/../../../escape.md' },
      { fileName: 'absolute.zip', escapeName: '/etc/passwd.md' },
      { fileName: 'drive.zip', escapeName: 'C:/windows/escape.md' },
      { fileName: 'empty-segment.zip', escapeName: 'demo-skill//escape.md' },
    ]
    for (const item of cases) {
      const source = await writeRawArchive(item.fileName, [
        { name: 'demo-skill/SKILL.md', content: skillMarkdown('demo-skill') },
        { name: item.escapeName, content: '越界' },
      ])
      expect(await expectErrorCode(() => install(source))).toBe('SKILL_ARCHIVE_REJECTED')
      expect(await listUserDir()).toEqual([])
      await expect(fs.access(path.join(rootDir, 'escape.md'))).rejects.toThrow()
    }
  })

  it('符号链接与嵌套压缩包整包拒绝', async () => {
    const symlinkArchive = await writeArchive('symlink.zip', [
      { name: 'demo-skill/SKILL.md', content: skillMarkdown('demo-skill') },
      { name: 'demo-skill/references/link.md', symlinkTo: '../../../../etc/passwd' },
    ])
    expect(await expectErrorCode(() => install(symlinkArchive))).toBe('SKILL_ARCHIVE_REJECTED')

    const nestedArchive = await writeArchive('nested.zip', [
      { name: 'demo-skill/SKILL.md', content: skillMarkdown('demo-skill') },
      { name: 'demo-skill/bundle.zip', content: 'PK' },
    ])
    expect(await expectErrorCode(() => install(nestedArchive))).toBe('SKILL_ARCHIVE_REJECTED')
    expect(await listUserDir()).toEqual([])
  })

  it('非文本文件不落盘并在 skippedFiles 中带原因返回', async () => {
    const source = await writeArchive('mixed.zip', [
      { name: 'demo-skill/SKILL.md', content: skillMarkdown('demo-skill') },
      { name: 'demo-skill/references/api.md', content: '引用' },
      { name: 'demo-skill/references/diagram.png', content: 'binary' },
      { name: 'demo-skill/install.js', content: 'console.log(1)' },
      { name: 'demo-skill/setup.py', content: 'print(1)' },
      { name: 'demo-skill/run.sh', content: 'echo 1' },
    ])
    const result = await install(source)
    expect(result.installed).toEqual(['demo-skill'])
    expect(result.skippedFiles.map((file) => file.path).sort()).toEqual([
      'demo-skill/install.js',
      'demo-skill/references/diagram.png',
      'demo-skill/run.sh',
      'demo-skill/setup.py',
    ])
    expect(result.skippedFiles.every((file) => file.reason.length > 0)).toBe(true)

    const files = await fs.readdir(path.join(target.userDir, 'demo-skill'), { recursive: true })
    expect(files.map(String).some((file) => file.endsWith('.js') || file.endsWith('.png'))).toBe(false)
  })

  it('带 allowed-tools 的外部标准技能能正常安装', async () => {
    const scalar = await writeMarkdownSource('scalar.md', [
      '---',
      'name: scalar-skill',
      'description: 标量写法',
      'allowed-tools: Read, Bash',
      'license: MIT',
      '---',
      '正文',
    ].join('\n'))
    const list = await writeMarkdownSource('list.md', [
      '---',
      'name: list-skill',
      'allowed-tools:',
      '  - Read',
      '  - Write',
      'description: 列表写法',
      '---',
      '正文',
    ].join('\n'))
    expect((await install(scalar)).installed).toEqual(['scalar-skill'])
    expect((await install(list)).installed).toEqual(['list-skill'])

    const manifest = await scanAssistantSkills({ ...target, disabledNames: [] })
    expect(manifest.skills).toHaveLength(2)
    expect(JSON.stringify(manifest)).not.toContain('allowed-tools')
  })

  it('四种超限都被拒绝', async () => {
    const hugeEntry = await writeMarkdownSource(
      'huge.md',
      skillMarkdown('huge-skill', '说明', 'x'.repeat(ASSISTANT_SKILL_MAX_BODY_BYTES + 1))
    )
    expect(await expectErrorCode(() => install(hugeEntry))).toBe('SKILL_LIMIT_EXCEEDED')

    const manyFiles = await writeArchive('many.zip', [
      { name: 'many-skill/SKILL.md', content: skillMarkdown('many-skill') },
      ...Array.from({ length: ASSISTANT_SKILL_MAX_FILE_COUNT }, (_, index) => ({
        name: `many-skill/references/file-${index}.md`,
        content: '引用',
      })),
    ])
    expect(await expectErrorCode(() => install(manyFiles))).toBe('SKILL_LIMIT_EXCEEDED')

    const bigTotal = await writeArchive('big.zip', [
      { name: 'big-skill/SKILL.md', content: skillMarkdown('big-skill') },
      ...Array.from({ length: 6 }, (_, index) => ({
        name: `big-skill/references/part-${index}.md`,
        content: 'x'.repeat(Math.ceil(ASSISTANT_SKILL_MAX_TOTAL_BYTES / 5)),
      })),
    ])
    expect(await expectErrorCode(() => install(bigTotal))).toBe('SKILL_LIMIT_EXCEEDED')

    expect(await listUserDir()).toEqual([])
  })

  it('frontmatter 非法时拒绝安装并给出带行号的原因', async () => {
    const source = await writeMarkdownSource('broken.md', ['---', 'description: 没有名字', '---', '正文'].join('\n'))
    try {
      await install(source)
      throw new Error('预期安装失败')
    } catch (error) {
      expect(isAssistantSkillError(error) && error.code).toBe('SKILL_FRONTMATTER_INVALID')
      expect((error as Error).message).toContain('第 3 行')
    }
    expect(await listUserDir()).toEqual([])
  })

  it('同名用户技能不静默覆盖，overwrite 后整体替换', async () => {
    const first = await writeMarkdownSource('v1.md', skillMarkdown('demo-skill', '第一版', '旧正文'))
    await install(first)
    await fs.mkdir(path.join(target.userDir, 'demo-skill', 'references'), { recursive: true })
    await fs.writeFile(path.join(target.userDir, 'demo-skill', 'references', 'old.md'), '旧引用', 'utf8')

    const second = await writeMarkdownSource('v2.md', skillMarkdown('demo-skill', '第二版', '新正文'))
    expect(await expectErrorCode(() => install(second))).toBe('SKILL_ALREADY_EXISTS')

    const result = await install(second, true)
    expect(result).toMatchObject({ installed: ['demo-skill'], replaced: ['demo-skill'] })
    const manifest = await scanAssistantSkills({ ...target, disabledNames: [] })
    expect(manifest.skills[0]?.description).toBe('第二版')
    // 整个文件夹被替换，旧引用文件不残留。
    expect(manifest.skills[0]?.referencePaths).toEqual([])
  })

  it('拒绝不支持的来源扩展名', async () => {
    const source = await writeMarkdownSource('skill.txt', skillMarkdown('demo-skill'))
    expect(await expectErrorCode(() => install(source))).toBe('UNSUPPORTED_SKILL_SOURCE')
  })

  it('压缩包里没有 SKILL.md 时整包拒绝', async () => {
    const source = await writeArchive('empty.zip', [{ name: 'notes/readme.md', content: '没有技能' }])
    expect(await expectErrorCode(() => install(source))).toBe('SKILL_ARCHIVE_REJECTED')
  })
})

describe('uninstallAssistantSkillFrom', () => {
  it('删除用户技能', async () => {
    const source = await writeMarkdownSource('demo.md', skillMarkdown('demo-skill'))
    await install(source)
    await uninstallAssistantSkillFrom(target, 'demo-skill')
    expect(await listUserDir()).toEqual([])
  })

  it('内置技能返回 SKILL_BUILTIN_READONLY 且文件未被删除', async () => {
    const builtinSkillDir = path.join(target.builtinDir, 'builtin-skill')
    await fs.mkdir(builtinSkillDir, { recursive: true })
    await fs.writeFile(path.join(builtinSkillDir, 'SKILL.md'), skillMarkdown('builtin-skill'), 'utf8')

    expect(await expectErrorCode(() => uninstallAssistantSkillFrom(target, 'builtin-skill')))
      .toBe('SKILL_BUILTIN_READONLY')
    await expect(fs.access(path.join(builtinSkillDir, 'SKILL.md'))).resolves.toBeUndefined()
  })

  it('技能不存在返回 SKILL_NOT_FOUND', async () => {
    expect(await expectErrorCode(() => uninstallAssistantSkillFrom(target, 'no-such-skill')))
      .toBe('SKILL_NOT_FOUND')
  })
})

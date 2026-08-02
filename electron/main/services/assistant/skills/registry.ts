import fs from 'node:fs/promises'
import path from 'node:path'

import {
  ASSISTANT_SKILL_ENTRY_FILE,
  ASSISTANT_SKILL_MAX_BODY_BYTES,
  ASSISTANT_SKILL_MAX_COUNT,
  ASSISTANT_SKILL_MAX_REFERENCE_COUNT,
  ASSISTANT_SKILL_MAX_REFERENCE_DEPTH,
  ASSISTANT_SKILL_REFERENCE_DIR,
  ASSISTANT_SKILL_SCHEMA_VERSION,
  AssistantSkillError,
  assistantSkillNameSchema,
  assistantSkillReferencePathSchema,
  isAssistantSkillError,
  isAssistantSkillTextFile,
  type AssistantSkillDetail,
  type AssistantSkillInvalidEntry,
  type AssistantSkillManifest,
  type AssistantSkillMetadata,
  type AssistantSkillSource,
} from '../../../../../src/core/assistant/skills'
import { createMainLogger } from '../../logging'
import { parseSkillFrontmatter } from './frontmatter'
import { getBuiltinSkillsDir, getUserSkillsDir, resolveSkillFilePath } from './paths'
import { readDisabledSkillNames } from './state'

const logger = createMainLogger('main.assistant_skills')

/** 一次扫描/读取所依赖的全部外部输入，测试可直接注入临时目录。 */
export interface SkillDirectorySet {
  builtinDir: string
  userDir: string
  disabledNames: readonly string[]
}

interface ScannedSkill {
  metadata: Omit<AssistantSkillMetadata, 'enabled' | 'overridesBuiltin'>
  dir: string
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

async function readDirEntries(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    const code = errorCode(error)
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      logger.warn('读取技能目录失败，按空目录处理', {
        event: 'assistant_skill.scan.dir_unreadable',
        error,
        context: { code },
      })
    }
    return []
  }
}

/**
 * 递归索引 `references/` 下的纯文本文件。符号链接一律跳过；文件名不符合引用路径 schema
 * 的（含空格、中文等）也跳过——模型无法用这些路径调用加载能力，收进清单只会误导。
 */
async function indexReferencePaths(skillDir: string): Promise<string[]> {
  const collected: string[] = []

  const walk = async (absoluteDir: string, relativeSegments: string[], depth: number): Promise<void> => {
    if (depth > ASSISTANT_SKILL_MAX_REFERENCE_DEPTH) return
    for (const entry of await readDirEntries(absoluteDir)) {
      if (collected.length >= ASSISTANT_SKILL_MAX_REFERENCE_COUNT) return
      if (entry.isSymbolicLink()) continue
      const nextSegments = [...relativeSegments, entry.name]
      if (entry.isDirectory()) {
        await walk(path.join(absoluteDir, entry.name), nextSegments, depth + 1)
        continue
      }
      if (!entry.isFile() || !isAssistantSkillTextFile(entry.name)) continue
      const relativePath = nextSegments.join('/')
      if (assistantSkillReferencePathSchema.safeParse(relativePath).success) {
        collected.push(relativePath)
      }
    }
  }

  await walk(
    path.join(skillDir, ASSISTANT_SKILL_REFERENCE_DIR),
    [ASSISTANT_SKILL_REFERENCE_DIR],
    1
  )
  return collected.sort((left, right) => left.localeCompare(right))
}

async function scanSkillFolder(
  parentDir: string,
  folderName: string,
  source: AssistantSkillSource
): Promise<ScannedSkill | AssistantSkillInvalidEntry> {
  const skillDir = path.join(parentDir, folderName)
  const entryFile = path.join(skillDir, ASSISTANT_SKILL_ENTRY_FILE)

  let raw: string
  try {
    raw = await fs.readFile(entryFile, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return { path: skillDir, reason: `缺少 ${ASSISTANT_SKILL_ENTRY_FILE}` }
    }
    return { path: skillDir, reason: `无法读取 ${ASSISTANT_SKILL_ENTRY_FILE}` }
  }

  let parsed: ReturnType<typeof parseSkillFrontmatter>
  try {
    parsed = parseSkillFrontmatter(raw)
  } catch (error) {
    return {
      path: skillDir,
      reason: isAssistantSkillError(error) ? error.message : 'frontmatter 解析失败',
    }
  }

  if (parsed.name !== folderName) {
    return {
      path: skillDir,
      reason: `frontmatter 的 name（${parsed.name}）与文件夹名（${folderName}）不一致`,
    }
  }

  const bodyBytes = Buffer.byteLength(parsed.body, 'utf8')
  if (bodyBytes > ASSISTANT_SKILL_MAX_BODY_BYTES) {
    return {
      path: skillDir,
      reason: `正文 ${bodyBytes} 字节，超过上限 ${ASSISTANT_SKILL_MAX_BODY_BYTES} 字节`,
    }
  }

  const stats = await fs.stat(entryFile)
  return {
    dir: skillDir,
    metadata: {
      name: parsed.name,
      description: parsed.description,
      source,
      bodyBytes,
      referencePaths: await indexReferencePaths(skillDir),
      updatedAt: stats.mtime.toISOString(),
    },
  }
}

async function scanDirectory(
  dir: string,
  source: AssistantSkillSource
): Promise<{ skills: Map<string, ScannedSkill>; invalid: AssistantSkillInvalidEntry[] }> {
  const skills = new Map<string, ScannedSkill>()
  const invalid: AssistantSkillInvalidEntry[] = []
  if (!dir) return { skills, invalid }

  for (const entry of await readDirEntries(dir)) {
    // withFileTypes 采用 lstat 语义：指向目录的符号链接 isDirectory() 为 false，天然被排除。
    if (!entry.isDirectory()) continue
    const result = await scanSkillFolder(dir, entry.name, source)
    if ('metadata' in result) {
      skills.set(result.metadata.name, result)
    } else {
      invalid.push(result)
    }
  }
  return { skills, invalid }
}

/** 扫描指定的内置与用户目录，聚合成一份去重后的技能清单。 */
export async function scanAssistantSkills(dirs: SkillDirectorySet): Promise<AssistantSkillManifest> {
  const builtin = await scanDirectory(dirs.builtinDir, 'builtin')
  const user = await scanDirectory(dirs.userDir, 'user')
  const disabled = new Set(dirs.disabledNames)

  const merged = new Map<string, AssistantSkillMetadata>()
  for (const [name, scanned] of builtin.skills) {
    merged.set(name, { ...scanned.metadata, overridesBuiltin: false, enabled: !disabled.has(name) })
  }
  // 同名时用户技能整个文件夹覆盖内置，不做文件级合并。
  for (const [name, scanned] of user.skills) {
    merged.set(name, {
      ...scanned.metadata,
      overridesBuiltin: builtin.skills.has(name),
      enabled: !disabled.has(name),
    })
  }

  const sorted = Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name))
  const skills = sorted.slice(0, ASSISTANT_SKILL_MAX_COUNT)
  const droppedCount = sorted.length - skills.length
  const invalid = [...builtin.invalid, ...user.invalid]

  logger.info('扫描智能助手技能完成', {
    event: 'assistant_skill.scan.completed',
    context: {
      builtinCount: builtin.skills.size,
      userCount: user.skills.size,
      totalCount: skills.length,
      disabledCount: skills.filter((skill) => !skill.enabled).length,
      referenceCount: skills.reduce((total, skill) => total + skill.referencePaths.length, 0),
      invalidCount: invalid.length,
      droppedCount,
    },
  })

  return { schemaVersion: ASSISTANT_SKILL_SCHEMA_VERSION, skills, invalid }
}

async function locateSkillDir(
  dirs: SkillDirectorySet,
  name: string
): Promise<{ dir: string; source: AssistantSkillSource }> {
  // 用户目录优先，与扫描时的覆盖规则一致。
  const candidates: { dir: string; source: AssistantSkillSource }[] = [
    { dir: dirs.userDir, source: 'user' },
    { dir: dirs.builtinDir, source: 'builtin' },
  ]
  for (const candidate of candidates) {
    if (!candidate.dir) continue
    const skillDir = path.join(candidate.dir, name)
    try {
      await fs.access(path.join(skillDir, ASSISTANT_SKILL_ENTRY_FILE))
      return { dir: skillDir, source: candidate.source }
    } catch {
      continue
    }
  }
  throw new AssistantSkillError('SKILL_NOT_FOUND', `技能不存在：${name}`)
}

/** 读取技能正文或其引用文件。`relativePath` 为空时返回不含 frontmatter 的 `SKILL.md` 正文。 */
export async function readAssistantSkillFrom(
  dirs: SkillDirectorySet,
  name: string,
  relativePath?: string
): Promise<AssistantSkillDetail> {
  // 技能名来自模型输入，必须先过 schema 再参与路径拼接。
  if (!assistantSkillNameSchema.safeParse(name).success) {
    throw new AssistantSkillError('SKILL_NOT_FOUND', `技能不存在：${name}`)
  }

  const located = await locateSkillDir(dirs, name)
  if (dirs.disabledNames.includes(name)) {
    throw new AssistantSkillError('SKILL_DISABLED', `技能已被停用：${name}`)
  }

  if (!relativePath) {
    const raw = await fs.readFile(path.join(located.dir, ASSISTANT_SKILL_ENTRY_FILE), 'utf8')
    const parsed = parseSkillFrontmatter(raw)
    return {
      name,
      source: located.source,
      path: null,
      content: parsed.body,
      bytes: Buffer.byteLength(parsed.body, 'utf8'),
    }
  }

  const absolutePath = resolveSkillFilePath(located.dir, relativePath)
  try {
    const content = await fs.readFile(absolutePath, 'utf8')
    return {
      name,
      source: located.source,
      path: relativePath.split(/[\\/]/).join('/'),
      content,
      bytes: Buffer.byteLength(content, 'utf8'),
    }
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') {
      throw new AssistantSkillError(
        'SKILL_REFERENCE_NOT_FOUND',
        `技能 ${name} 中不存在引用文件：${relativePath}`
      )
    }
    throw error
  }
}

export function resolveSkillDirectories(): SkillDirectorySet {
  return {
    builtinDir: getBuiltinSkillsDir(),
    userDir: getUserSkillsDir(),
    disabledNames: readDisabledSkillNames(),
  }
}

export async function listAssistantSkills(): Promise<AssistantSkillManifest> {
  return scanAssistantSkills(resolveSkillDirectories())
}

export async function readAssistantSkill(
  name: string,
  relativePath?: string
): Promise<AssistantSkillDetail> {
  return readAssistantSkillFrom(resolveSkillDirectories(), name, relativePath)
}

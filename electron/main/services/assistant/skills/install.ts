import { shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  ASSISTANT_SKILL_ARCHIVE_EXTENSIONS,
  ASSISTANT_SKILL_ENTRY_FILE,
  ASSISTANT_SKILL_MAX_ARCHIVE_ENTRIES,
  ASSISTANT_SKILL_MAX_BODY_BYTES,
  ASSISTANT_SKILL_MAX_COUNT,
  ASSISTANT_SKILL_MAX_FILE_COUNT,
  ASSISTANT_SKILL_MAX_TOTAL_BYTES,
  ASSISTANT_SKILL_REFERENCE_DIR,
  ASSISTANT_SKILL_SOURCE_EXTENSIONS,
  AssistantSkillError,
  assistantSkillInstallRequestSchema,
  assistantSkillNameSchema,
  assistantSkillReferencePathSchema,
  isAssistantSkillError,
  isAssistantSkillTextFile,
  type AssistantSkillInstallRequest,
  type AssistantSkillInstallResult,
  type AssistantSkillSkippedFile,
} from '../../../../../src/core/assistant/skills'
import { createMainLogger } from '../../logging'
import { isSymbolicLinkEntry, iterateEntries, openZip, readEntryBytes } from '../../zip-archive'
import { parseSkillFrontmatter } from './frontmatter'
import { getBuiltinSkillsDir, getUserSkillsDir } from './paths'
import { scanAssistantSkills } from './registry'

const logger = createMainLogger('main.assistant_skills')

/** 一个压缩包整体允许读入的字节上限，避免多技能包在内存里堆太大。 */
const MAX_ARCHIVE_TOTAL_BYTES = ASSISTANT_SKILL_MAX_TOTAL_BYTES * 8

export interface SkillInstallTarget {
  builtinDir: string
  userDir: string
}

interface PreparedFile {
  relativePath: string
  content: Buffer
}

interface PreparedSkill {
  name: string
  files: PreparedFile[]
  totalBytes: number
}

interface ArchiveEntryFile {
  segments: string[]
  content: Buffer
}

function rejectArchive(reason: string): AssistantSkillError {
  return new AssistantSkillError('SKILL_ARCHIVE_REJECTED', `压缩包被拒绝：${reason}`)
}

function rejectLimit(reason: string): AssistantSkillError {
  return new AssistantSkillError('SKILL_LIMIT_EXCEEDED', `超出技能限额：${reason}`)
}

function lowerExtension(fileName: string): string {
  return path.posix.extname(fileName).toLowerCase()
}

/**
 * 拆分压缩包条目路径并做 zip-slip 防护：绝对路径、盘符、空段、`.`、`..` 一律整包拒绝。
 * 这里不是"跳过这一条"，而是拒绝整个包——一个包里出现穿越路径，剩下的内容也不值得信任。
 */
function safeSegments(entryName: string): string[] {
  if (entryName.includes('\0')) throw rejectArchive('路径包含空字符')
  if (
    path.isAbsolute(entryName)
    || /^[A-Za-z]:/.test(entryName)
    || entryName.startsWith('/')
    || entryName.startsWith('\\')
  ) {
    throw rejectArchive(`包含绝对路径：${entryName}`)
  }
  const segments = entryName.split(/[\\/]/)
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw rejectArchive(`包含非法路径段：${entryName}`)
  }
  return segments
}

async function readArchiveEntries(
  sourcePath: string,
  skipped: AssistantSkillSkippedFile[]
): Promise<ArchiveEntryFile[]> {
  const archive = await openZip(sourcePath)
  const entries: ArchiveEntryFile[] = []
  let entryCount = 0
  let totalBytes = 0
  try {
    for await (const entry of iterateEntries(archive)) {
      entryCount += 1
      if (entryCount > ASSISTANT_SKILL_MAX_ARCHIVE_ENTRIES) {
        throw rejectArchive(`条目数量超过 ${ASSISTANT_SKILL_MAX_ARCHIVE_ENTRIES}`)
      }
      if (isSymbolicLinkEntry(entry)) throw rejectArchive(`包含符号链接：${entry.fileName}`)
      if (entry.fileName.endsWith('/')) continue

      const segments = safeSegments(entry.fileName)
      const fileName = segments[segments.length - 1] ?? ''
      const extension = lowerExtension(fileName)
      if ((ASSISTANT_SKILL_ARCHIVE_EXTENSIONS as readonly string[]).includes(extension)) {
        throw rejectArchive(`包含嵌套压缩包：${entry.fileName}`)
      }
      if (!isAssistantSkillTextFile(fileName)) {
        skipped.push({ path: entry.fileName, reason: '不是纯文本文件，只允许 .md 与 .txt' })
        continue
      }
      totalBytes += entry.uncompressedSize
      if (totalBytes > MAX_ARCHIVE_TOTAL_BYTES) {
        throw rejectLimit(`压缩包解压后总字节超过 ${MAX_ARCHIVE_TOTAL_BYTES}`)
      }
      entries.push({ segments, content: await readEntryBytes(archive, entry, entry.fileName) })
    }
  } finally {
    archive.close()
  }
  return entries
}

/**
 * 把一组文件收敛成一个待安装技能。只保留 `SKILL.md` 与 `references/` 下的文件——
 * 其他位置的文件运行时永远读不到，落盘只会让用户以为它们生效了。
 */
function prepareSkill(
  label: string,
  files: PreparedFile[],
  skipped: AssistantSkillSkippedFile[]
): PreparedSkill | null {
  const entryFile = files.find((file) => file.relativePath === ASSISTANT_SKILL_ENTRY_FILE)
  if (!entryFile) {
    skipped.push({ path: label, reason: `缺少 ${ASSISTANT_SKILL_ENTRY_FILE}` })
    return null
  }
  if (entryFile.content.byteLength > ASSISTANT_SKILL_MAX_BODY_BYTES) {
    throw rejectLimit(`${label} 的 ${ASSISTANT_SKILL_ENTRY_FILE} 超过 ${ASSISTANT_SKILL_MAX_BODY_BYTES} 字节`)
  }

  // frontmatter 非法直接抛出，错误消息带行号，用户可以照着改。
  const parsed = parseSkillFrontmatter(entryFile.content.toString('utf8'))

  const kept: PreparedFile[] = [entryFile]
  for (const file of files) {
    if (file === entryFile) continue
    if (!file.relativePath.startsWith(`${ASSISTANT_SKILL_REFERENCE_DIR}/`)) {
      skipped.push({
        path: `${label}/${file.relativePath}`,
        reason: `只保留 ${ASSISTANT_SKILL_ENTRY_FILE} 与 ${ASSISTANT_SKILL_REFERENCE_DIR}/ 下的文件`,
      })
      continue
    }
    if (!assistantSkillReferencePathSchema.safeParse(file.relativePath).success) {
      skipped.push({
        path: `${label}/${file.relativePath}`,
        reason: '引用路径含不支持的字符，只允许字母、数字、点、下划线和连字符',
      })
      continue
    }
    kept.push(file)
  }

  if (kept.length > ASSISTANT_SKILL_MAX_FILE_COUNT) {
    throw rejectLimit(`${label} 的文件数 ${kept.length} 超过 ${ASSISTANT_SKILL_MAX_FILE_COUNT}`)
  }
  const totalBytes = kept.reduce((total, file) => total + file.content.byteLength, 0)
  if (totalBytes > ASSISTANT_SKILL_MAX_TOTAL_BYTES) {
    throw rejectLimit(`${label} 的总字节 ${totalBytes} 超过 ${ASSISTANT_SKILL_MAX_TOTAL_BYTES}`)
  }
  // 目录名以 frontmatter 的 name 为准，压缩包里的文件夹名不一致时以 name 落盘。
  return { name: parsed.name, files: kept, totalBytes }
}

function groupArchiveEntries(
  entries: ArchiveEntryFile[],
  skipped: AssistantSkillSkippedFile[]
): Map<string, PreparedFile[]> {
  const groups = new Map<string, PreparedFile[]>()
  const rootIsSkill = entries.some(
    (entry) => entry.segments.length === 1 && entry.segments[0] === ASSISTANT_SKILL_ENTRY_FILE
  )
  for (const entry of entries) {
    if (rootIsSkill) {
      const group = groups.get('') ?? []
      group.push({ relativePath: entry.segments.join('/'), content: entry.content })
      groups.set('', group)
      continue
    }
    if (entry.segments.length < 2) {
      skipped.push({ path: entry.segments.join('/'), reason: '压缩包根目录下的散落文件' })
      continue
    }
    const [folder, ...rest] = entry.segments
    const group = groups.get(folder ?? '') ?? []
    group.push({ relativePath: rest.join('/'), content: entry.content })
    groups.set(folder ?? '', group)
  }
  return groups
}

async function prepareFromMarkdown(sourcePath: string): Promise<PreparedSkill[]> {
  const stats = await fs.stat(sourcePath)
  if (stats.size > ASSISTANT_SKILL_MAX_BODY_BYTES) {
    throw rejectLimit(`${ASSISTANT_SKILL_ENTRY_FILE} 超过 ${ASSISTANT_SKILL_MAX_BODY_BYTES} 字节`)
  }
  const raw = await fs.readFile(sourcePath, 'utf8')
  const parsed = parseSkillFrontmatter(raw)
  const content = Buffer.from(raw, 'utf8')
  return [{
    name: parsed.name,
    files: [{ relativePath: ASSISTANT_SKILL_ENTRY_FILE, content }],
    totalBytes: content.byteLength,
  }]
}

async function prepareFromArchive(
  sourcePath: string,
  skipped: AssistantSkillSkippedFile[]
): Promise<PreparedSkill[]> {
  // yauzl 自己也会拒绝一部分非法条目名（如 `../`），那些错误是原始 Error。
  // 统一收敛成 SKILL_ARCHIVE_REJECTED，界面才有稳定错误码可用，也不会把解压库的内部措辞抛给用户。
  const entries = await readArchiveEntries(sourcePath, skipped).catch((error: unknown) => {
    if (isAssistantSkillError(error)) throw error
    throw rejectArchive(error instanceof Error ? error.message : '无法读取压缩包')
  })
  const prepared: PreparedSkill[] = []
  for (const [label, files] of groupArchiveEntries(entries, skipped)) {
    const skill = prepareSkill(label || '压缩包根目录', files, skipped)
    if (skill) prepared.push(skill)
  }
  if (prepared.length === 0) {
    throw rejectArchive(`没有找到包含 ${ASSISTANT_SKILL_ENTRY_FILE} 的技能`)
  }
  const names = new Set(prepared.map((skill) => skill.name))
  if (names.size !== prepared.length) {
    throw rejectArchive('压缩包内存在同名技能')
  }
  return prepared
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function writePreparedSkill(rootDir: string, skill: PreparedSkill): Promise<string> {
  const skillDir = path.join(rootDir, skill.name)
  for (const file of skill.files) {
    const target = path.join(skillDir, ...file.relativePath.split('/'))
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, file.content)
  }
  return skillDir
}

/**
 * 先把全部技能写进用户目录下的临时目录，全部通过后再逐个整体改名到位。
 * 这样任何一步失败都不会在技能目录里留下半个技能。
 */
async function commitPreparedSkills(
  target: SkillInstallTarget,
  prepared: PreparedSkill[],
  overwrite: boolean
): Promise<{ installed: string[]; replaced: string[] }> {
  const manifest = await scanAssistantSkills({ ...target, disabledNames: [] })
  const knownNames = new Set(manifest.skills.map((skill) => skill.name))
  const addedCount = prepared.filter((skill) => !knownNames.has(skill.name)).length
  if (manifest.skills.length + addedCount > ASSISTANT_SKILL_MAX_COUNT) {
    throw rejectLimit(`安装后技能总数将超过 ${ASSISTANT_SKILL_MAX_COUNT}`)
  }

  const replaced: string[] = []
  for (const skill of prepared) {
    if (!(await pathExists(path.join(target.userDir, skill.name)))) continue
    if (!overwrite) {
      throw new AssistantSkillError('SKILL_ALREADY_EXISTS', `同名技能已存在：${skill.name}`)
    }
    replaced.push(skill.name)
  }

  await fs.mkdir(target.userDir, { recursive: true })
  const stagingDir = await fs.mkdtemp(path.join(target.userDir, '.install-'))
  const trashDirs: string[] = []
  try {
    for (const skill of prepared) {
      await writePreparedSkill(stagingDir, skill)
    }
    for (const skill of prepared) {
      const destination = path.join(target.userDir, skill.name)
      if (await pathExists(destination)) {
        const trash = path.join(stagingDir, `.replaced-${skill.name}`)
        await fs.rename(destination, trash)
        trashDirs.push(trash)
      }
      await fs.rename(path.join(stagingDir, skill.name), destination)
    }
  } finally {
    for (const trash of trashDirs) await fs.rm(trash, { recursive: true, force: true })
    await fs.rm(stagingDir, { recursive: true, force: true })
  }
  return { installed: prepared.map((skill) => skill.name), replaced }
}

export async function installAssistantSkillTo(
  target: SkillInstallTarget,
  request: AssistantSkillInstallRequest
): Promise<AssistantSkillInstallResult> {
  const parsedRequest = assistantSkillInstallRequestSchema.parse(request)
  const extension = lowerExtension(parsedRequest.sourcePath.replaceAll('\\', '/'))
  logger.info('安装智能助手技能开始', {
    event: 'assistant_skill.install.start',
    // 只记录来源类型，不记录用户源文件的绝对路径。
    context: { sourceExtension: extension, overwrite: parsedRequest.overwrite },
  })
  try {
    if (!(ASSISTANT_SKILL_SOURCE_EXTENSIONS as readonly string[]).includes(extension)) {
      throw new AssistantSkillError(
        'UNSUPPORTED_SKILL_SOURCE',
        `只支持安装 ${ASSISTANT_SKILL_SOURCE_EXTENSIONS.join(' 或 ')} 文件`
      )
    }
    const skippedFiles: AssistantSkillSkippedFile[] = []
    const prepared = extension === '.zip'
      ? await prepareFromArchive(parsedRequest.sourcePath, skippedFiles)
      : await prepareFromMarkdown(parsedRequest.sourcePath)
    const committed = await commitPreparedSkills(target, prepared, parsedRequest.overwrite)
    const result: AssistantSkillInstallResult = { ...committed, skippedFiles }
    logger.info('安装智能助手技能完成', {
      event: 'assistant_skill.install.completed',
      context: {
        installedCount: result.installed.length,
        replacedCount: result.replaced.length,
        skippedCount: result.skippedFiles.length,
        totalBytes: prepared.reduce((total, skill) => total + skill.totalBytes, 0),
      },
    })
    return result
  } catch (error) {
    logger.error('安装智能助手技能失败', {
      event: 'assistant_skill.install.failed',
      error,
      context: { sourceExtension: extension },
    })
    throw error
  }
}

export async function uninstallAssistantSkillFrom(
  target: SkillInstallTarget,
  name: string
): Promise<void> {
  logger.info('卸载智能助手技能开始', {
    event: 'assistant_skill.uninstall.start',
    context: { skill: name },
  })
  try {
    // 技能名来自渲染层，必须先过 schema 再参与路径拼接。
    const skillName = assistantSkillNameSchema.parse(name)
    const userSkillDir = path.join(target.userDir, skillName)
    if (!(await pathExists(userSkillDir))) {
      if (await pathExists(path.join(target.builtinDir, skillName))) {
        throw new AssistantSkillError(
          'SKILL_BUILTIN_READONLY',
          `内置技能不能删除，只能在技能管理里停用：${skillName}`
        )
      }
      throw new AssistantSkillError('SKILL_NOT_FOUND', `技能不存在：${skillName}`)
    }
    await fs.rm(userSkillDir, { recursive: true, force: true })
    logger.info('卸载智能助手技能完成', {
      event: 'assistant_skill.uninstall.completed',
      context: { skill: name },
    })
  } catch (error) {
    logger.error('卸载智能助手技能失败', {
      event: 'assistant_skill.uninstall.failed',
      error,
      context: { skill: name },
    })
    throw error
  }
}

function resolveInstallTarget(): SkillInstallTarget {
  return { builtinDir: getBuiltinSkillsDir(), userDir: getUserSkillsDir() }
}

export async function installAssistantSkill(
  request: AssistantSkillInstallRequest
): Promise<AssistantSkillInstallResult> {
  return installAssistantSkillTo(resolveInstallTarget(), request)
}

export async function uninstallAssistantSkill(name: string): Promise<void> {
  return uninstallAssistantSkillFrom(resolveInstallTarget(), name)
}

/**
 * 在系统文件管理器里打开用户技能目录。本期不做技能编辑器，用户改技能正文要靠外部编辑器，
 * 所以至少得能找到目录。目录不存在时先创建，否则首次使用会直接失败。
 */
export async function openAssistantSkillsDirectory(): Promise<string> {
  const userDir = getUserSkillsDir()
  await fs.mkdir(userDir, { recursive: true })
  const message = await shell.openPath(userDir)
  if (message) throw new Error(`无法打开技能目录：${message}`)
  logger.info('打开技能目录完成', { event: 'assistant_skill.open_dir.completed' })
  return userDir
}

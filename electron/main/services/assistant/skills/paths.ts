import fs from 'node:fs'
import path from 'node:path'

import {
  ASSISTANT_SKILL_MAX_REFERENCE_DEPTH,
  ASSISTANT_SKILL_REFERENCE_DIR,
  ASSISTANT_SKILL_TEXT_EXTENSIONS,
  AssistantSkillError,
  isAssistantSkillTextFile,
} from '../../../../../src/core/assistant/skills'
import { getDataRootDir } from '../../image/path-utils'

const BUILTIN_SKILLS_DIR_NAME = 'assistant-skills'

function builtinSkillsDirCandidates(): string[] {
  const candidates = [path.join(process.cwd(), 'resources', BUILTIN_SKILLS_DIR_NAME)]
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, BUILTIN_SKILLS_DIR_NAME))
    candidates.push(path.join(process.resourcesPath, 'resources', BUILTIN_SKILLS_DIR_NAME))
  }
  return candidates
}

/**
 * 内置技能目录：开发态取仓库内的 `resources/assistant-skills`，打包态取 `extraResources`
 * 释放出来的副本。与 ai-runtime/manifest.ts 的候选顺序保持一致。
 */
export function getBuiltinSkillsDir(): string {
  const candidates = builtinSkillsDirCandidates()
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0] ?? ''
}

/**
 * 用户技能目录。挂在 `getDataRootDir()` 下而不是应用本地目录，这样用户在设置里改数据
 * 目录时技能跟着走。目录不存在属于正常情况，这里不创建。
 */
export function getUserSkillsDir(): string {
  return path.join(getDataRootDir(), 'assistant', 'skills')
}

function reject(reason: string): AssistantSkillError {
  return new AssistantSkillError('SKILL_PATH_REJECTED', `技能文件路径被拒绝：${reason}`)
}

/**
 * 把技能内的相对引用路径解析成绝对路径，任一校验不通过即抛 `SKILL_PATH_REJECTED`。
 * 校验顺序：非空 → 非绝对路径 → 无空段与 `..` → 位于 references/ 下 → 层级与扩展名
 * 合法 → `path.resolve` 之后仍在技能目录内。最后一条是兜底，前面的规则已足以拦住穿越，
 * 但符号链接与平台差异让它值得保留。
 */
export function resolveSkillFilePath(skillDir: string, relativePath: string): string {
  const value = relativePath.trim()
  if (!value) throw reject('路径为空')
  if (value.includes('\0')) throw reject('路径包含空字符')
  if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.startsWith('/') || value.startsWith('\\')) {
    throw reject('不允许绝对路径')
  }

  const segments = value.split(/[\\/]/)
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw reject('路径包含空段或上级目录')
  }
  if (segments[0] !== ASSISTANT_SKILL_REFERENCE_DIR || segments.length < 2) {
    throw reject(`只能读取 ${ASSISTANT_SKILL_REFERENCE_DIR}/ 下的文件`)
  }
  if (segments.length > ASSISTANT_SKILL_MAX_REFERENCE_DEPTH + 1) {
    throw reject('路径层级过深')
  }
  if (!isAssistantSkillTextFile(segments[segments.length - 1] ?? '')) {
    throw reject(`只允许 ${ASSISTANT_SKILL_TEXT_EXTENSIONS.join(' / ')} 文件`)
  }

  const rootDir = path.resolve(skillDir)
  const resolved = path.resolve(rootDir, ...segments)
  if (!resolved.startsWith(rootDir + path.sep)) {
    throw reject('解析后超出技能目录')
  }
  return resolved
}

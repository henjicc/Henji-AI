import fsp from 'node:fs/promises'
import path from 'node:path'

import type { DocumentKindRegistry } from '../../../../src/core/documents/kinds'
import { entryNameKey, normalizeEntryName } from '../../../../src/core/documents/naming'
import type { NameCheckRequest, NameCheckResult } from '../../../../src/core/documents/types'
import { samePath } from '../../../../src/core/storage/pathSyntax'
import { DocumentLocationError, DocumentNameInvalidError, errorCode, ProjectNotFoundError } from './errors'
import type { DocumentWorkspace } from './workspace'

/*
 * 名称检查（实施方案 2.8，重要记录 015）：只在同一个文件夹里查重。
 * 项目查同级文件夹名，文档查同文件夹里的同名文件（名称 + 扩展名，因此不同类型可以同名）。
 * 文件系统不允许同一文件夹里文件与文件夹同名，所以文件、文件夹都参与比较。
 */

/** 文件夹里现有条目：比较键 → 实际名称。文件夹不存在时为空。 */
export async function readEntryNameKeys(folder: string): Promise<Map<string, string>> {
  try {
    const entries = await fsp.readdir(folder)
    return new Map(entries.map((name) => [entryNameKey(name), name]))
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return new Map()
    throw error
  }
}

/** 规范化用户输入的名称，非法时抛 DocumentNameInvalidError。 */
export function requireEntryName(input: string): string {
  const check = normalizeEntryName(input)
  if (!check.ok) throw new DocumentNameInvalidError(check.reason, check.message)
  return check.name
}

interface NameCheckDependencies {
  workspace: DocumentWorkspace
  kinds: DocumentKindRegistry
}

async function resolveFolder(
  request: NameCheckRequest,
  dependencies: NameCheckDependencies,
): Promise<{ folder: string; exclude?: string }> {
  const { workspace, kinds } = dependencies
  const location = request.location
  if ('folder' in location) {
    workspace.assertWritableLocation(location.folder)
    return { folder: path.resolve(location.folder) }
  }
  if ('renaming' in location) {
    workspace.assertWritableLocation(location.renaming)
    const existing = path.resolve(location.renaming)
    return { folder: path.dirname(existing), exclude: existing }
  }
  if (request.subject.type === 'project') {
    if (location.container.kind !== 'user') throw new DocumentLocationError('项目不能放在另一个项目里。')
    return { folder: workspace.layout().projectsDir }
  }
  const kind = kinds.require(request.subject.kind)
  const container = await workspace.resolveContainer(location.container)
  return { folder: workspace.defaultDocumentFolder(kind, container) }
}

export async function checkEntryName(
  request: NameCheckRequest,
  dependencies: NameCheckDependencies,
): Promise<NameCheckResult> {
  const check = normalizeEntryName(request.name)
  if (!check.ok) return { status: 'invalid', reason: check.reason, message: check.message }
  let resolved: { folder: string; exclude?: string }
  try {
    resolved = await resolveFolder(request, dependencies)
  } catch (error) {
    if (error instanceof DocumentLocationError || error instanceof ProjectNotFoundError) {
      return { status: 'invalid', reason: 'location', message: error.message }
    }
    throw error
  }
  const extension = request.subject.type === 'document' ? dependencies.kinds.require(request.subject.kind).extension : ''
  const entryName = `${check.name}${extension}`
  const candidate = path.join(resolved.folder, entryName)
  const existingName = (await readEntryNameKeys(resolved.folder)).get(entryNameKey(entryName))
  if (existingName !== undefined) {
    const existingPath = path.join(resolved.folder, existingName)
    if (!resolved.exclude || !samePath(dependencies.workspace.style, existingPath, resolved.exclude)) {
      return { status: 'duplicate', name: check.name, path: candidate, existingPath }
    }
  }
  return { status: 'available', name: check.name, path: candidate }
}

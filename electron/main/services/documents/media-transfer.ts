import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { sameEntryName } from '../../../../src/core/documents/naming'
import { INTERNAL_FOLDER_NAME } from '../../../../src/core/documents/projectManifest'
import { mapContentStrings, type LocationReference } from '../../../../src/core/storage/locationCodec'
import { parseAbsolutePath, pathKey, relativeSegments, type PathStyle } from '../../../../src/core/storage/pathSyntax'
import { copyFileNoOverwrite, EntryExistsError } from '../fs/no-overwrite'
import type { ResolvedContainer } from './workspace'

/*
 * 文档换容器时带走它用到的素材（实施方案 2.11）：原容器里被引用的文件复制到新容器，原处保留；
 * 外部文件与其他容器里的文件不动（引用照常换算成相对写法或外部路径）；其他文档文件不复制，
 * 跨文档引用继续指向原文档。
 *
 * 放置规则（保留原容器里的子路径）：
 * - 原容器“生成结果”下的 → 新容器的“生成结果”
 * - 原容器“素材”（作品目录为“上传素材”）下的 → 新容器的“素材”（作品目录为“上传素材”）
 * - 原容器 `.henji/` 下的内部资源 → 新容器的 `.henji/`
 * - 其他位置 → 新容器“素材”下保留相对路径
 * 目标已有同名文件时：内容相同直接复用，不同则改用“名称 (2).扩展名”，从不覆盖。
 */

export interface MediaTransferResult {
  /** 原文件的路径比较键 → 新位置。 */
  mapping: Map<string, string>
  copied: number
  missingPaths: string[]
}

export interface MediaTransferOptions {
  style: PathStyle
  /** 原容器换算内容时得到的引用（scope 为 container 的才是原容器里的文件）。 */
  references: readonly LocationReference[]
  from: ResolvedContainer
  to: ResolvedContainer
  /** 文档文件不复制。 */
  isDocumentFile(filePath: string): boolean
  /** 复制进新容器的 `.henji/` 前先建好它（Windows 上设为隐藏）。 */
  prepareInternalFolder?(containerRoot: string): Promise<unknown>
}

const MAX_KEEP_BOTH_ATTEMPTS = 1_000

async function fileDigest(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve())
  })
  return hash.digest('hex')
}

/** 两个文件内容是否相同（先比大小，再比 SHA-256）。 */
export async function sameFileContent(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([fsp.stat(left).catch(() => null), fsp.stat(right).catch(() => null)])
  if (!a?.isFile() || !b?.isFile() || a.size !== b.size) return false
  const [leftDigest, rightDigest] = await Promise.all([fileDigest(left), fileDigest(right)])
  return leftDigest === rightDigest
}

function targetFor(rest: readonly string[], from: ResolvedContainer, to: ResolvedContainer): string {
  const [first, ...tail] = rest
  if (first !== undefined && tail.length) {
    if (sameEntryName(first, path.basename(from.generatedDir))) return path.join(to.generatedDir, ...tail)
    if (sameEntryName(first, path.basename(from.materialsDir))) return path.join(to.materialsDir, ...tail)
    if (first === INTERNAL_FOLDER_NAME) return path.join(to.root, INTERNAL_FOLDER_NAME, ...tail)
  }
  return path.join(to.materialsDir, ...rest)
}

/** 复制到目标位置；重名且内容不同时依次改用“名称 (2)”。返回最终位置与是否真的复制了。 */
export async function copyKeepingBoth(source: string, desired: string): Promise<{ path: string; copied: boolean }> {
  const directory = path.dirname(desired)
  const extension = path.extname(desired)
  const stem = path.basename(desired, extension)
  for (let attempt = 1; attempt <= MAX_KEEP_BOTH_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 1 ? desired : path.join(directory, `${stem} (${attempt})${extension}`)
    try {
      await copyFileNoOverwrite(source, candidate)
      return { path: candidate, copied: true }
    } catch (error) {
      if (!(error instanceof EntryExistsError)) throw error
      if (await sameFileContent(source, candidate)) return { path: candidate, copied: false }
    }
  }
  throw new Error('目标文件夹里同名文件过多，请先整理后重试。')
}

export async function transferContainerMedia(options: MediaTransferOptions): Promise<MediaTransferResult> {
  const { style, from, to } = options
  const fromRoot = parseAbsolutePath(style, from.root)
  if (!fromRoot) throw new Error('原容器位置无效')
  const mapping = new Map<string, string>()
  const missingPaths: string[] = []
  let copied = 0
  for (const reference of options.references) {
    if (reference.scope !== 'container' || options.isDocumentFile(reference.path)) continue
    const parsed = parseAbsolutePath(style, reference.path)
    const rest = parsed ? relativeSegments(style, fromRoot, parsed) : null
    if (!rest?.length) continue
    const stat = await fsp.stat(reference.path).catch(() => null)
    if (!stat) {
      missingPaths.push(reference.path)
      continue
    }
    if (!stat.isFile()) continue
    const desired = targetFor(rest, from, to)
    if (rest[0] === INTERNAL_FOLDER_NAME) await options.prepareInternalFolder?.(to.root)
    const result = await copyKeepingBoth(reference.path, desired)
    const key = pathKey(style, reference.path)
    if (key) mapping.set(key, result.path)
    if (result.copied) copied += 1
  }
  return { mapping, copied, missingPaths }
}

/** 把内容里指向原文件的绝对路径换成复制后的新位置。 */
export function rewriteContentPaths(content: unknown, mapping: ReadonlyMap<string, string>, style: PathStyle): unknown {
  if (!mapping.size) return content
  return mapContentStrings(content, (value) => {
    const key = pathKey(style, value)
    return key !== null ? mapping.get(key) ?? value : value
  })
}

export interface MediaCollectOptions {
  style: PathStyle
  /** 文档内容换算时得到的引用（scope 不是 container 的都要收集）。 */
  references: readonly LocationReference[]
  /** 落在程序目录里的路径（文档里本不该出现），能读到的文件一并收集。 */
  programReferences: readonly string[]
  to: ResolvedContainer
  isDocumentFile(filePath: string): boolean
}

/**
 * 收集素材（重要记录 006，实施方案 2.11）：把文档用到的、不在所在容器里的文件
 * （外部文件、作品目录或别的项目里的文件、程序目录里的文件）复制进容器的“素材”文件夹，
 * 返回原位置 → 新位置的映射。原文件保留；其他文档文件不复制（跨文档引用照旧）。
 * 目标已有同名文件时内容相同就复用，不同则改用“名称 (2)”，从不覆盖。
 */
export async function collectContainerMedia(options: MediaCollectOptions): Promise<MediaTransferResult> {
  const { style, to } = options
  const mapping = new Map<string, string>()
  const missingPaths: string[] = []
  let copied = 0
  const candidates = [
    ...options.references.filter((reference) => reference.scope !== 'container').map((reference) => reference.path),
    ...options.programReferences.filter((value) => parseAbsolutePath(style, value) !== null),
  ]
  for (const source of candidates) {
    const key = pathKey(style, source)
    if (!key || mapping.has(key) || options.isDocumentFile(source)) continue
    const stat = await fsp.stat(source).catch(() => null)
    if (!stat) {
      if (!missingPaths.includes(source)) missingPaths.push(source)
      continue
    }
    if (!stat.isFile()) continue
    const result = await copyKeepingBoth(source, path.join(to.materialsDir, path.basename(source)))
    mapping.set(key, result.path)
    if (result.copied) copied += 1
  }
  return { mapping, copied, missingPaths }
}

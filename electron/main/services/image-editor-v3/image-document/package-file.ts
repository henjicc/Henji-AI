import { ZipArchive } from 'archiver'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import type { Readable } from 'node:stream'
import type * as yauzl from 'yauzl'

import { replaceFileAtomically } from '../../fs/atomic-file'
import { isSymbolicLinkEntry, iterateEntries, openEntryReadStream, openZip, readEntryBytes } from '../../zip-archive'
import {
  DEFAULT_HENJI_IMAGE_PACKAGE_LIMITS,
  HENJI_IMAGE_DOCUMENT_HEADER_ENTRY,
  HENJI_IMAGE_PACKAGE_MANIFEST,
  validateHenjiImagePackageManifest,
  validatePackageEntryPath,
  type HenjiImagePackageManifest,
} from '../package-types'
import { stagedPackagePathFor } from '../package-export'
import {
  ImageDocumentHeaderError,
  legacyImageDocumentHeader,
  parseImageDocumentHeaderBytes,
  serializeImageDocumentHeader,
  withImageEditDocumentId,
  type HenjiImageDocumentHeader,
} from './header'

/*
 * `.henjiimg` 的头信息读写（3.5 图片文档）。
 *
 * - 读：只解压 `henji-document.json` 这一个小条目；旧包没有头，才解压 manifest 推出头信息。
 * - 改：头信息与包内 V3 文档 ID 写在 zip 里，改不了单个条目，只能整包重写：
 *   逐条流式复制到暂存文件（资源条目不重新压缩），换上新的头与 manifest，刷盘后原子替换。
 *   失败时原文件保持原样。改名不需要重写（名称以文件名为准）。
 */

export interface ImageDocumentPackageHeaderRead {
  header: HenjiImageDocumentHeader
  /** 没有文档头的旧包（头信息由 manifest 推出）。 */
  legacy: boolean
}

export interface ImageDocumentHeaderChange {
  id?: string
  draft?: boolean
}

function entriesMatching(names: readonly string[]): (entry: yauzl.Entry) => boolean {
  const set = new Set(names)
  return (entry) => set.has(entry.fileName)
}

async function readSmallEntries(filePath: string, names: readonly string[]): Promise<Map<string, Buffer>> {
  const archive = await openZip(filePath)
  const wanted = entriesMatching(names)
  const found = new Map<string, Buffer>()
  try {
    for await (const entry of iterateEntries(archive)) {
      if (!wanted(entry)) continue
      const limit = entry.fileName === HENJI_IMAGE_PACKAGE_MANIFEST
        ? DEFAULT_HENJI_IMAGE_PACKAGE_LIMITS.maxManifestBytes
        : 64 * 1024
      if (entry.uncompressedSize > limit) throw new ImageDocumentHeaderError(`图片文档条目过大：${entry.fileName}`)
      found.set(entry.fileName, await readEntryBytes(archive, entry, entry.fileName))
      if (found.size === names.length) break
    }
  } finally {
    archive.close()
  }
  return found
}

function parseManifest(bytes: Buffer): HenjiImagePackageManifest {
  try {
    return validateHenjiImagePackageManifest(JSON.parse(bytes.toString('utf8')) as unknown)
  } catch (error) {
    throw new ImageDocumentHeaderError(`图片文档内容无效：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 只读包里的文档头条目（`henji-document.json`）原始字节；没有时返回 null。画布内嵌图层包也用这个条目放自己的头。 */
export async function readPackageDocumentHeaderBytes(filePath: string): Promise<Buffer | null> {
  return (await readSmallEntries(filePath, [HENJI_IMAGE_DOCUMENT_HEADER_ENTRY])).get(HENJI_IMAGE_DOCUMENT_HEADER_ENTRY) ?? null
}

export async function readImageDocumentPackageHeader(filePath: string): Promise<ImageDocumentPackageHeaderRead> {
  const header = (await readSmallEntries(filePath, [HENJI_IMAGE_DOCUMENT_HEADER_ENTRY])).get(HENJI_IMAGE_DOCUMENT_HEADER_ENTRY)
  if (header) return { header: parseImageDocumentHeaderBytes(header), legacy: false }
  const manifest = (await readSmallEntries(filePath, [HENJI_IMAGE_PACKAGE_MANIFEST])).get(HENJI_IMAGE_PACKAGE_MANIFEST)
  if (!manifest) throw new ImageDocumentHeaderError('不是有效的图片文档：缺少内容清单')
  const parsed = parseManifest(manifest)
  return { header: legacyImageDocumentHeader(parsed.document, parsed.createdAt), legacy: true }
}

function appendAndWait(archive: ZipArchive, input: Readable | Buffer | string, name: string, store: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEntry = (entry: { name: string }): void => {
      if (entry.name !== name) return
      cleanup()
      resolve()
    }
    const onError = (error: unknown): void => {
      cleanup()
      reject(error)
    }
    const cleanup = (): void => {
      archive.off('entry', onEntry)
      archive.off('error', onError)
    }
    archive.on('entry', onEntry)
    archive.once('error', onError)
    archive.append(input, { name, store })
  })
}

/**
 * 改写包头（副本换 ID、草稿转正、旧包补头）。ID 变化时 manifest 里的 V3 文档 ID 一并改写，
 * 包内清单与文档头始终是同一个 ID。没有实际变化时不写文件。
 */
export async function rewriteImageDocumentPackageHeader(
  filePath: string,
  change: ImageDocumentHeaderChange,
  now: () => Date = () => new Date(),
): Promise<HenjiImageDocumentHeader> {
  const current = await readImageDocumentPackageHeader(filePath)
  const nextId = change.id ?? current.header.id
  const nextDraft = change.draft ?? current.header.draft
  if (!current.legacy && nextId === current.header.id && nextDraft === current.header.draft) return current.header
  const header: HenjiImageDocumentHeader = {
    ...current.header,
    id: nextId,
    draft: nextDraft,
    updatedAt: now().toISOString(),
  }
  const stagedPath = stagedPackagePathFor(filePath)
  const archive = await openZip(filePath)
  try {
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(stagedPath, { flags: 'wx', mode: 0o600 })
      const writer = new ZipArchive({ zlib: { level: 6 } })
      let settled = false
      const settle = (error?: unknown): void => {
        if (settled) return
        settled = true
        if (error) {
          writer.abort()
          output.destroy()
          reject(error)
        } else {
          resolve()
        }
      }
      output.once('close', () => settle())
      output.once('error', settle)
      writer.once('warning', settle)
      writer.pipe(output)
      void (async () => {
        let manifestSeen = false
        for await (const entry of iterateEntries(archive)) {
          if (isSymbolicLinkEntry(entry)) throw new ImageDocumentHeaderError(`图片文档包含符号链接：${entry.fileName}`)
          validatePackageEntryPath(entry.fileName)
          if (entry.fileName === HENJI_IMAGE_DOCUMENT_HEADER_ENTRY) continue
          if (entry.fileName === HENJI_IMAGE_PACKAGE_MANIFEST) {
            manifestSeen = true
            const manifest = parseManifest(await readEntryBytes(archive, entry, entry.fileName))
            const rewritten = validateHenjiImagePackageManifest({
              ...manifest,
              document: withImageEditDocumentId(manifest.document, nextId),
            })
            await appendAndWait(writer, `${JSON.stringify(rewritten)}\n`, entry.fileName, false)
            continue
          }
          const stream = await openEntryReadStream(archive, entry, entry.fileName)
          // 资源条目原本就不压缩（图片已压缩），保持一致避免重复 deflate。
          await appendAndWait(writer, stream, entry.fileName, entry.fileName.startsWith('resources/'))
        }
        if (!manifestSeen) throw new ImageDocumentHeaderError('不是有效的图片文档：缺少内容清单')
        await appendAndWait(writer, serializeImageDocumentHeader(header), HENJI_IMAGE_DOCUMENT_HEADER_ENTRY, false)
        await writer.finalize()
      })().catch(settle)
    })
    const staged = await fsp.open(stagedPath, 'r+')
    try {
      await staged.sync()
    } finally {
      await staged.close()
    }
    await replaceFileAtomically(stagedPath, filePath)
    return header
  } catch (error) {
    await fsp.rm(stagedPath, { force: true }).catch(() => undefined)
    throw error
  } finally {
    archive.close()
  }
}

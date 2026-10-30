import fsp from 'node:fs/promises'
import path from 'node:path'
import { isPathInside, type PathStyle } from '../../../../src/core/storage/pathSyntax'
import { codeWebFolderOf } from '../../../../src/core/videoEdit/codeMaterial/webSource'
import { copyFileNoOverwrite } from '../fs/no-overwrite'
import { resolveWebSourceFolder, webSourceContentHash, webSourceFiles } from '../web-source/site'

/**
 * 网页画面（代码图片参数 `{kind:'web', path}`）引用的是整个网页文件夹：`path` 写文件夹本身或其中的 index.html。
 * 换容器、收集素材、打包时整个文件夹一起带上，引用改指向新位置（原来写文件夹还是写 index.html 保持不变）；
 * 不能只带 index.html，也不能悄悄跳过。
 */
export interface ContentWebReference { reference: string; folder: string }

/** 内容里全部网页画面引用（同一路径只列一次）。 */
export function contentWebReferences(content: unknown): ContentWebReference[] {
  const found = new Map<string, ContentWebReference>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (record.kind === 'web' && typeof record.path === 'string') {
      const folder = codeWebFolderOf(record.path)
      if (folder && !found.has(record.path)) found.set(record.path, { reference: record.path, folder })
    }
    Object.values(record).forEach(visit)
  }
  visit(content)
  return [...found.values()]
}

/** 文件夹搬到 `target` 后引用的新写法。 */
export function webReferenceIn(web: ContentWebReference, target: string): string {
  return web.reference === web.folder ? target : path.join(target, path.basename(web.reference))
}

/** 网页文件夹在且含 index.html 时为文件夹位置，否则 null（调用方按缺失文件报告）。 */
export async function existingWebFolder(web: ContentWebReference): Promise<string | null> {
  return (await resolveWebSourceFolder(web.reference).catch(() => null))?.root ?? null
}

/**
 * 网页文件夹就是项目（容器）文件夹本身、或包含了它时没法单独带上：整个项目会被当成网页复制进自己或包里。
 * 换容器、收集素材、打包都在这里明确报错。
 */
export function assertSeparateWebFolder(style: PathStyle, folder: string, containerRoot: string): void {
  if (!isPathInside(style, folder, containerRoot)) return
  const same = isPathInside(style, containerRoot, folder)
  throw new Error(`网页文件夹${same ? '就是项目文件夹本身' : '包含了项目文件夹'}，没法单独带上：${folder}。请把网页放进单独的文件夹后再试。`)
}

const MAX_KEEP_BOTH_ATTEMPTS = 1_000

/**
 * 把网页文件夹整个复制到 `desired`：目标已有同名文件夹时，内容完全相同就复用，不同则改用“名称 (2)”，从不覆盖、不合并。
 * 目标落在网页文件夹自己里面（网页文件夹包含了目标项目）时拒绝，免得把文件夹复制进自己。
 */
export async function copyWebFolder(style: PathStyle, source: string, desired: string): Promise<{ path: string; copied: number }> {
  if (isPathInside(style, source, desired)) throw new Error(`网页文件夹包含了目标位置，没法整个带上：${source}。请把网页放进单独的文件夹后再试。`)
  const files = await webSourceFiles(source)
  let sourceHash: string | undefined
  await fsp.mkdir(path.dirname(desired), { recursive: true })
  for (let attempt = 1; attempt <= MAX_KEEP_BOTH_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 1 ? desired : `${desired} (${attempt})`
    // 先排他地建出空文件夹占住名字，再往里复制：同名文件夹已在时不往里合并。
    const created = await fsp.mkdir(candidate).then(() => true, (error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST') return false
      throw error
    })
    if (created) {
      try {
        for (const item of files) await copyFileNoOverwrite(item.file, path.join(candidate, ...item.relative.split('/')))
      } catch (error) {
        await fsp.rm(candidate, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
      return { path: candidate, copied: files.length }
    }
    sourceHash ??= await webSourceContentHash(source)
    if ((await fsp.stat(candidate)).isDirectory() && await webSourceContentHash(candidate) === sourceHash) return { path: candidate, copied: 0 }
  }
  throw new Error('目标文件夹里同名网页文件夹过多，请先整理后重试。')
}

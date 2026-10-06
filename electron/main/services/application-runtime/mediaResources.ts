import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { inferMimeFromPath, isPathWithinAllowedMediaRoots } from '../../protocol'
import { getAssetFilePath } from '../asset-library'
import { getGenerationHistoryStore } from '../generation-history/store'
import { getDataRootDir } from '../image/path-utils'
import { normalizeLocalSource } from '../image/source'
import { createMainLogger } from '../logging'
import { getDocumentService } from '../documents/runtime'
import { resolveCanvasMediaSchema } from '../canvas-media-schema'
import { decodeCanvasImageReference, parseCanvasDocumentGraph } from '../../../../src/core/canvas/canvasDocumentGraph'
import { mapCanvasNodeMediaReferences } from '../../../../src/core/canvas/nodeMediaReferences'
import { APPLICATION_READABLE_MEDIA_KINDS } from '../../../../src/core/application-control/mediaReferenceKinds'

const logger = createMainLogger('main.mcp.media')
export class ApplicationMediaResourceError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ApplicationMediaResourceError' }
}
function failure(code: string, message: string): never { throw new ApplicationMediaResourceError(code, message) }
const inputSchema = z.object({
  ref: z.object({ kind: z.enum(APPLICATION_READABLE_MEDIA_KINDS), id: z.string().min(1).max(512) }).strict(),
  outputIndex: z.number().int().min(0).max(10_000).default(0),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  length: z.number().int().min(1).max(256 * 1024).default(256 * 1024),
}).strict()

async function sources(ref: z.infer<typeof inputSchema>['ref']): Promise<string[]> {
  // 参数只作为完整业务主键交给各自的仓库，绝不作为文件路径或 SQL 片段；仓库返回已换回的绝对路径。
  if (ref.kind === 'asset') {
    const filePath = getAssetFilePath(ref.id)
    if (!filePath) failure('MEDIA_NOT_PERSISTED', '媒体尚未保存或原记录不存在，请先查询原任务结果。')
    return [filePath]
  }
  if (ref.kind === 'generation.result') {
    const resultPaths = getGenerationHistoryStore().get(ref.id)?.resultPaths ?? []
    if (resultPaths.length === 0) failure('MEDIA_NOT_PERSISTED', '媒体尚未保存或原记录不存在，请先查询原任务结果。')
    return resultPaths
  }
  const separator = ref.id.indexOf(':')
  if (separator < 1 || separator === ref.id.length - 1) failure('INVALID_REFERENCE', '请使用包含原画布的完整画布节点引用。')
  // 画布节点引用是“画布文档 ID:节点 ID”；从画布文件读（内容里的位置已换回绝对路径）
  let content: unknown
  try {
    content = (await getDocumentService().readDocument({ id: ref.id.slice(0, separator) })).content
  } catch (error) {
    if (error instanceof Error && error.name === 'DocumentNotFoundError') failure('NOT_FOUND', '原画布不存在。')
    throw error
  }
  const graph = parseCanvasDocumentGraph(content, resolveCanvasMediaSchema)
  const node = graph.nodes.find((item) => item.id === ref.id.slice(separator + 1))
  if (!node) failure('NOT_FOUND', '原画布节点不存在。')
  const found = new Set<string>()
  mapCanvasNodeMediaReferences(node.data, (value) => { found.add(decodeCanvasImageReference(value, graph.imagePool, 'nodes')); return value }, resolveCanvasMediaSchema)
  return [...found]
}

/** 只读取稳定业务引用已保存的本地媒体；连接授权由 MCP 服务在调用前核对。 */
export async function readApplicationMediaResource(input: {
  ref: { kind: string; id: string }; outputIndex?: number; offset?: number; length?: number
}, metadataOnly = false): Promise<{ mimeType: string; base64: string; offset: number; byteLength: number; totalBytes: number; eof: boolean }> {
  const parsed = inputSchema.parse(input)
  logger.debug('开始读取关联媒体', { event: 'mcp.media.read.start', context: { kind: parsed.ref.kind } })
  try {
    const source = (await sources(parsed.ref))[parsed.outputIndex]
    if (!source) failure('MEDIA_INDEX_OUT_OF_RANGE', '此媒体序号不存在，请查询原业务结果。')
    if (/^(?:https?:|data:|blob:)/i.test(source)) failure('MEDIA_NOT_LOCAL', '媒体尚未由应用保存到本地，请先完成原任务保存。')
    const normalized = normalizeLocalSource(source)
    const local = path.isAbsolute(normalized) ? normalized : path.resolve(getDataRootDir(), normalized)
    if (!isPathWithinAllowedMediaRoots(local)) failure('MEDIA_ACCESS_DENIED', '媒体不在应用已授权目录内。')
    const real = await fs.realpath(local)
    if (!isPathWithinAllowedMediaRoots(real)) failure('MEDIA_ACCESS_DENIED', '媒体链接指向未授权目录。')
    const mimeType = inferMimeFromPath(real)
    if (!/^(?:image|video|audio)\//.test(mimeType)) failure('UNSUPPORTED_MEDIA_TYPE', '此资源不是可读取的图片、视频或音频。')
    const file = await fs.open(real, 'r')
    try {
      const stat = await file.stat()
      if (!stat.isFile()) failure('UNSUPPORTED_MEDIA_TYPE', '媒体不是普通文件。')
      if (parsed.offset > stat.size) failure('MEDIA_RANGE_OUT_OF_BOUNDS', '读取位置超出媒体末尾。')
      if (metadataOnly) return { mimeType, base64: '', offset: 0, byteLength: 0, totalBytes: stat.size, eof: stat.size === 0 }
      const buffer = Buffer.alloc(Math.min(parsed.length, stat.size - parsed.offset))
      const { bytesRead } = await file.read(buffer, 0, buffer.length, parsed.offset)
      logger.debug('关联媒体读取完成', { event: 'mcp.media.read.completed', context: { kind: parsed.ref.kind, byteLength: bytesRead } })
      return { mimeType, base64: buffer.subarray(0, bytesRead).toString('base64'), offset: parsed.offset, byteLength: bytesRead, totalBytes: stat.size, eof: parsed.offset + bytesRead >= stat.size }
    } finally { await file.close() }
  } catch (error) {
    logger.warn('关联媒体读取失败', { event: 'mcp.media.read.failed', context: { kind: parsed.ref.kind } })
    // 文件系统错误可能包含本地路径；不将其透传到外部客户端。
    if (error instanceof ApplicationMediaResourceError) throw error
    throw new ApplicationMediaResourceError('MEDIA_READ_FAILED', '媒体读取未完成：请确认原文件仍然存在且所属文档可正常读取。')
  }
}

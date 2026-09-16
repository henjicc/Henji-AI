import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { inferMimeFromPath, isPathWithinAllowedMediaRoots } from '../../protocol'
import { getDb } from '../db'
import { getDataRootDir } from '../image/path-utils'
import { normalizeLocalSource } from '../image/source'
import { createMainLogger } from '../logging'
import { getStoryboardProject } from '../storyboard-projects'
import { resolveStoryboardProjectMediaSchema } from '../storyboard-project-validation'
import { decodeCanvasProjectImageReference, parseCanvasProjectRecord } from '../../../../src/core/canvas/projectRecordCodec'
import { mapCanvasNodeMediaReferences } from '../../../../src/core/canvas/nodeMediaReferences'

const logger = createMainLogger('main.mcp.media')
export class McpMediaResourceError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'McpMediaResourceError' }
}
function failure(code: string, message: string): never { throw new McpMediaResourceError(code, message) }
const inputSchema = z.object({
  ref: z.object({ kind: z.enum(['generation.result', 'asset', 'canvas.node']), id: z.string().min(1).max(512) }).strict(),
  outputIndex: z.number().int().min(0).max(10_000).default(0),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  length: z.number().int().min(1).max(256 * 1024).default(256 * 1024),
}).strict()

function sources(ref: z.infer<typeof inputSchema>['ref']): string[] {
  if (ref.kind === 'asset' || ref.kind === 'generation.result') {
    // 参数只作为完整业务主键绑定，绝不作为文件路径或 SQL 片段。
    const row = getDb().prepare(ref.kind === 'asset'
      ? 'SELECT file_path FROM assets WHERE id = ?'
      : 'SELECT file_path FROM history WHERE id = ?').get(ref.id) as { file_path: string | null } | undefined
    if (!row?.file_path) failure('MEDIA_NOT_PERSISTED', '媒体尚未保存或原记录不存在，请先查询原任务结果。')
    return ref.kind === 'generation.result' ? row.file_path.split('|||') : [row.file_path]
  }
  const separator = ref.id.indexOf(':')
  if (separator < 1 || separator === ref.id.length - 1) failure('INVALID_REFERENCE', '请使用包含原工程的完整画布节点引用。')
  const record = getStoryboardProject(ref.id.slice(0, separator))
  if (!record) failure('NOT_FOUND', '原画布工程不存在。')
  const project = parseCanvasProjectRecord(record, resolveStoryboardProjectMediaSchema)
  const node = project.nodes.find((item) => item.id === ref.id.slice(separator + 1))
  if (!node) failure('NOT_FOUND', '原画布节点不存在。')
  const found = new Set<string>()
  mapCanvasNodeMediaReferences(node.data, (value) => { found.add(decodeCanvasProjectImageReference(value, project.imagePool, 'nodesJson')); return value }, resolveStoryboardProjectMediaSchema)
  return [...found]
}

/** 只读取稳定业务引用已保存的本地媒体；连接授权由 MCP 服务在调用前核对。 */
export async function readMcpMediaResource(input: {
  ref: { kind: string; id: string }; outputIndex?: number; offset?: number; length?: number
}): Promise<{ mimeType: string; base64: string; offset: number; byteLength: number; totalBytes: number; eof: boolean }> {
  const parsed = inputSchema.parse(input)
  logger.debug('开始读取关联媒体', { event: 'mcp.media.read.start', context: { kind: parsed.ref.kind } })
  try {
    const source = sources(parsed.ref)[parsed.outputIndex]
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
      const buffer = Buffer.alloc(Math.min(parsed.length, stat.size - parsed.offset))
      const { bytesRead } = await file.read(buffer, 0, buffer.length, parsed.offset)
      logger.debug('关联媒体读取完成', { event: 'mcp.media.read.completed', context: { kind: parsed.ref.kind, byteLength: bytesRead } })
      return { mimeType, base64: buffer.subarray(0, bytesRead).toString('base64'), offset: parsed.offset, byteLength: bytesRead, totalBytes: stat.size, eof: parsed.offset + bytesRead >= stat.size }
    } finally { await file.close() }
  } catch (error) {
    logger.warn('关联媒体读取失败', { event: 'mcp.media.read.failed', context: { kind: parsed.ref.kind } })
    // 文件系统错误可能包含本地路径；不将其透传到外部客户端。
    if (error instanceof McpMediaResourceError) throw error
    throw new McpMediaResourceError('MEDIA_READ_FAILED', '媒体读取未完成：请确认原文件仍然存在且原工程数据可正常读取。')
  }
}

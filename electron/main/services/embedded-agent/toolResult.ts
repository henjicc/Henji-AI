import { z } from 'zod'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'

const chunkSchema = z.object({ mimeType: z.string(), base64: z.string(), offset: z.number().int().nonnegative(),
  byteLength: z.number().int().positive(), totalBytes: z.number().int().positive(), eof: z.boolean() })
type ToolResult = Awaited<ReturnType<ToolDefinition['execute']>>
type CallTool = (id: string, name: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>
const textResult = (text: string): ToolResult => ({ content: [{ type: 'text', text }], details: undefined })
const MAX_IMAGE_BYTES = 16 * 1024 * 1024

/** MCP 的文字镜像无需再次进入模型上下文，额外说明仍完整保留。 */
function applicationResultText(result: unknown): string {
  const parsed = z.object({ isError: z.boolean(), structuredContent: z.unknown().optional(),
    content: z.array(z.unknown()).optional() }).passthrough().safeParse(result)
  if (!parsed.success) return JSON.stringify(result)
  const envelope = parsed.data
  const structured = envelope.structuredContent === undefined ? undefined : JSON.stringify(envelope.structuredContent)
  const extra = (envelope.content ?? []).filter(item => {
    const text = z.object({ type: z.literal('text'), text: z.string() }).safeParse(item)
    return !text.success || text.data.text !== structured
  })
  const text = structured === undefined
    ? JSON.stringify(extra)
    : extra.length === 0 ? structured : JSON.stringify({ result: envelope.structuredContent, content: extra })
  // Pi 官方执行循环通过异常标记 toolResult.isError，普通返回值不表示失败。
  if (envelope.isError) throw new Error(text)
  return text
}

/** 仅消费受控媒体工具返回的字节，不解析路径或下载任意 URL。 */
export async function executePiTool(input: { id: string; name: string; args: Record<string, unknown>; signal?: AbortSignal; vision: boolean }, call: CallTool): Promise<ToolResult> {
  if (input.name !== 'read_application_media') return textResult(applicationResultText(await call(input.id, input.name, input.args, input.signal)))
  if (!input.vision) return textResult('当前模型不支持图片理解。请让用户切换支持图片的模型；可以继续读取媒体记录的文字属性，不要声称已看到图片。')
  const chunks: Buffer[] = []
  let offset = 0
  let mimeType: string | undefined
  let totalBytes: number | undefined
  while (offset < MAX_IMAGE_BYTES) {
    input.signal?.throwIfAborted()
    const result = await call(`${input.id}:${offset}`, input.name, { ...input.args, offset, length: 256 * 1024 }, input.signal)
    const envelope = z.object({ isError: z.boolean().optional(), structuredContent: z.unknown().optional() }).passthrough().parse(result)
    if (envelope.isError) applicationResultText(result)
    const chunk = chunkSchema.parse(envelope.structuredContent)
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(chunk.mimeType)) return textResult('这份媒体的格式暂不支持直接理解。可以读取文字属性；若需要分析画面，请提供 PNG、JPEG、WebP 或 GIF 图片。视频和音频需要另行适配。')
    if (chunk.totalBytes > MAX_IMAGE_BYTES) return textResult('图片超过 16 MiB，请先缩小图片后再分析。')
    if (chunk.offset !== offset || (mimeType !== undefined && mimeType !== chunk.mimeType) || (totalBytes !== undefined && totalBytes !== chunk.totalBytes)) throw new Error('图片读取期间发生变化，请重新读取原媒体。')
    mimeType = chunk.mimeType; totalBytes = chunk.totalBytes
    const bytes = Buffer.from(chunk.base64, 'base64')
    if (bytes.byteLength !== chunk.byteLength || offset + bytes.byteLength > totalBytes) throw new Error('图片读取不完整，请重新读取原媒体。')
    chunks.push(bytes)
    offset += bytes.byteLength
    if (chunk.eof) {
      if (offset !== totalBytes) throw new Error('图片尚未完整读取，不能分析，请重试。')
      return { content: [{ type: 'text', text: '以下是该业务引用关联的完整图片。' }, { type: 'image', data: Buffer.concat(chunks).toString('base64'), mimeType }], details: undefined }
    }
  }
  throw new Error('图片读取未结束，请缩小图片后重试。')
}

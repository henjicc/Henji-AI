import { describe, expect, it, vi } from 'vitest'
import { executePiTool } from './toolResult'

const input = { id: 'tool', name: 'read_application_media', args: { ref: { kind: 'asset', id: 'asset' } }, vision: true }
const chunk = (text: string, offset: number, totalBytes: number, eof: boolean, mimeType = 'image/png') => ({ isError: false,
  structuredContent: { mimeType, base64: Buffer.from(text).toString('base64'), byteLength: Buffer.byteLength(text), offset, totalBytes, eof } })
describe('Pi media result boundary', () => {
  it('普通工具去掉结构化结果的文字镜像，并保留额外说明', async () => {
    const data = { ok: true, data: { task: 'task-1' } }
    const envelope = { isError: false, structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] }
    const ordinary = { ...input, name: 'get_application_operation' }
    const result = await executePiTool(ordinary, vi.fn().mockResolvedValue(envelope))
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(data) }])
    const extra = { type: 'text', text: '继续查询任务状态' }
    const withExtra = await executePiTool(ordinary, vi.fn().mockResolvedValue({ ...envelope, content: [...envelope.content, extra] }))
    expect(withExtra.content).toEqual([{ type: 'text', text: JSON.stringify({ result: data, content: [extra] }) }])
  })
  it('普通和媒体工具的 MCP 失败均交给 Pi 错误机制，保留原操作与恢复信息', async () => {
    const data = { ok: false, operationId: 'original-operation', executionState: 'unknown', recovery: '查询 original-operation，不要重复提交' }
    const envelope = { isError: true, structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] }
    for (const name of ['get_application_operation', 'read_application_media']) {
      await expect(executePiTool({ ...input, name }, vi.fn().mockResolvedValue(envelope))).rejects.toThrow(JSON.stringify(data))
    }
    await expect(executePiTool({ ...input, name: 'read_project' }, vi.fn().mockResolvedValue({ isError: true,
      content: [{ type: 'text', text: '项目不存在，请读取项目列表' }] }))).rejects.toThrow('请读取项目列表')
  })
  it('拼完整分块并返回原生图片内容，文字中没有 base64', async () => {
    const call = vi.fn().mockResolvedValueOnce(chunk('abc', 0, 6, false)).mockResolvedValueOnce(chunk('def', 3, 6, true))
    const result = await executePiTool(input, call)
    expect(result.content[1]).toEqual({ type: 'image', data: Buffer.from('abcdef').toString('base64'), mimeType: 'image/png' })
    expect(call.mock.calls[1][2]).toMatchObject({ ref: input.args.ref, offset: 3 })
  })
  it('不支持视觉、视频和超大图片均给出可行动的说明，不把字节当文字', async () => {
    const call = vi.fn()
    expect(JSON.stringify(await executePiTool({ ...input, vision: false }, call))).toContain('切换')
    expect(call).not.toHaveBeenCalled()
    call.mockResolvedValue(chunk('abc', 0, 3, true, 'video/mp4'))
    expect(JSON.stringify(await executePiTool(input, call))).toContain('视频和音频')
    call.mockResolvedValue(chunk('abc', 0, 17 * 1024 * 1024, false))
    expect(JSON.stringify(await executePiTool(input, call))).toContain('缩小')
  })
  it('拒绝缺块、变更和取消，不能把不完整图片交给模型', async () => {
    await expect(executePiTool(input, vi.fn().mockResolvedValue(chunk('abc', 0, 6, true)))).rejects.toThrow('完整')
    const changing = vi.fn().mockResolvedValueOnce(chunk('abc', 0, 6, false)).mockResolvedValueOnce(chunk('def', 3, 7, true))
    await expect(executePiTool(input, changing)).rejects.toThrow('变化')
    const controller = new AbortController(); controller.abort()
    const call = vi.fn()
    await expect(executePiTool({ ...input, signal: controller.signal }, call)).rejects.toThrow()
    expect(call).not.toHaveBeenCalled()
  })
})

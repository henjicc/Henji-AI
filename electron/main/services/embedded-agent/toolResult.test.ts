import { describe, expect, it, vi } from 'vitest'
import { executePiTool } from './toolResult'

const input = { id: 'tool', name: 'read_application_media', args: { ref: { kind: 'asset', id: 'asset' } }, vision: true }
const chunk = (text: string, offset: number, totalBytes: number, eof: boolean, mimeType = 'image/png') => ({ isError: false,
  structuredContent: { mimeType, base64: Buffer.from(text).toString('base64'), byteLength: Buffer.byteLength(text), offset, totalBytes, eof } })
describe('Pi media result boundary', () => {
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

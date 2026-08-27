import { describe, expect, it } from 'vitest'

import { PortableUtf8StreamDecoder } from '../../src/llm/utf8-stream-decoder'

describe('PortableUtf8StreamDecoder', () => {
  it('跨 chunk 保留中文与 emoji 多字节字符', () => {
    const decoder = new PortableUtf8StreamDecoder()
    const bytes = Uint8Array.from([
      0xe4, 0xbd, 0xa0, 0xe5, 0xa5, 0xbd,
      0xf0, 0x9f, 0x98, 0x80,
    ])

    expect(decoder.decode(bytes.slice(0, 1), { stream: true })).toBe('')
    expect(decoder.decode(bytes.slice(1, 7), { stream: true })).toBe('你好')
    expect(decoder.decode(bytes.slice(7, 9), { stream: true })).toBe('')
    expect(decoder.decode(bytes.slice(9), { stream: true })).toBe('😀')
    expect(decoder.decode()).toBe('')
  })

  it('用替换字符处理畸形、过长、代理项与越界序列', () => {
    const decoder = new PortableUtf8StreamDecoder()
    const malformed = Uint8Array.from([
      0x66,
      0x80,
      0xc0, 0xaf,
      0xe2, 0x28, 0xa1,
      0xe1, 0x80, 0x41,
      0xe0, 0x80, 0x80,
      0xed, 0xa0, 0x80,
      0xf4, 0x90, 0x80, 0x80,
    ])

    expect(decoder.decode(malformed)).toBe('f����(��A����������')
  })

  it('流式尾段暂存，flush 时只产生一个替换字符', () => {
    const decoder = new PortableUtf8StreamDecoder()

    expect(decoder.decode(Uint8Array.from([0xe2, 0x82]), { stream: true })).toBe('')
    expect(decoder.decode()).toBe('�')
    expect(decoder.decode()).toBe('')
  })
})

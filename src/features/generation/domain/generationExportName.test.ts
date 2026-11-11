import { describe, expect, it } from 'vitest'
import { createExportNameAllocator, generationExportBaseName } from './generationExportName'

describe('生成结果导出命名', () => {
  it('日期_模型_提示词开头，多结果带序号，非法字符换成空格', () => {
    const base = { createdAt: new Date(2026, 10, 11, 3, 1), modelName: 'GPT Image 2.6', prompt: '宋代女子:梳宋制低盘发/中分发缝，发丝服帖地向后收拢' }
    expect(generationExportBaseName({ ...base, outputIndex: 0, outputCount: 1 })).toBe('2026-11-11_GPT Image 2.6_宋代女子 梳宋制低盘发 中分发缝')
    expect(generationExportBaseName({ ...base, outputIndex: 2, outputCount: 4 })).toBe('2026-11-11_GPT Image 2.6_宋代女子 梳宋制低盘发 中分发缝_3')
    expect(generationExportBaseName({ ...base, prompt: null, outputIndex: 0, outputCount: 1 })).toBe('2026-11-11_GPT Image 2.6')
  })

  it('与目标位置已有文件、同一批里的文件重名时顺延编号，不分大小写，不覆盖', () => {
    const allocate = createExportNameAllocator(['A.png', 'a (2).PNG'])
    expect(allocate('a', 'png')).toBe('a (3).png')
    expect(allocate('a', 'png')).toBe('a (4).png')
    expect(allocate('a', 'mp4')).toBe('a.mp4')
  })
})

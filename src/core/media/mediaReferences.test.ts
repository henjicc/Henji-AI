import { expect, it } from 'vitest'
import { collectMediaReferences } from './mediaReferences'

it('收集值与键里的本地路径和媒体地址，跳过以斜杠开头的作者代码与多行文本', () => {
  const source = '// 节点纸面 · 风格样片\n// 由「节点光迹」改成亮色\nexport default {}'
  const content = {
    clip: { path: 'D:\\media\\a.mp4', url: 'file:///D:/media/b.png', ref: 'henji://user/生成结果/c.png' },
    pool: { '/media/d.wav': true },
    code: { source, comment: '// 单行注释', unc: '\\\\ 不是服务器名' },
    note: '普通文字',
  }
  expect(collectMediaReferences(content).sort()).toEqual(['/media/d.wav', 'D:\\media\\a.mp4', 'file:///D:/media/b.png', 'henji://user/生成结果/c.png'].sort())
  expect(collectMediaReferences({ share: '\\\\nas\\media\\e.mp4' })).toEqual(['\\\\nas\\media\\e.mp4'])
})

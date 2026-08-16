import { describe, expect, it } from 'vitest'

import {
  asksToGenerateMedia,
  explicitlyCreatesProject,
  inferIntentTaskSemantics,
} from './task-intent-semantics'

describe('任务动作极性', () => {
  it('重命名和归类任务里的“不要删除”不会覆盖真实更新意图', () => {
    expect(inferIntentTaskSemantics(
      'assets',
      '把最新素材重命名并添加标签，不要删除任何素材或工程',
    )).toMatchObject({ effect: 'update' })
    expect(inferIntentTaskSemantics(
      'assets',
      '把最新素材加入新素材库，不要删除任何素材或工程',
    ).effect).not.toBe('delete')
  })

  it('同一句话允许否定一个动作并肯定另一个动作', () => {
    expect(explicitlyCreatesProject('不要创建新项目，在现有项目中创建一个节点')).toBe(false)
    expect(inferIntentTaskSemantics(
      'canvas',
      '不要删除现有节点，请创建一个新的文字节点',
    )).toMatchObject({ effect: 'create' })
  })

  it('媒体生成只接受肯定动作', () => {
    expect(asksToGenerateMedia('不要生成视频，只生成一张图片')).toBe(true)
    expect(asksToGenerateMedia('生成一张赛博朋克风格海报')).toBe(true)
    expect(asksToGenerateMedia('画一幅极简插画')).toBe(true)
    expect(asksToGenerateMedia('不要生成任何图片')).toBe(false)
    expect(asksToGenerateMedia('不要生成一张新海报')).toBe(false)
    expect(asksToGenerateMedia(
      '把已有生成结果 task-1 作为图片节点放到画布，并从正式状态源验证。不要重新生成图片。'
    )).toBe(false)
    expect(asksToGenerateMedia('Use the generated image as a canvas node; do not generate a new image.')).toBe(false)
  })
})

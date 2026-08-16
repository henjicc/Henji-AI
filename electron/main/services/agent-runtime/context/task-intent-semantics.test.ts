import { describe, expect, it } from 'vitest'

import { asksToGenerateMedia, hasAffirmativeIntent } from './task-intent-semantics'

/*
 * 这里曾经还测 inferIntentTaskSemantics 与 explicitlyCreatesProject——把一句话推成
 * "本轮必须产生哪些 Effect、几个"，喂给任务图当结算依据。任务图删除后那部分一并删掉，
 * 剩下的两个函数只判动作极性，供路由分类使用。
 */
describe('任务动作极性', () => {
  const deletePattern = /(?:删除|移除|清除|delete|remove)/i
  const createPattern = /(?:新建|创建|建立|添加|加入|create|add)/i

  it('“不要删除”不会覆盖同一句里的真实更新意图', () => {
    const goal = '把最新素材重命名并添加标签，不要删除任何素材或工程'
    expect(hasAffirmativeIntent(goal, createPattern)).toBe(true)
    expect(hasAffirmativeIntent(goal, deletePattern)).toBe(false)
  })

  it('同一句话允许否定一个动作并肯定另一个动作', () => {
    const goal = '不要删除现有节点，请创建一个新的文字节点'
    expect(hasAffirmativeIntent(goal, deletePattern)).toBe(false)
    expect(hasAffirmativeIntent(goal, createPattern)).toBe(true)
  })

  it('协调否定覆盖第二个及后续动作', () => {
    expect(hasAffirmativeIntent('不要删除或移除任何素材', deletePattern)).toBe(false)
    expect(hasAffirmativeIntent('不要删除，但要新建一个素材库', createPattern)).toBe(true)
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

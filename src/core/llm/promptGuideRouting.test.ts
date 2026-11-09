import { describe, expect, it } from 'vitest'

import {
  buildSmartOptimizationSystemPrompt,
  extractCommonPromptRules,
  needsPromptGuideRouting,
  parsePromptGuideRoutingAnswer,
  resolvePromptGuideCandidates,
} from './promptGuideRouting'

describe('智能优化选指南', () => {
  it('素材与模型功能能唯一确定时不必问模型', () => {
    const textToImage = resolvePromptGuideCandidates({ modelType: 'image', modelTags: ['text-to-image'], imageCount: 0, videoCount: 0 })
    expect(textToImage.base).toEqual(['image'])
    expect(needsPromptGuideRouting(textToImage, '一只猫坐在窗台上')).toBe(false)
    expect(resolvePromptGuideCandidates({ modelType: 'video', modelTags: ['text-to-video'], imageCount: 0, videoCount: 0 }).base).toEqual(['video'])
    expect(resolvePromptGuideCandidates({ modelType: 'video', modelTags: ['image-to-video'], imageCount: 1, videoCount: 0 }).base).toEqual(['video-frames'])
    expect(resolvePromptGuideCandidates({ modelType: 'image', modelTags: ['inpainting'], imageCount: 1, videoCount: 0 }).base).toEqual(['image-edit'])
  })

  it('带图的图片任务、能参考也能编辑的视频任务交给模型挑', () => {
    const imageWithReference = resolvePromptGuideCandidates({ modelType: 'image', modelTags: ['text-to-image', 'image-to-image'], imageCount: 2, videoCount: 0 })
    expect(imageWithReference.base).toEqual(['image-reference', 'image-edit'])
    expect(needsPromptGuideRouting(imageWithReference, '换成红色')).toBe(true)
    const videoWithVideo = resolvePromptGuideCandidates({ modelType: 'video', modelTags: ['reference-mode', 'video-to-video', 'video-extension'], imageCount: 1, videoCount: 1 })
    expect(videoWithVideo.base).toEqual(['video-reference', 'video-edit', 'video-extension'])
  })

  it('提示词带出文字、商品或对白线索时才多花一次调用挑专项指南', () => {
    const candidates = resolvePromptGuideCandidates({ modelType: 'image', modelTags: ['text-to-image'], imageCount: 0, videoCount: 0 })
    expect(needsPromptGuideRouting(candidates, '音乐节海报，标题写“夏夜回声”')).toBe(true)
  })

  it('音频等没有指南的类型只用通用写法', () => {
    expect(resolvePromptGuideCandidates({ modelType: 'audio', imageCount: 0, videoCount: 0 })).toEqual({ base: [], extras: [] })
  })

  it('解析模型的选择：只接受候选内的指南，读不出时回退第一个基础模式', () => {
    const candidates = resolvePromptGuideCandidates({ modelType: 'image', modelTags: ['image-to-image'], imageCount: 1, videoCount: 0 })
    expect(parsePromptGuideRoutingAnswer('{"guides":["image-edit","poster","video"]}', candidates)).toEqual(['image-edit', 'poster'])
    expect(parsePromptGuideRoutingAnswer('好的，我选 {"guides":["poster"]}', candidates)).toEqual(['image-reference', 'poster'])
    expect(parsePromptGuideRoutingAnswer('看不懂', candidates)).toEqual(['image-reference'])
  })

  it('系统提示词只取技能里的通用写法和选中的指南，不带助手专用的加载说明', () => {
    const skill = '# 提示词编写\n\n## 先判断模式\n用 load_assistant_skill 读取\n\n## 所有模式通用的写法\n\n1. 具象胜过抽象\n\n## 执行边界\n\n- 只写提示词时不提交'
    const rules = extractCommonPromptRules(skill)
    expect(rules).toContain('具象胜过抽象')
    expect(rules).not.toContain('load_assistant_skill')
    expect(rules).not.toContain('执行边界')
    expect(buildSmartOptimizationSystemPrompt(rules, ['# 文生图\n主体 + 行为'])).toContain('# 文生图')
  })
})

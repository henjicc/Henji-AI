import { z } from 'zod'

/**
 * 动态链接的音频编辑成品：依次由源录音的这些采样帧区间拼成（[起, 止, 起, 止, …]，相邻相接的已合并）。
 * 音频编辑重新剪辑后，链接服务据此把剪辑里的声音片段按原来对应的源录音位置对回新成品。
 */
export const videoEditLinkedTimelineSchema = z.object({
  sampleRate: z.number().int().positive().max(768000),
  spans: z.array(z.number().int().nonnegative()).max(400000).refine(spans => spans.length % 2 === 0, '区间须成对出现。'),
}).strict().describe('动态链接的音频编辑成品：依次由源录音的这些采样帧区间拼成，由链接服务维护。')
export type VideoEditLinkedTimeline = z.infer<typeof videoEditLinkedTimelineSchema>

import { createVolcengineSeedanceModel } from './seedance'

// 价格：https://www.volcengine.com/docs/82379/1544106 （输入不含视频的在线推理 token 单价）
export const volcengineSeedance25Model = createVolcengineSeedanceModel({
  id: 'volcengine-seedance-2.5', canonicalModelId: 'seedance-2.5', seriesRank: 2.5,
  apiModel: 'doubao-seedance-2-5-260628', paramPrefix: 'volcengineSeedance25', generation: '2.5',
  resolutions: ['480p', '720p', '1080p'],
  tokenPrices: { '480p': 70, '720p': 70, '1080p': 77 },
  priceDescription: '按 token 计费：480p/720p ¥70、1080p ¥77 每百万 token；token ≈ 时长 × 宽 × 高 × 24 / 1024（720p 16:9 5 秒约 ¥7.56）；自动时长按 30 秒预估',
})
export default volcengineSeedance25Model

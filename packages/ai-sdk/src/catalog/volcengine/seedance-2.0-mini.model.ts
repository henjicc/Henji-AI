import { createVolcengineSeedanceModel } from './seedance'

// 价格：https://www.volcengine.com/docs/82379/1544106 （输入不含视频的在线推理 token 单价）
export const volcengineSeedance20MiniModel = createVolcengineSeedanceModel({
  id: 'volcengine-seedance-2.0-mini', canonicalModelId: 'seedance-2.0-mini', seriesRank: 2.05,
  apiModel: 'doubao-seedance-2-0-mini-260615', paramPrefix: 'volcengineSeedance20Mini', generation: '2.0',
  resolutions: ['480p', '720p'],
  tokenPrices: { '480p': 23, '720p': 23 },
  priceDescription: '按 token 计费：480p/720p ¥23 每百万 token；token ≈ 时长 × 宽 × 高 × 24 / 1024（720p 16:9 5 秒约 ¥2.48）',
})
export default volcengineSeedance20MiniModel

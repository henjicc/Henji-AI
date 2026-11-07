import { createVolcengineSeedanceModel } from './seedance'

// 价格：https://www.volcengine.com/docs/82379/1544106 （在线推理 token 单价，分输入含 / 不含视频两档）
export const volcengineSeedance20Model = createVolcengineSeedanceModel({
  id: 'volcengine-seedance-2.0', canonicalModelId: 'seedance-2.0', seriesRank: 2,
  apiModel: 'doubao-seedance-2-0-260128', paramPrefix: 'volcengineSeedance20', generation: '2.0',
  resolutions: ['480p', '720p', '1080p', '4k'],
  tokenPrices: { '480p': 46, '720p': 46, '1080p': 51, '4k': 26 },
  videoTokenPrices: { '480p': 28, '720p': 28, '1080p': 31, '4k': 16 },
  priceDescription: '按 token 计费：480p/720p ¥46、1080p ¥51、4K ¥26 每百万 token；token ≈ 时长 × 宽 × 高 × 24 / 1024（720p 16:9 5 秒约 ¥4.97）；带参考视频时 480p/720p ¥28、1080p ¥31、4K ¥16 每百万 token，输入视频时长也计入',
})
export default volcengineSeedance20Model

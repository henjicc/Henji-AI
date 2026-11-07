import { createVolcengineSeedanceModel } from './seedance'

// 价格：https://www.volcengine.com/docs/82379/1544106 （在线推理 token 单价，分输入含 / 不含视频两档）
export const volcengineSeedance20FastModel = createVolcengineSeedanceModel({
  id: 'volcengine-seedance-2.0-fast', canonicalModelId: 'seedance-2.0-fast', seriesRank: 2.1,
  apiModel: 'doubao-seedance-2-0-fast-260128', paramPrefix: 'volcengineSeedance20Fast', generation: '2.0',
  resolutions: ['480p', '720p'],
  tokenPrices: { '480p': 37, '720p': 37 },
  videoTokenPrices: { '480p': 22, '720p': 22 },
  priceDescription: '按 token 计费：480p/720p ¥37 每百万 token；token ≈ 时长 × 宽 × 高 × 24 / 1024（720p 16:9 5 秒约 ¥4.00）；带参考视频时 480p/720p ¥22 每百万 token，输入视频时长也计入（不足 4 秒按 4 秒）',
})
export default volcengineSeedance20FastModel

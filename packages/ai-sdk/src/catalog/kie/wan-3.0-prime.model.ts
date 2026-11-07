import { defineModel } from '../defineModel'
import { wan30Definition } from './wan30'

export const kieWan30PrimeModel = defineModel({
  meta: {
    id: 'kie-wan-3.0-prime', canonicalModelId: 'wan-3.0-prime', seriesId: 'wan', seriesRank: 3.01,
    provider: 'kie', type: 'video',
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode'],
    polling: { interval: 3000, maxAttempts: 400, expectedAttempts: 100 },
  },
  ...wan30Definition({
    idPrefix: 'kieWan30Prime', model: 'wan/3-0-video-prime', name: 'Wan 3.0 Prime',
    rates: { '480p': 0.0612, '720p': 0.126, '1080p': 0.252 },
  }),
})
export default kieWan30PrimeModel

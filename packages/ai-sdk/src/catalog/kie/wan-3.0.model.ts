import { defineModel } from '../defineModel'
import { wan30Definition } from './wan30'

export const kieWan30Model = defineModel({
  meta: {
    id: 'kie-wan-3.0', canonicalModelId: 'wan-3.0', seriesId: 'wan', seriesRank: 3,
    provider: 'kie', type: 'video',
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode'],
    polling: { interval: 3000, maxAttempts: 400, expectedAttempts: 100 },
  },
  ...wan30Definition({
    idPrefix: 'kieWan30', model: 'wan/3-0-video', name: 'Wan 3.0',
    rates: { '480p': 0.04, '720p': 0.08, '1080p': 0.16 },
  }),
})
export default kieWan30Model

import { defineModel } from '../defineModel'
import { kling40Definition } from './kling40'

export const kieKling40FlashModel = defineModel({
  meta: {
    id: 'kie-kling-4.0-flash', canonicalModelId: 'kling-video-4.0-flash', seriesId: 'kling-video', seriesRank: 4.01,
    provider: 'kie', type: 'video',
    tags: ['text-to-video', 'image-to-video', 'reference-mode'],
    polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 60 },
  },
  ...kling40Definition({
    idPrefix: 'kieKling40Flash', modelPrefix: 'kling-4.0/flash-', name: 'Kling 4.0 Flash',
    maxDuration: 20, firstFrameOnly: true, elementTypeField: true, resolutions: ['720p'],
    rates: { '720p': { base: 0.085, withVideo: 0.0565 } },
  }),
})
export default kieKling40FlashModel

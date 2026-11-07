import { defineModel } from '../defineModel'
import { kling40Definition } from './kling40'

export const kieKling40Model = defineModel({
  meta: {
    id: 'kie-kling-4.0', canonicalModelId: 'kling-video-4.0', seriesId: 'kling-video', seriesRank: 4,
    provider: 'kie', type: 'video',
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode'],
    polling: { interval: 3000, maxAttempts: 400, expectedAttempts: 100 },
  },
  ...kling40Definition({
    idPrefix: 'kieKling40', modelPrefix: 'kling-4.0/', name: 'Kling 4.0',
    maxDuration: 30, firstFrameOnly: false, resolutions: ['720p', '1080p'],
    rates: { '720p': { base: 0.1425, withVideo: 0.085 }, '1080p': { base: 0.2125, withVideo: 0.1275 } },
  }),
})
export default kieKling40Model

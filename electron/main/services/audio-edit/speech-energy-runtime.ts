import path from 'node:path'
import { getProgramDataDir } from '../appPaths'
import { createContentDiskCache } from '../media/content-disk-cache'
import { createMainLogger } from '../logging'
import { SpeechEnergyService } from './speech-energy-service'

const logger = createMainLogger('main.audio_edit')
const onError = (event: string, error: unknown): void => logger.warn('声音证据缓存未命中或未保存', { event: `audio_edit.energy.cache.${event}`, error })
const service = new SpeechEnergyService(createContentDiskCache({
  directory: () => path.join(getProgramDataDir(), 'speech-energy'), extension: '.json', budgetBytes: 32 * 1024 * 1024, pruneIntervalMs: 60_000, onError,
}), undefined, onError)
export const analyzeSpeechEnergy: SpeechEnergyService['analyze'] = (...args) => service.analyze(...args)

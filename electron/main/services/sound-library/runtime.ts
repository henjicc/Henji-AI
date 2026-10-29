import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { readSoundLibraryFolders, writeSoundLibraryFolders, onSoundLibraryFoldersRestored } from './registry'
export { SOUND_LIBRARY_FOLDERS_CONTRACT } from './registry'
import { SOUND_LIBRARY_IPC_CHANNELS, type SoundLibraryState } from '../../../../src/platform/contracts/soundLibrary'
import { getProgramStoreDir } from '../appPaths'
import { createMainLogger } from '../logging'
import { createContentDiskCache } from '../media/content-disk-cache'
import { executionProviderOrder } from '../local-inference/providers'
import type { SoundClapModels } from '../local-inference/sound/protocol'
import { getLocalModelService } from '../local-models/runtime'
import { getLocalInferenceHost } from '../smart-regions/runtime'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { SoundLibraryService } from './service'
import { showOpenDialog } from '../dialogs'

/*
 * 音效库的进程内单例：设置表（登记的文件夹）、系统文件夹选择框、本地推理后台进程、听音模型与窗口广播。
 */

const logger = createMainLogger('main.sound_library')
const CLAP_FILES = { audioModelPath: 'larger_clap_general_audio_fp16.onnx', textModelPath: 'larger_clap_general_text_fp16.onnx', tokenizerPath: 'tokenizer.json', tokenizerConfigPath: 'tokenizer_config.json' } as const

function broadcast(state: SoundLibraryState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(SOUND_LIBRARY_IPC_CHANNELS.changed, state)
  }
}

async function clapModels(): Promise<SoundClapModels | null> {
  const local = getLocalModelService()
  if ((await local.info('audio_understanding_clap')).status !== 'ready') return null
  const files = (await local.ensure('audio_understanding_clap')).files
  const find = (name: string): string => {
    const file = files.find(entry => entry.name === name)
    if (!file) throw new Error(`听音模型缺少 ${name}。`)
    return file.path
  }
  return { audioModelPath: find(CLAP_FILES.audioModelPath), textModelPath: find(CLAP_FILES.textModelPath), tokenizerPath: find(CLAP_FILES.tokenizerPath), tokenizerConfigPath: find(CLAP_FILES.tokenizerConfigPath) }
}

let service: SoundLibraryService | undefined

export function getSoundLibraryService(): SoundLibraryService {
  if (service) return service
  const inference = getLocalInferenceHost()
  const providers = executionProviderOrder(process.platform)
  service = new SoundLibraryService({
    readFolders: readSoundLibraryFolders,
    writeFolders: writeSoundLibraryFolders,
    chooseFolder: async () => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const options = { title: '选择音效文件夹', properties: ['openDirectory' as const] }
      const selection = await showOpenDialog(window, options)
      const chosen = selection.canceled ? null : selection.filePaths[0] ?? null
      return chosen
    },
    allowFolder: folderPath => folderPath,
    analyze: async (files, clap, progress) => inference.analyzeSounds({ id: randomUUID(), ffmpegPath: await loadFfmpegPath(), files: files.map(path => ({ path })), ...(clap ? { clap } : {}), providers }, progress),
    embedText: async (clap, texts) => (await inference.embedSoundText({ id: randomUUID(), clap, texts, providers })).embeddings,
    clapModels,
    cache: createContentDiskCache({ directory: () => getProgramStoreDir('soundLibrary'), extension: '.json', budgetBytes: 256 * 1024 ** 2, pruneIntervalMs: 60_000, onError: (event, error) => logger.warn('音效分析缓存操作失败', { event: `sound_library.cache.${event}`, error }) }),
    emit: broadcast,
    log: (level, message, event, context, error) => logger[level](message, { event, context, ...(error === undefined ? {} : { error }) }),
  })
  onSoundLibraryFoldersRestored(() => service!.reloadFolders())
  return service
}

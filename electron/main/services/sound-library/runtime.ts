import { randomUUID } from 'node:crypto'
import { BrowserWindow, dialog } from 'electron'
import { formatMigrations } from '../../../../src/core/persistence/formatMigrations'
import { readStoredPersistenceJson, serializeVersionedPersistenceJson } from '../../../../src/core/persistence/versionedJson'
import type { PersistenceContract } from '../../../../src/core/persistence/migrations'
import { SOUND_LIBRARY_FOLDERS_SETTING_KEY, SOUND_LIBRARY_FOLDERS_VERSION, soundLibraryFoldersSchema, type SoundLibraryFolderRecord } from '../../../../src/core/soundLibrary/soundLibraryFolders'
import { SOUND_LIBRARY_IPC_CHANNELS, type SoundLibraryState } from '../../../../src/platform/contracts/soundLibrary'
import { getProgramStoreDir } from '../appPaths'
import { createMainLogger } from '../logging'
import { createContentDiskCache } from '../media/content-disk-cache'
import { allowMediaRoot } from '../../protocol'
import { executionProviderOrder } from '../local-inference/providers'
import type { SoundClapModels } from '../local-inference/sound/protocol'
import { getLocalModelService } from '../local-models/runtime'
import { getSettingsStore } from '../settings/store'
import { getLocalInferenceHost } from '../smart-regions/runtime'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { SoundLibraryService } from './service'

/*
 * 音效库的进程内单例：设置表（登记的文件夹）、系统文件夹选择框、本地推理后台进程、听音模型与窗口广播。
 * 用户在选择框里选中的文件夹同时授权媒体协议读取（与导入素材同一授权），剪辑才能直接引用原文件。
 */

const logger = createMainLogger('main.sound_library')
export const SOUND_LIBRARY_FOLDERS_CONTRACT: PersistenceContract = { id: 'sound-library-folders', name: '音效文件夹', version: SOUND_LIBRARY_FOLDERS_VERSION, schema: soundLibraryFoldersSchema, migrations: formatMigrations('sound-library-folders') }
const CLAP_FILES = { audioModelPath: 'larger_clap_general_audio_fp16.onnx', textModelPath: 'larger_clap_general_text_fp16.onnx', tokenizerPath: 'tokenizer.json', tokenizerConfigPath: 'tokenizer_config.json' } as const

const settings = {
  getItem: async (key: string) => getSettingsStore().get(key),
  setItem: async (key: string, value: string) => getSettingsStore().set(key, value, 'json'),
}

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
    readFolders: async () => {
      const text = await settings.getItem(SOUND_LIBRARY_FOLDERS_SETTING_KEY)
      const folders = text === null ? [] : await readStoredPersistenceJson(text, SOUND_LIBRARY_FOLDERS_SETTING_KEY, SOUND_LIBRARY_FOLDERS_CONTRACT, settings) as SoundLibraryFolderRecord[]
      for (const folder of folders) { try { allowMediaRoot(folder.path) } catch { /* 非法路径在整理时报告 */ } }
      return folders
    },
    writeFolders: async folders => settings.setItem(SOUND_LIBRARY_FOLDERS_SETTING_KEY, serializeVersionedPersistenceJson(SOUND_LIBRARY_FOLDERS_CONTRACT, folders)),
    chooseFolder: async () => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const options = { title: '选择音效文件夹', properties: ['openDirectory' as const] }
      const selection = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      const chosen = selection.canceled ? null : selection.filePaths[0] ?? null
      if (chosen) allowMediaRoot(chosen)
      return chosen
    },
    analyze: async (files, clap, progress) => inference.analyzeSounds({ id: randomUUID(), ffmpegPath: await loadFfmpegPath(), files: files.map(path => ({ path })), ...(clap ? { clap } : {}), providers }, progress),
    embedText: async (clap, texts) => (await inference.embedSoundText({ id: randomUUID(), clap, texts, providers })).embeddings,
    clapModels,
    cache: createContentDiskCache({ directory: () => getProgramStoreDir('soundLibrary'), extension: '.json', budgetBytes: 256 * 1024 ** 2, pruneIntervalMs: 60_000, onError: (event, error) => logger.warn('音效分析缓存操作失败', { event: `sound_library.cache.${event}`, error }) }),
    emit: broadcast,
    log: (level, message, event, context, error) => logger[level](message, { event, context, ...(error === undefined ? {} : { error }) }),
  })
  return service
}

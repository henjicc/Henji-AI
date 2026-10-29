import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mergeRecycledMembers } from '../../../../src/core/localRecords/recycle'
import { readStoredPersistenceJson, serializeVersionedPersistenceJson } from '../../../../src/core/persistence/versionedJson'
import { formatMigrations } from '../../../../src/core/persistence/formatMigrations'
import { SOUND_LIBRARY_FOLDERS_SETTING_KEY, SOUND_LIBRARY_FOLDERS_VERSION, soundLibraryFoldersSchema, type SoundLibraryFolderRecord } from '../../../../src/core/soundLibrary/soundLibraryFolders'
import { getSettingsStore } from '../settings/store'
import { getDb } from '../db'
import { RecycleStore } from '../recycle/store'

export const SOUND_LIBRARY_FOLDERS_CONTRACT = { id: 'sound-library-folders', name: '音效文件夹', version: SOUND_LIBRARY_FOLDERS_VERSION, schema: soundLibraryFoldersSchema, migrations: formatMigrations('sound-library-folders') }
const settings = { getItem: async (key: string) => getSettingsStore().get(key), setItem: async (key: string, value: string) => getSettingsStore().set(key, value, 'json') }
export async function readSoundLibraryFolders(): Promise<SoundLibraryFolderRecord[]> {
  const text = await settings.getItem(SOUND_LIBRARY_FOLDERS_SETTING_KEY)
  return text === null ? [] : await readStoredPersistenceJson(text, SOUND_LIBRARY_FOLDERS_SETTING_KEY, SOUND_LIBRARY_FOLDERS_CONTRACT, settings) as SoundLibraryFolderRecord[]
}
export async function writeSoundLibraryFolders(folders: SoundLibraryFolderRecord[]): Promise<void> {
  const before = await readSoundLibraryFolders(), recycle = new RecycleStore(getDb())
  const saved = before.filter(item => !folders.some(folder => folder.id === item.id)).map(item => recycle.snapshot('member', 'sound-library-folder', path.basename(item.path), JSON.stringify(item)))
  try { await settings.setItem(SOUND_LIBRARY_FOLDERS_SETTING_KEY, serializeVersionedPersistenceJson(SOUND_LIBRARY_FOLDERS_CONTRACT, folders)) }
  catch (error) { for (const id of saved) recycle.forget(id); throw error }
}
const restoreListeners = new Set<() => Promise<void>>()
export function onSoundLibraryFoldersRestored(listener: () => Promise<void>): () => void { restoreListeners.add(listener); return () => { restoreListeners.delete(listener) } }
export async function restoreSoundLibraryFolder(record: SoundLibraryFolderRecord): Promise<void> {
  await writeSoundLibraryFolders(mergeRecycledMembers(await readSoundLibraryFolders(), [record], 'id', randomUUID).values)
  for (const listener of restoreListeners) await listener()
}

// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'

import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import type { SoundLibraryFolderInfo, SoundLibrarySearchRequest, SoundLibrarySoundLocation, SoundLibraryState } from '@/platform/contracts/soundLibrary'

import { applicationReflectionHandlers } from '../../application-control/capabilities/applicationReflectionAdapter'
import { searchSoundEffectsFromCapability, addSoundLibraryFolderFromCapability } from './soundLibraryCapabilities'

/** 假的主进程音效库：真相源只有这里，断言一律从它读。 */
const fake = vi.hoisted(() => ({ revision: 1, folders: [] as SoundLibraryFolderInfo[], requests: [] as SoundLibrarySearchRequest[], chosen: null as SoundLibraryFolderInfo | null }))
const folder = (id: string, name: string): SoundLibraryFolderInfo => ({ id, name, path: `D:/音效/${name}`, status: 'ready', soundCount: 2, listeningCount: 0, skipped: [{ relativePath: 'Umbrella - 伞.wav', reason: '文件已损坏或不是有效的音频' }], progress: null, indexedAt: '2026-10-21T00:00:00.000Z', lastError: null })
const sound: SoundLibrarySoundLocation = { id: 'f1:abc', folderId: 'f1', relativePath: '转场/嗖02-短.mp3', label: '嗖02-短', english: null, chinese: '嗖02-短', path: 'D:/音效/转场/嗖02-短.mp3', hasListening: false,
  features: { durationSeconds: 0.9, attackSeconds: 0.2, hitSeconds: 0.36, peakDbfs: -1, loudnessLufs: -12, brightnessHz: 5000 } }
const state = (): SoundLibraryState => ({ revision: fake.revision, folders: fake.folders, listeningModelReady: false })

vi.mock('@/platform', () => ({ getPlatform: () => ({ soundLibrary: {
  getState: async () => state(),
  addFolder: async () => { if (fake.chosen && !fake.folders.some(value => value.id === fake.chosen!.id)) { fake.folders = [...fake.folders, fake.chosen]; fake.revision++ } return fake.chosen },
  removeFolder: async (id: string) => { fake.folders = fake.folders.filter(value => value.id !== id); fake.revision++; return true },
  locate: async (id: string) => { if (id !== sound.id) throw new Error('missing'); return sound },
  listSounds: async () => ({ sounds: [sound], total: 1, revision: fake.revision }),
  search: async (request: SoundLibrarySearchRequest) => { fake.requests.push(request); return { matches: [{ ...sound, ...sound.features, score: 0.9, nameScore: 0.9, listenScore: null, matchedBy: ['name'] }], noGoodMatch: false, considered: 2, listening: 'model_not_downloaded', indexedSounds: 2, skippedFiles: 1 } },
  onChanged: () => () => undefined,
} }) }))

beforeEach(() => { fake.revision = 1; fake.folders = [folder('f1', '转场'), folder('f2', 'MG音效')]; fake.requests = []; fake.chosen = null })

const context = () => ({
  callerGrant: createApplicationCallerGrant({ callerId: 'external-agent', capabilityIds: ['change_application_entities', 'read_application_entity'], permissions: ['application:write', 'settings:read', 'settings:write', 'video_edit:read'], allowWrites: true, allowDestructive: true }),
  signal: new AbortController().signal, requestId: crypto.randomUUID(), expectedRevisions: { sound_library: fake.revision },
})
const library = { kind: 'sound_library.library', id: 'singleton' }

it('通过通用 change 取消登记音效文件夹，音效库登记表随之变化且不删文件', async () => {
  await applicationReflectionHandlers.changeEntities({ summary: '移除音效文件夹', changes: [{ kind: 'remove_items', entityType: 'sound_library.folder', parent: library, targets: [{ kind: 'sound_library.folder', id: 'f2' }] }] }, context())
  expect(fake.folders.map(value => value.id)).toEqual(['f1'])
  expect((await applicationReflectionHandlers.readEntity({ ref: library, propertyIds: ['sound_library.library.folder_count'] }, context())).properties).toEqual({ 'sound_library.library.folder_count': 1 })
})

it('通过通用读取文件夹与音效：跳过的坏文件、击中点可读回，音效只读并指明改道', async () => {
  const read = await applicationReflectionHandlers.readEntity({ ref: { kind: 'sound_library.folder', id: 'f1' }, propertyIds: ['sound_library.folder.skipped_files', 'sound_library.folder.sound_count'] }, context())
  expect(read.properties).toEqual({ 'sound_library.folder.skipped_files': 'Umbrella - 伞.wav（文件已损坏或不是有效的音频）', 'sound_library.folder.sound_count': 2 })
  const hit = await applicationReflectionHandlers.readEntity({ ref: { kind: 'sound_library.sound', id: 'f1:abc' }, propertyIds: ['sound_library.sound.hit_seconds', 'sound_library.sound.brightness'] }, context())
  expect(hit.properties).toEqual({ 'sound_library.sound.hit_seconds': 0.36, 'sound_library.sound.brightness': 'bright' })
  await expect(applicationReflectionHandlers.changeEntities({ summary: '改击中点', changes: [{ kind: 'set_properties', target: { kind: 'sound_library.sound', id: 'f1:abc' }, entityType: 'sound_library.sound', properties: { 'sound_library.sound.hit_seconds': 1 } }] }, context())).rejects.toThrow()
  expect(sound.features.hitSeconds).toBe(0.36)
})

it('检索把英文描述、中英文关键词与文件夹引用交给正式服务，结果带击中点与降级说明', async () => {
  const result = await searchSoundEffectsFromCapability({ keywords: ['whoosh', '嗖'], description: 'a short sharp whoosh', folderRefs: [{ kind: 'sound_library.folder', id: 'f1' }], maxDurationSeconds: 1 }, context())
  expect(fake.requests[0]).toMatchObject({ keywords: ['whoosh', '嗖'], description: 'a short sharp whoosh', folderIds: ['f1'], maxDurationSeconds: 1, limit: 10 })
  expect(result.matches[0]).toMatchObject({ soundRef: { kind: 'sound_library.sound', id: 'f1:abc' }, hitSeconds: 0.36, brightness: 'bright' })
  expect(result.message).toContain('听音模型未下载')
  await expect(searchSoundEffectsFromCapability({ keywords: [], description: '短促的嗖' }, context())).rejects.toThrow(/英文/)
})

it('登记文件夹：用户取消不改登记表，选中后回读核对', async () => {
  expect((await addSoundLibraryFolderFromCapability({}, context())).status).toBe('cancelled')
  fake.chosen = folder('f3', '新音效')
  const added = await addSoundLibraryFolderFromCapability({}, context())
  expect(added).toMatchObject({ status: 'added', resultRef: { kind: 'sound_library.folder', id: 'f3' }, verification: { verified: true } })
  expect((await addSoundLibraryFolderFromCapability({}, context())).status).toBe('already_registered')
})

import { getPlatform } from '@/platform'
import type { SoundLibraryFolderInfo, SoundLibrarySearchRequest, SoundLibrarySearchResponse, SoundLibrarySoundLocation, SoundLibrarySoundPage, SoundLibraryState } from '@/platform/contracts/soundLibrary'

/*
 * 音效库：扫描、测量、缓存与检索都在主进程与本地推理后台进程完成；渲染层只取状态、发起操作、订阅变化。
 */

export function getSoundLibraryState(): Promise<SoundLibraryState> { return getPlatform().soundLibrary.getState() }
export function addSoundLibraryFolder(): Promise<SoundLibraryFolderInfo | null> { return getPlatform().soundLibrary.addFolder() }
export function removeSoundLibraryFolder(id: string): Promise<boolean> { return getPlatform().soundLibrary.removeFolder(id) }
export function refreshSoundLibrary(folderIds?: string[]): Promise<SoundLibraryState> { return getPlatform().soundLibrary.refresh(folderIds) }
export function searchSoundLibrary(request: SoundLibrarySearchRequest): Promise<SoundLibrarySearchResponse> { return getPlatform().soundLibrary.search(request) }
export function locateSoundLibrarySound(id: string): Promise<SoundLibrarySoundLocation> { return getPlatform().soundLibrary.locate(id) }
export function listSoundLibrarySounds(offset: number, limit: number): Promise<SoundLibrarySoundPage> { return getPlatform().soundLibrary.listSounds(offset, limit) }
export function subscribeSoundLibrary(handler: (state: SoundLibraryState) => void): () => void { return getPlatform().soundLibrary.onChanged(handler) }

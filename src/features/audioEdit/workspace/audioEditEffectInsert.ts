import { create } from 'zustand'
import { AUDIO_EDIT_MAX_CHAIN_ITEMS, type AudioEditChainItem } from '@/core/audioEdit/effects'
import type { AudioEditEffectCatalogEntry } from '@/core/audioEdit/effectCatalog'
import { notificationMessage } from '@/i18n/notifications'
import { analyzeProjectAudioEditBreathItem, detectProjectAudioEditMouthClicks } from '../application/audioEditApplicationService'
import type { AudioEditWorkspace } from './audioEditWorkspaceContext'

/*
 * 往效果控件里加效果（效果控件的搜索、“效果”面板的双击与拖放共用）：加在当前选中的效果下面，没选中就加到最后；
 * 去除口水音、呼吸声加进来就按它之前的声音自动检测。选中哪一项只是界面状态，不进作品、不进撤销。
 */

interface EffectSelection { projectId: string; selectedId: string; select: (projectId: string, id: string) => void }
export const useAudioEditEffectSelection = create<EffectSelection>(set => ({ projectId: '', selectedId: '', select: (projectId, selectedId) => set({ projectId, selectedId }) }))

/** 当前作品里选中的效果项 id（换了作品就不算）。 */
export function selectedAudioEditEffect(projectId: string): string {
  const state = useAudioEditEffectSelection.getState()
  return state.projectId === projectId ? state.selectedId : ''
}

export const AUDIO_EDIT_EFFECT_DRAG_TYPE = 'application/x-henji-audio-edit-effect'

/** 加一项；index 不给时加在选中项下面（没选中就加到最后）。返回新项的 id，没加成返回空串。 */
export function insertAudioEditEffect(workspace: Pick<AudioEditWorkspace, 'project' | 'update' | 'run' | 'notify'>, entry: AudioEditEffectCatalogEntry, index?: number): string {
  const { project } = workspace
  const chain = project.effectChain ?? []
  if (entry.disabledReason) { workspace.notify(entry.disabledReason); return '' }
  if (chain.length >= AUDIO_EDIT_MAX_CHAIN_ITEMS) { workspace.notify(notificationMessage('audioEffectChainFull', { count: AUDIO_EDIT_MAX_CHAIN_ITEMS })); return '' }
  const existing = entry.single ? chain.find(item => item.kind === entry.single) : undefined
  if (existing) { useAudioEditEffectSelection.getState().select(project.id, existing.id); workspace.notify(notificationMessage('audioEffectAlreadyAdded', { name: entry.name })); return '' }
  const item: AudioEditChainItem = entry.create()
  const selected = chain.findIndex(candidate => candidate.id === selectedAudioEditEffect(project.id))
  const at = Math.max(0, Math.min(chain.length, index ?? (selected >= 0 ? selected + 1 : chain.length)))
  workspace.update({ effectChain: [...chain.slice(0, at), item, ...chain.slice(at)] })
  useAudioEditEffectSelection.getState().select(project.id, item.id)
  analyzeAudioEditEffect(workspace, item)
  return item.id
}

/** 需要先分析的效果：检测口水音 / 呼吸声，写回这一项。 */
export function analyzeAudioEditEffect(workspace: Pick<AudioEditWorkspace, 'project' | 'run' | 'notify'>, item: AudioEditChainItem, sensitivity?: number): void {
  const projectId = workspace.project.id
  if (item.kind === 'mouth_declick') void workspace.run(async () => {
    const { count, perMinute } = await detectProjectAudioEditMouthClicks(projectId, { itemId: item.id, ...(sensitivity !== undefined ? { sensitivity } : {}) })
    workspace.notify(notificationMessage(count ? 'audioMouthClicksDetected' : 'audioMouthClicksNone', { count, perMinute }))
  })
  if (item.kind === 'breath') void workspace.run(async () => {
    const { count } = await analyzeProjectAudioEditBreathItem(projectId, item.id)
    workspace.notify(notificationMessage(count ? 'audioBreathItemDetected' : 'audioBreathItemNone', { count }))
  })
}

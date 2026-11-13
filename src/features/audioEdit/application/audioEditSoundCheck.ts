import { compareAudioEditSoundChecks, type AudioEditSoundCheck, type AudioEditSoundCheckDelta, type AudioEditSoundCheckRequest } from '@/core/audioEdit/soundCheck'
import { getPlatform } from '@/platform/runtime'
import { flushAudioEditProject, loadAudioEditProject, subscribeAudioEditProjectDisposal } from './audioEditProjectInstances'

/** 每份口播、每个测量范围记住上一次读回，下次同一范围再测时给出差值；只在本次运行内。 */
const previousChecks = new Map<string, { revision: number; checkedAt: string; check: AudioEditSoundCheck }>()
const MAX_REMEMBERED = 64
subscribeAudioEditProjectDisposal(projectId => { for (const key of previousChecks.keys()) if (key.startsWith(`${projectId}|`)) previousChecks.delete(key) })

type SoundCheckOptions = Omit<AudioEditSoundCheckRequest, 'projectId' | 'requestId'>

/**
 * 读回口播成品现在听起来怎样（主进程按已保存的口播渲染成品再测）。界面与助手共用。
 * sinceLastCheck：同一范围上一次读回之后口播改过时，给出本次减上次的差值。
 * remember=false 用于处理回执里顺带的测量：不替换上一次读回，处理前读的那次仍是对比基准。
 */
export async function checkAudioEditProjectSound(projectId: string, options: SoundCheckOptions = {}, requestId: string = crypto.randomUUID(), { remember = true }: { remember?: boolean } = {}): Promise<{ check: AudioEditSoundCheck; sinceLastCheck?: AudioEditSoundCheckDelta }> {
  await flushAudioEditProject(projectId)
  const revision = (await loadAudioEditProject(projectId)).persistedRevision
  const check = await getPlatform().audioEdit.checkSound({ projectId, requestId, ...options })
  const key = `${projectId}|${options.startSeconds ?? 0}|${options.endSeconds ?? 'end'}`
  const previous = previousChecks.get(key)
  if (remember) {
    previousChecks.delete(key)
    previousChecks.set(key, { revision, checkedAt: new Date().toISOString(), check })
    while (previousChecks.size > MAX_REMEMBERED) previousChecks.delete(previousChecks.keys().next().value!)
  }
  return { check, ...(previous && previous.revision !== revision ? { sinceLastCheck: compareAudioEditSoundChecks(previous.check, check, previous.checkedAt) } : {}) }
}

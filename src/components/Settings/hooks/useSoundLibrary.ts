import { useCallback, useEffect, useRef, useState } from 'react'

import { addSoundLibraryFolder, getSoundLibraryState, refreshSoundLibrary, removeSoundLibraryFolder, subscribeSoundLibrary } from '@/commands/soundLibrary'
import { createLogger } from '@/core/logging'
import type { SoundLibraryState } from '@/platform/contracts/soundLibrary'

const logger = createLogger('components.settings.sound_library')

export interface SoundLibraryView {
  state: SoundLibraryState | null
  loadFailed: boolean
  actionFailed: boolean
  add: () => void
  remove: (id: string) => void
  refresh: (id: string) => void
  reload: () => void
}

/** 设置“音效库”分区：取一次状态，之后靠主进程推送就地更新；助手登记或整理同样会推送过来。 */
export function useSoundLibrary(): SoundLibraryView {
  const [state, setState] = useState<SoundLibraryState | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [actionFailed, setActionFailed] = useState(false)
  const mounted = useRef(true)

  const reload = useCallback(() => {
    getSoundLibraryState()
      .then((next) => { if (mounted.current) { setState(next); setLoadFailed(false) } })
      .catch((error: unknown) => {
        logger.error('读取音效库失败', { event: 'sound_library.ui_state.failed', error })
        if (mounted.current) setLoadFailed(true)
      })
  }, [])

  useEffect(() => {
    mounted.current = true
    reload()
    const unsubscribe = subscribeSoundLibrary((next) => setState((current) => (!current || next.revision >= current.revision ? next : current)))
    return () => { mounted.current = false; unsubscribe() }
  }, [reload])

  const run = useCallback((event: string, action: () => Promise<unknown>) => {
    setActionFailed(false)
    action().then(reload).catch((error: unknown) => {
      logger.warn('音效库操作未完成', { event, error })
      if (mounted.current) setActionFailed(true)
    })
  }, [reload])

  return {
    state, loadFailed, actionFailed, reload,
    add: () => run('sound_library.ui_add.failed', () => addSoundLibraryFolder()),
    remove: (id) => run('sound_library.ui_remove.failed', () => removeSoundLibraryFolder(id)),
    refresh: (id) => run('sound_library.ui_refresh.failed', () => refreshSoundLibrary([id])),
  }
}

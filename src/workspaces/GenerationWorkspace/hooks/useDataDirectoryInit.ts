import { createLogger } from '@/core/logging'
import { useEffect } from 'react'
import { getDataRoot, initializeDataDirectory } from '@/utils/dataPath'
import { isDesktop } from '@/utils/save'

const logger = createLogger('workspaces.GenerationWorkspace.hooks.useDataDirectoryInit')

export function useDataDirectoryInit(): void {
  useEffect(() => {
    const init = async (): Promise<void> => {
      if (!isDesktop()) return
      try {
        const dataRoot = await getDataRoot()
        await initializeDataDirectory(dataRoot)
        logger.info('[Workspace] 数据目录已初始化', { dataRoot })
      } catch (error) {
        logger.error('[Workspace] 初始化数据目录失败', error)
      }
    }

    void init()
  }, [])
}



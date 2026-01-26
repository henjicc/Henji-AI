import { useEffect } from 'react'
import { getDataRoot, initializeDataDirectory } from '@/utils/dataPath'
import { logError, logInfo } from '@/utils/errorLogger'
import { isDesktop } from '@/utils/save'

export function useDataDirectoryInit(): void {
  useEffect(() => {
    const init = async (): Promise<void> => {
      if (!isDesktop()) return
      try {
        const dataRoot = await getDataRoot()
        await initializeDataDirectory(dataRoot)
        logInfo('[Workspace] 数据目录已初始化', { dataRoot })
      } catch (error) {
        logError('[Workspace] 初始化数据目录失败', error)
      }
    }

    void init()
  }, [])
}


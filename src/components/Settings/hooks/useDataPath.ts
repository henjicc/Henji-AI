import { useState, useEffect } from 'react'
import { getDataRoot, getDefaultDataRoot, setCustomDataRoot, resetToDefaultDataRoot } from '../../../utils/dataPath'

export function useDataPath() {
  const [currentPath, setCurrentPath] = useState<string>('')
  const [defaultPath, setDefaultPath] = useState<string>('')
  const [isCustom, setIsCustom] = useState<boolean>(false)

  // 加载数据路径
  useEffect(() => {
    const loadPaths = async () => {
      try {
        const current = await getDataRoot()
        const defaultP = await getDefaultDataRoot()
        setCurrentPath(current)
        setDefaultPath(defaultP)
        setIsCustom(current !== defaultP)
      } catch (error) {
        console.error('Failed to load data paths:', error)
      }
    }
    loadPaths()
  }, [])

  // 设置自定义路径
  const setCustomPath = async (path: string) => {
    try {
      await setCustomDataRoot(path)
      setCurrentPath(path)
      setIsCustom(true)
    } catch (error) {
      console.error('Failed to set custom path:', error)
      throw error
    }
  }

  // 重置到默认路径
  const resetPath = async () => {
    try {
      await resetToDefaultDataRoot()
      setCurrentPath(defaultPath)
      setIsCustom(false)
    } catch (error) {
      console.error('Failed to reset path:', error)
      throw error
    }
  }

  return { currentPath, defaultPath, isCustom, setCustomPath, resetPath }
}

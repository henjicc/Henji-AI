/**
 * 文件管理 Hook
 * 职责：管理上传和生成的文件
 */

import { useState, useCallback } from 'react'

export interface ManagedFile {
  id: string
  name: string
  type: 'image' | 'video' | 'audio'
  url: string
  size: number
  source: 'upload' | 'generated'
  createdAt: number
  metadata?: Record<string, any>
}

export const useFileManagement = () => {
  const [files, setFiles] = useState<ManagedFile[]>([])

  const addFile = useCallback((file: Omit<ManagedFile, 'id' | 'createdAt'>) => {
    const newFile: ManagedFile = {
      ...file,
      id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now()
    }
    setFiles(prev => [...prev, newFile])
    return newFile.id
  }, [])

  const removeFile = useCallback((fileId: string) => {
    setFiles(prev => prev.filter(f => f.id !== fileId))
  }, [])

  const updateFile = useCallback((fileId: string, updates: Partial<ManagedFile>) => {
    setFiles(prev => prev.map(f =>
      f.id === fileId ? { ...f, ...updates } : f
    ))
  }, [])

  const clearFiles = useCallback(() => {
    setFiles([])
  }, [])

  const getFile = useCallback((fileId: string) => {
    return files.find(f => f.id === fileId)
  }, [files])

  const getFilesByType = useCallback((type: ManagedFile['type']) => {
    return files.filter(f => f.type === type)
  }, [files])

  const getFilesBySource = useCallback((source: ManagedFile['source']) => {
    return files.filter(f => f.source === source)
  }, [files])

  const getTotalSize = useCallback(() => {
    return files.reduce((total, file) => total + file.size, 0)
  }, [files])

  return {
    files,
    addFile,
    removeFile,
    updateFile,
    clearFiles,
    getFile,
    getFilesByType,
    getFilesBySource,
    getTotalSize
  }
}

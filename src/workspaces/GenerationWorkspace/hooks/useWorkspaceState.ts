/**
 * 工作区状态 Hook
 * 职责：管理工作区的整体状态
 */

import { useState, useCallback } from 'react'

export interface WorkspaceState {
  isLoading: boolean
  isSidebarOpen: boolean
  activePanel: 'tasks' | 'history' | 'files' | null
  viewMode: 'grid' | 'list'
  sortBy: 'date' | 'name' | 'type'
  sortOrder: 'asc' | 'desc'
  filterType: 'all' | 'image' | 'video' | 'audio'
}

const DEFAULT_STATE: WorkspaceState = {
  isLoading: false,
  isSidebarOpen: true,
  activePanel: 'tasks',
  viewMode: 'grid',
  sortBy: 'date',
  sortOrder: 'desc',
  filterType: 'all'
}

export const useWorkspaceState = () => {
  const [state, setState] = useState<WorkspaceState>(DEFAULT_STATE)

  const setLoading = useCallback((isLoading: boolean) => {
    setState(prev => ({ ...prev, isLoading }))
  }, [])

  const toggleSidebar = useCallback(() => {
    setState(prev => ({ ...prev, isSidebarOpen: !prev.isSidebarOpen }))
  }, [])

  const setActivePanel = useCallback((panel: WorkspaceState['activePanel']) => {
    setState(prev => ({ ...prev, activePanel: panel }))
  }, [])

  const setViewMode = useCallback((viewMode: WorkspaceState['viewMode']) => {
    setState(prev => ({ ...prev, viewMode }))
  }, [])

  const setSortBy = useCallback((sortBy: WorkspaceState['sortBy']) => {
    setState(prev => ({ ...prev, sortBy }))
  }, [])

  const toggleSortOrder = useCallback(() => {
    setState(prev => ({
      ...prev,
      sortOrder: prev.sortOrder === 'asc' ? 'desc' : 'asc'
    }))
  }, [])

  const setFilterType = useCallback((filterType: WorkspaceState['filterType']) => {
    setState(prev => ({ ...prev, filterType }))
  }, [])

  const resetState = useCallback(() => {
    setState(DEFAULT_STATE)
  }, [])

  return {
    state,
    setLoading,
    toggleSidebar,
    setActivePanel,
    setViewMode,
    setSortBy,
    toggleSortOrder,
    setFilterType,
    resetState
  }
}

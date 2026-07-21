import { useState, useCallback } from 'react'

/**
 * 任务管理 Hook
 * 职责：管理生成任务队列
 */

export interface GenerationTask {
  id: string
  type: 'image' | 'video' | 'audio'
  prompt: string
  model: string
  provider?: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress?: number
  result?: DynamicValue
  error?: string
  createdAt: number
}

export const useTaskManagement = () => {
  const [tasks, setTasks] = useState<GenerationTask[]>([])

  const addTask = useCallback((task: Omit<GenerationTask, 'id' | 'status' | 'createdAt'>) => {
    const newTask: GenerationTask = {
      ...task,
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      status: 'pending',
      createdAt: Date.now()
    }
    setTasks(prev => [...prev, newTask])
    return newTask.id
  }, [])

  const updateTask = useCallback((id: string, updates: Partial<GenerationTask>) => {
    setTasks(prev => prev.map(task =>
      task.id === id ? { ...task, ...updates } : task
    ))
  }, [])

  const removeTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(task => task.id !== id))
  }, [])

  const clearTasks = useCallback(() => {
    setTasks([])
  }, [])

  const getTask = useCallback((id: string) => {
    return tasks.find(task => task.id === id)
  }, [tasks])

  return {
    tasks,
    addTask,
    updateTask,
    removeTask,
    clearTasks,
    getTask
  }
}

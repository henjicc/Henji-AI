/**
 * 任务格式化工具
 * 职责：格式化任务显示信息
 */

import type { GenerationTask } from '../hooks/useTaskManagement'

/**
 * 格式化任务状态文本
 */
export function formatTaskStatus(status: GenerationTask['status']): string {
  const statusMap = {
    pending: '等待中',
    processing: '生成中',
    completed: '已完成',
    failed: '失败'
  }
  return statusMap[status] || status
}

/**
 * 格式化任务类型文本
 */
export function formatTaskType(type: GenerationTask['type']): string {
  const typeMap = {
    image: '图片',
    video: '视频',
    audio: '音频'
  }
  return typeMap[type] || type
}

/**
 * 格式化任务进度
 */
export function formatTaskProgress(progress?: number): string {
  if (progress === undefined) return ''
  return `${Math.round(progress * 100)}%`
}

/**
 * 格式化任务时间
 */
export function formatTaskTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) return `${hours}小时前`
  if (minutes > 0) return `${minutes}分钟前`
  if (seconds > 0) return `${seconds}秒前`
  return '刚刚'
}

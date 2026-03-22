/**
 * 生成历史 Hook
 * 职责：管理生成历史记录
 */

import { useState, useCallback } from 'react'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  attachments?: {
    type: 'image' | 'video' | 'audio'
    url: string
    name?: string
  }[]
}

export const useGenerationHistory = () => {
  const [messages, setMessages] = useState<Message[]>([])

  const addMessage = useCallback((message: Omit<Message, 'id' | 'timestamp'>) => {
    const newMessage: Message = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now()
    }
    setMessages(prev => [...prev, newMessage])
    return newMessage.id
  }, [])

  const updateMessage = useCallback((messageId: string, updates: Partial<Message>) => {
    setMessages(prev => prev.map(msg =>
      msg.id === messageId ? { ...msg, ...updates } : msg
    ))
  }, [])

  const removeMessage = useCallback((messageId: string) => {
    setMessages(prev => prev.filter(msg => msg.id !== messageId))
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  const getMessage = useCallback((messageId: string) => {
    return messages.find(msg => msg.id === messageId)
  }, [messages])

  const getMessagesByRole = useCallback((role: Message['role']) => {
    return messages.filter(msg => msg.role === role)
  }, [messages])

  return {
    messages,
    addMessage,
    updateMessage,
    removeMessage,
    clearMessages,
    getMessage,
    getMessagesByRole
  }
}

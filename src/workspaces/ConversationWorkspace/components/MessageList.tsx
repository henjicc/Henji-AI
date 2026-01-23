/**
 * 消息列表组件
 * 职责：显示对话消息列表
 */

import React, { useRef, useEffect } from 'react'

interface Message {
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

interface MessageListProps {
  messages: Message[]
  onMessageClick?: (messageId: string) => void
  onAttachmentClick?: (url: string, type: string) => void
  autoScroll?: boolean
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  onMessageClick,
  onAttachmentClick,
  autoScroll = true
}) => {
  const listRef = useRef<HTMLDivElement>(null)
  const lastMessageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoScroll && lastMessageRef.current) {
      lastMessageRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, autoScroll])

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getRoleIcon = (role: Message['role']) => {
    switch (role) {
      case 'user': return '👤'
      case 'assistant': return '🤖'
      case 'system': return '⚙️'
    }
  }

  const getAttachmentIcon = (type: string) => {
    switch (type) {
      case 'image': return '🖼️'
      case 'video': return '🎬'
      case 'audio': return '🎵'
      default: return '📎'
    }
  }

  return (
    <div ref={listRef} className="message-list">
      {messages.length === 0 ? (
        <div className="message-list-empty">
          开始新的对话
        </div>
      ) : (
        messages.map((message, index) => (
          <div
            key={message.id}
            ref={index === messages.length - 1 ? lastMessageRef : null}
            className={`message message-${message.role}`}
            onClick={() => onMessageClick?.(message.id)}
          >
            <div className="message-header">
              <span className="message-role">{getRoleIcon(message.role)}</span>
              <span className="message-time">{formatTime(message.timestamp)}</span>
            </div>

            <div className="message-content">
              {message.content}
            </div>

            {message.attachments && message.attachments.length > 0 && (
              <div className="message-attachments">
                {message.attachments.map((attachment, idx) => (
                  <div
                    key={idx}
                    className="attachment"
                    onClick={(e) => {
                      e.stopPropagation()
                      onAttachmentClick?.(attachment.url, attachment.type)
                    }}
                  >
                    <span className="attachment-icon">
                      {getAttachmentIcon(attachment.type)}
                    </span>
                    <span className="attachment-name">
                      {attachment.name || `${attachment.type}-${idx + 1}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}

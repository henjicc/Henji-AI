import React, { useEffect, useState, useCallback } from 'react'
import ReactDOM from 'react-dom'

interface MenuPosition {
  x: number
  y: number
}

// 自定义事件名称，用于通知图片粘贴
export const PASTE_IMAGE_EVENT = 'global-paste-image'

/**
 * 全局右键菜单 Provider
 * 自动为所有文本输入元素（input[type="text"], input[type="password"], textarea）添加粘贴菜单
 * 对于提示词输入框（textarea），还支持粘贴图片
 */
const GlobalContextMenuProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [menuVisible, setMenuVisible] = useState(false)
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ x: 0, y: 0 })
  const [targetElement, setTargetElement] = useState<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const [isPromptTextarea, setIsPromptTextarea] = useState(false)

  const hideMenu = useCallback(() => {
    setMenuVisible(false)
    setTargetElement(null)
    setIsPromptTextarea(false)
  }, [])

  // 粘贴文本到输入框
  const pasteTextToInput = useCallback(async (text: string) => {
    if (!targetElement) return

    // 获取当前光标位置
    const start = targetElement.selectionStart || 0
    const end = targetElement.selectionEnd || 0
    const currentValue = targetElement.value

    // 在光标位置插入文本（或替换选中的文本）
    const newValue = currentValue.substring(0, start) + text + currentValue.substring(end)

    // 触发 React 的 onChange 事件
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      targetElement.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
      'value'
    )?.set

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(targetElement, newValue)

      // 触发 input 事件让 React 感知到变化
      const event = new Event('input', { bubbles: true })
      targetElement.dispatchEvent(event)

      // 设置光标位置到粘贴内容之后
      setTimeout(() => {
        const newCursorPos = start + text.length
        targetElement.setSelectionRange(newCursorPos, newCursorPos)
        targetElement.focus()
      }, 0)
    }
  }, [targetElement])

  const handlePaste = useCallback(async () => {
    if (!targetElement) {
      hideMenu()
      return
    }

    // 先关闭菜单
    hideMenu()

    // 如果是提示词输入框，尝试粘贴图片
    if (isPromptTextarea) {
      targetElement.focus()

      try {
        // 首先尝试使用 Rust 命令读取文件管理器复制的文件
        const { invoke } = await import('@tauri-apps/api/core')
        const clipboardFiles = await invoke<Array<{ path: string; data: string; mime_type: string }>>('read_clipboard_files')

        if (clipboardFiles && clipboardFiles.length > 0) {
          // 有文件管理器复制的图片文件，通过事件传递 base64 数据
          const customEvent = new CustomEvent(PASTE_IMAGE_EVENT, {
            detail: {
              clipboardFiles: clipboardFiles.map(f => ({
                data: f.data,
                mimeType: f.mime_type,
                name: f.path.split(/[/\\]/).pop() || 'clipboard-image'
              }))
            }
          })
          document.dispatchEvent(customEvent)
          return
        }

        // 没有文件，尝试读取剪贴板中的图片（截图等）
        const clipboardItems = await navigator.clipboard.read()
        for (const item of clipboardItems) {
          const imageType = item.types.find(type => type.startsWith('image/'))
          if (imageType) {
            const blob = await item.getType(imageType)
            if (blob && blob.size > 0) {
              const customEvent = new CustomEvent(PASTE_IMAGE_EVENT, {
                detail: { imageBlob: blob, imageType }
              })
              document.dispatchEvent(customEvent)
              return
            }
          }
        }

        // 没有图片，尝试粘贴文本
        const text = await navigator.clipboard.readText()
        if (text) {
          await pasteTextToInput(text)
        }
      } catch {
        // 如果所有方法都失败，尝试使用 Tauri API 读取文本
        try {
          const { readText } = await import('@tauri-apps/plugin-clipboard-manager')
          const text = await readText()
          if (text) {
            await pasteTextToInput(text)
          }
        } catch (err) {
          console.error('Failed to paste:', err)
        }
      }
      return
    }

    // 非提示词输入框，只粘贴文本
    try {
      const { readText } = await import('@tauri-apps/plugin-clipboard-manager')
      const text = await readText()
      if (text) {
        await pasteTextToInput(text)
      }
    } catch (err) {
      console.error('Failed to paste:', err)
    }
  }, [targetElement, isPromptTextarea, hideMenu, pasteTextToInput])

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement

      // 检查是否是文本输入元素
      const isTextInput = (
        (target.tagName === 'INPUT' &&
          ['text', 'password', 'email', 'url', 'search', 'tel', 'number'].includes((target as HTMLInputElement).type)
        ) ||
        target.tagName === 'TEXTAREA'
      )

      if (!isTextInput) {
        return // 不是文本输入元素，不处理
      }

      // 检查是否被禁用或只读
      const inputElement = target as HTMLInputElement | HTMLTextAreaElement
      if (inputElement.disabled || inputElement.readOnly) {
        return
      }

      e.preventDefault()
      e.stopPropagation()

      // 检查是否是提示词输入框（通过检查父元素是否包含特定的类或属性）
      // 提示词输入框是 textarea，且在 InputArea 组件中
      const textareaElement = target as HTMLTextAreaElement
      const isPrompt = target.tagName === 'TEXTAREA' &&
        (target.closest('[data-prompt-textarea]') !== null ||
         textareaElement.placeholder?.includes('描述想要生成的内容') ||
         textareaElement.placeholder?.includes('输入要合成的文本'))

      // 计算菜单位置
      const menuWidth = 180
      const menuHeight = 48
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      let x = e.clientX
      let y = e.clientY

      // 边界检查
      if (x + menuWidth > viewportWidth - 10) {
        x = viewportWidth - menuWidth - 10
      }
      if (y + menuHeight > viewportHeight - 10) {
        y = y - menuHeight
      }
      x = Math.max(10, x)
      y = Math.max(10, y)

      setTargetElement(inputElement)
      setIsPromptTextarea(isPrompt)
      setMenuPosition({ x, y })
      setMenuVisible(true)
    }

    const handleClick = (e: MouseEvent) => {
      if (!menuVisible) return

      const target = e.target as HTMLElement
      if (!target.closest('[data-global-context-menu]')) {
        hideMenu()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menuVisible) {
        hideMenu()
      }
    }

    document.addEventListener('contextmenu', handleContextMenu, true)
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, true)
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuVisible, hideMenu])

  return (
    <>
      {children}

      {/* 全局右键菜单 */}
      {menuVisible && ReactDOM.createPortal(
        <div
          data-global-context-menu
          className="context-menu animate-scale-in"
          style={{
            left: `${menuPosition.x}px`,
            top: `${menuPosition.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="context-menu-item"
            onClick={handlePaste}
          >
            <div className="context-menu-icon">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <span>粘贴</span>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

export default GlobalContextMenuProvider

/* eslint-disable react-refresh/only-export-components */
import { createLogger } from '@/core/logging'
import React, { useEffect, useState, useCallback } from 'react'
import ContextMenu from '@/components/ContextMenu'
import { useI18n } from '@/hooks/useI18n'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'
import { Clipboard } from 'lucide-react'
import { readClipboardFiles, readClipboardImage } from '@/commands/clipboard'

const logger = createLogger('contexts.GlobalContextMenuProvider')

interface MenuPosition {
  x: number
  y: number
}

// 自定义事件名称，用于通知图片粘贴
export const PASTE_IMAGE_EVENT = 'globalPasteImage'

/**
 * 全局右键菜单 Provider
 * 自动为所有文本输入元素（input[type="text"], input[type="password"], textarea）添加粘贴菜单
 * 对于提示词输入框（textarea），还支持粘贴图片
 */
const GlobalContextMenuProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useI18n('common')
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
        // 文件只传路径给统一导入入口；仅无文件路径的截图读取位图。
        if (isDesktopRuntime()) {
          const files = await readClipboardFiles()
          const images = files.filter(file => file.mimeType.startsWith('image/'))
          if (images.length) {
            window.dispatchEvent(new CustomEvent(PASTE_IMAGE_EVENT, {
              detail: { clipboardPaths: images },
            }))
            return
          }
          const image = files.length === 0 ? await readClipboardImage() : null
          if (image) {
            window.dispatchEvent(new CustomEvent(PASTE_IMAGE_EVENT, {
              detail: { clipboardFiles: [{ data: image.dataUrl, name: image.name }] },
            }))
            return
          }
        }

        // 浏览器宿主使用浏览器剪贴板；桌面已经检查过图片，直接回退文本。
        const clipboardItems = isDesktopRuntime() ? [] : await navigator.clipboard.read()
        for (const item of clipboardItems) {
          const imageType = item.types.find(type => type.startsWith('image/'))
          if (imageType) {
            const blob = await item.getType(imageType)
            if (blob && blob.size > 0) {
              const customEvent = new CustomEvent(PASTE_IMAGE_EVENT, {
                detail: { imageBlob: blob, imageType }
              })
              window.dispatchEvent(customEvent)
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
        // 如果所有方法都失败，尝试使用平台剪贴板读取文本
        try {
          const text = isDesktopRuntime()
            ? await getPlatform().clipboard.readText()
            : await navigator.clipboard.readText()
          if (text) {
            await pasteTextToInput(text)
          }
        } catch (err) {
          logger.error('Failed to paste:', err)
        }
      }
      return
    }

    // 非提示词输入框，只粘贴文本
    try {
      const text = isDesktopRuntime()
        ? await getPlatform().clipboard.readText()
        : await navigator.clipboard.readText()
      if (text) {
        await pasteTextToInput(text)
      }
    } catch (err) {
      logger.error('Failed to paste:', err)
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

      setTargetElement(inputElement)
      setIsPromptTextarea(isPrompt)
      setMenuPosition({ x: e.clientX, y: e.clientY })
      setMenuVisible(true)
    }

    document.addEventListener('contextmenu', handleContextMenu, true)
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, true)
    }
  }, [])

  return (
    <>
      {children}

      {/* 全局文本粘贴菜单：与其他右键菜单同一个共享组件（任务 5.9），点外、Escape 与定位由它处理 */}
      <ContextMenu
        visible={menuVisible}
        position={menuPosition}
        onClose={hideMenu}
        items={[{ id: 'paste', label: t('actions.paste'), icon: <Clipboard className="h-4 w-4" />, onClick: handlePaste }]}
      />
    </>
  )
}

export default GlobalContextMenuProvider

import React, { useEffect, useRef, useState } from 'react'
import { Box, Camera, Copy, Eye, EyeOff, Trash2, User } from 'lucide-react'
import { UiEmpty, UiIconButton, UiInput, UiOptionButton } from '@/components/ui'
import type { StageObject } from '../domain/sceneTypes'
import { useCameraStageStore } from '../store/cameraStageStore'

/** 场景对象列表：列表选中/显隐/复制/删除；双击对象名称可直接行内改名 */

const TypeIcon: React.FC<{ object: StageObject }> = ({ object }) => {
  if (object.type === 'character') return <User size={14} />
  if (object.type === 'camera') return <Camera size={14} />
  return <Box size={14} />
}

const ObjectListPanel: React.FC = () => {
  const objects = useCameraStageStore((state) => state.objects)
  const selectedId = useCameraStageStore((state) => state.selectedId)
  const activeCameraId = useCameraStageStore((state) => state.activeCameraId)
  const setSelected = useCameraStageStore((state) => state.setSelected)
  const removeObject = useCameraStageStore((state) => state.removeObject)
  const updateObject = useCameraStageStore((state) => state.updateObject)
  const duplicateObject = useCameraStageStore((state) => state.duplicateObject)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editingId) return
    const editingObject = objects.find((item) => item.id === editingId)
    if (!editingObject) {
      setEditingId(null)
      setDraftName('')
      return
    }

    const focusTimer = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })

    return () => window.cancelAnimationFrame(focusTimer)
  }, [editingId, objects])

  const beginRename = (object: StageObject): void => {
    setSelected(object.id)
    setEditingId(object.id)
    setDraftName(object.name)
  }

  const finishRename = (mode: 'commit' | 'cancel'): void => {
    if (!editingId) return
    if (mode === 'commit') {
      const current = objects.find((item) => item.id === editingId)
      if (current) {
        const nextName = draftName.trim()
        updateObject(editingId, { name: nextName || current.name })
      }
    }
    setEditingId(null)
    setDraftName('')
  }

  // 面板标题由停靠标签给出（“场景对象”），这里不再重复一条标题带
  return (
    <div className="flex h-full w-full flex-col overflow-y-auto px-2 py-1.5" role="list" aria-label="场景对象">
      {objects.length === 0 && (
        <UiEmpty size="xs" title="场景为空" description="用顶部命令带的快速添加按钮放入几何体、角色或摄像机" />
      )}
      {objects.map((object) => {
        const isEditing = object.id === editingId
        const isSelected = object.id === selectedId
        const isFramingCamera = object.type === 'camera' && object.id === activeCameraId

        return (
          <div key={object.id} role="listitem" className="flex items-center gap-0.5">
            {isEditing ? (
              // 改名直接把名称换成输入框，不再给输入框外面套一圈强调色描边的框
              <div className="flex min-w-0 flex-1 items-center gap-2 pl-2.5">
                <span aria-hidden="true" className="shrink-0 text-text2">
                  <TypeIcon object={object} />
                </span>
                <UiInput
                  ref={inputRef}
                  aria-label="对象名称"
                  size="sm"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={() => finishRename('commit')}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      finishRename('commit')
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      finishRename('cancel')
                    }
                  }}
                  className="min-w-0 flex-1"
                />
              </div>
            ) : (
              <UiOptionButton
                active={isSelected}
                variant="menu"
                onClick={() => setSelected(object.id)}
                onDoubleClick={() => beginRename(object)}
                size="sm"
                className="min-w-0 flex-1 gap-2"
                title={`${object.name}（双击可改名）`}
              >
                <span aria-hidden="true" className="shrink-0 text-text2">
                  <TypeIcon object={object} />
                </span>
                <span className="truncate">{object.name}</span>
                {isFramingCamera && (
                  <span className="ml-auto shrink-0 text-2xs text-text2">取景</span>
                )}
              </UiOptionButton>
            )}
            <UiIconButton
              size="sm"
              title={object.visible ? '隐藏' : '显示'}
              aria-label={object.visible ? `隐藏${object.name}` : `显示${object.name}`}
              onClick={() => updateObject(object.id, { visible: !object.visible })}
            >
              {object.visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </UiIconButton>
            <UiIconButton
              size="sm"
              title="复制 (Ctrl+D)"
              aria-label={`复制${object.name}`}
              onClick={() => duplicateObject(object.id)}
            >
              <Copy size={14} />
            </UiIconButton>
            <UiIconButton
              size="sm"
              tone="danger"
              title="删除"
              aria-label={`删除${object.name}`}
              onClick={() => removeObject(object.id)}
            >
              <Trash2 size={14} />
            </UiIconButton>
          </div>
        )
      })}
    </div>
  )
}

export default ObjectListPanel

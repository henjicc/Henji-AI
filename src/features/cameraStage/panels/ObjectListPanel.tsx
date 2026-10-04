import React, { useEffect, useRef, useState } from 'react'
import { Box, Camera, Copy, Eye, EyeOff, Trash2, User } from 'lucide-react'
import { UiIconButton, UiInput, UiOptionButton } from '@/components/ui'
import type { StageObject } from '../domain/sceneTypes'
import { useCameraStageStore } from '../store/cameraStageStore'

/** 左侧场景对象列表：列表选中/显隐/复制/删除；双击对象名称可直接行内改名 */

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

  return (
    <div className="flex h-full w-full flex-col bg-raised">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <span className="text-sm font-medium text-text1">场景对象</span>
        <span className="text-xs text-text2">{objects.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {objects.length === 0 && (
          <div className="px-2 pt-6 text-center text-xs text-text2">
            场景为空，点击顶部工具栏的快速添加图标开始搭建
          </div>
        )}
        <div className="flex flex-col gap-1">
          {objects.map((object) => {
            const isEditing = object.id === editingId
            const isSelected = object.id === selectedId

            return (
              <div key={object.id} className="flex items-center gap-1">
                {isEditing ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-accent bg-hover px-2.5 py-1.5">
                    <span className="shrink-0 text-text2">
                      <TypeIcon object={object} />
                    </span>
                    <UiInput
                      ref={inputRef}
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
                      size="sm" className="min-w-0 flex-1 px-2 py-0"
                    />
                    {object.type === 'camera' && object.id === activeCameraId && (
                      <span className="shrink-0 text-2xs text-text2">取景</span>
                    )}
                  </div>
                ) : (
                  <UiOptionButton
                    active={isSelected}
                    variant="menu"
                    onClick={() => setSelected(object.id)}
                    onDoubleClick={() => beginRename(object)}
                    size="md" className="min-w-0 flex-1 gap-2 py-1.5"
                    title="双击可改名"
                  >
                    <span className="shrink-0 text-text2">
                      <TypeIcon object={object} />
                    </span>
                    <span className="truncate">{object.name}</span>
                    {object.type === 'camera' && object.id === activeCameraId && (
                      <span className={`ml-auto shrink-0 text-2xs text-text2`}>取景</span>
                    )}
                  </UiOptionButton>
                )}
                <UiIconButton
                  className="shrink-0"
                  title={object.visible ? '隐藏' : '显示'}
                  onClick={() => updateObject(object.id, { visible: !object.visible })}
                >
                  {object.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </UiIconButton>
                <UiIconButton
                  className="shrink-0"
                  title="复制 (Ctrl+D)"
                  onClick={() => duplicateObject(object.id)}
                >
                  <Copy size={13} />
                </UiIconButton>
                <UiIconButton tone="danger"
                  className="shrink-0"
                  title="删除"
                  onClick={() => removeObject(object.id)}
                >
                  <Trash2 size={13} />
                </UiIconButton>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default ObjectListPanel

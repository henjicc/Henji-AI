import { UI_ICON_SIZE } from '@/core/theme/icons'
import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Box, Camera, Copy, Eye, EyeOff, Trash2, User } from 'lucide-react'
import { UiEmpty, UiIconButton, UiInput, UiOptionButton } from '@/components/ui'
import type { StageObject } from '../domain/sceneTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import { createRafScheduler } from '@/utils/createRafScheduler'
import { ownerWindowOf } from '@/utils/crossRealmDom'

/** 场景对象列表：列表选中/显隐/复制/删除；双击对象名称可直接行内改名 */

const TypeIcon: React.FC<{ type: StageObject['type'] }> = ({ type }) => {
  if (type === 'character') return <User size={UI_ICON_SIZE.sm} />
  if (type === 'camera') return <Camera size={UI_ICON_SIZE.sm} />
  return <Box size={UI_ICON_SIZE.sm} />
}

/*
 * 行内组件只接收列表展示用到的字段：播放与逐帧导出每次 seek 都会换掉整份 objects（变换被重新采样），
 * 名称、显隐不变的行据此跳过重渲染，否则每帧要重建全部行的悬停提示。
 */
interface ObjectNameButtonProps {
  id: string
  name: string
  type: StageObject['type']
  selected: boolean
  framingCamera: boolean
  onBeginRename: (id: string, name: string) => void
}

const ObjectNameButton = memo(function ObjectNameButton({ id, name, type, selected, framingCamera, onBeginRename }: ObjectNameButtonProps) {
  const setSelected = useCameraStageStore((state) => state.setSelected)
  return (
    <UiOptionButton
      active={selected}
      variant="menu"
      onClick={() => setSelected(id)}
      onDoubleClick={() => onBeginRename(id, name)}
      size="sm"
      className="min-w-0 flex-1 gap-2"
      tooltip={`${name}（双击可改名）`}
    >
      <span aria-hidden="true" className="shrink-0 text-text2">
        <TypeIcon type={type} />
      </span>
      <span className="truncate">{name}</span>
      {framingCamera && (
        <span className="ml-auto shrink-0 text-2xs text-text2">取景</span>
      )}
    </UiOptionButton>
  )
})

const ObjectRowActions = memo(function ObjectRowActions({ id, name, visible }: { id: string; name: string; visible: boolean }) {
  const removeObject = useCameraStageStore((state) => state.removeObject)
  const updateObject = useCameraStageStore((state) => state.updateObject)
  const duplicateObject = useCameraStageStore((state) => state.duplicateObject)
  return (
    <>
      <UiIconButton
        size="xs"
        tooltip={visible ? '隐藏' : '显示'}
        aria-label={visible ? `隐藏${name}` : `显示${name}`}
        onClick={() => updateObject(id, { visible: !visible })}
      >
        {visible ? <Eye  /> : <EyeOff  />}
      </UiIconButton>
      <UiIconButton
        size="xs"
        tooltip="复制 (Ctrl+D)"
        aria-label={`复制${name}`}
        onClick={() => duplicateObject(id)}
      >
        <Copy  />
      </UiIconButton>
      <UiIconButton
        size="xs"
        tone="danger"
        tooltip="删除"
        aria-label={`删除${name}`}
        onClick={() => removeObject(id)}
      >
        <Trash2  />
      </UiIconButton>
    </>
  )
})

const ObjectListPanel: React.FC = () => {
  const objects = useCameraStageStore((state) => state.objects)
  const selectedId = useCameraStageStore((state) => state.selectedId)
  const activeCameraId = useCameraStageStore((state) => state.activeCameraId)
  const setSelected = useCameraStageStore((state) => state.setSelected)
  const updateObject = useCameraStageStore((state) => state.updateObject)
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

    const focus = createRafScheduler(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, ownerWindowOf(inputRef.current))
    focus.schedule()

    return () => focus.cancel()
  }, [editingId, objects])

  const beginRename = useCallback((id: string, name: string): void => {
    setSelected(id)
    setEditingId(id)
    setDraftName(name)
  }, [setSelected])

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
              <div className="flex min-w-0 flex-1 items-center gap-2 pl-3">
                <span aria-hidden="true" className="shrink-0 text-text2">
                  <TypeIcon type={object.type} />
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
              <ObjectNameButton
                id={object.id}
                name={object.name}
                type={object.type}
                selected={isSelected}
                framingCamera={isFramingCamera}
                onBeginRename={beginRename}
              />
            )}
            <ObjectRowActions id={object.id} name={object.name} visible={object.visible} />
          </div>
        )
      })}
    </div>
  )
}

export default ObjectListPanel

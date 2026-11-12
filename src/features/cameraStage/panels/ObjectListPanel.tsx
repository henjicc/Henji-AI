import { UI_ICON_SIZE } from '@/core/theme/icons'
import React, { memo, useCallback, useEffect, useState } from 'react'
import { Box, Camera, Copy, Eye, EyeOff, Trash2, User } from 'lucide-react'
import { UiEmpty, UiIconButton, UiInput, UiOptionButton, UiVirtualList } from '@/components/ui'
import type { StageObject } from '../domain/sceneTypes'
import { useCameraStageStore, type CameraStageState } from '../store/cameraStageStore'
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
 * 操作函数也由列表传入、行内不订阅 store：每个订阅在每次 store 写入时都要检查一遍，
 * 上万行时，仅播放头的低频回写就要检查几万次。
 */
interface ObjectNameButtonProps {
  id: string
  name: string
  type: StageObject['type']
  selected: boolean
  framingCamera: boolean
  onSelect: (id: string) => void
  onBeginRename: (id: string, name: string) => void
}

const ObjectNameButton = memo(function ObjectNameButton({ id, name, type, selected, framingCamera, onSelect, onBeginRename }: ObjectNameButtonProps) {
  return (
    <UiOptionButton
      active={selected}
      variant="menu"
      onClick={() => onSelect(id)}
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

interface ObjectRowActionsProps {
  id: string
  name: string
  visible: boolean
  onUpdate: CameraStageState['updateObject']
  onDuplicate: CameraStageState['duplicateObject']
  onRemove: CameraStageState['removeObject']
}

const ObjectRowActions = memo(function ObjectRowActions({ id, name, visible, onUpdate, onDuplicate, onRemove }: ObjectRowActionsProps) {
  return (
    <>
      <UiIconButton
        size="xs"
        tone="rest"
        on={!visible}
        tooltip={visible ? '隐藏' : '显示'}
        aria-label={visible ? `隐藏${name}` : `显示${name}`}
        onClick={() => onUpdate(id, { visible: !visible })}
      >
        {visible ? <Eye  /> : <EyeOff  />}
      </UiIconButton>
      <UiIconButton
        size="xs"
        tooltip="复制 (Ctrl+D)"
        aria-label={`复制${name}`}
        onClick={() => onDuplicate(id)}
      >
        <Copy  />
      </UiIconButton>
      <UiIconButton
        size="xs"
        tone="danger"
        tooltip="删除"
        aria-label={`删除${name}`}
        onClick={() => onRemove(id)}
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
  const duplicateObject = useCameraStageStore((state) => state.duplicateObject)
  const removeObject = useCameraStageStore((state) => state.removeObject)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  // 虚拟列表的行晚于列表本身提交，输入框挂上后才能按它所在的窗口（可能是浮窗）排聚焦帧
  const [input, setInput] = useState<HTMLInputElement | null>(null)

  // 正在改名的对象被删掉（撤销、助手写入）就退出改名。
  useEffect(() => {
    if (editingId && !objects.some((item) => item.id === editingId)) {
      setEditingId(null)
      setDraftName('')
    }
  }, [editingId, objects])

  // 只在进入改名、输入框挂上时聚焦并全选一次：场景里其他对象一变（播放、助手写入）就重选，会打断正在输入的文字。
  useEffect(() => {
    if (!editingId || !input) return
    const focus = createRafScheduler(() => {
      input.focus()
      input.select()
    }, ownerWindowOf(input))
    focus.schedule()
    return () => focus.cancel()
  }, [editingId, input])

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

  const renderRow = (object: StageObject): React.ReactNode => {
    const isEditing = object.id === editingId
    const isSelected = object.id === selectedId
    const isFramingCamera = object.type === 'camera' && object.id === activeCameraId

    return (
      <div role="listitem" className="group/object flex items-center gap-0.5 px-2">
        {isEditing ? (
          // 改名直接把名称换成输入框，不再给输入框外面套一圈强调色描边的框
          <div className="flex min-w-0 flex-1 items-center gap-2 pl-3">
            <span aria-hidden="true" className="shrink-0 text-text2">
              <TypeIcon type={object.type} />
            </span>
            <UiInput
              ref={setInput}
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
            onSelect={setSelected}
            onBeginRename={beginRename}
          />
        )}
        {/* 行内操作只在悬停、聚焦或选中的行出现；隐藏着的对象一直露出“显示”（偏离默认） */}
        <span data-layout-allow="tone" data-layout-allow-reason="显示开关保持默认时退到图标灰，复制与删除是动作" className={`flex items-center transition-opacity duration-120 group-hover/object:opacity-100 focus-within:opacity-100 ${isSelected || !object.visible ? 'opacity-100' : 'opacity-0'}`}>
        <ObjectRowActions
          id={object.id}
          name={object.name}
          visible={object.visible}
          onUpdate={updateObject}
          onDuplicate={duplicateObject}
          onRemove={removeObject}
        />
        </span>
      </div>
    )
  }

  // 面板标题由停靠标签给出（“场景对象”），这里不再重复一条标题带。
  // 上万个物体时整表挂载要几秒（每行四个按钮和悬停提示），只挂可见的行；滚动条仍贴面板右缘，所以左右留白放在行上
  return (
    <div className="flex h-full w-full flex-col py-1.5" role="list" aria-label="场景对象">
      <UiVirtualList
        data={objects}
        getKey={(object) => object.id}
        retainScroll
        emptyState={(
          <div className="px-2">
            <UiEmpty size="xs" title="场景为空" description="用顶部命令带的快速添加按钮放入几何体、角色或摄像机" />
          </div>
        )}
        renderItem={renderRow}
      />
    </div>
  )
}

export default ObjectListPanel

import React from 'react'
import { Box, Camera, Eye, EyeOff, Trash2, User } from 'lucide-react'
import Dropdown from '@/components/ui/Dropdown'
import { UiIconButton, UiOptionButton } from '@/components/ui'
import { PRIMITIVE_KINDS, PRIMITIVE_KIND_LABELS } from '../domain/sceneDefaults'
import type { StageObject, StagePrimitiveKind } from '../domain/sceneTypes'
import { useCameraStageStore } from '../store/cameraStageStore'

/** 左侧场景对象列表：添加入口 + 列表选中/显隐/删除 */

type AddOptionValue = StagePrimitiveKind | 'character' | 'camera'

const ADD_OPTIONS: Array<{ label: string; value: AddOptionValue }> = [
  ...PRIMITIVE_KINDS.map((kind) => ({ label: PRIMITIVE_KIND_LABELS[kind], value: kind as AddOptionValue })),
  { label: '角色', value: 'character' },
  { label: '机位相机（占位）', value: 'camera' },
]

const TypeIcon: React.FC<{ object: StageObject }> = ({ object }) => {
  if (object.type === 'character') return <User size={14} />
  if (object.type === 'camera') return <Camera size={14} />
  return <Box size={14} />
}

const ObjectListPanel: React.FC = () => {
  const objects = useCameraStageStore((state) => state.objects)
  const selectedId = useCameraStageStore((state) => state.selectedId)
  const setSelected = useCameraStageStore((state) => state.setSelected)
  const removeObject = useCameraStageStore((state) => state.removeObject)
  const updateObject = useCameraStageStore((state) => state.updateObject)
  const addPrimitive = useCameraStageStore((state) => state.addPrimitive)
  const addCharacter = useCameraStageStore((state) => state.addCharacter)
  const addCamera = useCameraStageStore((state) => state.addCamera)

  const handleAdd = (value: AddOptionValue): void => {
    if (value === 'character') {
      addCharacter()
    } else if (value === 'camera') {
      addCamera()
    } else {
      addPrimitive(value)
    }
  }

  return (
    <div className="flex h-full w-60 flex-col border-r border-border-dark bg-surface-dark">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <span className="text-sm font-medium text-text-dark">场景对象</span>
        <span className="text-xs text-text-muted">{objects.length}</span>
      </div>
      <div className="px-3 pb-2">
        <Dropdown<AddOptionValue>
          display="＋ 添加对象"
          options={ADD_OPTIONS}
          onSelect={handleAdd}
          className="w-full"
          buttonClassName="w-full justify-center"
          minWidthStrategy="none"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {objects.length === 0 && (
          <div className="px-2 pt-6 text-center text-xs text-text-muted">
            场景为空，点击上方"添加对象"开始搭建
          </div>
        )}
        <div className="flex flex-col gap-1">
          {objects.map((object) => (
            <div key={object.id} className="flex items-center gap-1">
              <UiOptionButton
                active={object.id === selectedId}
                onClick={() => setSelected(object.id)}
                className="min-w-0 flex-1 gap-2 py-1.5 text-sm"
              >
                <span className="shrink-0 text-text-muted"><TypeIcon object={object} /></span>
                <span className="truncate">{object.name}</span>
              </UiOptionButton>
              <UiIconButton
                showBorder={false}
                appearance="hover-only"
                className="h-7 w-7 shrink-0"
                title={object.visible ? '隐藏' : '显示'}
                onClick={() => updateObject(object.id, { visible: !object.visible })}
              >
                {object.visible ? <Eye size={13} /> : <EyeOff size={13} />}
              </UiIconButton>
              <UiIconButton
                showBorder={false}
                appearance="hover-only"
                hoverVariant="danger"
                className="h-7 w-7 shrink-0"
                title="删除"
                onClick={() => removeObject(object.id)}
              >
                <Trash2 size={13} />
              </UiIconButton>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ObjectListPanel

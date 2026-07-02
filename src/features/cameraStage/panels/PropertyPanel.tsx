import React from 'react'
import NumberInput from '@/components/ui/NumberInput'
import { UiButton, UiInput, UiSwitch } from '@/components/ui'
import { CAMERA_STAGE_OBJECT_PALETTE_HEX } from '@/core/theme/colorTokens'
import type { StageObject, StageVec3 } from '../domain/sceneTypes'
import { useCameraStageStore } from '../store/cameraStageStore'

/** 右侧属性面板：名称/颜色/变换（位置、旋转、缩放）与对象类型专属字段 */

type Vec3Key = 'position' | 'rotation' | 'scale'

const VEC3_ROWS: Array<{ key: Vec3Key; label: string; step: number; precision: number }> = [
  { key: 'position', label: '位置', step: 0.1, precision: 2 },
  { key: 'rotation', label: '旋转（°）', step: 5, precision: 1 },
  { key: 'scale', label: '缩放', step: 0.1, precision: 2 },
]

const AXES: Array<keyof StageVec3> = ['x', 'y', 'z']

interface Vec3RowProps {
  label: string
  value: StageVec3
  step: number
  precision: number
  min?: number
  onChange: (next: StageVec3) => void
}

const Vec3Row: React.FC<Vec3RowProps> = ({ label, value, step, precision, min, onChange }) => (
  <div>
    <div className="mb-1 text-xs text-text-muted">{label}</div>
    <div className="flex gap-1.5">
      {AXES.map((axis) => (
        <NumberInput
          key={axis}
          value={value[axis]}
          step={step}
          precision={precision}
          min={min}
          widthClassName="w-full"
          className="min-w-0 flex-1"
          commitOnChange
          wheelStep
          onChange={(next) => onChange({ ...value, [axis]: next })}
        />
      ))}
    </div>
  </div>
)

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-xs font-medium uppercase tracking-wide text-text-muted">{children}</div>
)

const PropertyPanel: React.FC = () => {
  const objects = useCameraStageStore((state) => state.objects)
  const selectedId = useCameraStageStore((state) => state.selectedId)
  const updateObject = useCameraStageStore((state) => state.updateObject)
  const updateTransform = useCameraStageStore((state) => state.updateTransform)

  const selected: StageObject | undefined = objects.find((item) => item.id === selectedId)

  if (!selected) {
    return (
      <div className="flex h-full w-72 flex-col border-l border-border-dark bg-surface-dark">
        <div className="px-3 pb-2 pt-3 text-sm font-medium text-text-dark">属性</div>
        <div className="px-3 pt-4 text-center text-xs text-text-muted">
          选中一个场景对象后在这里编辑属性
        </div>
      </div>
    )
  }

  const handleUniformScale = (next: number): void => {
    updateTransform(selected.id, { scale: { x: next, y: next, z: next } })
  }

  return (
    <div className="flex h-full w-72 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-l border-border-dark bg-surface-dark">
      <div className="px-3 pb-2 pt-3 text-sm font-medium text-text-dark">属性</div>
      <div className="flex flex-col gap-4 px-3 pb-4">
        <div className="flex flex-col gap-2">
          <SectionTitle>名称</SectionTitle>
          <UiInput
            value={selected.name}
            onChange={(event) => updateObject(selected.id, { name: event.target.value })}
          />
        </div>

        <div className="flex flex-col gap-2">
          <SectionTitle>颜色</SectionTitle>
          <div className="flex items-center gap-1.5">
            <UiInput
              type="color"
              value={selected.color}
              onChange={(event) => updateObject(selected.id, { color: event.target.value })}
              className="h-9 !w-12 shrink-0 cursor-pointer p-1"
            />
            <div className="flex flex-1 flex-wrap gap-1">
              {CAMERA_STAGE_OBJECT_PALETTE_HEX.map((hex) => (
                <UiButton
                  key={hex}
                  size="sm"
                  title={hex}
                  className="h-6 w-6 min-w-0 rounded-md border-border-dark p-0"
                  style={{ backgroundColor: hex }}
                  onClick={() => updateObject(selected.id, { color: hex })}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <SectionTitle>变换</SectionTitle>
          {VEC3_ROWS.map((row) => (
            <Vec3Row
              key={row.key}
              label={row.label}
              value={selected.transform[row.key]}
              step={row.step}
              precision={row.precision}
              min={row.key === 'scale' ? 0.01 : undefined}
              onChange={(next) => updateTransform(selected.id, { [row.key]: next })}
            />
          ))}
          <div>
            <div className="mb-1 text-xs text-text-muted">统一缩放</div>
            <NumberInput
              value={selected.transform.scale.x}
              step={0.1}
              min={0.01}
              precision={2}
              widthClassName="w-full"
              commitOnChange
              wheelStep
              onChange={handleUniformScale}
            />
          </div>
        </div>

        {selected.type === 'camera' && (
          <div className="flex flex-col gap-2">
            <SectionTitle>相机</SectionTitle>
            <div>
              <div className="mb-1 text-xs text-text-muted">视野角 FOV（°）</div>
              <NumberInput
                value={selected.fov}
                step={1}
                min={10}
                max={120}
                precision={0}
                widthClassName="w-full"
                commitOnChange
                wheelStep
                onChange={(next) => updateObject(selected.id, { fov: next })}
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <SectionTitle>显示</SectionTitle>
          <UiSwitch
            checked={selected.visible}
            onCheckedChange={(checked) => updateObject(selected.id, { visible: checked })}
          />
        </div>
      </div>
    </div>
  )
}

export default PropertyPanel

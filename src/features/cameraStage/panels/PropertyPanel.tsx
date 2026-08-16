import React from 'react'
import { Lock, Unlock } from 'lucide-react'
import NumberInput from '@/components/ui/NumberInput'
import { UiButton, UiIconButton, UiInput, UiSwitch } from '@/components/ui'
import { CAMERA_STAGE_OBJECT_PALETTE_HEX } from '@/core/theme/colorTokens'
import type { StageObject, StageTransform, StageVec3 } from '../domain/sceneTypes'
import { beginHistorySession, endHistorySession, useCameraStageStore } from '../store/cameraStageStore'
import CameraSettingsSection from './CameraSettingsSection'
import CharacterPoseSection from './CharacterPoseSection'
import SceneSettingsPanel from './SceneSettingsPanel'

/** 右侧属性面板：名称/颜色/变换（位置、旋转、缩放）与对象类型专属字段 */

type Vec3Key = 'position' | 'rotation' | 'scale'

const VEC3_ROWS: Array<{ key: Vec3Key; label: string; step: number; precision: number }> = [
  { key: 'position', label: '位置（约米）', step: 0.1, precision: 2 },
  { key: 'rotation', label: '旋转（°）', step: 5, precision: 1 },
  { key: 'scale', label: '缩放（倍）', step: 0.1, precision: 2 },
]

const AXES: Array<keyof StageVec3> = ['x', 'y', 'z']
const AXIS_LABELS: Record<keyof StageVec3, string> = { x: 'X', y: 'Y', z: 'Z' }

interface Vec3RowProps {
  label: string
  pathKey: Vec3Key
  value: StageVec3
  step: number
  precision: number
  min?: number
  onChange: (next: StageVec3, changedPaths?: string[]) => void
  scaleLocked?: boolean
  onScaleLockedChange?: (locked: boolean) => void
}

const Vec3Row: React.FC<Vec3RowProps> = ({
  label,
  pathKey,
  value,
  step,
  precision,
  min,
  onChange,
  scaleLocked = false,
  onScaleLockedChange,
}) => (
  <div>
    <div className="mb-1 flex items-center justify-between gap-2 text-xs text-text-muted">
      <span>{label}</span>
      {pathKey === 'scale' && onScaleLockedChange && (
        <UiIconButton
          type="button"
          showBorder={false}
          appearance="hover-only"
          active={scaleLocked}
          title={scaleLocked ? '已锁定等比缩放' : '独立缩放'}
          aria-label={scaleLocked ? '关闭等比缩放' : '开启等比缩放'}
          className="h-6 w-6 shrink-0"
          onClick={() => onScaleLockedChange(!scaleLocked)}
        >
          {scaleLocked ? <Lock size={13} /> : <Unlock size={13} />}
        </UiIconButton>
      )}
    </div>
    <div className="flex gap-1.5">
      {AXES.map((axis) => (
        <div key={axis} className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-0.5 text-3xs text-text-muted">
            <span>{AXIS_LABELS[axis]}</span>
          </div>
          <NumberInput
            value={value[axis]}
            step={step}
            precision={precision}
            min={min}
            widthClassName="w-full"
            className="min-w-0"
            commitOnChange
            wheelStep
            onChange={(next) => {
              const lockedScale = pathKey === 'scale' && scaleLocked
              onChange(
                lockedScale ? { x: next, y: next, z: next } : { ...value, [axis]: next },
                lockedScale ? undefined : [`transform.${pathKey}.${axis}`],
              )
            }}
          />
        </div>
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
  const [scaleLocked, setScaleLocked] = React.useState(false)

  const selected: StageObject | undefined = objects.find((item) => item.id === selectedId)

  if (!selected) {
    return <SceneSettingsPanel />
  }

  const handleScaleLockedChange = (locked: boolean): void => {
    setScaleLocked(locked)
    if (!locked || selected.type === 'camera') return

    const next = selected.transform.scale.x
    updateTransform(selected.id, { scale: { x: next, y: next, z: next } })
  }

  const transformRows = selected.type === 'camera'
    ? VEC3_ROWS.filter((row) => row.key === 'position')
    : VEC3_ROWS

  return (
    <div
      className="flex h-full w-full flex-col overflow-y-auto overflow-x-hidden bg-surface-dark"
      // 一段连续编辑（聚焦某控件时的输入/滑杆拖动）合并为一条撤销记录：焦点进入开会话，离开提交
      onFocusCapture={beginHistorySession}
      onBlurCapture={endHistorySession}
    >
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
          {transformRows.map((row) => (
            <Vec3Row
              key={row.key}
              label={row.label}
              pathKey={row.key}
              value={selected.transform[row.key]}
              step={row.step}
              precision={row.precision}
              min={row.key === 'scale' ? 0.01 : undefined}
              scaleLocked={row.key === 'scale' && scaleLocked}
              onScaleLockedChange={row.key === 'scale' ? handleScaleLockedChange : undefined}
              onChange={(next, changedPaths) => updateTransform(
                selected.id,
                { [row.key]: next } as Partial<StageTransform>,
                changedPaths,
              )}
            />
          ))}
        </div>

        {selected.type === 'character' && <CharacterPoseSection object={selected} />}

        {selected.type === 'camera' && <CameraSettingsSection object={selected} />}

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

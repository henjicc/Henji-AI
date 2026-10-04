import React from 'react'
import { Lock, Unlock } from 'lucide-react'
import { UiColorInput, UiFormRow, UiGroup, UiIconButton, UiInput, UiOptionButton } from '@/components/ui'
import { CAMERA_STAGE_OBJECT_PALETTE_HEX } from '@/core/theme/colorTokens'
import type { StageObject, StageTransform } from '../domain/sceneTypes'
import { beginHistorySession, endHistorySession, useCameraStageStore } from '../store/cameraStageStore'
import CameraSettingsSection from './CameraSettingsSection'
import CharacterPoseSection from './CharacterPoseSection'
import SceneSettingsPanel from './SceneSettingsPanel'
import { SwitchRow, Vec3Row } from './panelFields'

/** 右侧属性面板：名称/颜色/显示、变换（位置、旋转、缩放）与对象类型专属字段；未选中对象时显示场景设置 */

type Vec3Key = 'position' | 'rotation' | 'scale'

const VEC3_ROWS: Array<{ key: Vec3Key; label: string; name: string; step: number; precision: number }> = [
  { key: 'position', label: '位置（约米）', name: '位置', step: 0.1, precision: 2 },
  { key: 'rotation', label: '旋转（°）', name: '旋转', step: 5, precision: 1 },
  { key: 'scale', label: '缩放（倍）', name: '缩放', step: 0.1, precision: 2 },
]

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
      className="flex h-full w-full flex-col gap-3 overflow-y-auto overflow-x-hidden px-3 py-2.5"
      // 一段连续编辑（聚焦某控件时的输入/滑杆拖动）合并为一条撤销记录：焦点进入开会话，离开提交
      onFocusCapture={beginHistorySession}
      onBlurCapture={endHistorySession}
    >
      {/* 面板标题由停靠标签给出（“属性”），这里不再重复一条标题带 */}
      <UiGroup title="对象" titleTone="compact">
        <UiFormRow label="名称" density="compact">
          <UiInput
            aria-label="对象名称"
            size="sm"
            value={selected.name}
            onChange={(event) => updateObject(selected.id, { name: event.target.value })}
          />
        </UiFormRow>
        <UiFormRow label="颜色" density="compact">
          <div className="flex items-center gap-2">
            <UiColorInput
              aria-label="自定义颜色"
              value={selected.color}
              onChange={(event) => updateObject(selected.id, { color: event.target.value })}
            />
            <div className="flex flex-1 flex-wrap gap-1">
              {CAMERA_STAGE_OBJECT_PALETTE_HEX.map((hex) => (
                <UiOptionButton
                  key={hex}
                  variant="swatch"
                  active={selected.color.toLowerCase() === hex.toLowerCase()}
                  aria-pressed={selected.color.toLowerCase() === hex.toLowerCase()}
                  aria-label={`颜色 ${hex}`}
                  title={hex}
                  // 对象颜色是用户内容色（登记在 colorTokens），色样只能内联
                  style={{ backgroundColor: hex }}
                  onClick={() => updateObject(selected.id, { color: hex })}
                />
              ))}
            </div>
          </div>
        </UiFormRow>
        <SwitchRow
          label="在场景中显示"
          checked={selected.visible}
          onChange={(checked) => updateObject(selected.id, { visible: checked })}
        />
      </UiGroup>

      <UiGroup title="变换" titleTone="compact" divided>
        {transformRows.map((row) => (
          <Vec3Row
            key={row.key}
            label={row.label}
            name={row.name}
            value={selected.transform[row.key]}
            step={row.step}
            precision={row.precision}
            min={row.key === 'scale' ? 0.01 : undefined}
            actions={row.key === 'scale' ? (
              <UiIconButton
                size="sm"
                on={scaleLocked}
                title={scaleLocked ? '已锁定等比缩放' : '独立缩放'}
                aria-label={scaleLocked ? '关闭等比缩放' : '开启等比缩放'}
                onClick={() => handleScaleLockedChange(!scaleLocked)}
              >
                {scaleLocked ? <Lock size={13} /> : <Unlock size={13} />}
              </UiIconButton>
            ) : undefined}
            onAxisChange={(axis, next) => {
              const value = selected.transform[row.key]
              const lockedScale = row.key === 'scale' && scaleLocked
              updateTransform(
                selected.id,
                { [row.key]: lockedScale ? { x: next, y: next, z: next } : { ...value, [axis]: next } } as Partial<StageTransform>,
                lockedScale ? undefined : [`transform.${row.key}.${axis}`],
              )
            }}
          />
        ))}
      </UiGroup>

      {selected.type === 'character' && <CharacterPoseSection object={selected} />}

      {selected.type === 'camera' && <CameraSettingsSection object={selected} />}
    </div>
  )
}

export default PropertyPanel

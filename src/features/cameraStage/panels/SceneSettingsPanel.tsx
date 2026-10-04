import React from 'react'
import { Dropdown, UiFormRow, UiGroup, UiSwitch } from '@/components/ui'
import { GROUND_PATTERN_OPTIONS } from '../domain/sceneDefaults'
import type { StageGroundPattern } from '../domain/sceneTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import { ColorRow, SliderNumberRow, SwitchRow, Vec3Row } from './panelFields'

function formatTimeOfDayLabel(value: number): string {
  const normalized = Math.max(0, Math.min(24, value))
  const hours = Math.floor(normalized)
  const minutes = Math.round((normalized - hours) * 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

const SceneSettingsPanel: React.FC = () => {
  const sceneSettings = useCameraStageStore((state) => state.sceneSettings)
  const setSceneGroundColor = useCameraStageStore((state) => state.setSceneGroundColor)
  const setSceneGroundPattern = useCameraStageStore((state) => state.setSceneGroundPattern)
  const setSceneGroundDensity = useCameraStageStore((state) => state.setSceneGroundDensity)
  const setSceneGroundGridLineColor = useCameraStageStore((state) => state.setSceneGroundGridLineColor)
  const setSceneGroundGridLineThickness = useCameraStageStore((state) => state.setSceneGroundGridLineThickness)
  const setSceneGroundCheckerLightColor = useCameraStageStore((state) => state.setSceneGroundCheckerLightColor)
  const setSceneGroundCheckerDarkColor = useCameraStageStore((state) => state.setSceneGroundCheckerDarkColor)
  const setSceneSkyColor = useCameraStageStore((state) => state.setSceneSkyColor)
  const setSceneSunlightEnabled = useCameraStageStore((state) => state.setSceneSunlightEnabled)
  const setSceneSunlightIntensity = useCameraStageStore((state) => state.setSceneSunlightIntensity)
  const setSceneSunlightTimeOfDay = useCameraStageStore((state) => state.setSceneSunlightTimeOfDay)
  const setSceneFogEnabled = useCameraStageStore((state) => state.setSceneFogEnabled)
  const setSceneFogDistance = useCameraStageStore((state) => state.setSceneFogDistance)
  const setSceneShowNameLabels = useCameraStageStore((state) => state.setSceneShowNameLabels)
  const setSceneNameLabelTextColor = useCameraStageStore((state) => state.setSceneNameLabelTextColor)
  const setSceneNameLabelBackgroundColor = useCameraStageStore((state) => state.setSceneNameLabelBackgroundColor)
  const setSceneNameLabelBackgroundOpacity = useCameraStageStore((state) => state.setSceneNameLabelBackgroundOpacity)
  const setSceneNameLabelFollowObjectColor = useCameraStageStore((state) => state.setSceneNameLabelFollowObjectColor)
  const setSceneNameLabelScale = useCameraStageStore((state) => state.setSceneNameLabelScale)
  const setSceneNameLabelOffset = useCameraStageStore((state) => state.setSceneNameLabelOffset)
  const setSceneNameLabelShadowColor = useCameraStageStore((state) => state.setSceneNameLabelShadowColor)
  const setSceneNameLabelShadowOpacity = useCameraStageStore((state) => state.setSceneNameLabelShadowOpacity)
  const setSceneNameLabelShadowBlur = useCameraStageStore((state) => state.setSceneNameLabelShadowBlur)
  const setSceneNameLabelShadowDistance = useCameraStageStore((state) => state.setSceneNameLabelShadowDistance)
  const setSceneNameLabelShadowAngle = useCameraStageStore((state) => state.setSceneNameLabelShadowAngle)
  const labelSettings = sceneSettings.display.nameLabel

  return (
    // 未选中对象时属性面板显示场景设置；面板标题由停靠标签给出，这里不再重复一条标题带
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto overflow-x-hidden px-3 py-2.5">
      <UiGroup title="地面" titleTone="compact">
        <UiFormRow label="样式" density="compact">
          <Dropdown<StageGroundPattern>
            ariaLabel="地面样式"
            value={sceneSettings.ground.pattern}
            display={GROUND_PATTERN_OPTIONS.find((item) => item.value === sceneSettings.ground.pattern)?.label ?? '纯色'}
            options={GROUND_PATTERN_OPTIONS}
            onSelect={setSceneGroundPattern}
            className="w-full"
            size="sm"
            minWidthStrategy="none"
          />
        </UiFormRow>
        {sceneSettings.ground.pattern !== 'checker' && (
          <ColorRow label="底色" value={sceneSettings.ground.color} onChange={setSceneGroundColor} />
        )}
        {sceneSettings.ground.pattern !== 'none' && (
          <SliderNumberRow label="密度" ariaLabel="地面密度" min={1} max={64} step={1} precision={0}
            value={sceneSettings.ground.density} onChange={setSceneGroundDensity} />
        )}
        {sceneSettings.ground.pattern === 'grid' && (
          <>
            <ColorRow label="线色" value={sceneSettings.ground.gridLineColor} onChange={setSceneGroundGridLineColor} />
            <SliderNumberRow label="线粗" ariaLabel="网格线粗" min={0.2} max={3} step={0.05} precision={2}
              value={sceneSettings.ground.gridLineThickness} onChange={setSceneGroundGridLineThickness} />
          </>
        )}
        {sceneSettings.ground.pattern === 'checker' && (
          <>
            <ColorRow label="亮色" value={sceneSettings.ground.checkerLightColor} onChange={setSceneGroundCheckerLightColor} />
            <ColorRow label="暗色" value={sceneSettings.ground.checkerDarkColor} onChange={setSceneGroundCheckerDarkColor} />
          </>
        )}
      </UiGroup>

      <UiGroup title="天空" titleTone="compact" divided>
        <ColorRow label="颜色" value={sceneSettings.sky.color} onChange={setSceneSkyColor} />
      </UiGroup>

      <UiGroup
        title="阳光"
        titleTone="compact"
        divided
        actions={<UiSwitch aria-label="阳光" checked={sceneSettings.sunlight.enabled} onCheckedChange={setSceneSunlightEnabled} />}
      >
        <SliderNumberRow
          label="时间"
          ariaLabel="阳光时间"
          min={0}
          max={24}
          step={0.5}
          precision={1}
          value={sceneSettings.sunlight.timeOfDay}
          onChange={setSceneSunlightTimeOfDay}
          readout={(
            <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-text2">
              {formatTimeOfDayLabel(sceneSettings.sunlight.timeOfDay)}
            </span>
          )}
        />
        <SliderNumberRow label="亮度" ariaLabel="阳光亮度" min={0} max={3} step={0.05} precision={2}
          value={sceneSettings.sunlight.intensity} onChange={setSceneSunlightIntensity} />
      </UiGroup>

      <UiGroup
        title="雾"
        titleTone="compact"
        divided
        actions={<UiSwitch aria-label="雾" checked={sceneSettings.fog.enabled} onCheckedChange={setSceneFogEnabled} />}
      >
        <SliderNumberRow label="淡出距离" ariaLabel="雾淡出距离" min={30} max={200} step={1} precision={0}
          value={sceneSettings.fog.distance} onChange={setSceneFogDistance} />
      </UiGroup>

      <UiGroup
        title="名称标签"
        titleTone="compact"
        divided
        actions={<UiSwitch aria-label="名称标签" checked={sceneSettings.display.showNameLabels} onCheckedChange={setSceneShowNameLabels} />}
      >
        {sceneSettings.display.showNameLabels && (
          <>
            <ColorRow label="文字颜色" value={labelSettings.textColor} onChange={setSceneNameLabelTextColor} />
            <SwitchRow label="背景跟随对象色" checked={labelSettings.followObjectColor} onChange={setSceneNameLabelFollowObjectColor} />
            {!labelSettings.followObjectColor && (
              <ColorRow label="背景颜色" value={labelSettings.backgroundColor} onChange={setSceneNameLabelBackgroundColor} />
            )}
            <SliderNumberRow label="背景透明度" ariaLabel="标签背景透明度" min={0} max={1} step={0.05} precision={2}
              value={labelSettings.backgroundOpacity} onChange={setSceneNameLabelBackgroundOpacity} />
            <SliderNumberRow label="整体大小" ariaLabel="标签整体大小" min={0.5} max={2.5} step={0.05} precision={2}
              value={labelSettings.scale} onChange={setSceneNameLabelScale} />
            <Vec3Row
              label="位置偏移"
              name="标签偏移"
              value={labelSettings.offset}
              step={0.05}
              precision={2}
              min={-3}
              max={3}
              onAxisChange={(axis, next) => setSceneNameLabelOffset({ ...labelSettings.offset, [axis]: next })}
            />
          </>
        )}
      </UiGroup>

      {sceneSettings.display.showNameLabels && (
        <UiGroup title="标签文字阴影" titleTone="compact" divided>
          <ColorRow label="阴影颜色" value={labelSettings.shadowColor} onChange={setSceneNameLabelShadowColor} />
          <SliderNumberRow label="阴影透明度" ariaLabel="阴影透明度" min={0} max={1} step={0.05} precision={2}
            value={labelSettings.shadowOpacity} onChange={setSceneNameLabelShadowOpacity} />
          <SliderNumberRow label="阴影模糊" ariaLabel="阴影模糊" min={0} max={24} step={1} precision={0}
            value={labelSettings.shadowBlur} onChange={setSceneNameLabelShadowBlur} />
          <SliderNumberRow label="阴影距离" ariaLabel="阴影距离" min={0} max={24} step={1} precision={0}
            value={labelSettings.shadowDistance} onChange={setSceneNameLabelShadowDistance} />
          <SliderNumberRow label="阴影方向" ariaLabel="阴影方向" min={0} max={360} step={1} precision={0}
            value={labelSettings.shadowAngle} onChange={setSceneNameLabelShadowAngle} />
        </UiGroup>
      )}
    </div>
  )
}

export default SceneSettingsPanel

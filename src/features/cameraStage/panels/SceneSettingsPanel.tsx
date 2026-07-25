import React from 'react'
import NumberInput from '@/components/ui/NumberInput'
import { Dropdown, UiColorInput, UiRangeInput, UiSwitch } from '@/components/ui'
import { GROUND_PATTERN_OPTIONS } from '../domain/sceneDefaults'
import type { StageGroundPattern, StageVec3 } from '../domain/sceneTypes'
import { useCameraStageStore } from '../store/cameraStageStore'

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-xs font-medium uppercase tracking-wide text-text-muted">{children}</div>
)

function formatTimeOfDayLabel(value: number): string {
  const normalized = Math.max(0, Math.min(24, value))
  const hours = Math.floor(normalized)
  const minutes = Math.round((normalized - hours) * 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

const LABEL_OFFSET_AXES: Array<{ key: keyof StageVec3; label: string }> = [
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'z', label: 'Z' },
]

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
    <div className="flex h-full w-full flex-col overflow-y-auto bg-surface-dark">
      <div className="px-3 pb-2 pt-3 text-sm font-medium text-text-dark">场景设置</div>
      <div className="flex flex-col gap-4 px-3 pb-4">
        <div className="flex flex-col gap-3">
          <SectionTitle>地面</SectionTitle>
          {sceneSettings.ground.pattern !== 'checker' ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-text-muted">底色</span>
              <UiColorInput
                value={sceneSettings.ground.color}
                onChange={(event) => setSceneGroundColor(event.target.value)}
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <div className="text-xs text-text-muted">样式</div>
            <Dropdown<StageGroundPattern>
              value={sceneSettings.ground.pattern}
              display={GROUND_PATTERN_OPTIONS.find((item) => item.value === sceneSettings.ground.pattern)?.label ?? '纯色'}
              options={GROUND_PATTERN_OPTIONS}
              onSelect={setSceneGroundPattern}
              className="w-full"
              minWidthStrategy="none"
            />
          </div>
          {sceneSettings.ground.pattern !== 'none' && (
            <div className="flex items-center gap-1.5">
              <UiRangeInput
                min={1}
                max={64}
                step={1}
                value={sceneSettings.ground.density}
                onChange={(event) => setSceneGroundDensity(Number(event.target.value))}
              />
              <NumberInput
                value={sceneSettings.ground.density}
                min={1}
                max={64}
                step={1}
                precision={0}
                widthClassName="w-16"
                className="shrink-0"
                commitOnChange
                wheelStep
                onChange={setSceneGroundDensity}
              />
            </div>
          )}
          {sceneSettings.ground.pattern === 'grid' && (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-muted">线色</span>
                <UiColorInput
                  value={sceneSettings.ground.gridLineColor}
                  onChange={(event) => setSceneGroundGridLineColor(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="text-xs text-text-muted">线粗</div>
                <div className="flex items-center gap-1.5">
                  <UiRangeInput
                    min={0.2}
                    max={3}
                    step={0.05}
                    value={sceneSettings.ground.gridLineThickness}
                    onChange={(event) => setSceneGroundGridLineThickness(Number(event.target.value))}
                  />
                  <NumberInput
                    value={sceneSettings.ground.gridLineThickness}
                    min={0.2}
                    max={3}
                    step={0.05}
                    precision={2}
                    widthClassName="w-16"
                    className="shrink-0"
                    commitOnChange
                    wheelStep
                    onChange={setSceneGroundGridLineThickness}
                  />
                </div>
              </div>
            </>
          )}
          {sceneSettings.ground.pattern === 'checker' && (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-muted">亮色</span>
                <UiColorInput
                  value={sceneSettings.ground.checkerLightColor}
                  onChange={(event) => setSceneGroundCheckerLightColor(event.target.value)}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-muted">暗色</span>
                <UiColorInput
                  value={sceneSettings.ground.checkerDarkColor}
                  onChange={(event) => setSceneGroundCheckerDarkColor(event.target.value)}
                />
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <SectionTitle>天空</SectionTitle>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-text-muted">颜色</span>
            <UiColorInput
              value={sceneSettings.sky.color}
              onChange={(event) => setSceneSkyColor(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <SectionTitle>阳光</SectionTitle>
            <UiSwitch checked={sceneSettings.sunlight.enabled} onCheckedChange={setSceneSunlightEnabled} />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="text-xs text-text-muted">时间</div>
            <div className="flex items-center gap-1.5">
              <UiRangeInput
                min={0}
                max={24}
                step={0.5}
                value={sceneSettings.sunlight.timeOfDay}
                onChange={(event) => setSceneSunlightTimeOfDay(Number(event.target.value))}
              />
              <div className="w-16 shrink-0 text-right text-xs text-text-muted">
                {formatTimeOfDayLabel(sceneSettings.sunlight.timeOfDay)}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="text-xs text-text-muted">亮度</div>
            <div className="flex items-center gap-1.5">
              <UiRangeInput
                min={0}
                max={3}
                step={0.05}
                value={sceneSettings.sunlight.intensity}
                onChange={(event) => setSceneSunlightIntensity(Number(event.target.value))}
              />
              <NumberInput
                value={sceneSettings.sunlight.intensity}
                min={0}
                max={3}
                step={0.05}
                precision={2}
                widthClassName="w-16"
                className="shrink-0"
                commitOnChange
                wheelStep
                onChange={setSceneSunlightIntensity}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <SectionTitle>雾</SectionTitle>
            <UiSwitch checked={sceneSettings.fog.enabled} onCheckedChange={setSceneFogEnabled} />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="text-xs text-text-muted">淡出距离</div>
            <div className="flex items-center gap-1.5">
              <UiRangeInput
                min={30}
                max={200}
                step={1}
                value={sceneSettings.fog.distance}
                onChange={(event) => setSceneFogDistance(Number(event.target.value))}
              />
              <NumberInput
                value={sceneSettings.fog.distance}
                min={30}
                max={200}
                step={1}
                precision={0}
                widthClassName="w-16"
                className="shrink-0"
                commitOnChange
                wheelStep
                onChange={setSceneFogDistance}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <SectionTitle>显示</SectionTitle>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-text-muted">名称标签</span>
            <UiSwitch checked={sceneSettings.display.showNameLabels} onCheckedChange={setSceneShowNameLabels} />
          </div>
          {sceneSettings.display.showNameLabels && (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-muted">文字颜色</span>
                <UiColorInput
                  value={labelSettings.textColor}
                  onChange={(event) => setSceneNameLabelTextColor(event.target.value)}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-muted">背景跟随对象色</span>
                <UiSwitch
                  checked={labelSettings.followObjectColor}
                  onCheckedChange={setSceneNameLabelFollowObjectColor}
                />
              </div>
              {!labelSettings.followObjectColor && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-text-muted">背景颜色</span>
                  <UiColorInput
                    value={labelSettings.backgroundColor}
                    onChange={(event) => setSceneNameLabelBackgroundColor(event.target.value)}
                  />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <div className="text-xs text-text-muted">背景透明度</div>
                <div className="flex items-center gap-1.5">
                  <UiRangeInput
                    min={0}
                    max={1}
                    step={0.05}
                    value={labelSettings.backgroundOpacity}
                    onChange={(event) => setSceneNameLabelBackgroundOpacity(Number(event.target.value))}
                  />
                  <NumberInput
                    value={labelSettings.backgroundOpacity}
                    min={0}
                    max={1}
                    step={0.05}
                    precision={2}
                    widthClassName="w-16"
                    className="shrink-0"
                    commitOnChange
                    wheelStep
                    onChange={setSceneNameLabelBackgroundOpacity}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="text-xs text-text-muted">整体大小</div>
                <div className="flex items-center gap-1.5">
                  <UiRangeInput
                    min={0.5}
                    max={2.5}
                    step={0.05}
                    value={labelSettings.scale}
                    onChange={(event) => setSceneNameLabelScale(Number(event.target.value))}
                  />
                  <NumberInput
                    value={labelSettings.scale}
                    min={0.5}
                    max={2.5}
                    step={0.05}
                    precision={2}
                    widthClassName="w-16"
                    className="shrink-0"
                    commitOnChange
                    wheelStep
                    onChange={setSceneNameLabelScale}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="text-xs text-text-muted">位置偏移</div>
                <div className="flex gap-1.5">
                  {LABEL_OFFSET_AXES.map((axis) => (
                    <div key={axis.key} className="min-w-0 flex-1">
                      <div className="mb-1 text-3xs text-text-muted">{axis.label}</div>
                      <NumberInput
                        value={labelSettings.offset[axis.key]}
                        min={-3}
                        max={3}
                        step={0.05}
                        precision={2}
                        widthClassName="w-full"
                        className="min-w-0"
                        commitOnChange
                        wheelStep
                        onChange={(next) => setSceneNameLabelOffset({
                          ...labelSettings.offset,
                          [axis.key]: next,
                        })}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <div className="text-xs text-text-muted">文字阴影</div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-text-muted">阴影颜色</span>
                  <UiColorInput
                    value={labelSettings.shadowColor}
                    onChange={(event) => setSceneNameLabelShadowColor(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="text-xs text-text-muted">阴影透明度</div>
                  <div className="flex items-center gap-1.5">
                    <UiRangeInput
                      min={0}
                      max={1}
                      step={0.05}
                      value={labelSettings.shadowOpacity}
                      onChange={(event) => setSceneNameLabelShadowOpacity(Number(event.target.value))}
                    />
                    <NumberInput
                      value={labelSettings.shadowOpacity}
                      min={0}
                      max={1}
                      step={0.05}
                      precision={2}
                      widthClassName="w-16"
                      className="shrink-0"
                      commitOnChange
                      wheelStep
                      onChange={setSceneNameLabelShadowOpacity}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="text-xs text-text-muted">阴影模糊</div>
                  <div className="flex items-center gap-1.5">
                    <UiRangeInput
                      min={0}
                      max={24}
                      step={1}
                      value={labelSettings.shadowBlur}
                      onChange={(event) => setSceneNameLabelShadowBlur(Number(event.target.value))}
                    />
                    <NumberInput
                      value={labelSettings.shadowBlur}
                      min={0}
                      max={24}
                      step={1}
                      precision={0}
                      widthClassName="w-16"
                      className="shrink-0"
                      commitOnChange
                      wheelStep
                      onChange={setSceneNameLabelShadowBlur}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="text-xs text-text-muted">阴影距离</div>
                  <div className="flex items-center gap-1.5">
                    <UiRangeInput
                      min={0}
                      max={24}
                      step={1}
                      value={labelSettings.shadowDistance}
                      onChange={(event) => setSceneNameLabelShadowDistance(Number(event.target.value))}
                    />
                    <NumberInput
                      value={labelSettings.shadowDistance}
                      min={0}
                      max={24}
                      step={1}
                      precision={0}
                      widthClassName="w-16"
                      className="shrink-0"
                      commitOnChange
                      wheelStep
                      onChange={setSceneNameLabelShadowDistance}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="text-xs text-text-muted">阴影方向</div>
                  <div className="flex items-center gap-1.5">
                    <UiRangeInput
                      min={0}
                      max={360}
                      step={1}
                      value={labelSettings.shadowAngle}
                      onChange={(event) => setSceneNameLabelShadowAngle(Number(event.target.value))}
                    />
                    <NumberInput
                      value={labelSettings.shadowAngle}
                      min={0}
                      max={360}
                      step={1}
                      precision={0}
                      widthClassName="w-16"
                      className="shrink-0"
                      commitOnChange
                      wheelStep
                      onChange={setSceneNameLabelShadowAngle}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default SceneSettingsPanel

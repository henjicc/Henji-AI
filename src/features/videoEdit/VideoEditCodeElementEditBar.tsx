import { useState } from 'react'
import { AlertTriangle, MessageSquare, Palette, TextCursorInput, Type } from 'lucide-react'
import { UiButton, UiColorInput, UiIconButton, UiOptionButton } from '@/components/ui'
import PanelTrigger from '@/components/ui/PanelTrigger'
import { uiParameterHex } from '@/components/ui/styleTokens'
import type { CodeColor } from '@/core/videoEdit/codeMaterial/contract'
import { WHITE_HEX } from '@/core/theme/colorTokens'
import { VideoEditParameterFields } from './panels/CodeParameterPanel'
import { readVideoEditCodeEditor } from './application/videoEditCodeParameters'
import type { readVideoEditCodeElementEdit, VideoEditCodeElementTarget } from './application/videoEditCodeElementEditing'
import { VideoEditPictureEditBar } from './VideoEditPictureEditBar'

type Current = ReturnType<typeof readVideoEditCodeElementEdit>

/** 文字超框、被截断或自动缩字号也放不下：改字后立刻在编辑条上提示，不调用模型。 */
function codeElementTextIssue(current: Current): string | undefined {
  const issues = new Set<string>()
  for (const draw of current.element?.author.textDraws ?? []) {
    if (draw.truncated) issues.add('被截断')
    if (draw.overflow?.visible && (draw.overflow.visible.width || draw.overflow.visible.height || draw.overflow.visible.lines)) issues.add('超出排版框')
    if (draw.fit?.failed) issues.add('缩小字号也放不下')
  }
  return issues.size ? `文字${[...issues].join('、')}` : undefined
}

function ParameterButton({ title, trigger, children }: { title: string; trigger: (open: boolean, toggle: () => void) => React.ReactNode; children: () => React.ReactNode }): React.ReactElement {
  return <PanelTrigger panelSize="wide" panelPadding="content" alignment="bottomLeft" panelWidthLabels={[title]} renderPanel={children}>
    {({ open, togglePanel }) => trigger(open, togglePanel)}
  </PanelTrigger>
}

function AssistantColor({ onAsk }: { onAsk: (hex: string) => void }): React.ReactElement {
  const [hex, setHex] = useState<string>(WHITE_HEX)
  return <div className="flex items-center gap-2">
    <UiColorInput aria-label="想要的颜色" value={hex} onChange={event => setHex(event.target.value)} />
    <UiButton size="sm" variant="secondary" onClick={() => onAsk(hex)}>交给助手改</UiButton>
  </div>
}

/**
 * 代码元素的画面编辑条：改字、绑定到它的文字样式与颜色参数（与效果控件同一套参数控件和撤销），
 * 颜色没做成参数时把想要的颜色交给助手改源码并开放成参数，文字超框时提示并可交给助手调排版。
 */
export function VideoEditCodeElementEditBar({ target, current, polygon, busy, onEditText, onAsk, onError }: { target: VideoEditCodeElementTarget; current: Current; polygon: ReadonlyArray<{ x: number; y: number }>; busy: boolean; onEditText: () => void; onAsk: (request?: string) => void; onError: (error: unknown) => void }): React.ReactElement {
  const editor = readVideoEditCodeEditor(target.projectId, target.sequenceId, target.clipId)
  const keys = current.element?.author.parameterKeys ?? []
  const declared = editor.metadata.parameters.filter(parameter => keys.includes(parameter.key))
  const styles = declared.filter(parameter => parameter.type === 'textStyle')
  const colors = declared.filter(parameter => parameter.type === 'color')
  const name = current.element?.author.name ?? target.elementId
  const issue = codeElementTextIssue(current)
  const fields = (key: string) => () => <VideoEditParameterFields editor={readVideoEditCodeEditor(target.projectId, target.sequenceId, target.clipId)} parameterKeys={[key]} onError={onError} bare />
  return <VideoEditPictureEditBar polygon={polygon} label="元素编辑">
    {current.textTargets.length > 0 && <UiIconButton size="xs" aria-label="编辑文字" tooltip="编辑文字（双击文字）" onClick={onEditText}><TextCursorInput /></UiIconButton>}
    {styles.map(parameter => <ParameterButton key={parameter.key} title={parameter.title} trigger={(open, toggle) => <UiIconButton size="xs" aria-label={parameter.title} tooltip={parameter.title} aria-expanded={open} data-panel-trigger-button onClick={toggle}><Type /></UiIconButton>}>{fields(parameter.key)}</ParameterButton>)}
    {colors.map(parameter => <ParameterButton key={parameter.key} title={parameter.title} trigger={(open, toggle) => <UiOptionButton type="button" variant="swatch" aria-label={parameter.title} tooltip={parameter.title} aria-expanded={open} data-panel-trigger-button active={open} onClick={toggle} style={{ backgroundColor: uiParameterHex(editor.parameters[parameter.key] as CodeColor) }} />}>{fields(parameter.key)}</ParameterButton>)}
    {!colors.length && current.element?.author.kind !== 'adjust' && <ParameterButton title="改颜色" trigger={(open, toggle) => <UiIconButton size="xs" aria-label="改颜色" tooltip="这个元素的颜色还没做成参数：选好颜色交给助手改" aria-expanded={open} data-panel-trigger-button onClick={toggle}><Palette /></UiIconButton>}>
      {() => <AssistantColor onAsk={hex => onAsk(`把元素「${name}」的颜色改成 ${hex}（有几种颜色时改主要的那一种），并把这个颜色写成 color 参数、用 layer 绑定到这个图层，以后可以在画面上直接改。`)} />}
    </ParameterButton>}
    {issue && <UiIconButton size="xs" aria-label={`${issue}，交给助手调整`} tooltip={`${issue}：点一下交给助手调整排版`} disabled={busy} onClick={() => onAsk(`元素「${name}」的${issue}。请调整排版（框宽、换行、字号或位置）让文字完整显示，不要改文字内容，也不要推翻用户手改过的值。`)}><AlertTriangle className="text-warning-text" /></UiIconButton>}
    <UiIconButton size="xs" aria-label="让助手改这里" tooltip="让助手改这里" disabled={busy} onClick={() => onAsk()}><MessageSquare /></UiIconButton>
  </VideoEditPictureEditBar>
}

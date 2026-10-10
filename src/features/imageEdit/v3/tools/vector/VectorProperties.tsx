import { useEffect,useRef,useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Dropdown, UiButton, UiEmpty, UiError, UiFormRow, UiGroup, UiIconButton, UiTextArea } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { TypographyPanel } from '@/components/typography/TypographyPanel'
import { defaultTextStyle, rectanglePath, type RichTextContent, type TextStyle, type VectorPathCommand, type VectorPathContent } from '@/core/imaging/vectorContent'
import type { ImageEditVectorLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorV3Controller } from '../../editor/types'
import { collectImageEditV3LiveLayers } from '../../application/imageEditDocumentRefs'
import { attachImageEditVectorMaskV3,setImageEditVectorContentV3 } from './service'

/** Draft text preserves IME composition; persistence receives complete edits only. */
function RunTextInput({value,onCommit}:{value:string;onCommit:(text:string)=>void}):JSX.Element {
  const [draft,setDraft]=useState(value);const composing=useRef(false)
  useEffect(()=>{if(!composing.current)setDraft(value)},[value])
  const commit=(text:string)=>{if(!composing.current && text!==value)onCommit(text)}
  return <UiTextArea aria-label="图层文字内容" rows={3} value={draft} onChange={event=>setDraft(event.currentTarget.value)} onCompositionStart={()=>{composing.current=true}} onCompositionEnd={event=>{composing.current=false;setDraft(event.currentTarget.value);commit(event.currentTarget.value)}} onBlur={()=>commit(draft)} onKeyDown={event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.nativeEvent.isComposing){event.preventDefault();commit(draft)}}}/>
}

export function VectorProperties({ controller, layer, locked, onContentChange, maskOnly = false }: { controller: ImageEditorV3Controller; layer: ImageEditVectorLayerV3; locked: boolean; onContentChange?: (content: RichTextContent | VectorPathContent) => void; maskOnly?: boolean }): JSX.Element {
  const [paragraphIndex, setParagraph] = useState(0)
  const [runIndex, setRun] = useState(0)
  const [operandIndex, setOperand] = useState(0)
  const [pointIndex, setPoint] = useState(0)
  const [maskTarget,setMaskTarget]=useState('')
  const [error, setError] = useState('')
  const fail = (cause: unknown): void => setError(cause instanceof Error ? cause.message : '无法更新内容，请重试。')
  const write = (content: RichTextContent | VectorPathContent): void => {
    try { if(onContentChange) onContentChange(content); else setImageEditVectorContentV3(controller.document.id, layer.id, content); setError('') } catch (cause) { fail(cause) }
  }
  const number = (label: string, value: number, update: (value: number) => void, min?: number): JSX.Element => <UiFormRow label={label} density="compact"><NumberInput ariaLabel={label} size="sm" value={value} min={min} onChange={update} /></UiFormRow>
  if (layer.type === 'text') {
    const content = layer.content
    const p = Math.min(paragraphIndex, Math.max(0, content.paragraphs.length - 1))
    const paragraph = content.paragraphs[p]
    const r = Math.min(runIndex, Math.max(0, (paragraph?.runs.length ?? 0) - 1))
    const run = paragraph?.runs[r]
    const updateParagraph = (patch: Partial<NonNullable<typeof paragraph>>): void => write({ ...content, paragraphs: content.paragraphs.map((value, index) => index === p ? { ...value, ...patch } : value) })
    const updateRun = (patch: Partial<NonNullable<typeof run>>): void => updateParagraph({ runs: paragraph.runs.map((value, index) => index === r ? { ...value, ...patch } : value) })
    return <fieldset disabled={locked} className="min-w-0" data-vector-properties>
      <UiGroup title="段落与文字" titleTone="compact" actions={<UiIconButton size="sm" aria-label="添加段落" onClick={() => { write({ ...content, paragraphs: [...content.paragraphs, { runs: [{ text: '文字', style: run?.style ?? defaultTextStyle(controller.document.geometry.height) }], align: 'left', direction: 'auto', spaceBefore: 0, spaceAfter: 0 }] }); setParagraph(content.paragraphs.length); setRun(0) }}><Plus size={14} /></UiIconButton>}>
        {paragraph ? <Dropdown ariaLabel="编辑段落" size="sm" value={String(p)} options={content.paragraphs.map((value, index) => ({ value: String(index), label: `段落 ${index + 1} · ${value.runs.map(item => item.text).join('').slice(0, 20)}` }))} onSelect={value => { setParagraph(Number(value)); setRun(0) }} /> : <UiEmpty size="xs" title="还没有文字" description="添加段落后即可输入文字。" />}
        {paragraph && <><div className="flex items-center gap-2"><Dropdown ariaLabel="文字片段" size="sm" value={String(r)} options={paragraph.runs.map((value, index) => ({ value: String(index), label: `片段 ${index + 1} · ${value.text.slice(0, 20)}` }))} onSelect={value => setRun(Number(value))} /><UiIconButton size="sm" aria-label="添加文字片段" onClick={() => { updateParagraph({ runs: [...paragraph.runs, { text: '文字', style: run?.style ?? defaultTextStyle(controller.document.geometry.height) }] }); setRun(paragraph.runs.length) }}><Plus size={14} /></UiIconButton><UiIconButton size="sm" aria-label="删除文字片段" onClick={() => updateParagraph({ runs: paragraph.runs.filter((_, index) => index !== r) })}><Trash2 size={14} /></UiIconButton></div>
          {run ? <RunTextInput value={run.text} onCommit={text=>updateRun({text})} /> : <UiEmpty size="xs" title="段落为空" description="添加文字片段后即可输入。" />}
          <Dropdown ariaLabel="段落方向" size="sm" value={paragraph.direction} options={[{ value: 'auto', label: '自动方向' }, { value: 'ltr', label: '从左到右' }, { value: 'rtl', label: '从右到左' }]} onSelect={value => updateParagraph({ direction: value as typeof paragraph.direction })} />
          {number('段前间距', paragraph.spaceBefore, spaceBefore => updateParagraph({ spaceBefore }), 0)}
          {number('段后间距', paragraph.spaceAfter, spaceAfter => updateParagraph({ spaceAfter }), 0)}
          <UiButton size="sm" onClick={() => write({ ...content, paragraphs: content.paragraphs.filter((_, index) => index !== p) })}>删除段落</UiButton>
        </>}
        {number('文本框宽度（0 自动）', content.box.width, width => write({ ...content, box: { ...content.box, width } }), 0)}
        {number('文本框高度（0 自动）', content.box.height, height => write({ ...content, box: { ...content.box, height } }), 0)}
      </UiGroup>
      {run && <TypographyPanel fields="rich-text" style={run.style} onChange={style => write({...content,paragraphs:content.paragraphs.map((entry,index)=>({...entry,...(index===p?{align:style.align}:{}),runs:entry.runs.map((value,runPosition)=>index===p&&runPosition===r?{...value,style}:style.verticalAlign!==run.style.verticalAlign?{...value,style:{...value.style,verticalAlign:style.verticalAlign}}:value)}))})} onError={fail} />}
      {error && <UiError message={error} />}
    </fieldset>
  }
  const content = layer.content
  const o = Math.min(operandIndex, Math.max(0, content.operands.length - 1))
  const operand = content.operands[o]
  const c = Math.min(pointIndex, Math.max(0, (operand?.path.commands.length ?? 0) - 1))
  const command = operand?.path.commands[c]
  const updateOperand = (patch: Partial<NonNullable<typeof operand>>): void => write({ ...content, operands: content.operands.map((value, index) => index === o ? { ...value, ...patch } : value) })
  const updateCommand = (command: VectorPathCommand): void => updateOperand({ path: { ...operand.path, commands: operand.path.commands.map((value, index) => index === c ? command : value) } })
  const style: TextStyle = { ...defaultTextStyle(controller.document.geometry.height), ...content.paint }
  return <fieldset disabled={locked} className="min-w-0" data-vector-properties>
    <UiGroup title="路径与组合" titleTone="compact" actions={<UiIconButton size="sm" aria-label="添加路径" onClick={() => { write({ ...content, operands: [...content.operands, { operation: content.operands.length ? 'add' : 'replace', path: rectanglePath(20, 20, 100, 100) }] }); setOperand(content.operands.length); setPoint(0) }}><Plus size={14} /></UiIconButton>}>
      {operand ? <Dropdown size="sm" ariaLabel="编辑路径" value={String(o)} options={content.operands.map((_, index) => ({ value: String(index), label: `路径 ${index + 1}` }))} onSelect={value => { setOperand(Number(value)); setPoint(0) }} /> : <UiEmpty size="xs" title="还没有路径" description="添加路径后即可编辑锚点与组合。" />}
      {operand && <><Dropdown size="sm" ariaLabel="路径组合方式" value={operand.operation} options={[{ value: 'replace', label: '替换' }, { value: 'add', label: '合并' }, { value: 'subtract', label: '减去' }, { value: 'intersect', label: '相交' }]} onSelect={value => updateOperand({ operation: value as typeof operand.operation })} />
        <Dropdown size="sm" ariaLabel="路径填充规则" value={operand.path.fillRule} options={[{ value: 'nonzero', label: '按绕向填充' }, { value: 'evenodd', label: '交替填充' }]} onSelect={value => updateOperand({ path: { ...operand.path, fillRule: value as typeof operand.path.fillRule } })} />
        <Dropdown size="sm" ariaLabel="编辑锚点" value={String(c)} options={operand.path.commands.map((value, index) => ({ value: String(index), label: value.kind === 'close' ? '闭合路径' : `锚点 ${index + 1}${value.kind === 'cubic' || value.kind === 'quadratic' ? ' · 曲线' : ''}` }))} onSelect={value => setPoint(Number(value))} />
        {command && command.kind !== 'close' && <>{number('锚点横向', command.x, x => updateCommand({ ...command, x }))}{number('锚点纵向', command.y, y => updateCommand({ ...command, y }))}
          {command.kind === 'line' && <UiButton size="sm" onClick={() => updateCommand({ kind: 'cubic', x: command.x, y: command.y, cx1: command.x - 40, cy1: command.y, cx2: command.x, cy2: command.y - 40 })}>转为曲线</UiButton>}
          {command.kind === 'quadratic' && <>{number('控制柄横向', command.cx, cx => updateCommand({ ...command, cx }))}{number('控制柄纵向', command.cy, cy => updateCommand({ ...command, cy }))}</>}
          {command.kind === 'cubic' && <>{(['cx1', 'cy1', 'cx2', 'cy2'] as const).map((key, index) => number(`控制柄 ${index < 2 ? 1 : 2}${index % 2 ? '纵向' : '横向'}`, command[key], value => updateCommand({ ...command, [key]: value })))}</>}
        </>}
        <UiButton size="sm" onClick={() => write({ ...content, operands: content.operands.filter((_, index) => index !== o) })}>删除路径</UiButton>
      </>}
    </UiGroup>
    {!maskOnly && <UiGroup title="路径蒙版" titleTone="compact"><Dropdown size="sm" ariaLabel="蒙版目标图层" value={maskTarget} options={collectImageEditV3LiveLayers(controller.document).filter(row=>row.layer.id!==layer.id&&!row.layer.locked&&!row.ancestors.some(ancestor=>ancestor.locked)).map(row=>({value:row.layer.id,label:row.layer.name}))} onSelect={setMaskTarget} /><UiButton size="sm" disabled={!maskTarget} onClick={()=>{try{attachImageEditVectorMaskV3(controller.document.id,layer.id,maskTarget);setError('')}catch(cause){fail(cause)}}}>用路径作为蒙版</UiButton></UiGroup>}
    {!maskOnly && <TypographyPanel fields="appearance" style={style} onChange={next => write({ ...content, paint: { fill: next.fill, strokes: next.strokes, shadows: next.shadows } })} onError={fail} />}
    {error && <UiError message={error} />}
  </fieldset>
}

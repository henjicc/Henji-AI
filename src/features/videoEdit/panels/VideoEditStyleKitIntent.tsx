import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Dropdown, UiButton, UiDisclosurePanel, UiFormRow, UiGroup, UiIconButton, UiInput, UiRecordItem, UiRecordList, UiTextArea } from '@/components/ui'
import { STYLE_RULE_KINDS, STYLE_STRENGTHS, type StyleConcept, type StyleKit, type StyleRule } from '@/core/videoEdit/styleKit'
import { RULE_KIND_LABELS, STRENGTH_LABELS } from '../application/videoEditStyleKitDraft'

const kindOptions = STYLE_RULE_KINDS.map(value => ({ value, label: RULE_KIND_LABELS[value] }))
const strengthOptions = STYLE_STRENGTHS.map(value => ({ value, label: STRENGTH_LABELS[value] }))

type Change = (update: (kit: StyleKit) => StyleKit) => void

function ConceptEditor({ concept, onChange }: { concept: StyleConcept; onChange: (value: StyleConcept) => void }): React.ReactElement {
  const set = <K extends keyof StyleConcept>(key: K, value: StyleConcept[K]): void => onChange({ ...concept, [key]: value })
  return <UiGroup labelWidth={96} gap="stack">
    <UiFormRow label="名称" density="compact"><UiInput size="sm" aria-label="概念名称" value={concept.name} onChange={event => set('name', event.target.value)} /></UiFormRow>
    <UiFormRow label="含义" density="compact"><UiInput size="sm" aria-label="概念含义" value={concept.meaning} onChange={event => set('meaning', event.target.value)} /></UiFormRow>
    <UiFormRow label="判据" density="compact"><UiTextArea aria-label="概念判据" height="short" placeholder="每行一条，取帧能判断" value={concept.criteria.join('\n')} onChange={event => set('criteria', event.target.value.split('\n'))} /></UiFormRow>
    <UiFormRow label="参数倾向" density="compact"><UiInput size="sm" aria-label="参数倾向" value={concept.tendencies} onChange={event => set('tendencies', event.target.value)} /></UiFormRow>
    <UiFormRow label="正例" density="compact"><UiInput size="sm" aria-label="正例" value={concept.positive} onChange={event => set('positive', event.target.value)} /></UiFormRow>
    <UiFormRow label="反例" density="compact"><UiInput size="sm" aria-label="反例" value={concept.negative} onChange={event => set('negative', event.target.value)} /></UiFormRow>
    <UiFormRow label="强度" density="compact"><Dropdown ariaLabel="概念强度" size="sm" value={concept.strength} options={strengthOptions} onSelect={value => set('strength', value as StyleConcept['strength'])} /></UiFormRow>
    <UiFormRow label="可破例" density="compact"><UiInput size="sm" aria-label="破例情形" placeholder="不破例" value={concept.exceptions} onChange={event => set('exceptions', event.target.value)} /></UiFormRow>
  </UiGroup>
}

/** 理念：定位、适用场景与抽象概念。概念只以可检验的判据存在。 */
export function StyleKitProfileEditor({ kit, onChange }: { kit: StyleKit; onChange: Change }): React.ReactElement {
  const [open, setOpen] = useState('')
  const concepts = kit.profile.concepts
  const profile = (patch: Partial<StyleKit['profile']>): void => onChange(value => ({ ...value, profile: { ...value.profile, ...patch } }))
  const updateConcept = (id: string, next: StyleConcept): void => profile({ concepts: concepts.map(concept => concept.id === id ? next : concept) })
  const addConcept = (): void => { const id = crypto.randomUUID(); profile({ concepts: [...concepts, { id, name: '新概念', meaning: '', criteria: [], tendencies: '', positive: '', negative: '', strength: 'prefer', exceptions: '' }] }); setOpen(id) }
  return <UiGroup title="理念" titleTone="compact">
    <UiFormRow label="定位" density="compact"><UiInput size="sm" aria-label="风格定位" placeholder="一句话说清这套风格" value={kit.profile.summary} onChange={event => profile({ summary: event.target.value })} /></UiFormRow>
    <UiFormRow label="适用场景" density="compact"><UiInput size="sm" aria-label="适用场景" placeholder="用顿号分隔，如 科技教程、横屏" value={kit.profile.scenarios.join('、')} onChange={event => profile({ scenarios: event.target.value.split(/[、,，]/u).map(item => item.trim()).filter(Boolean) })} /></UiFormRow>
    <UiRecordList aria-label="风格概念">
      {concepts.map((concept, index) => <UiRecordItem key={concept.id} index={index} density="compact" title={concept.name || '未命名概念'} meta={[STRENGTH_LABELS[concept.strength], concept.meaning || '缺少含义']}
        actions={<><UiButton size="sm" aria-expanded={open === concept.id} onClick={() => setOpen(value => value === concept.id ? '' : concept.id)}>{open === concept.id ? '收起' : '编辑'}</UiButton><UiIconButton size="sm" tone="danger" label={`删除概念${concept.name}`} onClick={() => profile({ concepts: concepts.filter(value => value.id !== concept.id) })}><Trash2 /></UiIconButton></>}>
        <UiDisclosurePanel open={open === concept.id}><ConceptEditor concept={concept} onChange={next => updateConcept(concept.id, next)} /></UiDisclosurePanel>
      </UiRecordItem>)}
    </UiRecordList>
    <UiButton size="sm" onClick={addConcept}><Plus />添加概念</UiButton>
  </UiGroup>
}

/** 规则：做 / 不做 / 统一 / 可变，每条带强度与适用范围。 */
export function StyleKitRulesEditor({ kit, onChange }: { kit: StyleKit; onChange: Change }): React.ReactElement {
  const [kind, setKind] = useState<StyleRule['kind']>('do'); const [strength, setStrength] = useState<StyleRule['strength']>('prefer'); const [text, setText] = useState('')
  const rules = (next: StyleRule[]): void => onChange(value => ({ ...value, rules: next }))
  const add = (): void => { if (!text.trim()) return; rules([...kit.rules, { id: crypto.randomUUID(), kind, strength, text: text.trim(), scope: '' }]); setText('') }
  return <UiGroup title="规则" titleTone="compact">
    <UiRecordList aria-label="风格规则">
      {kit.rules.map((rule, index) => <UiRecordItem key={rule.id} index={index} density="compact" title={rule.text} meta={[RULE_KIND_LABELS[rule.kind], STRENGTH_LABELS[rule.strength], ...(rule.scope ? [rule.scope] : [])]}
        actions={<UiIconButton size="sm" tone="danger" label={`删除规则${rule.text}`} onClick={() => rules(kit.rules.filter(value => value.id !== rule.id))}><Trash2 /></UiIconButton>} />)}
    </UiRecordList>
    <UiFormRow label="类型" density="compact"><Dropdown ariaLabel="规则类型" size="sm" value={kind} options={kindOptions} onSelect={value => setKind(value as StyleRule['kind'])} /></UiFormRow>
    <UiFormRow label="强度" density="compact"><Dropdown ariaLabel="规则强度" size="sm" value={strength} options={strengthOptions} onSelect={value => setStrength(value as StyleRule['strength'])} /></UiFormRow>
    <UiFormRow label="内容" density="compact"><UiInput size="sm" aria-label="新规则" placeholder="例如：标题不用衬线体" value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') add() }} /></UiFormRow>
    <UiButton size="sm" disabled={!text.trim()} disabledReason="先填写规则内容" onClick={add}>添加规则</UiButton>
  </UiGroup>
}

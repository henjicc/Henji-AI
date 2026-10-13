import { UiActionGroup, UiButton, UiFormRow, UiGroup, UiInput, UiPanel, UiToolbar } from '@/components/ui'
import type { ReactNode } from 'react'

const RULES = ['multiplePrimary', 'rowHeightMismatch', 'formControlMisaligned', 'actionStartsAtLabelColumn', 'toolbarWrap', 'shortTextTruncated', 'selectedStateWeak', 'overlayClipped', 'stackedBands'] as const

function Example({ rule, bad }: { rule: typeof RULES[number]; bad: boolean }): JSX.Element {
  let content: ReactNode
  switch (rule) {
    case 'multiplePrimary': content = <UiToolbar><UiButton variant="primary">保存</UiButton><UiButton variant={bad ? 'primary' : 'quiet'}>导出</UiButton></UiToolbar>; break
    case 'rowHeightMismatch': content = <UiToolbar><UiButton size="md">打开</UiButton><UiButton size={bad ? 'sm' : 'md'}>复制</UiButton></UiToolbar>; break
    case 'formControlMisaligned': content = <UiGroup labelWidth={96}><UiFormRow label="名称"><UiInput /></UiFormRow><div className={bad ? 'pl-4' : ''}><UiFormRow label="路径"><UiInput /></UiFormRow></div></UiGroup>; break
    case 'actionStartsAtLabelColumn': content = <UiGroup labelWidth={96}><UiFormRow label="名称"><UiInput /></UiFormRow>{bad ? <UiButton>打开</UiButton> : <UiFormRow label=""><UiButton>打开</UiButton></UiFormRow>}</UiGroup>; break
    case 'toolbarWrap': content = <div role="toolbar" className={bad ? 'flex w-40 flex-wrap gap-2' : 'flex w-full gap-2'}>{['复制内容', '打开内容', '刷新内容'].map(label => <UiButton key={label}>{label}</UiButton>)}</div>; break
    case 'shortTextTruncated': content = <UiButton className={bad ? 'w-12' : 'w-40'}><span className="truncate">打开内容</span></UiButton>; break
    case 'selectedStateWeak': content = <div role="tablist" className="flex gap-2"><UiButton role="tab" aria-selected="true" variant={bad ? 'quiet' : 'secondary'}>图片</UiButton><UiButton role="tab" aria-selected="false">视频</UiButton></div>; break
    case 'overlayClipped': content = <div className={`relative h-24 ${bad ? 'overflow-hidden' : ''}`}><UiPanel role="menu" className="absolute left-0 top-8 z-panel h-24 w-40"><UiButton>打开</UiButton></UiPanel></div>; break
    case 'stackedBands': content = <div>{Array.from({ length: bad ? 3 : 2 }, (_, i) => <UiToolbar key={i} variant="command"><UiButton>操作 {i + 1}</UiButton></UiToolbar>)}</div>; break
  }
  const id = `gallery-rule-${rule}-${bad ? 'bad' : 'good'}`
  return <section id={id} data-gallery-rule-sample={rule} data-gallery-expect-hit={bad ? rule : undefined} data-gallery-expect-clean={bad ? undefined : rule} className="flex flex-col gap-3">
    <p className="text-xs text-text2">{bad ? "Don't" : 'Do'} · {rule}</p>{content}
  </section>
}

export function GalleryRuleSamples(): JSX.Element {
  return <div className="flex flex-col gap-8">
    <UiGroup title="动作组：组内继承同一档位" titleTone="compact"><UiActionGroup tier="secondary" size="sm"><UiButton>打开内容</UiButton><UiButton>刷新来源</UiButton></UiActionGroup><UiActionGroup tier="quiet" size="md"><UiButton>复制</UiButton><UiButton>重命名</UiButton></UiActionGroup><UiActionGroup size="lg"><UiButton>继续编辑</UiButton></UiActionGroup></UiGroup>
    {RULES.map(rule => <UiGroup key={rule} title={rule} titleTone="compact"><Example rule={rule} bad={false} /><Example rule={rule} bad /></UiGroup>)}
  </div>
}

import { UiRecordList, UiRecordItem, UiViewerShell, useUiViewerShell } from '@/components/ui'
import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useRafCallback } from '@/hooks/useRafCallback'
import { MoreHorizontal, TriangleAlert } from 'lucide-react'
import { UiButton, UiEmpty, UiFormRow, UiGroup, UiIconButton, UiInput, UiLoading, UiError, UiOverflowRow, UiPanel, UiSegmented, UiSwitch, UiToolbar, UiVirtualList, UiVirtualGrid, UI_TEXT_META_CLASS } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { GALLERY_SKILL_SOURCE } from './galleryIndex'
import { GalleryRuleSamples } from './ruleSamples'

const noop = (): void => undefined

function Antipattern({ children }: { children: string }): JSX.Element {
  return <p data-gallery-antipattern className="flex items-center gap-2 text-xs text-warning-text"><TriangleAlert className={`${UI_ICON_SIZE_CLASS.md} shrink-0`} />禁止写法：{children}</p>
}

export function PatternSection(): JSX.Element {
  const [value, setValue] = useState('place')
  return <div className="flex flex-col gap-8">
    <UiGroup title="G1 面板表单行：标签列、成对网格与动作对齐" titleTone="compact" labelWidth={96}>
      <UiFormRow label="方式" density="compact" labelColumn="panel"><UiSegmented ariaLabel="方式" value={value} onChange={setValue} options={[{ value: 'place', label: '分时摆放' }, { value: 'record', label: '录制轨迹' }]} /></UiFormRow>
      <UiFormRow label="位置" density="compact" labelColumn="auto"><div className="grid grid-cols-2 gap-3"><UiFormRow label="X" labelColumn="auto"><NumberInput value={20} onChange={noop} widthClassName="w-full" /></UiFormRow><UiFormRow label="Y" labelColumn="auto"><NumberInput value={30} onChange={noop} widthClassName="w-full" /></UiFormRow></div></UiFormRow>
      <UiFormRow label="" density="compact"><UiButton variant="secondary">应用</UiButton></UiFormRow>
      <Antipattern>裸下拉直接堆入分组；每行用不同标签列宽；动作从标签列起头。</Antipattern>
    </UiGroup>
    <UiGroup title="G2 分段选择：中性抬起底 + 强文字，最多五项" titleTone="compact">
      <UiFormRow label="媒体方式" density="compact"><UiSegmented ariaLabel="媒体方式" size="md" fullWidth value={value} onChange={setValue} options={[{ value: 'place', label: '图片' }, { value: 'record', label: '视频' }]} /></UiFormRow>
      <Antipattern>独立 UiOptionButton 并排冒充分段；用强调实底表示当前值。</Antipattern>
    </UiGroup>
    <UiGroup title="G3 记录列表：标题、元信息、结果、恢复动作" titleTone="compact">
      <UiRecordList>{['镜头 01', '镜头 02', '镜头 03'].map((name, index) => <UiRecordItem key={name} index={index} density="page" title={name} meta={['今天', '图片', index === 1 ? '失败' : '已完成']}
        status={index === 1 ? <UiError size="xs" align="start" message="未能读取图片，请重试。" /> : undefined}
        actions={<UiButton size="sm">{index === 1 ? '重试' : '继续编辑'}</UiButton>}><UiPanel variant="inset" className="p-4">结果预览</UiPanel></UiRecordItem>)}</UiRecordList>
      <UiRecordList><UiRecordItem index={0} density="panel" title="面板记录" meta={['每侧 12px 留白']}>结果</UiRecordItem><UiRecordItem index={1} density="compact" title="紧凑记录" meta={['每侧 4px 留白']}>结果</UiRecordItem></UiRecordList>
      <Antipattern>记录间距与块内间距相同；在面板内再逐项套卡片。</Antipattern>
    </UiGroup>
    <ViewerShellSamples />
    <UiGroup title="G4 复用同类结构：空、加载、失败" titleTone="compact"><div className="grid grid-cols-3 gap-4"><UiEmpty size="xs" title="还没有素材" action={<UiButton>添加素材</UiButton>} /><UiLoading size="xs" message="处理中" /><UiError size="xs" message="读取失败" onRetry={noop} /></div><Antipattern>每个页面手画三态或再加一圈卡片壳。</Antipattern></UiGroup>
    <UiGroup title="G5 不可用动作不出现；设置行保持横排" titleTone="overline" labelWidth={96}><UiFormRow label="启用预览" inline><UiSwitch checked /></UiFormRow><UiFormRow label="文件名称" inline><UiInput defaultValue="镜头 01" /></UiFormRow><Antipattern>没有对象时仍常驻整排灰色动作；只读内部状态进入正式界面。</Antipattern></UiGroup>
    <UiGroup title="命令带与从属带共享表面" titleTone="compact"><UiToolbar variant="command" trailing={<UiButton variant="primary">导出</UiButton>} subordinate={<UiFormRow label="强度" inline><NumberInput value={50} onChange={noop} /></UiFormRow>}><span className="text-13 text-text1">当前作品</span><UiButton>撤销</UiButton></UiToolbar><Antipattern>返回、标题、工具、参数分别长出一条头带。</Antipattern></UiGroup>
    <UiGroup title="浮层面板：内部留白分组" titleTone="compact"><UiPanel className="p-4"><UiGroup title="预览设置" titleTone="compact" labelWidth={96}><UiFormRow label="名称" density="compact"><UiInput defaultValue="当前作品" /></UiFormRow><UiPanel variant="inset" className="p-3">只读预览</UiPanel></UiGroup></UiPanel><Antipattern>浮层内部分组继续使用 border + bg-panel + rounded。</Antipattern></UiGroup>
  </div>
}

/** 同一块内容在宽、中、窄三档宽度下并排：一张截图看清它放不下时怎么变（重要记录 020）。 */
const RESIZE_WIDTHS = [360, 240, 160] as const
function WidthStrip({ title, description, children }: { title: string; description: string; children: () => ReactNode }): JSX.Element {
  return <UiGroup title={title} description={description} titleTone="compact">
    <div className="flex items-start gap-6">{RESIZE_WIDTHS.map(width => <div key={width} className="flex shrink-0 flex-col gap-1">
      <span className={UI_TEXT_META_CLASS}>{width}px</span>
      <div data-gallery-resize-frame={width} className="border-r border-dashed border-line-strong pr-1" style={{ width }}>{children()}</div>
    </div>)}</div>
  </UiGroup>
}
const RESIZE_TOOLS = ['复制', '粘贴', '分割', '对齐', '导出']
const RESIZE_NAMES = ['镜头箱', '素材箱 1（第二机位·采访·调色前·用来看截断的超长名称）', '配乐与音效', '采访原片（未剪）', '空镜']

/**
 * 缩放与放不下（重要记录 020）：放不下只有三种对策，停靠面板另外声明最小宽高。
 * 开发运行时布局守卫会给硬裁、遮挡的元素描红边，这一页三档宽度都不应出现红边。
 */
export function ResizeSection(): JSX.Element {
  return <div className="flex flex-col gap-8">
    <WidthStrip title="对策一：收进“更多”" description="工具条、底栏、命令带按优先级把放不下的项收进行末的“更多”，不折行、不硬裁。">
      {() => <UiOverflowRow items={RESIZE_TOOLS.map((label, index) => ({ id: label, priority: RESIZE_TOOLS.length - index, node: <UiButton size="sm">{label}</UiButton> }))}
        renderOverflow={hidden => <UiIconButton size="sm" aria-label={`更多（${hidden.length} 项）`} tooltip={`更多：${hidden.join('、')}`}><MoreHorizontal /></UiIconButton>} />}
    </WidthStrip>
    <WidthStrip title="对策二：截断后悬停看全" description="名称、标签放不下时用省略号截断，悬停或聚焦能看到全称；不折成两行，也不靠加宽容器硬塞。">
      {() => <div className="flex flex-col">{RESIZE_NAMES.slice(0, 3).map(name => <UiButton key={name} size="sm" className="w-full !justify-start" tooltip={name}><span className="truncate" data-user-content>{name}</span></UiButton>)}</div>}
    </WidthStrip>
    <WidthStrip title="对策三：滚动" description="列表与表格在自己的区域里滚动；面板只剩一屏时整列滚动，不把下面的内容裁掉。">
      {() => <div className="h-24 overflow-y-auto" data-gallery-ignore-rules="nestedScroll" data-gallery-ignore-reason="三档宽度的滚动样本嵌在中心页目录滚动区内">{RESIZE_NAMES.map(name => <div key={name} className="truncate py-1 text-xs text-text1" data-user-content>{name}</div>)}</div>}
    </WidthStrip>
    <UiGroup title="停靠面板：声明最小宽高" titleTone="compact" description="面板定义里写 minimumWidth / minimumHeight，停靠布局拖不到更小；同组标签取一致的值，默认布局在 960×640 下放得下各面板的最小值。">
      <Antipattern>容器 overflow-hidden 把按钮或文字裁掉一截；透明定位层压在可点的控件上；面板被拖到内容放不下。</Antipattern>
    </UiGroup>
  </div>
}

export function RulesSection(): JSX.Element {
  const links = [
    ['三条铁律', '三条铁律先记住这三句'], ['五级容器', '五级容器词汇表先背这张表'],
    ['动作层级', '动作层级视觉重量--动作的重要性'], ['选中态词汇表', '选中态词汇表先判断语义再选强度'],
    ['界面语法 G1–G5', '界面语法照着做就不会错2026-10-12-起强制'], ['必须复用', '必须复用-vs-允许新增'],
  ] as const
  return <UiGroup title="规范速查：链接到唯一原文" titleTone="compact">{links.map(([label, anchor]) => <a key={label} className="py-3 text-13 text-accent-text underline" href={`${GALLERY_SKILL_SOURCE}#${anchor}`} target="_blank" rel="noreferrer">{label}</a>)}<p className={UI_TEXT_META_CLASS}>分段用中性抬起底 + 强文字（最多 5 项）；其他单选用淡强调底。当前组件尺寸读取真实枚举，任务 4.2 合并后自动反映。</p><GalleryRuleSamples /></UiGroup>
}

const LIST_SAMPLES = Array.from({ length: 1000 }, (_, id) => ({ id, name: `记录 ${id + 1}` }))

function PointerProgressReadout({ clock }: { clock: StoreApi<{ ratio: number }> }): JSX.Element {
  const ratio = useStore(clock, state => state.ratio)
  return <div className="flex flex-col gap-2"><p className="text-xs text-text2">预览位置 {Math.round(ratio * 100)}%</p><div className="h-2 overflow-hidden rounded-full bg-control"><div className="h-full origin-left bg-accent" style={{ transform: `scaleX(${ratio})` }} /></div></div>
}

export function LongListSection(): JSX.Element {
  const [selected, setSelected] = useState(0)
  const [clock] = useState(() => createStore(() => ({ ratio: 0 })))
  const preview = useRafCallback((ratio: number) => clock.setState({ ratio }))
  return <div className="flex flex-col gap-8">
    <UiGroup title="共享虚拟列表：1000 条可变行高记录" titleTone="compact"><UiRecordList data-gallery-ignore-rules="nestedScroll" data-gallery-ignore-reason="独立虚拟列表滚动样本嵌在中心页目录滚动区内" className="h-80"><UiVirtualList data={LIST_SAMPLES} getKey={item => item.id} emptyState={<UiEmpty size="xs" title="暂无记录" />} renderItem={item => <UiRecordItem index={item.id} density="page" title={item.name}>{item.id % 3 === 0 && <p className="text-xs text-text2">描述会增加本行高度，滚动位置由共享列表测量。</p>}<UiButton size="sm">继续编辑</UiButton></UiRecordItem>} /></UiRecordList></UiGroup>
    <UiGroup title="共享虚拟网格：状态和描述可以改变行高" titleTone="compact"><div data-gallery-ignore-rules="nestedScroll" data-gallery-ignore-reason="独立虚拟网格滚动样本嵌在中心页目录滚动区内" className="h-64"><UiVirtualGrid data={LIST_SAMPLES} columns={3} getKey={item => item.id} highlightedIndex={selected} renderItem={item => <UiButton variant={selected === item.id ? 'secondary' : 'quiet'} onClick={() => setSelected(item.id)} className="w-full">{item.name}</UiButton>} /></div></UiGroup>
    <UiGroup title="高频预览：合帧生产，叶子订阅" titleTone="compact"><div className="h-24 bg-control" onPointerMove={event => {
      const rect = event.currentTarget.getBoundingClientRect()
      preview.schedule(Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))))
    }} onPointerLeave={() => preview.flush()}><p className="p-3 text-xs text-text2">移动指针查看预览；外层列表不订阅位置。</p></div><PointerProgressReadout clock={clock} /></UiGroup>
  </div>
}

function ViewerShellSamples(): JSX.Element {
  const [open, setOpen] = useState(false)
  const media = useUiViewerShell(true, noop, { scope: 'container' })
  const canvas = useUiViewerShell(true, noop, { scope: 'container' })
  const live = useUiViewerShell(open, () => setOpen(false))
  return <UiGroup title="全屏查看器：共享外壳与关闭" titleTone="compact">
    <div className="grid grid-cols-2 gap-4">
      <div data-gallery-ignore-rules="overlayClipped" data-gallery-ignore-reason="容器内查看器外壳样本随目录滚动，不是视口浮层" className="relative h-40"><UiViewerShell viewer={media} surface="media" presentation="centered" aria-label="媒体外壳样本"><span className="text-on-media">媒体底</span></UiViewerShell></div>
      <div data-gallery-ignore-rules="overlayClipped" data-gallery-ignore-reason="容器内查看器外壳样本随目录滚动，不是视口浮层" className="relative h-40"><UiViewerShell viewer={canvas} surface="canvas" aria-label="画布外壳样本"><p className="p-4 text-text1">画布底</p></UiViewerShell></div>
    </div>
    <UiButton onClick={() => setOpen(true)}>打开查看器，验证 Escape 关闭</UiButton>
    <UiViewerShell viewer={live} aria-label="查看器交互样本" presentation="centered" controls={<UiButton variant="media" className="absolute right-4 top-4" onClick={() => setOpen(false)}>关闭</UiButton>}><span className="text-on-media">点击背景或按 Escape 关闭</span></UiViewerShell>
  </UiGroup>
}

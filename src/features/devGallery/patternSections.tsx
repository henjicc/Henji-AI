import { useEffect, useRef, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { TriangleAlert } from 'lucide-react'
import { UiButton, UiEmpty, UiFormRow, UiGroup, UiInput, UiLoading, UiError, UiPanel, UiSegmented, UiSwitch, UiToolbar, UI_TEXT_META_CLASS } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { GALLERY_SKILL_SOURCE } from './galleryIndex'

const noop = (): void => undefined

function Antipattern({ children }: { children: string }): JSX.Element {
  return <p data-gallery-antipattern className="flex items-center gap-2 text-xs text-warning-text"><TriangleAlert className="h-4 w-4 shrink-0" />禁止写法：{children}</p>
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
      {['镜头 01', '镜头 02'].map((name, index) => <div key={name} className={`flex flex-col gap-2 py-5 ${index ? 'border-t border-line' : ''}`}><p className="text-sm font-medium text-text1">{name}</p><p className="text-xs text-text2">今天 · 图片 · 已完成</p><UiPanel variant="inset" className="p-4">结果预览</UiPanel><UiButton size="sm">继续编辑</UiButton></div>)}
      <Antipattern>记录间距与块内间距相同；在面板内再逐项套卡片。</Antipattern>
    </UiGroup>
    <UiGroup title="G4 复用同类结构：空、加载、失败" titleTone="compact"><div className="grid grid-cols-3 gap-4"><UiEmpty size="xs" title="还没有素材" action={<UiButton>添加素材</UiButton>} /><UiLoading size="xs" message="处理中" /><UiError size="xs" message="读取失败" onRetry={noop} /></div><Antipattern>每个页面手画三态或再加一圈卡片壳。</Antipattern></UiGroup>
    <UiGroup title="G5 不可用动作不出现；设置行保持横排" titleTone="overline" labelWidth={96}><UiFormRow label="启用预览" inline><UiSwitch checked /></UiFormRow><UiFormRow label="文件名称" inline><UiInput defaultValue="镜头 01" /></UiFormRow><Antipattern>没有对象时仍常驻整排灰色动作；只读内部状态进入正式界面。</Antipattern></UiGroup>
    <UiGroup title="命令带与从属带共享表面" titleTone="compact"><UiToolbar variant="command" trailing={<UiButton variant="primary">导出</UiButton>} subordinate={<UiFormRow label="强度" inline><NumberInput value={50} onChange={noop} /></UiFormRow>}><span className="text-13 text-text1">当前作品</span><UiButton>撤销</UiButton></UiToolbar><Antipattern>返回、标题、工具、参数分别长出一条头带。</Antipattern></UiGroup>
    <UiGroup title="浮层面板：内部留白分组" titleTone="compact"><UiPanel className="p-4"><UiGroup title="预览设置" titleTone="compact" labelWidth={96}><UiFormRow label="名称" density="compact"><UiInput defaultValue="当前作品" /></UiFormRow><UiPanel variant="inset" className="p-3">只读预览</UiPanel></UiGroup></UiPanel><Antipattern>浮层内部分组继续使用 border + bg-panel + rounded。</Antipattern></UiGroup>
  </div>
}

export function RulesSection(): JSX.Element {
  const links = [
    ['三条铁律', '三条铁律先记住这三句'], ['五级容器', '五级容器词汇表先背这张表'],
    ['动作层级', '动作层级视觉重量--动作的重要性'], ['选中态词汇表', '选中态词汇表先判断语义再选强度'],
    ['界面语法 G1–G5', '界面语法照着做就不会错2026-10-12-起强制'], ['必须复用', '必须复用-vs-允许新增'],
  ] as const
  return <UiGroup title="规范速查：链接到唯一原文" titleTone="compact">{links.map(([label, anchor]) => <a key={label} className="py-3 text-13 text-accent-text underline" href={`${GALLERY_SKILL_SOURCE}#${anchor}`} target="_blank" rel="noreferrer">{label}</a>)}<p className={UI_TEXT_META_CLASS}>分段用中性抬起底 + 强文字（最多 5 项）；其他单选用淡强调底。当前组件尺寸读取真实枚举，任务 4.2 合并后自动反映。</p></UiGroup>
}

export function LongListSection(): JSX.Element {
  const [fps, setFps] = useState<number | null>(null)
  const frames = useRef({ count: 0, since: 0, frame: 0 })
  useEffect(() => {
    const measurement = frames.current
    const tick = (time: number): void => {
      if (!frames.current.since) frames.current.since = time
      frames.current.count += 1
      if (time - frames.current.since >= 1000) {
        setFps(Math.round(frames.current.count * 1000 / (time - frames.current.since)))
        frames.current.since = time
        frames.current.count = 0
      }
      frames.current.frame = requestAnimationFrame(tick)
    }
    frames.current.frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(measurement.frame)
  }, [])
  return <UiGroup title="长列表：复用现有 react-virtuoso" titleTone="compact"><p className="text-xs text-text2">1000 条 · 当前窗口回调帧率 {fps ?? '测量中'}（不代表滚动性能验收）</p><div className="h-80"><Virtuoso totalCount={1000} itemContent={index => <div className="flex flex-col gap-2 border-b border-line py-5"><p className="text-sm font-medium text-text1">记录 {index + 1}</p><p className="text-xs text-text2">图片 · 已完成</p><UiButton size="sm">继续编辑</UiButton></div>} /></div></UiGroup>
}

import { useCallback, useMemo, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'

import { UiButton, UiOptionButton, UiPanel } from '@/components/ui/primitives'

import { PromptDocumentStatic } from './PromptDocumentStatic'
import { PrototypePromptEditor } from './PrototypePromptEditor'
import {
  createPrototypeDocument,
  createReplacementDocument,
  type PromptEditorPrototypeHandle,
  type PrototypeReference,
} from './prototypeTypes'
import prototypeThumbnail from '../../../../../resources/icons/icon.png'

type MountStrategy = 'all' | 'active'
type CanvasScale = 0.5 | 1 | 2

interface BenchmarkResult {
  strategy: MountStrategy
  expectedEditors: number
  readyEditors: number
  elapsedMs: number
  heapMb: number | null
}

const NODE_COUNT = 50
const SCALE_OPTIONS: CanvasScale[] = [0.5, 1, 2]
const REFERENCES: readonly PrototypeReference[] = [
  { id: 'asset-demo-image', label: '图1', mediaType: 'image', thumbnailSrc: prototypeThumbnail },
  {
    id: 'asset-demo-video',
    label: '视频1',
    mediaType: 'video',
    thumbnailSrc: prototypeThumbnail,
    sourceNodeId: 'prototype-source-node',
  },
  { id: 'asset-demo-audio', label: '音频1', mediaType: 'audio' },
]

function readHeapMb(): number | null {
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize: number }
  }).memory
  return memory ? Math.round((memory.usedJSHeapSize / 1024 / 1024) * 10) / 10 : null
}

function createInitialDocuments(): JSONContent[] {
  return Array.from({ length: NODE_COUNT }, (_, index) => createPrototypeDocument(index + 1))
}

function ResultCard({ result }: { result: BenchmarkResult | null }): JSX.Element {
  if (!result) {
    return <span className="text-xs text-text-muted">切换挂载策略后显示最近一次初始化结果</span>
  }
  return (
    <span className="text-xs text-text-muted">
      {result.strategy === 'all' ? '全量挂载' : '按需挂载'}：
      {result.readyEditors}/{result.expectedEditors} 个编辑器，{result.elapsedMs.toFixed(1)} ms
      {result.heapMb === null ? '' : `，JS Heap ${result.heapMb} MB`}
    </span>
  )
}

export default function PromptEditorPrototypeView(): JSX.Element {
  const primaryEditorRef = useRef<PromptEditorPrototypeHandle>(null)
  const benchmarkStartedAtRef = useRef(performance.now())
  const benchmarkReadyCountRef = useRef(0)
  const [primaryDocument, setPrimaryDocument] = useState<JSONContent>(() => createPrototypeDocument())
  const [secondaryDocument, setSecondaryDocument] = useState<JSONContent>(() => createPrototypeDocument(2))
  const [documents, setDocuments] = useState<JSONContent[]>(createInitialDocuments)
  const [scale, setScale] = useState<CanvasScale>(1)
  const [mountStrategy, setMountStrategy] = useState<MountStrategy>('active')
  const [activeNodeIndex, setActiveNodeIndex] = useState(0)
  const [benchmarkRun, setBenchmarkRun] = useState(0)
  const [benchmarkResult, setBenchmarkResult] = useState<BenchmarkResult | null>(null)
  const [editSessionCount, setEditSessionCount] = useState(0)

  const expectedEditors = mountStrategy === 'all' ? NODE_COUNT : 1
  const transformedWidth = useMemo(() => `${100 / scale}%`, [scale])

  const startBenchmark = (strategy: MountStrategy): void => {
    benchmarkStartedAtRef.current = performance.now()
    benchmarkReadyCountRef.current = 0
    setBenchmarkResult(null)
    setMountStrategy(strategy)
    setBenchmarkRun((current) => current + 1)
  }

  const handleEditorReady = useCallback((): void => {
    benchmarkReadyCountRef.current += 1
    const expected = mountStrategy === 'all' ? NODE_COUNT : 1
    if (benchmarkReadyCountRef.current !== expected) return
    setBenchmarkResult({
      strategy: mountStrategy,
      expectedEditors: expected,
      readyEditors: benchmarkReadyCountRef.current,
      elapsedMs: performance.now() - benchmarkStartedAtRef.current,
      heapMb: readHeapMb(),
    })
  }, [mountStrategy])

  const updateNodeDocument = (index: number, document: JSONContent): void => {
    setDocuments((current) => current.map((item, itemIndex) => (
      itemIndex === index ? document : item
    )))
  }

  return (
    <main className="h-screen overflow-auto bg-app p-5 text-text-dark">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-accent">Phase 1.1 · isolated prototype</p>
            <h1 className="mt-1 text-xl font-semibold">结构化提示词编辑器内核验证</h1>
            <p className="mt-1 text-sm text-text-muted">
              输入 @ 选择媒体；验证 IME、原子删除、复制粘贴、两实例撤销与画布缩放定位。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {SCALE_OPTIONS.map((option) => (
              <UiOptionButton
                key={option}
                active={scale === option}
                onClick={() => setScale(option)}
              >
                {option}×
              </UiOptionButton>
            ))}
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-2">
          <UiPanel className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-medium">生成工作区尺寸</h2>
                <p className="text-xs text-text-muted">实例 A · 当前编辑会话 {editSessionCount}</p>
              </div>
              <UiButton
                size="sm"
                onClick={() => primaryEditorRef.current?.replaceDocument(createReplacementDocument())}
              >
                程序化替换
              </UiButton>
            </div>
            <PrototypePromptEditor
              ref={primaryEditorRef}
              value={primaryDocument}
              references={REFERENCES}
              ariaLabel="提示词原型实例 A"
              onChange={setPrimaryDocument}
              onEditStart={() => setEditSessionCount((current) => current + 1)}
            />
            <pre className="mt-3 max-h-44 overflow-auto rounded-lg bg-bg-dark p-3 text-[10px] leading-4 text-text-muted">
              {JSON.stringify(primaryDocument, null, 2)}
            </pre>
          </UiPanel>

          <UiPanel className="overflow-hidden p-4">
            <div className="mb-3">
              <h2 className="text-sm font-medium">ReactFlow 缩放容器模拟</h2>
              <p className="text-xs text-text-muted">实例 B · 当前 {scale}×，候选框 Portal 应保持屏幕坐标准确</p>
            </div>
            <div className="h-[250px] overflow-auto rounded-lg border border-border-dark bg-bg-dark p-8">
              <div
                style={{
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                  width: transformedWidth,
                }}
              >
                <PrototypePromptEditor
                  value={secondaryDocument}
                  references={REFERENCES}
                  ariaLabel="提示词原型实例 B"
                  onChange={setSecondaryDocument}
                />
              </div>
            </div>
          </UiPanel>
        </section>

        <UiPanel className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">50 节点挂载策略对比</h2>
              <ResultCard result={benchmarkResult} />
            </div>
            <div className="flex gap-2">
              <UiButton size="sm" onClick={() => startBenchmark('all')}>全量挂载 50 个</UiButton>
              <UiButton size="sm" variant="primary" onClick={() => startBenchmark('active')}>
                仅挂载激活节点
              </UiButton>
            </div>
          </div>

          <div className="mt-4 grid max-h-[520px] grid-cols-1 gap-2 overflow-auto md:grid-cols-2 xl:grid-cols-3">
            {documents.map((document, index) => {
              const shouldMountEditor = mountStrategy === 'all' || activeNodeIndex === index
              return (
                <div key={index} className="rounded-lg border border-border-dark bg-bg-dark p-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-text-muted">节点 {index + 1}</span>
                    <UiButton
                      size="sm"
                      variant={activeNodeIndex === index ? 'primary' : 'ghost'}
                      onClick={() => setActiveNodeIndex(index)}
                    >
                      {activeNodeIndex === index ? '编辑中' : '编辑'}
                    </UiButton>
                  </div>
                  {shouldMountEditor ? (
                    <PrototypePromptEditor
                      key={`${benchmarkRun}-${index}`}
                      value={document}
                      references={REFERENCES}
                      ariaLabel={`提示词节点 ${index + 1}`}
                      editable={activeNodeIndex === index}
                      onChange={(nextDocument) => updateNodeDocument(index, nextDocument)}
                      onReady={handleEditorReady}
                      className="[&_.ProseMirror]:min-h-[68px]"
                    />
                  ) : (
                    <PromptDocumentStatic
                      document={document}
                      references={REFERENCES}
                      className="min-h-[68px] rounded-lg border border-border-dark bg-surface-dark px-3 py-2.5"
                    />
                  )}
                </div>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-text-muted">
            当前策略预计挂载 {expectedEditors} 个完整编辑器；其余节点只渲染结构化静态内容。
          </p>
        </UiPanel>
      </div>
    </main>
  )
}

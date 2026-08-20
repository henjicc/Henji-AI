import { fieldLedgerEntries, type ApplicationStoreActionBinding, type ApplicationStoreActionLedger } from '@/core/application-control'

import type { useCanvasStore } from '@/stores/canvasStore'
import { NODE_FIELDS } from './canvasFields'
import { CANVAS_ENTITY_TYPES as ENTITY } from './canvasReflection'

/*
 * 画布的界面动作账本。
 *
 * 画布是全项目覆盖最好的一块——节点与连线两侧都声明了 collectionWrite，专用能力也齐。
 * 建这份账主要是把剩下的几处缺口钉住，并把大量 ReactFlow 中间态明确排除掉，
 * 免得下一个人误以为它们也该注册。
 */

type State = ReturnType<typeof useCanvasStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const NODE_CREATE: ApplicationStoreActionBinding = { kind: 'collection', entityType: ENTITY.node, operation: 'create' }
const NODE_REMOVE: ApplicationStoreActionBinding = { kind: 'collection', entityType: ENTITY.node, operation: 'remove' }

const REACTFLOW_BRIDGE = 'ReactFlow 把拖拽、框选、连线手势翻译成的增量事件，是渲染层与图数据之间的桥；'
  + '助手的增删改走 canvas.node / canvas.edge 的集合写入与属性写入，不经过手势。'

export const CANVAS_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'canvasStore',
  title: '画布',
  entries: {
    /* ── 节点与连线 ─────────────────────────────────────────── */
    addNode: NODE_CREATE,
    addDerivedUploadNode: NODE_CREATE,
    addDerivedExportNode: NODE_CREATE,
    addStoryboardSplitNode: NODE_CREATE,
    deleteNode: NODE_REMOVE,
    deleteNodes: NODE_REMOVE,
    addEdge: { kind: 'collection', entityType: ENTITY.edge, operation: 'create' },
    ensureTextDisplayOutput: {
      kind: 'excluded',
      category: 'internal',
      reason: '文本处理首次运行时原子创建其输出展示节点，是生成执行器的内部结果落点；'
        + '助手仍通过画布节点与连线的正式集合能力编排显式结构。',
    },
    deleteEdge: { kind: 'collection', entityType: ENTITY.edge, operation: 'remove' },
    updateNodeData: { kind: 'capability', capabilityId: 'update_canvas_node' },
    resolveUploadPlaceholder: {
      kind: 'excluded',
      category: 'internal',
      reason: '本地文件完成类型识别与持久化后，将无端口上传占位节点原位收敛为具体媒体源节点；'
        + '它不暴露本地路径，助手仍通过可信素材引用创建具体节点。',
    },
    /*
     * 定义收敛在 canvasFields.ts；display_name 走 updateNodeData 能力，不在这里重复声明。
     * 3.2 又把分镜格子的 updateStoryboardFrame/reorderStoryboardFrame 并进同一批字段——
     * 两个 store 动作共用同一条 canvas.node.storyboard_frames 属性（内容与排序都是按 id
     * 定点写 note/order 字段），账本条目同样从这里自动派生。
     */
    ...fieldLedgerEntries(NODE_FIELDS),
    groupNodes: { kind: 'capability', capabilityId: 'group_canvas_nodes' },
    // 工程级整体状态操作，与 undo/group 同属专用能力（3.1，见执行记录：走集合删除要么绕两步、
    // 要么撞 maxItemsPerChange，不如照 undo_canvas_change 的先例）。
    clearCanvas: { kind: 'capability', capabilityId: 'clear_canvas' },
    // 集合删除对节点早就是级联删除子节点的语义，解散分组要求子节点保留，两者冲突，
    // 不能共用 remove_items（3.1）。
    ungroupNode: { kind: 'capability', capabilityId: 'ungroup_canvas_node' },

    /* ── 撤销重做 ───────────────────────────────────────────── */
    undo: { kind: 'capability', capabilityId: 'undo_canvas_change' },
    redo: { kind: 'capability', capabilityId: 'redo_canvas_change' },
    endHistoryGroup: {
      kind: 'excluded',
      category: 'internal',
      reason: '把一串连续拖拽合并成一条历史记录的收尾标记，由交互手势自己配对调用；'
        + '助手的写入通过事务边界成组，不需要这个标记。',
    },

    /* ── ReactFlow 桥接与视口 ───────────────────────────────── */
    onNodesChange: { kind: 'excluded', category: 'internal', reason: REACTFLOW_BRIDGE },
    onEdgesChange: { kind: 'excluded', category: 'internal', reason: REACTFLOW_BRIDGE },
    onConnect: { kind: 'excluded', category: 'internal', reason: REACTFLOW_BRIDGE },
    setCanvasData: {
      kind: 'excluded',
      category: 'internal',
      reason: '整图替换，由工程加载与事务回滚链路调用；助手侧对应的是打开工程与撤销，不直接换图。',
    },
    findNodePosition: {
      kind: 'excluded',
      category: 'internal',
      reason: '给新节点算一个不重叠的落点，是 addNode 的内部步骤，不改变任何状态。',
    },
    setViewportState: {
      kind: 'excluded',
      category: 'view_state',
      reason: '画布平移与缩放只影响本机当前看到的范围，助手要定位到某个节点用 focus_canvas_node。',
    },
    setCanvasViewportSize: {
      kind: 'excluded',
      category: 'view_state',
      reason: '窗口尺寸变化时由布局回填，用于视口换算，不是用户动作。',
    },
    setSelectedNode: { kind: 'capability', capabilityId: 'select_canvas_node' },
    setModelSelectorExpanded: {
      kind: 'excluded',
      category: 'view_state',
      reason: '节点上模型选择器的展开收起只影响这一个节点在屏幕上占多大，不写进工程文件；'
        + '助手选模型直接写节点数据。',
    },

    /* ── 查看器与对话框 ─────────────────────────────────────── */
    openImageViewer: {
      kind: 'excluded',
      category: 'view_state',
      reason: '查看器只是同一张图的放大浮层；助手要看图直接用素材的稳定媒体引用，比截查看器更清晰。',
    },
    closeImageViewer: {
      kind: 'excluded',
      category: 'view_state',
      reason: '同 openImageViewer，属于图片查看浮层的开关，不改变任何画布数据。',
    },
    navigateImageViewer: {
      kind: 'excluded',
      category: 'view_state',
      reason: '在查看器里翻上一张下一张，助手按引用逐个读图即可，不需要翻页。',
    },
    openToolDialog: {
      kind: 'excluded',
      category: 'view_state',
      reason: '工具对话框是参数录入的容器；助手直接写目标属性，开对话框反而多一步且会打断用户。',
    },
    closeToolDialog: {
      kind: 'excluded',
      category: 'view_state',
      reason: '同 openToolDialog，属于对话框容器的开关。',
    },
  },
}

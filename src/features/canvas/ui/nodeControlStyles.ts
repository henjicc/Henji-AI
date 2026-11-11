/** 行内模型/模板触发器的布局：靠右、按内容宽，最长 260 后截断；外观由静默触发器决定 */
export const NODE_CONTROL_MODEL_CHIP_CLASS = 'nodrag nowheel min-w-0 max-w-[260px]';

export const NODE_CONTROL_ICON_CLASS = 'h-3 w-3';

export const NODE_PORT_BASE_CLASS =
  "!h-2 !w-2 !border !border-text3/60 !opacity-0 transition-opacity duration-120 before:absolute before:-inset-2 before:content-[''] [&.connectingfrom]:!opacity-100 [&.connectingto]:!opacity-100";

export const NODE_PORT_VISIBLE_CLASS = '!opacity-100';

export const NODE_PORT_ROW_CLASS =
  `${NODE_PORT_BASE_CLASS} group-hover/row:!opacity-100 hover:!opacity-100`;

export const NODE_PORT_NODE_CLASS =
  `${NODE_PORT_BASE_CLASS} group-hover:!opacity-100 hover:!opacity-100`;

/**
 * 节点里的输入框表面（提示词、系统提示词等可以直接打字的区域）：比节点面板沉一级的底加一圈发丝线。
 * 行底取 window（4.3）：在四个预设下都比节点面板（panel）沉一级，与框内控件仍能区分。
 */
export const NODE_ROW_CARD_CLASS =
  'rounded-lg border border-line bg-window transition-colors';

/**
 * 参数行（模型/素材/参数）：节点本身已是卡片，行不各自套框（同一层纵深只画一次边框），
 * 靠行高与分组分隔线区分；取值控件统一为静默触发器（值 + 下箭头，悬停出底）。
 */
export const NODE_ROW_CLASS =
  'group/row relative flex min-h-10 items-center gap-3 px-2';

export const NODE_ROW_LABEL_CLASS =
  'min-w-16 max-w-[45%] shrink-0 truncate whitespace-nowrap text-left text-xs font-normal text-text3';

export const NODE_ROW_CONTROL_SLOT_CLASS = 'ml-auto flex min-w-0 items-center justify-end';

/** 行与行之间的间隙：行不套框，靠行高本身分开，只留很小的间隙 */
export const NODE_ROW_GAP_CLASS = 'gap-0.5';

/** 节点里“输入”与“参数”两组之间的分隔线 */
export const NODE_ROW_GROUP_DIVIDER_CLASS = 'mx-2 my-1 h-px shrink-0 bg-line';

/** 结果节点生成失败时的红色描边（配合 NodeGenerationError 覆盖层使用） */
export const NODE_GENERATION_ERROR_BORDER_CLASS =
  'border-danger-text/70 shadow-node-error';

/**
 * 节点外壳的选中 / 未选中描边。
 *
 * 这两组类此前在 11 个节点文件里各写一遍（完全相同的三元表达式），
 * 属于"同功能多份实现"。收敛到这里后新增节点直接复用，改描边只改一处。
 *
 * 用法：
 *   className={`... ${selected ? NODE_SELECTED_BORDER_CLASS : NODE_IDLE_BORDER_CLASS}`}
 */
export const NODE_SELECTED_BORDER_CLASS = 'border-accent shadow-node-selected';

/**
 * 节点静息描边取辅助文字色的低透明度：`line` / `line-strong` 在深色预设里与节点面几乎同亮，
 * 画布上节点会失去轮廓；辅助文字色两种模式都与表面拉开足够对比，压低透明度后与旧白纱观感一致，
 * 纸白下自动变成浅灰描边。
 */
export const NODE_IDLE_BORDER_CLASS = 'border-text3/30 hover:border-text3/50';

/**
 * 上传类节点被文件拖到上面时铺的一层淡强调底（任务 5.8，N03.2）：描边同选中态，内层淡强调底表示“松手即接住”。
 * 叠在节点内容之上、不接收指针。
 */
export const NODE_DROP_TARGET_OVERLAY_CLASS = 'pointer-events-none absolute inset-0 rounded-[var(--node-radius)] bg-selected-accent';

/** 不需要 hover 反馈的节点（如分组节点）用这个 */
export const NODE_IDLE_BORDER_STATIC_CLASS = 'border-text3/30';

/**
 * 节点外壳表面（henji-ui-surface 五级容器：画布节点是卡片 = 面板底）。实底不透明：
 * 点阵不再透进节点，纸白下节点为白色卡片、深色下比画布底亮一级。
 */
export const NODE_SURFACE_CLASS = 'bg-panel';

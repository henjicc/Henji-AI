// 节点内控件芯片：高度与字号走 UiChipButton size="sm"（28 / 12px），这里只放布局
export const NODE_CONTROL_CHIP_CLASS = '!gap-1.5';

export const NODE_CONTROL_MODEL_CHIP_CLASS = '!w-full !min-w-0 !max-w-[260px] !justify-start';

export const NODE_CONTROL_PARAMS_CHIP_CLASS = '!max-w-[120px] !justify-start';

export const NODE_CONTROL_ICON_CLASS = 'h-3 w-3';

export const NODE_PORT_BASE_CLASS =
  "!h-2 !w-2 !border !border-text3/60 !opacity-0 transition-opacity duration-120 before:absolute before:-inset-2 before:content-[''] [&.connectingfrom]:!opacity-100 [&.connectingto]:!opacity-100";

export const NODE_PORT_VISIBLE_CLASS = '!opacity-100';

export const NODE_PORT_ROW_CLASS =
  `${NODE_PORT_BASE_CLASS} group-hover/row:!opacity-100 hover:!opacity-100`;

export const NODE_PORT_NODE_CLASS =
  `${NODE_PORT_BASE_CLASS} group-hover:!opacity-100 hover:!opacity-100`;

/**
 * 节点逐行输入的统一卡片外壳（媒体/参数/模型/提示词行共用）。
 * 圆角、边框、背景固定不变，行内具体控件（下拉/开关/数值）各自保持自身样式，
 * 避免"不同控件类型各自圆角"导致的不统一感。
 */
// 行底取 window（4.3）：原 gap/45 在纸白下与行内取值触发器（raised）只差 ΔE 0.013，触发器边界看不清；
// window 在四个预设下与 raised 都 ≥ 0.024，且仍比节点面板（panel）沉一级。
export const NODE_ROW_CARD_CLASS =
  'rounded-lg border border-line bg-window transition-colors';

export const NODE_ROW_CLASS =
  `group/row relative flex min-h-10 items-center gap-3 px-3 py-1.5 ${NODE_ROW_CARD_CLASS}`;

export const NODE_ROW_LABEL_CLASS =
  'min-w-[64px] max-w-[45%] shrink-0 truncate whitespace-nowrap text-left text-xs font-medium text-text2';

export const NODE_ROW_CONTROL_SLOT_CLASS = 'ml-auto flex min-w-0 items-center justify-end';

/**
 * 未连线行的悬停提示（连线行改用插槽色底色，不叠加该 hover）。
 * 只加强描边、不换底色（任务 4.3，重要记录 012）：行底换成 hover 后与行内取值触发器（raised / 悬停同为 hover）
 * 同色，触发器边界消失。同一处的交互层级不得同色。
 * 描边取辅助文字色的低透明度（与节点外壳悬停同一做法）：原 `line-strong` 在石墨下只比 `line` 亮 9 级，
 * 1px 描边上几乎看不出悬停（5.2 转交，任务 5.4）。
 */
export const NODE_ROW_HOVER_CLASS = 'hover:border-text3/45';

/** 行与行之间的间隙（替代旧版贴边 divide-y），让每行读成独立卡片 */
export const NODE_ROW_GAP_CLASS = 'gap-1.5';

/** 结果节点生成失败时的红色描边（配合 NodeGenerationError 覆盖层使用） */
export const NODE_GENERATION_ERROR_BORDER_CLASS =
  'border-danger-hi/70 shadow-node-error';

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

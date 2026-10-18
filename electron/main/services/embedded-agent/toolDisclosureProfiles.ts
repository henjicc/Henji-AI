// 只决定披露时机和流程提示；schema、权限及执行来自正式 MCP 目录。
/**
 * 进剪辑首轮就给的创作工具：代码素材、就地生成和调色分析。代码、文字、字幕、转场与关键帧的普通创改走通用实体工具。
 * 只放创作时几乎每次都会用到的；标题模板、字幕识别与翻译、多机位、响度、场景检测等按需 load_application_tools，
 * 否则首轮工具会占去约一半上下文。名称由 piEngine.test 对照正式目录校验。
 */
const VIDEO_EDIT_CREATIVE_TOOLS = ['collect_video_edit_code_asset', 'analyze_video_edit_color',
  'prepare_video_edit_in_place_generation', 'generate_video_edit_in_place', 'get_video_edit_in_place_generation',
  'recover_video_edit_in_place_generation', 'discard_video_edit_in_place_generation'] as const
export function videoEditCreativeTools(): string[] { return [...VIDEO_EDIT_CREATIVE_TOOLS] }
export const basicTools = new Set(['load_assistant_skill', 'describe_application_entities', 'list_application_entities', 'read_application_entity', 'change_application_entities'])
const modelTools = ['resolve_generation_model', 'search_models', 'get_model_schema']
const taskTools = ['wait_generation_task', 'cancel_generation_task', 'get_application_operation']
export const taskProfiles = {
  canvas_generation: {
    tools: [...modelTools, ...taskTools, 'get_canvas_node_schema', 'prepare_generation_task', 'create_visible_generation_task',
      'prepare_canvas_node_generation', 'submit_canvas_node_generation', 'resume_canvas_generation_task'],
    guidance: '画布新生成：未指定模型时先 resolve_generation_model 读取最新默认模型与供应商，不把搜索排序或旧草稿当用户偏好；明确指定模型时遵循用户要求。选定后读取参数，再 prepare_generation_task → create_visible_generation_task，destination 为原画布；应用创建节点与参考连线，结果落在旁侧。位置优先级：明确位置、原选中节点旁、原视口空位。已有节点用 prepare_canvas_node_generation → submit_canvas_node_generation，保留节点模型。提交后调用 wait_generation_task 等待结果，终态停止，不重复提交。',
  },
  generation: {
    tools: [...modelTools, ...taskTools, 'prepare_generation_task', 'create_visible_generation_task'],
    guidance: '生成页新任务：未指定模型时先 resolve_generation_model 读取最新默认模型与供应商；用户明确要求沿用当前草稿时读取草稿模型。选定后读取参数，准备后提交；提交后调用 wait_generation_task 等待结果，终态停止，不重复提交。明确指定的画布目标仍优先。',
  },
  canvas_nodes: {
    tools: ['search_canvas_node_types', 'get_canvas_node_schema', 'get_canvas_node', 'duplicate_canvas_node', 'group_canvas_nodes', 'ungroup_canvas_node'],
    guidance: '节点编辑：只查询需要的节点类型及 schema；普通节点、连线的增删改使用通用实体事务。复制、分组使用正式语义工具。已有上下文中的画布和选择无需重复查询。',
  },
} satisfies Record<string, { tools: string[]; guidance: string }>

export function disclosureSurface(context: string): string {
  try {
    const value = JSON.parse(context) as { surface?: { id?: string }; workspace?: { id?: string; activeToolId?: string } }
    if (typeof value?.surface?.id === 'string') return value.surface.id
    if (value?.workspace?.activeToolId === 'cameraStage') return 'tool.camera_stage'
    if (value?.workspace?.activeToolId === 'imageMark') return 'tool.image_edit'
    if (value?.workspace?.activeToolId === 'audioEdit') return 'tool.audio_edit'
    if (value?.workspace?.activeToolId === 'screenRecording') return 'tool.screen_recording'
    return value?.workspace?.id === 'nodes' ? 'workspace.canvas' : `workspace.${value?.workspace?.id ?? 'unknown'}`
  } catch { return 'workspace.unknown' }
}

export function surfaceProfile(surface: string): { tools: string[]; guidance: string } {
  if (surface === 'tool.screen_recording') return { tools: ['start_screen_recording', 'stop_screen_recording', 'read_screen_recording_events'], guidance: '当前为屏幕录制。先列出 screen_recording.source 与 screen_recording.device，开始后保留返回的 session 引用。通用实体读取 phase/elapsed_ms/details；暂停、继续、标记、中止、恢复和导入剪辑按名称加载对应操作。停止会等待媒体与会话保存，再分页读事件；不会自动回放操作。会话是正式文档，可通过通用文档能力列出、改名、移动和删除。' }
  if (surface === 'workspace.canvas') return { tools: ['get_canvas_document'],
    guidance: '当前为画布。已有通用实体读写与画布读取；已有画布和选择摘要无需再查。生成加载 task=canvas_generation，节点详细操作加载 task=canvas_nodes；三维和生成页工具按需加载。' }
  if (surface === 'workspace.generation') return { tools: ['search_models'], guidance: '当前为生成页。生成任务加载 task=generation；模型参数按所选模型读取。' }
  if (surface === 'tool.camera_stage') return { tools: ['observe_camera_stage_scene'], guidance: '当前为三维场景（一份镜头参考文档，id 即文档 ID）。普通属性走通用实体，场景算法与渲染按需加载 camera_stage 领域；文档的列出、新建、改名、移动、删除用通用文档能力。' }
  if (surface === 'tool.image_edit') return { tools: [], guidance: '当前为图片编辑。图层普通读写走通用实体，按本步骤用 load_application_tools 的 names 加载算法，如选区 select_image_edit_region、修补 repair_image_edit_region；不加载整个领域。' }
  if (surface === 'workspace.video_edit') return { tools: ['observe_video_edit_frame', 'read_application_media', ...modelTools, ...taskTools, ...videoEditCreativeTools()],
    guidance: '当前为剪辑。宿主上下文的 videoEdit 给出当前剪辑、序列、播放头、入出点与选区；剪辑、序列、素材项、片段、代码素材与参数关键帧走通用实体读改增删。取帧、读图、代码素材收录、调色分析、就地生成（付费，提交前宿主自动估价；完成后用 get_video_edit_in_place_generation 确认落位）与模型、任务工具已加载。修改后用 observe_video_edit_frame 取指定合成帧或源帧（contact_sheet 可一次看一段动作），再用 read_application_media 读取画面核对。保存、撤销、拆分、波纹／滚动／外滑／内滑修剪（trim_video_edit_clip）、转录局部检索（query_video_edit_transcript）和文本范围波纹删除（ripple_delete_video_edit_text，优先使用检索返回的 selector）、标题模板、字幕识别与翻译、多机位源创建（create_video_edit_multicam）、本地生成代理（generate_video_edit_proxy）、切回替换前的镜头（restore_video_edit_clip_take）、导出与收录按当前步骤用 load_application_tools 的 names 加载。' }
  if (surface === 'tool.audio_edit') return { tools: [], guidance: '当前为口播剪辑。口播是文档：列出、新建、打开、改名、删除走通用文档能力（kind=audio_edit）；口播内容、词块与线索走通用实体，转写、分析、预览和导出按需加载 audio_edit 领域。' }
  if (surface.startsWith('settings.')) return { tools: ['search_application_settings'], guidance: '当前为设置。先定位需要的设置属性，再通过通用实体读取和修改。' }
  return { tools: [], guidance: '按当前界面与用户任务使用通用实体；缺少专用操作时再按领域或工具名加载。' }
}

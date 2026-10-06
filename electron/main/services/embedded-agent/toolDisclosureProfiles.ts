// 只决定披露时机和流程提示；schema、权限及执行来自正式 MCP 目录。
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
    return value?.workspace?.id === 'nodes' ? 'workspace.canvas' : `workspace.${value?.workspace?.id ?? 'unknown'}`
  } catch { return 'workspace.unknown' }
}

export function surfaceProfile(surface: string): { tools: string[]; guidance: string } {
  if (surface === 'workspace.canvas') return { tools: ['get_canvas_document'],
    guidance: '当前为画布。已有通用实体读写与画布读取；已有画布和选择摘要无需再查。生成加载 task=canvas_generation，节点详细操作加载 task=canvas_nodes；三维和生成页工具按需加载。' }
  if (surface === 'workspace.generation') return { tools: ['search_models'], guidance: '当前为生成页。生成任务加载 task=generation；模型参数按所选模型读取。' }
  if (surface === 'tool.camera_stage') return { tools: ['observe_camera_stage_scene'], guidance: '当前为三维场景（一份镜头参考文档，id 即文档 ID）。普通属性走通用实体，场景算法与渲染按需加载 camera_stage 领域；文档的列出、新建、改名、移动、删除用通用文档能力。' }
  if (surface === 'tool.image_edit') return { tools: [], guidance: '当前为图片编辑。图层普通读写走通用实体，编辑算法、预览及保存按需加载 image_edit 领域。' }
  if (surface === 'workspace.video_edit') return { tools: ['observe_video_edit_frame', 'read_application_media'],
    guidance: '当前为剪辑。宿主上下文的 videoEdit 给出当前剪辑、序列、播放头、入出点与选区；剪辑、序列、素材项、片段、代码素材与参数关键帧走通用实体读改增删。修改后用 observe_video_edit_frame 取指定合成帧或源帧，再用 read_application_media 读取画面核对。保存、撤销、拆分、波纹／滚动／外滑／内滑修剪（trim_video_edit_clip）、文本范围波纹删除（ripple_delete_video_edit_text，先读序列转录稿）、多机位源创建（create_video_edit_multicam，返回新序列和素材项）、本地生成代理（generate_video_edit_proxy，只生成看片缓存）、在时间线原地生成镜头／替换镜头／延长／配音配乐（generate_video_edit_in_place，付费，提交前宿主自动估价；完成后用 get_video_edit_in_place_generation 确认落位）、切回替换前的镜头（restore_video_edit_clip_take）、导出、收录与创作结果回填按需加载 video_edit 领域。' }
  if (surface === 'tool.audio_edit') return { tools: [], guidance: '当前为口播剪辑。口播是文档：列出、新建、打开、改名、删除走通用文档能力（kind=audio_edit）；口播内容、词块与线索走通用实体，转写、分析、预览和导出按需加载 audio_edit 领域。' }
  if (surface.startsWith('settings.')) return { tools: ['search_application_settings'], guidance: '当前为设置。先定位需要的设置属性，再通过通用实体读取和修改。' }
  return { tools: [], guidance: '按当前界面与用户任务使用通用实体；缺少专用操作时再按领域或工具名加载。' }
}

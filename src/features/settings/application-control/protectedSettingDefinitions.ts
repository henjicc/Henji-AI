/*
 * 只读理由必须是技术事实，不是含糊的「安全」表态（4.4 决策，见重要记录.md 记录 003）。
 *
 * 密钥两项确实是安全边界：明文密钥一旦进入模型上下文就有泄露风险，理由保留「安全」表述。
 * 路径三项不是「顾虑」，是渲染进程技术上做不到——OS 文件对话框由主进程/系统弹出，渲染层
 * 拿不到用户在对话框里的选择结果之外的任何东西，助手没有办法代替用户点。
 *
 * 每条理由都补一句 open_application_surface 的替代路径：助手做不到的事，至少能把用户
 * 带到对应设置分区，由用户自己完成。
 *
 * `models.visibility` 与 `updates.configuration` 已在 4.4 松绑，不再需要占位符：
 * - `models.visibility` 的实际写入能力落在 `generation.model.hidden`（每个模型的隐藏开关），
 *   不是这里的单一标量设置——供应商级/媒体类型级的批量隐藏仍只能在设置页操作，执行记录里有
 *   完整判断依据。
 * - `updates.configuration` 拆成了 `updates.enabled` 与 `updates.check_frequency` 两条正规
 *   设置（generalSettingDefinitions.ts），原因是本注册表里每条设置都是单一标量值，没有组合
 *   对象的先例。
 */
export const PROTECTED_APPLICATION_SETTING_DEFINITIONS: Record<string, Record<string, unknown>> = {
  'security.provider_keys': {
    id: 'security.provider_keys', title: '服务密钥',
    description: '密钥明文一旦进入模型上下文就有泄露风险，助手只能查询各服务是否已配置，'
      + '密钥值永不返回；输入或修改密钥请用 open_application_surface 把用户带到 api-keys 分区，'
      + '由用户自己在密钥输入框里操作。',
    aliases: ['API Key', '密钥', '供应商密钥'], target: { tab: 'api', sectionId: 'api-keys' }, sensitive: true, writable: false,
  },
  'storage.download_paths': {
    id: 'storage.download_paths', title: '下载目录',
    description: 'OS 文件选择器由系统弹出，不在渲染进程里，助手没有办法代替用户点选目录，'
      + '只能查询已配置几条；配置或删除下载预设路径请用 open_application_surface 把用户带到 '
      + 'general-storage 分区的「下载预设路径」，由用户自己选择目录。',
    aliases: ['下载路径', '保存目录', '本地路径', '下载预设路径'], target: { tab: 'general', sectionId: 'general-storage' }, sensitive: true, writable: false,
  },
  'storage.data_path': {
    id: 'storage.data_path', title: '应用数据目录',
    description: 'OS 文件选择器由系统弹出，不在渲染进程里，迁移数据目录必须由用户在系统确认框里'
      + '完成；助手可以用 open_application_surface 把用户带到 general-storage 分区定位到这一项。',
    aliases: ['数据目录', '迁移数据', '存储位置'], target: { tab: 'general', sectionId: 'general-storage' }, sensitive: true, writable: false,
  },
  'downloads.quick_path': {
    id: 'downloads.quick_path', title: '快速下载目录',
    description: 'OS 文件选择器由系统弹出，不在渲染进程里，助手没有办法代替用户点选目录，'
      + '具体路径只能通过系统选择器确认；用 open_application_surface 把用户带到 general-storage '
      + '分区定位到这一项。',
    aliases: ['快速下载路径', '下载文件夹'], target: { tab: 'general', sectionId: 'general-storage' }, sensitive: true, writable: false,
  },
  'llm.configuration': {
    id: 'llm.configuration', title: '助手模型配置',
    description: '含密钥的配置字段不会提供给助手；助手可以用 open_application_surface 把用户'
      + '带到 api-llm 分区，由用户自己完成模型端点与密钥的配置。',
    aliases: ['大语言模型', '助手模型', 'LLM 配置'], target: { tab: 'api', sectionId: 'api-llm' }, sensitive: true, writable: false,
  },
}

/*
 * 只读理由必须是技术事实，不是含糊的「安全」表态（4.4 决策，见重要记录.md 记录 003）。
 *
 * 密钥两项确实是安全边界：明文密钥一旦进入模型上下文就有泄露风险，理由保留「安全」表述。
 * 下载目录与快速下载目录（2026-10-21 起）是普通可读写设置，助手直接按路径读写；作品目录可读路径，
 * 但更换要整体搬迁并重启，仍由用户在设置里完成。
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
  'security.paid_approval': {
    id: 'security.paid_approval', title: 'AI 付费授权',
    description: '付费授权模式、额度和项目授权只能由用户在设置或确认弹窗中修改；允许助手修改会让付费调用方自行提升权限。可用 open_application_surface 打开智能助手设置，由用户调整。',
    aliases: ['AI 付费', '自动通过额度', '每日上限', '项目授权'], target: { tab: 'assistant', sectionId: 'assistant-preferences' }, sensitive: true, writable: false,
  },
  'security.provider_keys': {
    id: 'security.provider_keys', title: '服务密钥',
    description: '密钥明文一旦进入模型上下文就有泄露风险，助手只能查询各服务是否已配置，'
      + '密钥值永不返回；输入或修改密钥请用 open_application_surface 把用户带到供应商与模型分区，'
      + '由用户自己在密钥输入框里操作。',
    aliases: ['API Key', '密钥', '供应商密钥'], target: { tab: 'providers', sectionId: 'providers' }, sensitive: true, writable: false,
  },
  'storage.data_path': {
    id: 'storage.data_path', title: '作品目录',
    description: '作品目录（默认“文档/痕迹AI”）存放项目、各类文档、生成结果、上传素材、导出与助手技能。'
      + '可读取当前路径（path）；更换位置要整体移动全部作品、先保存并关闭所有打开的内容，'
      + '完成后重新启动应用，因此只能由用户在设置里操作。'
      + '需要时用 open_application_surface 把用户带到 files-storage 分区。',
    aliases: ['作品目录', '数据目录', '保存位置', '存储位置', 'works folder'], target: { tab: 'files', sectionId: 'files-storage' }, sensitive: true, writable: false,
  },
  'llm.configuration': {
    id: 'llm.configuration', title: '助手模型配置',
    description: '含密钥的配置字段不会提供给助手；助手可以用 open_application_surface 把用户'
      + '带到供应商与模型分区，由用户自己完成模型端点与密钥的配置。',
    aliases: ['大语言模型', '助手模型', 'LLM 配置'], target: { tab: 'providers', sectionId: 'providers' }, sensitive: true, writable: false,
  },
}

/** 设置声明保持宿主无关；组件键由界面层绑定，导航、搜索和 Surface 都从这里派生。 */
export interface SettingsSectionDeclaration {
  id: string
  surfaceId: string
  componentKeys: readonly string[]
  titleKey: string
  /** 保留已发布的目录和枚举顺序；不影响页面导航顺序。 */
  surfaceOrder: number
  schemaOrder: number
  sensitive?: boolean
  acceptedRefKinds?: readonly string[]
  search?: readonly { labelKey: string; keywords?: readonly string[]; order: number }[]
}

export interface SettingsTabDeclaration {
  surface?: { id: string; surfaceOrder: number; schemaOrder: number }
  sections: readonly SettingsSectionDeclaration[]
}

/** 标签、同义词是独立文案；顺序沿用原设置搜索，避免改变同分结果。 */
function searchRows(order: number, labels: readonly (string | readonly [string, readonly string[]])[]): NonNullable<SettingsSectionDeclaration['search']> {
  return labels.map((label, index) => typeof label === 'string'
    ? { labelKey: label, order: order + index / 100 }
    : { labelKey: label[0], keywords: label[1], order: order + index / 100 })
}

function section<const T extends Omit<SettingsSectionDeclaration, 'titleKey'>>(value: T): T & { titleKey: string } {
  return { ...value, titleKey: 'navSections.' + value.id }
}

/** 大类及分区的书写顺序就是设置页顺序。新增分区只在所属大类添加一条声明。 */
export const SETTINGS_DECLARATION = {
  general: {
    surface: { id: 'settings.general', surfaceOrder: 1, schemaOrder: 1 },
    sections: [
      section({
        id: 'general-basic', surfaceId: 'settings.general.basic', componentKeys: ['LanguageSection', 'StartupSection', 'OnboardingSection'],
        surfaceOrder: 2, schemaOrder: 2,
        search: [
          ...searchRows(1, [
            ['sections.language.label', ['语言', 'language', '中文', 'English']],
            ['sections.interface.startupWorkspaceLabel', ['启动', 'startup']],
            ['onboarding:settings.onboardingTitle', ['引导', '欢迎', 'onboarding']],
          ]),
        ],
      }),
      section({
        id: 'general-view', surfaceId: 'settings.general.view', componentKeys: ['ImageViewerSection', 'RecordingShortcutSettings'],
        surfaceOrder: 3, schemaOrder: 3,
        search: [
          ...searchRows(2, [
            ['sections.canvas.imageViewerInfoLabel', ['查看器', '分辨率', 'viewer']],
          ]),
          ...searchRows(21, [
            ['recordingShortcuts.title', ['录屏', '录制', '快捷键', 'screen recording', 'hotkeys']],
          ]),
        ],
      }),
      section({
        id: 'general-recording', surfaceId: 'settings.general.recording', componentKeys: ['AudioCaptureSettingsForm'],
        surfaceOrder: 0, schemaOrder: 0,
        acceptedRefKinds: ['audio_capture.settings'],
        search: [
          ...searchRows(0, [
            ['navSections.general-recording', ['设备类型', '输入设备', '输入通道', '声道', '采样率', '位深', '缓冲', '独占', 'ASIO', 'WASAPI', 'microphone', 'sample rate', 'bit depth', 'buffer', 'exclusive']],
          ]),
        ],
      }),
      section({
        id: 'general-appearance', surfaceId: 'settings.general.appearance', componentKeys: ['ThemeSettingsSection'],
        surfaceOrder: 4, schemaOrder: 4,
        search: [
          ...searchRows(3, [
            ['sections.theme.preset.label', ['主题', '深色', '浅色', 'dark', 'light', 'theme']],
            ['sections.theme.accent.label', ['颜色', 'color']],
            'sections.theme.contrast.label',
            'sections.theme.radius.label',
            ['sections.interface.uiScaleLabel', ['缩放', '字号', 'zoom', 'scale']],
            ['sections.theme.blur.label', ['模糊', 'blur']],
            ['sections.theme.portable.label', ['导入', '导出', 'import', 'export']],
          ]),
        ],
      }),
      section({
        id: 'general-about', surfaceId: 'settings.general.about', componentKeys: ['UpdateSection', 'AboutSection', 'HardwareCapabilitiesSection'],
        surfaceOrder: 5, schemaOrder: 5,
        search: [
          ...searchRows(4, [
            ['sections.updates.currentVersionLabel', ['版本', '检查更新', 'version', 'update']],
            ['sections.updates.autoCheckLabel', ['更新', 'update']],
            'sections.updates.clearIgnoredLabel',
            'sections.about.authorLabel',
            'sections.about.homepageLabel',
            ['sections.about.licenseLabel', ['许可', 'license']],
            ['sections.hardware.gpus', ['显卡', '硬件', 'GPU', 'hardware']],
            ['sections.hardware.decodeLabel', ['硬件解码', 'H.264', 'HEVC', 'AV1', 'VP9', '4:2:2', 'decode']],
            ['sections.hardware.encodeLabel', ['硬件编码', 'NVENC', 'encode']],
            ['sections.about.componentsLabel', ['开源', '第三方', 'open source']],
            'sections.about.allComponentsLabel',
          ]),
        ],
      }),
    ],
  },
  providers: {
    sections: [
      section({
        id: 'providers', surfaceId: 'settings.providers_models', componentKeys: ['ProviderCenterSection'],
        surfaceOrder: 6, schemaOrder: 6,
        sensitive: true,
        search: [
          ...searchRows(5, [
            ['providerCenter.apiKey', ['密钥', 'API Key', 'key', 'token']],
            ['providerCenter.models', ['模型', '隐藏模型', 'model']],
            ['providerCenter.actions.renameModel', ['别名', '改名', 'alias', 'rename']],
            ['providerCenter.actions.addProvider', ['供应商', 'provider', 'DeepSeek', 'OpenAI']],
          ]),
        ],
      }),
    ],
  },
  workspace: {
    surface: { id: 'settings.workspace', surfaceOrder: 7, schemaOrder: 7 },
    sections: [
      section({
        id: 'workspace-generation', surfaceId: 'settings.workspace.generation', componentKeys: ['GenerationSettingsSection'],
        surfaceOrder: 8, schemaOrder: 8,
        search: [
          ...searchRows(6, [
            ['onboarding:settings.primaryProvider', ['默认', 'default']],
            ['onboarding:settings.defaultModels.image', ['默认模型', 'default model']],
            'onboarding:settings.defaultModels.video',
            'onboarding:settings.defaultModels.audio',
            ['sections.concurrency.label', ['并发', '同时', 'queue']],
            ['sections.display.priceLabel', ['价格', '费用', 'price', 'cost']],
            ['sections.display.currencyModeLabel', ['币种', '人民币', '美元', 'currency']],
            ['sections.display.exchangeRateLabel', ['汇率', 'rate']],
            ['sections.promptOptimization.title', ['提示词', 'prompt']],
            'sections.display.autoFocusLabel',
            ['sections.interface.autoCollapseLabel', ['底部面板', '折叠', 'collapse']],
            ['sections.interface.collapseDelayLabel', ['移出后等待', 'collapse delay']],
          ]),
        ],
      }),
      section({
        id: 'workspace-canvas', surfaceId: 'settings.workspace.canvas', componentKeys: ['CanvasSection'],
        surfaceOrder: 9, schemaOrder: 9,
        search: [
          ...searchRows(7, [
            ['sections.canvas.lodLabel', ['卡顿', '性能', '流畅', 'performance']],
            'sections.canvas.autoInsertTextDisplayLabel',
            'sections.canvas.uploadFilenameTitleLabel',
            ['sections.canvas.storyboardKeepStyleLabel', ['分镜', 'storyboard']],
            'sections.canvas.storyboardNoTextLabel',
            'sections.canvas.storyboardAutoInferEmptyFrameLabel',
            'sections.canvas.ignoreAtTagLabel',
          ]),
        ],
      }),
      section({
        id: 'workspace-video-edit', surfaceId: 'settings.workspace.video_edit', componentKeys: ['VideoEditSection', 'VideoEditShortcutSettings'],
        surfaceOrder: 10, schemaOrder: 10,
        search: [
          ...searchRows(8, [
            ['videoEditShortcuts.label', ['快捷键', '键位', 'shortcut', 'hotkey']],
            ['sections.videoEdit.selectionFollowsPlayheadLabel', ['剪辑', '播放头', '自动选中', '效果控件', 'playhead', 'selection']],
            ['sections.videoEdit.binsFirstLabel', ['素材箱', 'bin']],
            ['sections.videoEdit.folderBinsLabel', ['素材箱', 'folder bin']],
            ['sections.videoEdit.duplicatePolicyLabel', ['重复文件', 'duplicate']],
            ['sections.videoEdit.renderFormatLabel', ['预渲染', 'HEVC', 'H.264', '编码', 'render format']],
            ['sections.videoEdit.renderQualityLabel', ['预渲染画质', 'render quality']],
          ]),
        ],
      }),
      section({
        id: 'workspace-assets', surfaceId: 'settings.workspace.assets', componentKeys: ['AssetLibrarySection'],
        surfaceOrder: 11, schemaOrder: 11,
        search: [
          ...searchRows(9, [
            ['sections.assetLibrary.tabAction', ['资产', '素材', 'asset']],
            'sections.assetLibrary.panelPosition',
            'sections.assetLibrary.edgeTrigger',
            'sections.assetLibrary.triggerEdge',
            ['sections.assetLibrary.delay', ['唤起前等待', 'trigger delay']],
          ]),
        ],
      }),
    ],
  },
  files: {
    surface: { id: 'settings.files', surfaceOrder: 12, schemaOrder: 12 },
    sections: [
      section({
        id: 'files-storage', surfaceId: 'settings.storage', componentKeys: ['DataPathSection'],
        surfaceOrder: 13, schemaOrder: 13,
        sensitive: true,
        search: [
          ...searchRows(10, [
            ['sections.dataPath.pathLabel', ['作品目录', '数据目录', '保存位置', '更换位置', '存储', 'works folder', 'storage', 'folder']],
          ]),
        ],
      }),
      section({
        id: 'files-cache', surfaceId: 'settings.files.cache', componentKeys: ['MediaCacheSection'],
        surfaceOrder: 14, schemaOrder: 14,
        search: [
          ...searchRows(11, [
            ['sections.mediaCache.usageLabel', ['缓存', '占用', '清理', '磁盘空间', 'cache', 'disk space']],
            ['sections.mediaCache.category.render', ['预渲染', '渲染文件', 'render']],
            ['sections.mediaCache.category.proxy', ['代理', 'proxy']],
            'sections.mediaCache.category.analysis',
            'sections.mediaCache.category.preview',
            'sections.mediaCache.category.audio_edit',
            ['sections.mediaCache.budgetLabel', ['容量上限', '缓存大小', 'cache size', 'limit']],
            ['sections.mediaCache.retentionLabel', ['自动清理', '保留', 'retention']],
          ]),
        ],
      }),
      section({
        id: 'files-upload', surfaceId: 'settings.upload', componentKeys: ['LargeUploadSection', 'UploadSection'],
        surfaceOrder: 15, schemaOrder: 15,
        search: [
          ...searchRows(12, [
            ['sections.largeUpload.strategyLabel', ['大文件', '复制', '引用', 'upload']],
            ['sections.upload.providerLabel', ['上传', '托管', 'upload']],
            'sections.upload.fallbackLabel',
          ]),
        ],
      }),
      section({
        id: 'files-download', surfaceId: 'settings.files.download', componentKeys: ['DownloadSettingsSection'],
        surfaceOrder: 16, schemaOrder: 16,
        search: [
          ...searchRows(13, [
            ['sections.download.enableLabel', ['下载', 'download']],
            'sections.download.pathLabel',
            'sections.download.buttonOnlyLabel',
            ['sections.download.presetPathsLabel', ['保存到', '下载路径']],
          ]),
        ],
      }),
      section({
        id: 'files-sounds', surfaceId: 'settings.files.sounds', componentKeys: ['SoundLibrarySection'],
        surfaceOrder: 17, schemaOrder: 17,
        search: [
          ...searchRows(14, [
            ['sections.soundLibrary.listLabel', ['音效', '音效库', '转场音效', '嗖', 'sound effect', 'sfx']],
          ]),
        ],
      }),
      section({
        id: 'files-models', surfaceId: 'settings.files.models', componentKeys: ['LocalModelsSection'],
        surfaceOrder: 18, schemaOrder: 18,
        search: [
          ...searchRows(15, [
            ['sections.localModels.listLabel', ['模型', '抠像', '人脸', '文字', '跟踪', 'ONNX', 'model', 'matting']],
            ['sections.localModels.sourceLabel', ['ModelScope', 'Hugging Face', '国内', '国外', '镜像', 'mirror']],
          ]),
        ],
      }),
    ],
  },
  assistant: {
    surface: { id: 'settings.assistant', surfaceOrder: 19, schemaOrder: 19 },
    sections: [
      section({
        id: 'assistant-models', surfaceId: 'settings.assistant.models', componentKeys: ['AssistantModelsSection'],
        surfaceOrder: 20, schemaOrder: 20,
        search: [
          ...searchRows(16, [
            ['agentModels.roles.primary', ['助手', '智能体', 'assistant', 'agent', 'LLM']],
            'agentModels.roles.router',
            'agentModels.roles.summarizer',
            'agentModels.roles.fallback',
            ['agentModels.roles.observer', ['视觉', 'vision']],
            ['agentModels.advanced', ['超时', '重试', 'Token', 'timeout']],
          ]),
        ],
      }),
      section({
        id: 'assistant-preferences', surfaceId: 'settings.assistant_preferences', componentKeys: ['AgentUserInstructionsSection', 'PaidApprovalSection'],
        surfaceOrder: 21, schemaOrder: 22,
        sensitive: true,
        search: [
          ...searchRows(17, [
            ['paidApproval.title', ['付费', '授权', '单次', '每日上限', '始终允许', 'auto', 'bypass', 'payment']],
            'paidApproval.mode',
            'paidApproval.single',
            'paidApproval.daily',
            ['agentInstructions.label', ['指令', '偏好', '提示词', 'instructions']],
          ]),
        ],
      }),
      section({
        id: 'assistant-memory', surfaceId: 'settings.assistant.memory', componentKeys: ['AssistantMemorySection'],
        surfaceOrder: 22, schemaOrder: 21,
        sensitive: true,
        search: [
          ...searchRows(18, ['memory.enabled', 'memory.autoOrganize', ['memory.title', ['记忆', '偏好', 'memory', 'preferences']], 'memory.history']),
        ],
      }),
      section({
        id: 'assistant-mcp', surfaceId: 'settings.assistant.mcp', componentKeys: ['McpSection'],
        surfaceOrder: 23, schemaOrder: 23,
        search: [
          ...searchRows(19, [
            ['mcp.enable', ['MCP', 'Codex', 'Claude', '外部', '连接']],
            ['mcp.port', ['端口', 'port']],
            'mcp.allowWrites',
            'mcp.allowDelete',
            ['mcp.allowPaid', ['付费']],
            ['mcp.connectionsTitle', ['授权', 'authorization']],
            'mcp.name',
            ['mcp.edit', ['修改权限', '修改配置', 'permission']],
          ]),
        ],
      }),
    ],
  },
  skills: {
    sections: [
      section({
        id: 'assistant-skills', surfaceId: 'settings.assistant_skills', componentKeys: ['AgentSkillsSection'],
        surfaceOrder: 24, schemaOrder: 24,
        search: [
          ...searchRows(20, [
            ['agentSkills.userGroup', ['技能', 'skill']],
            'agentSkills.builtinGroup',
            ['agentSkills.installGroup', ['安装', 'install']],
          ]),
        ],
      }),
    ],
  },
} as const satisfies Readonly<Record<string, SettingsTabDeclaration>>

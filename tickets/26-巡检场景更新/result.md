# ticket 26：剪辑 Reality 巡检结果

工作目录：D:/VibeCode/Henji-AI-t26；分支：task/26-巡检场景更新；基线：99fbf0b39。

仅修改 scripts/lib/uiInspection*.cjs，不推送、不合并、不切分支、不改依赖；Reality 使用隔离临时数据，不访问 D:/视频制作、不占用 9334。

## 准备状态

已读 AGENTS.md、docs/rules/testing.md 与参考提交 81a1a0d05。当前 out/ 不存在。原 electron:bundle 会写联接点（构建原生视频、音频、录音及 node_modules 锁），已请求确认采用本目录临时适配；确认前未运行构建。

## 逐场景结果

场景 id | 结果（通过/已修通/产品缺陷/跳过）| 说明 | 提交哈希
--- | --- | --- | ---


## 2026-11-02 继续执行

保留以上准备记录；现已按用户补充执行六步手动构建，不运行 electron:bundle。巡检缓存迁至当前工作目录 .ui-tour/cache；不推送、不合并、不切分支。

场景 id | 结果（通过/已修通/产品缺陷/跳过）| 说明 | 提交哈希
--- | --- | --- | ---
video-edit-agent-loop | 跳过 | 夹具固定依赖 D:/视频制作，且包含真实助手回环；按目录与账号限制不执行 | —
video-edit-creative-results | 跳过 | 夹具固定依赖 D:/视频制作；按目录禁令不执行 | —
video-edit-popout | 跳过 | 夹具固定依赖 D:/视频制作；按目录禁令不执行 | —
video-edit-dock-gestures | 跳过 | 与 popout 共用依赖 D:/视频制作 的夹具；按目录禁令不执行 | —
video-edit-performance | 跳过 | 标准负载固定依赖 D:/视频制作；不换素材冒充原性能证据 | —
video-edit-time-remap | 跳过 | 默认源文件位于 D:/视频制作；按目录禁令不执行 | —
video-edit-format-matrix | 跳过 | 完整矩阵读取 D:/视频制作/2026-09-19_Tripo/素材；按目录禁令不执行 | —
video-edit-music-remix | 跳过 | 场景要求联网下载节拍模型；按外网依赖规则跳过 | —
video-decode-native | 跳过 | 完整场景读取 D:/视频制作 的两份素材；按目录禁令不执行 | —
video-edit-media-probe | 跳过 | 完整场景读取 D:/视频制作 的 ProRes 4444 素材；按目录禁令不执行 | —
video-edit-engine-probe | 待修复 | 首次运行停在新建序列：脚本找确定，实际为新建；截图 .ui-tour/ticket26/video-edit-engine-probe/1440x900-video-edit-engine-probe-failed.png，已修共用入口待重跑 | —
video-edit-engine-probe | 待修复 | 第二次运行已通过序列创建，停在已移除的时间线文字按钮；已切换为命令带文字工具与节目画面就地输入，待重跑；截图 .ui-tour/ticket26/video-edit-engine-probe-r2/1440x900-video-edit-engine-probe-failed.png | —
video-edit-engine-probe | 待修复 | 第三次运行完成原生文字创建与七片段读回；拖放目标轨道被已有文字片段覆盖，已调整真实拖放定位与现有轨道，待重跑；截图 .ui-tour/ticket26/video-edit-engine-probe-r3/1440x900-video-edit-engine-probe-failed.png | —
video-edit-engine-probe | 待修复 | 第四次运行真实拖入与撤销均通过；MCP 合成写到默认序列不存在的第3、4轨，已显式创建独立画面轨并补接管，待重跑 | —
video-edit-engine-probe | 待修复 | 第五次运行 MCP 合成与接管撤销重做通过；旧 title 定位与旧点标注入口失效，已改为批注工具和评论钉，待重跑；截图 .ui-tour/ticket26/video-edit-engine-probe-r5/1440x900-video-edit-engine-probe-video-edit-composition.png | —
video-edit-engine-probe | 待修复 | 第六次运行批注创建、删除、撤销通过；文字片段在屏外被时间线虚拟化，已先滚到对应轨道再定位片段，待重跑；截图 .ui-tour/ticket26/video-edit-engine-probe-r6/1440x900-video-edit-engine-probe-failed.png | —
video-edit-timeline | 跳过 | 直接或间接复用 video-edit-scrub-original 的原4K60工程；该工程依赖本次禁止访问的 D:/视频制作，隔离缓存中没有前置夹具；不伪造原素材证据 | —
video-edit-monitor | 跳过 | 直接或间接复用 video-edit-scrub-original 的原4K60工程；该工程依赖本次禁止访问的 D:/视频制作，隔离缓存中没有前置夹具；不伪造原素材证据 | —
video-edit-picture-gesture | 跳过 | 直接或间接复用 video-edit-scrub-original 的原4K60工程；该工程依赖本次禁止访问的 D:/视频制作，隔离缓存中没有前置夹具；不伪造原素材证据 | —
video-edit-composite-edit | 跳过 | 直接或间接复用 video-edit-scrub-original 的原4K60工程；该工程依赖本次禁止访问的 D:/视频制作，隔离缓存中没有前置夹具；不伪造原素材证据 | —
video-edit-composite-pressure | 跳过 | 直接或间接复用 video-edit-scrub-original 的原4K60工程；该工程依赖本次禁止访问的 D:/视频制作，隔离缓存中没有前置夹具；不伪造原素材证据 | —
video-edit-mask | 跳过 | 直接或间接复用 video-edit-scrub-original 的原4K60工程；该工程依赖本次禁止访问的 D:/视频制作，隔离缓存中没有前置夹具；不伪造原素材证据 | —
video-edit-asset-references | 跳过 | 直接或间接复用 video-edit-scrub-original 的原4K60工程；该工程依赖本次禁止访问的 D:/视频制作，隔离缓存中没有前置夹具；不伪造原素材证据 | —
video-edit-outputs | 跳过 | 直接或间接复用 video-edit-scrub-original 的原4K60工程；该工程依赖本次禁止访问的 D:/视频制作，隔离缓存中没有前置夹具；不伪造原素材证据 | —
video-edit-code-assets | 跳过 | 直接或间接复用 video-edit-scrub-original 的原4K60工程；该工程依赖本次禁止访问的 D:/视频制作，隔离缓存中没有前置夹具；不伪造原素材证据 | —
video-edit-engine-probe | 待修复 | 第七次确认时间线已采用画面/声音分区自绘滚动，DOM scrollTop 无效；改用 Ctrl+滚轮滚动真实画面轨区，待重跑 | —
video-edit-engine-probe | 待修复 | 第八次通过批注、文字拖动修剪、MCP拆分与1080p实际导出；导出完成弹窗遮挡旧设置关闭按钮，已更新共用导出流程，待重跑；截图 .ui-tour/ticket26/video-edit-engine-probe-r8/1440x900-video-edit-engine-probe-failed.png | —
video-edit-engine-probe | 待修复 | 第九次1080p30导出像素/音频验证通过；切换1080p60时脚本沿用另一源文件的 assetContent 导致身份校验拒绝，已清夹具旧身份并同步帧率，待重跑 | —
video-edit-engine-probe | 待修复 | 第十次导出能力仍在异步探测时，旧等待条件误读隐藏提示并过早判断编码不可用；已限定可见错误语义，待重跑 | —
video-edit-engine-probe | 待修复 | 第十一次1080p30整套校验通过，第二规格效果控件停在溢出标签后；已通过窗口菜单显式置前效果控件，待重跑 | —
video-edit-engine-probe | 待修复 | 第十二次四规格导出与像素/音频校验全部通过；范围导出复用了记住的文件名，未落到旧 showSaveDialog 指定路径，已显式经导出界面设置文件名和目录，待重跑 | —
video-edit-engine-probe | 待修复 | 第十三次四规格与入出点范围导出全部通过；取消任务断言仍读已移除的 data.task，已改为按本次提交的 jobId 查 queue，待重跑 | —
video-edit-engine-probe | 待修复 | 第十四次取消请求已接收但查询仍是 running；取消清理是异步的，已改为按本次 jobId 等待终态；前半段已通过，稍后完整重跑 | —
video-edit-caption-track | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-caption-track/index.md；0 browser errors, 0 log errors | —
video-edit-caption-text | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-caption-text/index.md；0 browser errors, 0 log errors | —
video-edit-code-contract | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-code-contract/index.md；0 browser errors, 0 log errors | —
video-edit-composite-contract | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-composite-contract/index.md；0 browser errors, 0 log errors | —
video-edit-audio-link | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-audio-link/index.md；0 browser errors, 0 log errors | —
video-edit-composite-contract | 产品缺陷 | 正式构建内置 runVideoEditCompositeProbe 在图形准备时失败：文字外观 fontSize/align 仍写在 parameters；应写 text_style。定位 src/features/videoEdit/engine/videoEditCompositeProbe.ts 的夹具，超出允许脚本范围，未改产品代码；截图 .ui-tour/ticket26/video-edit-composite-contract/1440x900-video-edit-composite-contract-failed.png | —
video-edit-content-edit | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-content-edit/index.md；0 browser errors, 0 log errors | —
video-edit-code-ai | 通过 | 正式隔离 Electron 场景通过；.ui-tour/ticket26/video-edit-code-ai/index.md；0 browser errors, 0 log errors | c15c0947a
video-edit-project-source | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-project-source/index.md；0 browser errors, 0 log errors | —
video-edit-caption-track | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-caption-track/index.md；0 browser errors, 0 log errors | —
video-edit-caption-text | 通过 | 正式隔离 Electron 场景通过；.ui-tour/ticket26/video-edit-caption-text/index.md；0 browser errors, 0 log errors | c15c0947a
video-edit-code-contract | 通过 | 正式隔离 Electron 场景通过；.ui-tour/ticket26/video-edit-code-contract/index.md；0 browser errors, 0 log errors | c15c0947a
video-edit-audio-link | 通过 | 正式隔离 Electron 场景通过；.ui-tour/ticket26/video-edit-audio-link/index.md；0 browser errors, 0 log errors | c15c0947a
video-edit-content-edit | 通过 | 正式隔离 Electron 场景通过；.ui-tour/ticket26/video-edit-content-edit/index.md；0 browser errors, 0 log errors | c15c0947a
video-edit-caption-text | 已修通 | 点击字幕后验证当前效果控件；就地编辑与实际字幕像素通过；截图与日志 .ui-tour/ticket26/video-edit-caption-text/ | fe9ed65b4
video-edit-code-contract | 已修通 | 按正式会话现有返回验证热帧、确定性重放与异常恢复，移除退役 GPU 内部计数；截图与日志 .ui-tour/ticket26/video-edit-code-contract/ | fe9ed65b4
video-edit-audio-link | 已修通 | 删除入口更新为删除选区，8秒删到6秒并原位回填通过；截图与日志 .ui-tour/ticket26/video-edit-audio-link/ | fe9ed65b4
video-edit-content-edit | 已修通 | MCP 写入后先接管；整序列一步撤销重做、保存重开及局部观察通过；截图与日志 .ui-tour/ticket26/video-edit-content-edit/ | fe9ed65b4
video-edit-engine-probe | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-engine-probe/index.md；0 browser errors, 0 log errors | —
video-edit-engine-probe | 待修复 | 第十五次取消任务终态通过，随后关闭项目被导出已取消弹窗遮挡；已补完成按钮关闭终态弹窗，等待后续重跑 | —
video-edit-caption-track | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-caption-track/index.md；0 browser errors, 0 log errors | —
video-edit-project-source | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-project-source/index.md；0 browser errors, 0 log errors | —
video-edit-4k60-scrub | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-4k60-scrub/index.md；0 browser errors, 0 log errors | —
video-edit-first-frame | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-first-frame/index.md；0 browser errors, 0 log errors | —
video-edit-native-soak | 跳过 | 隔离缓存缺少 native-decode/prores422hq.mov；场景需默认60分钟曲线及原定4K60源，不读取主仓库缓存或伪造短测通过 | —
video-edit-tracking-stabilize | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-tracking-stabilize/index.md；0 browser errors, 0 log errors | —
video-edit-play-start | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-play-start/index.md；0 browser errors, 0 log errors | —
video-edit-filmstrip | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-filmstrip/index.md；0 browser errors, 0 log errors | —
video-edit-play-start | 产品缺陷 | 性能验收未达标：一轮暂停后起播231ms，场景原要求<150ms；保留阈值，未改产品。数据 .ui-tour/cache/video-edit-play-start/evidence.json；截图 .ui-tour/ticket26/video-edit-play-start/1440x900-video-edit-play-start-failed.png（结束时已离开剪辑）；本轮未区分产品退化与并行GPU负载影响 | —
video-edit-motion-draft | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-motion-draft/index.md；0 browser errors, 0 log errors | —
video-edit-explanation | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-explanation/index.md；0 browser errors, 0 log errors | —
video-edit-primitives | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-primitives/index.md；0 browser errors, 0 log errors | —
video-edit-annotation-relative | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-annotation-relative/index.md；0 browser errors, 0 log errors | —
video-edit-layout | 通过 | 正式隔离 Electron 场景通过；.ui-tour/ticket26/video-edit-layout/index.md；0 browser errors, 0 log errors | c15c0947a
video-edit-open-picture | 通过 | 正式隔离 Electron 场景通过；.ui-tour/ticket26/video-edit-open-picture/index.md；0 browser errors, 0 log errors | c15c0947a
video-edit-code-performance | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-code-performance/index.md；0 browser errors, 1 log errors | —
video-edit-observation-review | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-observation-review/index.md；0 browser errors, 0 log errors | —
video-edit-styles | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-styles/index.md；0 browser errors, 0 log errors | —
video-edit-style-memory | 通过 | 正式隔离 Electron 场景通过；.ui-tour/ticket26/video-edit-style-memory/index.md；0 browser errors, 0 log errors | c15c0947a
video-edit-code-project | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-code-project/index.md；0 browser errors, 0 log errors | —
video-edit-code-controls | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-code-controls/index.md；0 browser errors, 0 log errors | —
video-edit-web-source | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-web-source/index.md；0 browser errors, 0 log errors | —
video-edit-native-audio | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-native-audio/index.md；0 browser errors, 0 log errors | —
video-edit-high-precision | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-high-precision/index.md；0 browser errors, 0 log errors | —
video-edit-links | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-links/index.md；0 browser errors, 0 log errors | —
video-edit-multitrack | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-multitrack/index.md；0 browser errors, 0 log errors | —
video-edit-export-native | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-export-native/index.md；0 browser errors, 0 log errors | —
video-edit-native-faults | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-native-faults/index.md；0 browser errors, 1 log errors | —
video-edit-caption-track | 通过 | 正式隔离 Electron 场景通过；.ui-tour/ticket26/video-edit-caption-track/index.md；0 browser errors, 0 log errors | c15c0947a
video-edit-project-source | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-project-source/index.md；0 browser errors, 1 log errors | —
video-edit-caption-track | 已修通 | 置顶字幕轨、锁/输出按钮语义定位，显式打开字幕与标记面板并点击条目定位；.ui-tour/ticket26/video-edit-caption-track/index.md | df4d6e2ff
video-edit-layout | 已修通 | 窗口菜单开启停靠面板、面板菜单重置布局；.ui-tour/ticket26/video-edit-layout/index.md | df4d6e2ff
video-edit-style-memory | 已修通 | 风格标签溢出时通过窗口菜单置前；.ui-tour/ticket26/video-edit-style-memory/index.md | df4d6e2ff
video-edit-styles | 跳过 | 面板与导入已取证，导入外来风格包的代码执行返回 awaiting_user_confirmation；不替用户确认。截图 .ui-tour/ticket26/video-edit-styles/1440x900-video-edit-styles-failed.png | df4d6e2ff
video-edit-4k60-scrub | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-4k60-scrub/index.md；0 browser errors, 0 log errors | —
video-edit-first-frame | 通过 | 正式隔离 Electron 场景通过；.ui-tour/ticket26/video-edit-first-frame/index.md；0 browser errors, 0 log errors | c15c0947a
video-edit-tracking-stabilize | 通过 | 正式隔离 Electron 场景通过；.ui-tour/ticket26/video-edit-tracking-stabilize/index.md；0 browser errors, 0 log errors | c15c0947a
video-edit-web-source | 产品缺陷 | MCP 前后定位90→30→150，画布已回执150帧，像素时间条码却仍为1000ms（应5000ms）；疑似网页快照/帧缓存失效，未改产品。截图 .ui-tour/ticket26/video-edit-web-source/1440x900-video-edit-web-source-failed.png；原像素 .ui-tour/cache/video-edit-web-source/preview-2-150.png | —
video-edit-native-faults | 产品缺陷 | 服务缺失注入后已收到 unavailable，H.264播放55帧但后端日志仍为native/nativeAvailable=true；缺失回退断言不成立，尚未证明真实用到哪个后端。崩溃/导入失败/坏文件/预算恢复已越过。截图 .ui-tour/ticket26/video-edit-native-faults/1440x900-video-edit-native-faults-native-faults-failed.png | —
video-edit-4k60-scrub | 产品缺陷 | 更新缩放slider定位后完整跑至性能断言，cold-reverse画面更新2.8次/秒低于27；未放宽阈值，未排除其他会话GPU负载影响。截图 .ui-tour/ticket26/video-edit-4k60-scrub/1440x900-video-edit-4k60-scrub-failed.png | 待本批提交
video-edit-filmstrip | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-filmstrip/index.md；0 browser errors, 0 log errors | —
video-edit-first-frame | 已修通 | MCP写入后接管，首帧和多文件/多片段新序列计时回执及退出资源释放通过；.ui-tour/ticket26/video-edit-first-frame/index.md | d6a801868
video-edit-tracking-stabilize | 已修通 | 跟踪面板由窗口菜单置前，MCP后接管；跟踪/稳定像素与状态通过；.ui-tour/ticket26/video-edit-tracking-stabilize/index.md | d6a801868
video-edit-4k60-scrub | 产品缺陷 | 缩放定位修复提交d6a801868，性能证据同上，未放宽阈值 | d6a801868
video-edit-motion-draft | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-motion-draft/index.md；0 browser errors, 0 log errors | —
video-edit-explanation | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-explanation/index.md；0 browser errors, 0 log errors | —
video-edit-primitives | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-primitives/index.md；0 browser errors, 0 log errors | —
video-edit-annotation-relative | 通过 | 正式隔离 Electron 场景通过；.ui-tour/ticket26/video-edit-annotation-relative/index.md；0 browser errors, 0 log errors | c15c0947a
video-edit-code-performance | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-code-performance/index.md；0 browser errors, 1 log errors | —
video-edit-observation-review | 待分析 | 失败待截图分类；.ui-tour/ticket26/video-edit-observation-review/index.md；0 browser errors, 0 log errors | —

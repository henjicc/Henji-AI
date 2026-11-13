# 录屏：录制、恢复与进剪辑

> 何时读：要录屏幕或窗口、查看录制进度、录制中断后恢复、把录好的会话放进剪辑，或用录制时的鼠标键盘事件做推近、跟踪时读。

## 开始前

1. 用 `list_application_entities` 列 `screen_recording.source`（显示器与窗口），按名称选来源；不猜引用。需要指定麦克风或摄像头时再列 `screen_recording.device`，省略设备标识就用系统默认设备。
2. 分辨率（width 与 height 一起）、帧率和 tracks 省略时，跟随用户在录屏设置里保存的值，与他在录屏页点“开始录制”得到的一样；用户这次另有要求才显式给。只给 tracks 时只录写明的轨道。region 是显示器上的比例区域（0–1），窗口不能裁区。
3. tracks 里 microphone 录人声、systemAudio 录电脑里的声音、camera 录摄像头。
   - 系统声音：Windows 上由原生录音服务在后台录整个系统混音（默认输出设备，切换输出设备会跟着换，也包括痕迹AI自己发出的声音），不经过界面，界面重载、卡顿都不断；没声音播放时补静音，时间轴照样连续。macOS 上仍由界面采集，界面重载那一下会有空档。
   - 麦克风同一时间只给一处用：音频编辑正在录音时，省略 tracks 的录屏会自动不开麦克风并在回执里说明，tracks 里显式写 microphone 会被拒绝。音频编辑的录音助手也能直接控制（start_audio_edit_recording、stop_audio_edit_recording 等，状态读 audio_capture.settings.recording），录口播用那一组，不必为了录人声去开录屏。
   - 首次使用屏幕、麦克风或摄像头要用户在系统弹窗里允许，录屏本身不收费。
4. 要录完直接进某个剪辑，开始时就给 destination（documentId 为剪辑文档 ID，可加 sequenceId 与 frame）；录制始终绑定这个目标，用户中途切页面也不会改投别处。只想先录下来就省略，之后再导入。

## 录制中

- `start_screen_recording` 返回会话引用后先倒计时再开始，录制在后台进行，切页面不会中断。之后用 `read_application_entity` 读 `screen_recording.session` 的 phase（countdown、recording、paused、stopping、stopped、failed）与 elapsed_ms（已录毫秒）判断进度；details 里有画面与声音分片、标记数、事件数和所用设备。
- `pause_screen_recording` / `resume_screen_recording` 暂停与继续全部轨道，暂停的空档如实保留，不拼接成连续时间。
- 用户说“这里记一下”时用 `mark_screen_recording`，可带 note；标记之后可按 markersOnly 单独读回。
- `stop_screen_recording` 停止全部轨道，等画面、声音、事件与会话都保存好才返回；开始时给了剪辑目标的，会接着导入。它最多等约 45 秒：长录制收尾（拼接声音、导入）没做完时先返回 finishing=true，收尾照常进行；不要再发一次停止；之后读会话 details，finishing 变回 false 后 details.error 有值就是失败（写着原因），没有、phase 为 stopped 就算完成。`recover_screen_recording`、`import_screen_recording` 同样最多等约 45 秒，没做完返回 finishing=true（导入时 itemIds 为空），照常在后台进行，成败同样看 finishing 变回 false 后的 details.error。
- `cancel_screen_recording` 中止录制并释放设备与输入钩子；已经封存的片段不会删，之后仍可恢复。

## 中断后的恢复

- 界面重载或界面进程崩溃不停录：画面、鼠标键盘事件和 Windows 上的系统声音照常录，界面回来后自动接上；麦克风与摄像头在断开那一两秒没有数据，记成缺数据空档。
- 画面编码进程意外退出会自动续录（details.capture.video.encoderRestarts 加一，那一处画面留空一两秒）；一分钟内反复退出才按失败停下。
- 应用整个崩溃或被强制结束：下次启动时自动补齐上次没收尾的录制，phase 变成 interrupted，details.capture.recovered 为 true，可以直接导入剪辑。仍停在 recording、paused 的会话，或从别处拿到的中断录制，用 `recover_screen_recording` 检查已落盘的分片与事件页、补齐没封口的声音分段并拼接声音；它不会重新打开设备，也不会重放操作。
- 恢复后的会话与正常停止的一样可以导入剪辑；没能恢复的时段在 details.tracks 里按缺数据空档列出，告诉用户缺了哪一段，不要声称完整。

## 录完进剪辑

- 直接放素材：`import_screen_recording` 给 sessionRef 与 destination。给 sequenceId 时各轨按录制时的同一时钟对齐放到 frame 处，暂停与缺帧的空档保留；只给 documentId 就只进素材库。引用原片、不复制文件，一步撤销。
- 一键成片：`generate_screen_recording_movie` 把会话生成到目标剪辑里一条未锁定的空序列（可同时出竖版、方版），recipe 控制剪停顿与语气词、等待加速、推近、光标、字幕、标题、章节、摄像头与响度，整批一步撤销。字幕要先有文字稿：先用 `understand_screen_recording`（默认免费，开启转写才付费）分析出步骤、章节、停顿、等待与失误候选，候选只供审阅，不会剪原片。
- 录到了密码、手机号、密钥一类内容：用 `detect_screen_recording_sensitive_text` 在本机找出待打码的候选，确认后才生效；快速滚动、闪现、低清文字仍要人工看一遍。

## 鼠标键盘事件怎么用

录制时同步记下光标、点击、滚动、按键类别（打字、复制粘贴、快捷键等，不记具体打了什么字）、前台窗口位置和标记。`read_screen_recording_events` 按 offset 分页读，按返回的 nextOffset 续读到 null；暂停期间没有事件。

- 注意力推近：`generate_video_edit_screen_attention` 按这些事件给屏幕片段自动推近并跟着关注区域走（持续打字、点击、滚动、光标停留、窗口切换），没有信号时平滑退回全景；strength 选轻、中、强，可按段落指定力度，生成的位置与缩放关键帧之后都能改，人改过的重算时保留。
- 跟踪：`track_video_edit_recording` 直接用录制时的光标或前台窗口建跟踪器（精确，不做视觉跟踪）。target=cursor 跟鼠标，target=window 跟某一刻的前台窗口或其中一块区域；之后用 `follow_video_edit_tracker` 让箭头、圈注跟着走，或把跟踪器当效果的作用区域做打码、模糊、放大。
- 选镜头与复核：用标记和窗口切换找段落起止，再用 `query_video_edit_review` 看推近后的画面与节奏。事件只说明发生了什么，景别和停留仍按口播与内容判断。

## 长录事实怎么读回

`read_application_entity` 读 `screen_recording.session` 的 details：

- tracks：每路声音与摄像头的分段数、空档按原因计数（pause 暂停、device 设备断开、muted 静音、missingData 缺数据）、missingSeconds（缺数据与设备断开的总秒数，暂停不算）和提示（system-audio-silent 一直没听到系统声、system-audio-unavailable 系统声采不到）。录制中是实时的，停止后来自录制文档，应用重启后仍在。
- capture：本次运行内的采集计数，应用重启后为 null。null（整体或某一项）表示不知道，不等于没有丢帧或空档，汇报时如实说“没有这项记录”。video 是丢帧、重复帧与编码续录次数；systemAudio 是没声音补的静音秒数、设备不可用补的静音秒数、写盘跟不上丢的帧（已补等长静音）、设备切换与重连次数；microphone 是驱动溢出与欠载、写盘丢的帧（已补静音）、来不及送到轨道的块（停止时尽量用整段副本补回）与重连次数；detaches 是界面断开次数；failure 是采集出错的原因（用户取消不算）。
- error：采集出错的原因，以及停止收尾、恢复、导入在后台失败的原因；finishing 见“录制中”。

向用户汇报长录结果时，有空档、丢帧或续录就如实说出位置和时长，不要只说“录好了”。

## 长录注意

- 录前确认资料盘空间够；长录制的分片会不断写入，停止与导入都比短录制慢。
- 事件很多时分页读，或只读标记（markersOnly），不要整份读进上下文。
- 录制中切工作区不会停止录制，回来重新读会话 phase 即可。

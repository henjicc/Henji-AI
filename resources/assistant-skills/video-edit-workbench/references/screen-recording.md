# 录屏：录制、恢复与进剪辑

> 何时读：要录屏幕或窗口、查看录制进度、录制中断后恢复、把录好的会话放进剪辑，或用录制时的鼠标键盘事件做推近、跟踪时读。

## 开始前

1. 用 `list_application_entities` 列 `screen_recording.source`（显示器与窗口），按名称选来源；不猜引用。需要指定麦克风或摄像头时再列 `screen_recording.device`，省略设备标识就用系统默认设备。
2. 分辨率、帧率和要不要录声音按用户的要求显式给出；用户没说时按他平时的习惯给（以本次对话、记忆和已有录屏素材为准），不要依赖省略参数时的默认值。region 是显示器上的比例区域（0–1），窗口不能裁区。
3. tracks 里 microphone 录人声、systemAudio 录电脑里的声音、camera 录摄像头。麦克风同一时间只给一处用：音频编辑正在录音时，录屏不要再开 microphone。首次使用屏幕、麦克风或摄像头要用户在系统弹窗里允许，录屏本身不收费。
4. 要录完直接进某个剪辑，开始时就给 destination（documentId 为剪辑文档 ID，可加 sequenceId 与 frame）；录制始终绑定这个目标，用户中途切页面也不会改投别处。只想先录下来就省略，之后再导入。

## 录制中

- `start_screen_recording` 返回会话引用后先倒计时再开始，录制在后台进行，切页面不会中断。之后用 `read_application_entity` 读 `screen_recording.session` 的 phase（countdown、recording、paused、stopping、stopped、failed）与 elapsed_ms（已录毫秒）判断进度；details 里有画面与声音分片、标记数、事件数和所用设备。
- `pause_screen_recording` / `resume_screen_recording` 暂停与继续全部轨道，暂停的空档如实保留，不拼接成连续时间。
- 用户说“这里记一下”时用 `mark_screen_recording`，可带 note；标记之后可按 markersOnly 单独读回。
- `stop_screen_recording` 停止全部轨道，等画面、声音、事件与会话都保存好才返回；开始时给了剪辑目标的，会接着导入。长录制停止要拼接与整理较久：调用等不到结果时先读会话 phase，到了 stopped 就算完成，不要再发一次停止；外部助手可用 `get_application_operation` 查原操作。
- `cancel_screen_recording` 中止录制并释放设备与输入钩子；已经封存的片段不会删，之后仍可恢复。

## 中断后的恢复

软件退出、崩溃或设备出错后，会话读到的 phase 是 interrupted 或 failed。用 `recover_screen_recording` 检查已落盘的分片与事件页，恢复能播放的部分；它不会重新打开设备，也不会重放操作。恢复后的会话与正常停止的一样可以导入剪辑；没能恢复的时段按空档保留，告诉用户缺了哪一段，不要声称完整。

## 录完进剪辑

- 直接放素材：`import_screen_recording` 给 sessionRef 与 destination。给 sequenceId 时各轨按录制时的同一时钟对齐放到 frame 处，暂停与缺帧的空档保留；只给 documentId 就只进素材库。引用原片、不复制文件，一步撤销。
- 一键成片：`generate_screen_recording_movie` 把会话生成到目标剪辑里一条未锁定的空序列（可同时出竖版、方版），recipe 控制剪停顿与语气词、等待加速、推近、光标、字幕、标题、章节、摄像头与响度，整批一步撤销。字幕要先有文字稿：先用 `understand_screen_recording`（默认免费，开启转写才付费）分析出步骤、章节、停顿、等待与失误候选，候选只供审阅，不会剪原片。
- 录到了密码、手机号、密钥一类内容：用 `detect_screen_recording_sensitive_text` 在本机找出待打码的候选，确认后才生效；快速滚动、闪现、低清文字仍要人工看一遍。

## 鼠标键盘事件怎么用

录制时同步记下光标、点击、滚动、按键类别（打字、复制粘贴、快捷键等，不记具体打了什么字）、前台窗口位置和标记。`read_screen_recording_events` 按 offset 分页读，按返回的 nextOffset 续读到 null；暂停期间没有事件。

- 注意力推近：`generate_video_edit_screen_attention` 按这些事件给屏幕片段自动推近并跟着关注区域走（持续打字、点击、滚动、光标停留、窗口切换），没有信号时平滑退回全景；strength 选轻、中、强，可按段落指定力度，生成的位置与缩放关键帧之后都能改，人改过的重算时保留。
- 跟踪：`track_video_edit_recording` 直接用录制时的光标或前台窗口建跟踪器（精确，不做视觉跟踪）。target=cursor 跟鼠标，target=window 跟某一刻的前台窗口或其中一块区域；之后用 `follow_video_edit_tracker` 让箭头、圈注跟着走，或把跟踪器当效果的作用区域做打码、模糊、放大。
- 选镜头与复核：用标记和窗口切换找段落起止，再用 `query_video_edit_review` 看推近后的画面与节奏。事件只说明发生了什么，景别和停留仍按口播与内容判断。

## 长录注意

- 录前确认资料盘空间够；长录制的分片会不断写入，停止与导入都比短录制慢。
- 事件很多时分页读，或只读标记（markersOnly），不要整份读进上下文。
- 录制中切工作区不会停止录制，回来重新读会话 phase 即可。

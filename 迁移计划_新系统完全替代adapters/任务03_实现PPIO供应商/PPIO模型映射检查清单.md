# PPIO模型映射检查清单

## 已完成 ✅

### Kling 2.6 Pro ✅
- [x] ppioKling26Mode → mode
- [x] ppioKling26VideoDuration → duration
- [x] ppioKling26AspectRatio → aspect_ratio
- [x] ppioKling26CfgScale → cfg_scale
- [x] ppioKling26Sound → sound
- [x] ppioKling26CharacterOrientation → character_orientation
- [x] ppioKling26KeepOriginalSound → keep_original_sound

### Kling O1 ✅
- [x] ppioKlingO1Mode → mode
- [x] ppioKlingO1VideoDuration → duration
- [x] ppioKlingO1AspectRatio → aspectRatio
- [x] ppioKlingO1KeepAudio → keepAudio
- [x] ppioKlingO1FastMode → fastMode

### Wan 2.6 ✅
- [x] ppioWan26Mode → mode
- [x] ppioWan26AspectRatio → aspect_ratio
- [x] ppioWan26Quality → quality
- [x] ppioWan26VideoDuration → duration
- [x] ppioWan26ShotType → shot_type
- [x] ppioWan26Audio → audio
- [x] ppioWan26PromptExtend → prompt_extend

### Kling 2.5 Turbo ✅
- [x] ppioKling25TurboDuration → duration
- [x] ppioKling25TurboAspectRatio → aspect_ratio
- [x] ppioKling25TurboCfgScale → cfg_scale
- [x] ppioKling25TurboMode → mode
- [x] ppioKling25TurboNegativePrompt → negative_prompt

### Vidu Q1 ✅
- [x] ppioViduQ1Mode → mode
- [x] ppioViduQ1AspectRatio → aspectRatio
- [x] ppioViduQ1Style → style
- [x] ppioViduQ1MovementAmplitude → movementAmplitude
- [x] ppioViduQ1Bgm → bgm

### Minimax Hailuo 2.3 ✅
- [x] ppioHailuo23VideoDuration → duration
- [x] ppioHailuo23VideoResolution → resolution
- [x] ppioHailuo23EnablePromptExpansion → enable_prompt_expansion
- [x] ppioHailuo23FastMode → fast_mode

### Minimax Hailuo 02 ✅
- [x] falHailuo02Duration → duration
- [x] falHailuo02Resolution → resolution
- [x] falHailuo02PromptOptimizer → enable_prompt_expansion
- [x] falHailuo02FastMode → fast_mode

### Pixverse V4.5 ✅
- [x] ppioPixverse45VideoAspectRatio → aspect_ratio
- [x] ppioPixverse45VideoResolution → resolution
- [x] ppioPixverse45FastMode → fast_mode
- [x] ppioPixverse45NegativePrompt → negative_prompt

### Wan 2.5 Preview ✅
- [x] ppioWan25VideoDuration → duration
- [x] ppioWan25Size → size
- [x] falWan25Resolution → resolution
- [x] ppioWan25PromptExtend → prompt_extend
- [x] ppioWan25Audio → audio
- [x] ppioWan25NegativePrompt → negative_prompt

### Seedance V1 ✅
- [x] ppioSeedanceV1Variant → variant
- [x] ppioSeedanceV1Resolution → resolution
- [x] ppioSeedanceV1AspectRatio → aspect_ratio
- [x] ppioSeedanceV1VideoDuration → duration
- [x] ppioSeedanceV1CameraFixed → camera_fixed

### Seedance 1.5 Pro ✅
- [x] ppioSeedance15ProAspectRatio → aspect_ratio
- [x] ppioSeedance15ProResolution → resolution
- [x] ppioSeedance15ProDuration → duration
- [x] ppioSeedance15ProGenerateAudio → generate_audio
- [x] ppioSeedance15ProCameraFixed → camera_fixed
- [x] ppioSeedance15ProServiceTier → service_tier

### Seedream 4.0 ✅
- [x] 使用 request.builder 处理复杂参数转换（复合面板）
- [x] 不需要简单的 apiField 映射

### Seedream 4.5 ✅
- [x] 使用 request.builder 处理复杂参数转换（复合面板）
- [x] 不需要简单的 apiField 映射

### Minimax Speech 2.6 ✅
- [x] minimaxAudioSpec → spec
- [x] minimaxVoiceId → voice_id
- [x] minimaxAudioSpeed → speed
- [x] minimaxAudioEmotion → emotion
- [x] minimaxAudioVol → vol
- [x] minimaxAudioPitch → pitch
- [x] minimaxAudioSampleRate → sample_rate
- [x] minimaxAudioBitrate → bitrate
- [x] minimaxAudioFormat → format
- [x] minimaxAudioChannel → channel

## 进度统计
- 已完成：14/14 (100%) ✅
- 待修复：0/14 (0%)

## 总结
所有 PPIO 模型的 apiField 映射已全部完成！

### 修复的文件列表：
1. ✅ kling-2.6-pro.model.ts（已有映射）
2. ✅ kling-o1.model.ts（已有映射）
3. ✅ wan-2.6.model.ts
4. ✅ kling-2.5-turbo.model.ts
5. ✅ vidu-q1.model.ts
6. ✅ minimax-hailuo-2.3.model.ts
7. ✅ minimax-hailuo-02.model.ts
8. ✅ pixverse-v4.5.model.ts
9. ✅ wan-2.5-preview.model.ts
10. ✅ seedance-v1.model.ts
11. ✅ seedance-1.5-pro.model.ts
12. ✅ seedream-4.0.model.ts（使用 request.builder）
13. ✅ seedream-4.5.model.ts（使用 request.builder）
14. ✅ minimax-speech-2.6.model.ts

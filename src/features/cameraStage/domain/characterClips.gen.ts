/**
 * 自动生成文件，禁止手改：npm run gen:camera-stage-clips（scripts/generate-camera-stage-clips.mjs）
 * 数据来源：resources/camera-stage/UAL1_Standard.glb（Quaternius Universal Animation Library，CC0）
 * duration 秒；loop 循环片段；groundSpeed 原地走跑片段按原速播放时对应的前进速度（米/秒，模型原尺寸）；
 * leftStrikePhase 左脚掌刚着地的时刻占周期的比例。
 */
export interface CharacterClipFacts {
  duration: number
  loop: boolean
  groundSpeed?: number
  leftStrikePhase?: number
}

export const CHARACTER_CLIP_FACTS: Record<string, CharacterClipFacts> = {
  "A_TPose": {
    "duration": 2.5,
    "loop": false
  },
  "Crouch_Fwd_Loop": {
    "duration": 2,
    "loop": true,
    "groundSpeed": 0.717,
    "leftStrikePhase": 0.983
  },
  "Crouch_Idle_Loop": {
    "duration": 2.933,
    "loop": true
  },
  "Dance_Loop": {
    "duration": 1,
    "loop": true
  },
  "Death01": {
    "duration": 2.4,
    "loop": false
  },
  "Driving_Loop": {
    "duration": 1.667,
    "loop": true
  },
  "Fixing_Kneeling": {
    "duration": 5.2,
    "loop": false
  },
  "Hit_Chest": {
    "duration": 0.333,
    "loop": false
  },
  "Hit_Head": {
    "duration": 0.433,
    "loop": false
  },
  "Idle_Loop": {
    "duration": 2.5,
    "loop": true
  },
  "Idle_Talking_Loop": {
    "duration": 2.933,
    "loop": true
  },
  "Idle_Torch_Loop": {
    "duration": 1.267,
    "loop": true
  },
  "Interact": {
    "duration": 2,
    "loop": false
  },
  "Jog_Fwd_Loop": {
    "duration": 0.933,
    "loop": true,
    "groundSpeed": 5.907,
    "leftStrikePhase": 0.058
  },
  "Jump_Land": {
    "duration": 1.267,
    "loop": false
  },
  "Jump_Loop": {
    "duration": 2.5,
    "loop": true
  },
  "Jump_Start": {
    "duration": 1.333,
    "loop": false
  },
  "PickUp_Table": {
    "duration": 0.833,
    "loop": false
  },
  "Pistol_Aim_Down": {
    "duration": 0.167,
    "loop": false
  },
  "Pistol_Aim_Neutral": {
    "duration": 0.167,
    "loop": false
  },
  "Pistol_Aim_Up": {
    "duration": 0.167,
    "loop": false
  },
  "Pistol_Idle_Loop": {
    "duration": 1.667,
    "loop": true
  },
  "Pistol_Reload": {
    "duration": 1.667,
    "loop": false
  },
  "Pistol_Shoot": {
    "duration": 0.633,
    "loop": false
  },
  "Punch_Cross": {
    "duration": 1,
    "loop": false
  },
  "Punch_Jab": {
    "duration": 0.867,
    "loop": false
  },
  "Push_Loop": {
    "duration": 2.667,
    "loop": true
  },
  "Roll": {
    "duration": 1.467,
    "loop": false
  },
  "Sitting_Enter": {
    "duration": 1.3,
    "loop": false
  },
  "Sitting_Exit": {
    "duration": 1.033,
    "loop": false
  },
  "Sitting_Idle_Loop": {
    "duration": 1.667,
    "loop": true
  },
  "Sitting_Talking_Loop": {
    "duration": 2.933,
    "loop": true
  },
  "Spell_Simple_Enter": {
    "duration": 0.533,
    "loop": false
  },
  "Spell_Simple_Exit": {
    "duration": 0.433,
    "loop": false
  },
  "Spell_Simple_Idle_Loop": {
    "duration": 2.1,
    "loop": true
  },
  "Spell_Simple_Shoot": {
    "duration": 0.5,
    "loop": false
  },
  "Sprint_Loop": {
    "duration": 0.667,
    "loop": true,
    "groundSpeed": 8.95,
    "leftStrikePhase": 0.16
  },
  "Swim_Fwd_Loop": {
    "duration": 1.333,
    "loop": true
  },
  "Swim_Idle_Loop": {
    "duration": 3.333,
    "loop": true
  },
  "Sword_Attack": {
    "duration": 1.533,
    "loop": false
  },
  "Sword_Idle": {
    "duration": 1.667,
    "loop": true
  },
  "Walk_Formal_Loop": {
    "duration": 1.333,
    "loop": true,
    "groundSpeed": 0.979,
    "leftStrikePhase": 0.09
  },
  "Walk_Loop": {
    "duration": 1.333,
    "loop": true,
    "groundSpeed": 0.979,
    "leftStrikePhase": 0.09
  }
}

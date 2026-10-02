//! 时间口径（与浏览器后端 mediabunny 一致，规则见 1.3 设计“时间口径”）：
//!
//! - 帧身份 `ptsUs = trunc(pts · num · 1e6 / den)`，整数运算、向零取整（mediabunny `microsecondTimestamp`）；
//! - 不减流或容器的起始时间（FFmpeg 与 mediabunny 都已应用 MP4 编辑列表、都保留 TS 原始 PTS）；
//! - 请求时间 t（秒）换算为刻度 `x = t · den / num`，“几乎整数”取整，否则向下取整；
//!   所选帧 = 呈现时间刻度 ≤ x 的最后一帧（mediabunny `getPacket(t)` 的语义）。

/// FFmpeg 时间基（num/den 秒）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TimeBase {
    pub num: i32,
    pub den: i32,
}

impl TimeBase {
    pub fn is_valid(self) -> bool {
        self.num > 0 && self.den > 0
    }
}

/// 刻度 → 微秒（向零取整）。
pub fn pts_to_us(pts: i64, base: TimeBase) -> i64 {
    let value = pts as i128 * base.num as i128 * 1_000_000 / base.den as i128;
    value.clamp(i64::MIN as i128, i64::MAX as i128) as i64
}

/// 刻度 → 秒（与 mediabunny `timestamp` 相同的浮点值）。
pub fn pts_to_seconds(pts: i64, base: TimeBase) -> f64 {
    pts as f64 * base.num as f64 / base.den as f64
}

/// mediabunny `roundIfAlmostInteger`：相对误差小于 10ε 时视为整数。
fn round_if_almost_integer(value: f64) -> f64 {
    let rounded = value.round();
    if rounded != 0.0 && (value / rounded - 1.0).abs() < 10.0 * f64::EPSILON {
        rounded
    } else if rounded == 0.0 && value.abs() < 10.0 * f64::EPSILON {
        0.0
    } else {
        value
    }
}

/// 请求时间（秒）→ 可比较的最大刻度：帧刻度 `pts ≤ ticks` 即“呈现时间不晚于请求时间”。
pub fn seconds_to_ticks(seconds: f64, base: TimeBase) -> i64 {
    let value = round_if_almost_integer(seconds * base.den as f64 / base.num as f64);
    if !value.is_finite() {
        return if value > 0.0 { i64::MAX } else { i64::MIN };
    }
    value.floor() as i64
}

/// 刻度换算到另一时间基（用于把秒级回退量换成流刻度）。
pub fn seconds_to_duration_ticks(seconds: f64, base: TimeBase) -> i64 {
    (seconds * base.den as f64 / base.num as f64).round() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    const MP4_60: TimeBase = TimeBase { num: 1, den: 15360 };
    const TS: TimeBase = TimeBase { num: 1, den: 90000 };
    const NTSC: TimeBase = TimeBase { num: 1, den: 30000 };

    /// mediabunny 的浮点算法，作为对照。
    fn mediabunny_us(pts: i64, base: TimeBase) -> i64 {
        let seconds = pts as f64 * base.num as f64 / base.den as f64;
        (1e6 * (1.0 + f64::EPSILON) * seconds).trunc() as i64
    }

    #[test]
    fn microseconds_match_mediabunny() {
        for (base, step) in [(MP4_60, 256), (TS, 1501), (NTSC, 1001), (TimeBase { num: 1, den: 600 }, 10), (TimeBase { num: 1, den: 24000 }, 1001), (TimeBase { num: 1001, den: 30000 }, 1)] {
            for index in -5i64..5000 {
                let pts = index * step;
                assert_eq!(pts_to_us(pts, base), mediabunny_us(pts, base), "{base:?} pts={pts}");
            }
        }
        assert_eq!(pts_to_us(256, MP4_60), 16666);
        assert_eq!(pts_to_us(-256, MP4_60), -16666, "负值向零取整");
        assert_eq!(pts_to_us(48003, TS), 533366);
    }

    #[test]
    fn request_seconds_map_to_ticks() {
        // 60fps 素材：第 n 帧的秒值换回刻度应正好是该帧刻度。
        for frame in 0..10_000i64 {
            assert_eq!(seconds_to_ticks(frame as f64 / 60.0, MP4_60), frame * 256);
        }
        // 29.97：秒值 k·1001/30000 应正好落在 k·1001。
        for frame in 0..10_000i64 {
            assert_eq!(seconds_to_ticks(frame as f64 * 1001.0 / 30000.0, NTSC), frame * 1001);
        }
        // 两帧之间取前一帧。
        assert_eq!(seconds_to_ticks(0.0251, MP4_60), 385);
        assert_eq!(seconds_to_ticks(-0.5, MP4_60), -7680);
        assert_eq!(seconds_to_ticks(0.0, TS), 0);
    }

    #[test]
    fn seconds_round_trip() {
        assert!((pts_to_seconds(48003, TS) - 0.533366666).abs() < 1e-8);
        assert_eq!(seconds_to_duration_ticks(1.0, TS), 90000);
    }
}

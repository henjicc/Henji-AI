//! 声音会话的时间与网格换算（纯函数，2.3）。
//!
//! 输出网格：输出样本 n 在源绝对时间轴的 n / 输出采样率 秒（与渲染层 `VideoEditPcmSession` 契约一致）。
//! 重采样器（libswresample + libsoxr）把第一个送入的输入样本对齐到第一个输出样本（实测无额外延迟），
//! 所以每段从输入样本 m0 开始送入、m0 取对齐周期 L = 输入采样率 / gcd(输入, 输出) 的整数倍时，
//! 输出样本 n0 = m0 × 输出 / 输入 恰为整数，输出网格与绝对网格精确重合。

use crate::decode::timing::TimeBase;

pub fn gcd(mut left: u64, mut right: u64) -> u64 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left
}

fn floor_div(numerator: i128, denominator: i128) -> i128 {
    let quotient = numerator / denominator;
    if (numerator % denominator != 0) && ((numerator < 0) != (denominator < 0)) {
        quotient - 1
    } else {
        quotient
    }
}

/// 一段解码的起点：输入样本 `m0`（对齐周期的整数倍，且至少比目标早 `preroll` 个输入样本，用于解码器与滤波器预热）
/// 与它对应的输出样本 `n0`。
pub fn segment_start(target_out: i64, in_rate: u32, out_rate: u32, preroll: i64) -> (i64, i64) {
    let divisor = gcd(in_rate as u64, out_rate as u64) as i128;
    let period_in = in_rate as i128 / divisor;
    let period_out = out_rate as i128 / divisor;
    let target_in = floor_div(target_out as i128 * in_rate as i128, out_rate as i128);
    let periods = floor_div(target_in - preroll as i128, period_in);
    ((periods * period_in) as i64, (periods * period_out) as i64)
}

/// 呈现时间（流时间基刻度）对应的输入样本序号，四舍五入到最近的样本。
pub fn sample_index(pts: i64, time_base: TimeBase, rate: u32) -> i64 {
    let numerator = pts as i128 * time_base.num as i128 * rate as i128;
    let denominator = time_base.den as i128;
    floor_div(2 * numerator + denominator, 2 * denominator) as i64
}

/// 新解出的一帧相对预期位置的落位。
#[derive(Debug, PartialEq, Eq)]
pub enum Placement {
    /// 与预期相差不超过容差：按样本数连续累加（不因时间戳舍入抖动而插入或丢弃样本）。
    Contiguous,
    /// 帧晚于预期：中间是缺口，补这么多个零样本。
    Gap(i64),
    /// 帧早于预期：与已送入的样本重叠，丢弃帧开头这么多个样本。
    Overlap(i64),
}

pub fn place(frame_index: i64, expected: i64, tolerance: i64) -> Placement {
    let offset = frame_index - expected;
    if offset.abs() <= tolerance {
        Placement::Contiguous
    } else if offset > 0 {
        Placement::Gap(offset)
    } else {
        Placement::Overlap(-offset)
    }
}

/// 一次读取 [start, start + frames) 该续解还是重新定位。
#[derive(Debug, PartialEq, Eq)]
pub enum ReadPlan {
    /// 已有样本覆盖起点、或起点在已解位置之后 `ahead` 个样本以内：继续当前段。
    Continue,
    Restart,
}

pub fn read_plan(start: i64, buffer_start: Option<i64>, decoded_end: i64, ahead: i64) -> ReadPlan {
    match buffer_start {
        Some(buffered) if start >= buffered && start <= decoded_end + ahead => ReadPlan::Continue,
        _ => ReadPlan::Restart,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segment_start_aligns_to_the_absolute_output_grid() {
        // 44.1k → 48k：对齐周期 147 个输入样本 ↔ 160 个输出样本。
        for target in [0i64, 1, 47_999, 48_000, 1_234_567, 99_999_999] {
            let (m0, n0) = segment_start(target, 44_100, 48_000, 8192);
            assert_eq!(m0 % 147, 0);
            assert_eq!(n0 * 147, m0 * 160, "输出起点与输入起点对应同一时刻");
            let target_in = target as i128 * 44_100 / 48_000;
            assert!((m0 as i128) <= target_in - 8192 && (m0 as i128) > target_in - 8192 - 147);
            assert!(n0 <= target);
        }
        // 同采样率：周期 1，n0 = m0。
        assert_eq!(segment_start(100_000, 48_000, 48_000, 8192), (91_808, 91_808));
        // 96k → 48k：周期 2 ↔ 1；负起点照常（流开始前补零）。
        let (m0, n0) = segment_start(0, 96_000, 48_000, 8192);
        assert_eq!((m0, n0), (-8192, -4096));
        // 不常见的采样率：周期很长也保持整除。
        let (m0, n0) = segment_start(5_000_000, 44_056, 48_000, 8192);
        let divisor = gcd(44_056, 48_000) as i64;
        assert_eq!(m0 % (44_056 / divisor), 0);
        assert_eq!(n0 * 44_056, m0 * 48_000);
    }

    #[test]
    fn sample_index_rounds_to_nearest() {
        let base = TimeBase { num: 1, den: 90_000 };
        // MPEG 节目流起点 0.523s：0.523 × 48000 = 25104。
        assert_eq!(sample_index(47_070, base, 48_000), 25_104);
        assert_eq!(sample_index(0, TimeBase { num: 1, den: 44_100 }, 44_100), 0);
        assert_eq!(sample_index(1024, TimeBase { num: 1, den: 44_100 }, 44_100), 1024);
        assert_eq!(sample_index(-1024, TimeBase { num: 1, den: 44_100 }, 44_100), -1024);
        // 1 / 1000 时间基的 1ms 在 44.1k 下是 44.1 个样本 → 44。
        assert_eq!(sample_index(1, TimeBase { num: 1, den: 1000 }, 44_100), 44);
        assert_eq!(sample_index(3, TimeBase { num: 1, den: 2000 }, 1000), 2);
    }

    #[test]
    fn placement_tolerates_rounding_and_detects_gaps_and_overlaps() {
        assert_eq!(place(1000, 1000, 48), Placement::Contiguous);
        assert_eq!(place(1047, 1000, 48), Placement::Contiguous);
        assert_eq!(place(1100, 1000, 48), Placement::Gap(100));
        assert_eq!(place(900, 1000, 48), Placement::Overlap(100));
    }

    #[test]
    fn read_plan_continues_adjacent_and_nearby_reads() {
        assert_eq!(read_plan(100, None, 0, 96_000), ReadPlan::Restart);
        // 相邻混音块的读取有约 3 个样本的保护重叠，落在保留的已解样本内。
        assert_eq!(read_plan(23_997, Some(0), 24_002, 96_000), ReadPlan::Continue);
        assert_eq!(read_plan(24_002 + 96_000, Some(0), 24_002, 96_000), ReadPlan::Continue);
        assert_eq!(read_plan(24_002 + 96_001, Some(0), 24_002, 96_000), ReadPlan::Restart);
        assert_eq!(read_plan(-5, Some(0), 24_002, 96_000), ReadPlan::Restart);
    }
}

//! Burg LPC with bounded reflection coefficients; independent left/right
//! extrapolation blended by a raised cosine. No damaged samples enter training.
//! This is an implementation of standard LPC, not copied Audacity code.
use super::Result;

fn predict(context: &[f32], count: usize) -> Result<Vec<f32>> {
    if context.len() < 32 {
        return Err("declick requires at least 32 clean context frames on each side".into());
    }
    let mean = context.iter().map(|&x| x as f64).sum::<f64>() / context.len() as f64;
    let mut history: Vec<f64> = context.iter().map(|&x| x as f64 - mean).collect();
    let mut forward = history[1..].to_vec();
    let mut backward = history[..history.len() - 1].to_vec();
    let mut a = vec![1.0_f64];
    let order = 64.min(context.len() / 8);
    for _ in 0..order {
        let mut numerator = 0.0;
        let mut denominator = 0.0;
        for (&f, &b) in forward.iter().zip(&backward) {
            numerator += f * b;
            denominator += f * f + b * b;
        }
        if denominator < 1e-16 {
            break;
        }
        let k = (-2.0 * numerator / (denominator + 1e-14)).clamp(-0.99999, 0.99999);
        let mut next = vec![0.0; a.len() + 1];
        next[0] = 1.0;
        for j in 1..a.len() {
            next[j] = a[j] + k * a[a.len() - j];
        }
        next[a.len()] = k;
        a = next;
        for j in 0..forward.len() {
            let f = forward[j];
            let b = backward[j];
            forward[j] = f + k * b;
            backward[j] = b + k * f;
        }
        forward.remove(0);
        backward.pop();
    }
    let limit = context
        .iter()
        .fold(0.0_f64, |m, x| m.max((*x as f64 - mean).abs()))
        * 4.0
        + 1e-6;
    let mut result = Vec::with_capacity(count);
    for _ in 0..count {
        let value = -a
            .iter()
            .enumerate()
            .skip(1)
            .map(|(j, coefficient)| coefficient * history[history.len() - j])
            .sum::<f64>();
        if !value.is_finite() {
            return Err("LPC prediction became non-finite".into());
        }
        let value = value.clamp(-limit, limit);
        history.push(value);
        result.push((value + mean) as f32);
    }
    Ok(result)
}

pub fn interpolate(left: &[f32], right: &[f32], count: usize) -> Result<Vec<f32>> {
    let forward = predict(left, count)?;
    let reversed: Vec<f32> = right.iter().rev().copied().collect();
    let backward = predict(&reversed, count)?;
    Ok((0..count)
        .map(|i| {
            let t = (i + 1) as f32 / (count + 1) as f32;
            let w = 0.5 - 0.5 * (std::f32::consts::PI * t).cos();
            forward[i] * (1.0 - w) + backward[count - 1 - i] * w
        })
        .collect())
}

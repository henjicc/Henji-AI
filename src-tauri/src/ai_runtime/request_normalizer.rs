use crate::ai_runtime::types::{
    RuntimeConstraintsDsl, RuntimeEnumFieldConstraintDsl, RuntimeImageSizeFieldConstraintDsl,
    RuntimeNumberFieldConstraintDsl,
};
use serde_json::{Map, Number, Value};

pub fn normalize_request_body(
    body: &Value,
    constraints: Option<&RuntimeConstraintsDsl>,
) -> Value {
    let Some(constraints) = constraints else {
        return body.clone();
    };
    let Some(source) = body.as_object() else {
        return body.clone();
    };

    let mut next = source.clone();

    for constraint in &constraints.number_fields {
        normalize_number_field(&mut next, constraint);
    }

    for constraint in &constraints.enum_fields {
        normalize_enum_field(&mut next, constraint);
    }

    for constraint in &constraints.image_size_fields {
        normalize_image_size_field(&mut next, constraint);
    }

    Value::Object(next)
}

fn normalize_number_field(
    target: &mut Map<String, Value>,
    constraint: &RuntimeNumberFieldConstraintDsl,
) {
    let Some(current) = target.get(&constraint.field).cloned() else {
        return;
    };
    let Some(mut numeric) = parse_f64(&current) else {
        return;
    };

    if let Some(min) = constraint.min {
        if numeric < min {
            numeric = min;
        }
    }
    if let Some(max) = constraint.max {
        if numeric > max {
            numeric = max;
        }
    }
    if constraint.integer == Some(true) {
        numeric = numeric.round();
    }

    if let Some(value) = number_to_value(numeric) {
        target.insert(constraint.field.clone(), value);
        return;
    }

    if let Some(fallback) = constraint.fallback.and_then(number_to_value) {
        target.insert(constraint.field.clone(), fallback);
    }
}

fn normalize_enum_field(
    target: &mut Map<String, Value>,
    constraint: &RuntimeEnumFieldConstraintDsl,
) {
    let Some(current) = target.get(&constraint.field) else {
        return;
    };
    if constraint.allowed.iter().any(|allowed| allowed == current) {
        return;
    }

    if let Some(fallback) = &constraint.fallback {
        target.insert(constraint.field.clone(), fallback.clone());
    }
}

fn normalize_image_size_field(
    target: &mut Map<String, Value>,
    constraint: &RuntimeImageSizeFieldConstraintDsl,
) {
    let Some(current) = target.get(&constraint.field).cloned() else {
        return;
    };
    let normalized = if matches!(constraint.format.as_deref(), Some("object")) {
        normalize_image_size_object(&current, constraint)
    } else {
        normalize_image_size_string(&current, constraint)
    };

    if let Some(value) = normalized {
        target.insert(constraint.field.clone(), value);
    }
}

fn normalize_image_size_string(
    current: &Value,
    constraint: &RuntimeImageSizeFieldConstraintDsl,
) -> Option<Value> {
    let raw = current.as_str()?;
    let parsed = parse_size_text(raw)?;
    let normalized = normalize_dimensions(parsed.0, parsed.1, constraint);
    Some(Value::String(format!(
        "{}x{}",
        normalized.0 as i64, normalized.1 as i64
    )))
}

fn normalize_image_size_object(
    current: &Value,
    constraint: &RuntimeImageSizeFieldConstraintDsl,
) -> Option<Value> {
    let source = current.as_object()?;
    let width_key = constraint.width_key.as_deref().unwrap_or("width");
    let height_key = constraint.height_key.as_deref().unwrap_or("height");
    let width = parse_f64(source.get(width_key)?)?;
    let height = parse_f64(source.get(height_key)?)?;
    let normalized = normalize_dimensions(width, height, constraint);

    let mut next = source.clone();
    next.insert(
        width_key.to_string(),
        number_to_value(normalized.0)?,
    );
    next.insert(
        height_key.to_string(),
        number_to_value(normalized.1)?,
    );
    Some(Value::Object(next))
}

fn normalize_dimensions(
    width: f64,
    height: f64,
    constraint: &RuntimeImageSizeFieldConstraintDsl,
) -> (f64, f64) {
    let min_side = constraint.min_side.unwrap_or(1.0).max(1.0);
    let max_side = constraint.max_side.unwrap_or(f64::MAX);

    let mut next_width = normalize_side(width, min_side, max_side);
    let mut next_height = normalize_side(height, min_side, max_side);

    if let (Some(min_ratio), Some(max_ratio)) =
        (constraint.min_aspect_ratio, constraint.max_aspect_ratio)
    {
        let ratio = next_width / next_height.max(1.0);
        if ratio < min_ratio && min_ratio.is_finite() && min_ratio > 0.0 {
            next_height = (next_width / min_ratio).floor().max(1.0);
        } else if ratio > max_ratio && max_ratio.is_finite() && max_ratio > 0.0 {
            next_width = (next_height * max_ratio).floor().max(1.0);
        }
    }

    next_width = normalize_side(next_width, min_side, max_side);
    next_height = normalize_side(next_height, min_side, max_side);

    let mut pixels = next_width * next_height;
    if pixels > constraint.max_pixels {
        let scaled = scale_dimensions(next_width, next_height, (constraint.max_pixels / pixels).sqrt());
        next_width = normalize_side(scaled.0, min_side, max_side);
        next_height = normalize_side(scaled.1, min_side, max_side);
        pixels = next_width * next_height;
    }

    if let Some(min_pixels) = constraint.min_pixels {
        if min_pixels.is_finite() && min_pixels > 0.0 && pixels < min_pixels {
            let scaled = scale_dimensions(next_width, next_height, (min_pixels / pixels.max(1.0)).sqrt());
            next_width = normalize_side(scaled.0, min_side, max_side);
            next_height = normalize_side(scaled.1, min_side, max_side);
            pixels = next_width * next_height;
        }
    }

    if pixels > constraint.max_pixels {
        let scaled = scale_dimensions(next_width, next_height, (constraint.max_pixels / pixels).sqrt());
        next_width = normalize_side(scaled.0, min_side, max_side);
        next_height = normalize_side(scaled.1, min_side, max_side);
    }

    enforce_max_pixels(next_width, next_height, min_side, constraint.max_pixels)
}

fn normalize_side(value: f64, min_side: f64, max_side: f64) -> f64 {
    clamp(value.round(), min_side, max_side)
}

fn scale_dimensions(width: f64, height: f64, scale: f64) -> (f64, f64) {
    (
        (width * scale).round().max(1.0),
        (height * scale).round().max(1.0),
    )
}

fn enforce_max_pixels(width: f64, height: f64, min_side: f64, max_pixels: f64) -> (f64, f64) {
    let mut next_width = width.round().max(1.0);
    let mut next_height = height.round().max(1.0);

    while next_width * next_height > max_pixels {
        if next_width >= next_height && next_width > min_side {
            next_width -= 1.0;
            continue;
        }
        if next_height > min_side {
            next_height -= 1.0;
            continue;
        }
        if next_width > 1.0 {
            next_width -= 1.0;
            continue;
        }
        if next_height > 1.0 {
            next_height -= 1.0;
            continue;
        }
        break;
    }

    (next_width, next_height)
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

fn parse_size_text(value: &str) -> Option<(f64, f64)> {
    let normalized = value.trim().replace('*', "x");
    let pair: Vec<&str> = normalized.split('x').collect();
    if pair.len() != 2 {
        return None;
    }

    let width = pair[0].trim().parse::<f64>().ok()?;
    let height = pair[1].trim().parse::<f64>().ok()?;
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return None;
    }

    Some((width, height))
}

fn parse_f64(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn number_to_value(value: f64) -> Option<Value> {
    Number::from_f64(value).map(Value::Number)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ppio_seedream_constraint() -> RuntimeImageSizeFieldConstraintDsl {
        RuntimeImageSizeFieldConstraintDsl {
            field: "size".to_string(),
            format: Some("string".to_string()),
            width_key: None,
            height_key: None,
            min_side: None,
            max_side: None,
            min_pixels: Some(3686400.0),
            max_pixels: 16777216.0,
            min_aspect_ratio: Some(1.0 / 16.0),
            max_aspect_ratio: Some(16.0),
        }
    }

    #[test]
    fn normalizes_oversized_seedream_size_string() {
        let constraint = ppio_seedream_constraint();
        let value = normalize_image_size_string(&Value::String("3113x5390".to_string()), &constraint)
            .expect("normalized size");
        assert_eq!(value, Value::String("3113x5389".to_string()));
    }

    #[test]
    fn normalizes_object_image_size() {
        let constraint = RuntimeImageSizeFieldConstraintDsl {
            field: "image_size".to_string(),
            format: Some("object".to_string()),
            width_key: Some("width".to_string()),
            height_key: Some("height".to_string()),
            min_side: Some(1920.0),
            max_side: Some(4096.0),
            min_pixels: Some(3686400.0),
            max_pixels: 16777216.0,
            min_aspect_ratio: None,
            max_aspect_ratio: None,
        };

        let input = Value::Object(
            [
                ("width".to_string(), Value::Number(Number::from(3113))),
                ("height".to_string(), Value::Number(Number::from(5390))),
            ]
            .into_iter()
            .collect(),
        );

        let normalized =
            normalize_image_size_object(&input, &constraint).expect("normalized object size");
        let output = normalized.as_object().expect("size object");
        assert_eq!(output.get("width").and_then(Value::as_f64), Some(3113.0));
        assert_eq!(output.get("height").and_then(Value::as_f64), Some(4096.0));
    }
}

use crate::ai_runtime::errors::{AiResult, AiRuntimeError};
use crate::ai_runtime::types::{
    EndpointConfigDsl, EndpointRuleDsl, ModelManifestItem, RequestFieldDsl, RequestTransformDsl,
};
use serde_json::{Map, Number, Value};

const INTERNAL_PARAM_PREFIX: &str = "__";

#[derive(Debug, Clone)]
pub struct BuiltRequest {
    pub route: String,
    pub method: String,
    pub body: Value,
}

pub fn build_request(params: &Map<String, Value>, model: Option<&ModelManifestItem>) -> AiResult<BuiltRequest> {
    let route = resolve_route(params, model)?;
    let method = resolve_method(model);
    let body = if let Some(model_item) = model {
        if let Some(request_dsl) = &model_item.request {
            if let Some(builder_js) = &request_dsl.builder_js {
                build_body_from_js(params, builder_js)?
            } else {
                apply_request_dsl(params, request_dsl)
            }
        } else {
            Value::Object(strip_internal_params(params))
        }
    } else {
        Value::Object(strip_internal_params(params))
    };

    Ok(BuiltRequest { route, method, body })
}

fn resolve_route(params: &Map<String, Value>, model: Option<&ModelManifestItem>) -> AiResult<String> {
    if let Some(model_item) = model {
        if let Some(endpoint_dsl) = &model_item.endpoints {
            if let Some(selector_js) = &endpoint_dsl.selector_js {
                let value = crate::ai_runtime::js_runtime::eval_function(selector_js, params)?;
                if let Some(route) = value.as_str() {
                    return Ok(resolve_named_route(endpoint_dsl, route));
                }
                return Err(AiRuntimeError::new(
                    "invalid_selector_result",
                    "Selector JS must return a string route",
                ));
            }

            return Ok(select_endpoint_from_dsl(params, endpoint_dsl));
        }
    }
    Ok("".to_string())
}

fn resolve_method(model: Option<&ModelManifestItem>) -> String {
    model
        .and_then(|item| item.endpoints.as_ref())
        .and_then(|endpoint| endpoint.method.clone())
        .map(|method| method.to_uppercase())
        .unwrap_or_else(|| "POST".to_string())
}

fn select_endpoint_from_dsl(params: &Map<String, Value>, endpoint_dsl: &EndpointConfigDsl) -> String {
    for rule in &endpoint_dsl.rules {
        if matches_rule(params, rule) {
            return resolve_named_route(endpoint_dsl, &rule.route);
        }
    }
    resolve_named_route(endpoint_dsl, &endpoint_dsl.default_route)
}

fn resolve_named_route(endpoint_dsl: &EndpointConfigDsl, route: &str) -> String {
    endpoint_dsl
        .routes
        .get(route)
        .map(|entry| entry.path.clone())
        .unwrap_or_else(|| route.to_string())
}

fn matches_rule(params: &Map<String, Value>, rule: &EndpointRuleDsl) -> bool {
    let Some(condition_obj) = rule.when.as_object() else {
        return false;
    };

    for (key, expected) in condition_obj {
        let actual = params.get(key).unwrap_or(&Value::Null);
        if actual != expected {
            return false;
        }
    }

    true
}

fn apply_request_dsl(
    params: &Map<String, Value>,
    request_dsl: &crate::ai_runtime::types::RequestConfigDsl,
) -> Value {
    let mut output = request_dsl.constants.clone();

    for field in &request_dsl.fields {
        if !field_should_apply(params, field) {
            continue;
        }

        if let Some(value) = get_value(params, &field.from) {
            let transformed = apply_transforms(value, &field.transforms);
            output.insert(field.to.clone(), transformed);
        }
    }

    for key in &request_dsl.remove_empty {
        if is_empty(output.get(key)) {
            output.remove(key);
        }
    }

    Value::Object(output)
}

fn build_body_from_js(
    params: &Map<String, Value>,
    builder_js: &str,
) -> AiResult<Value> {
    crate::ai_runtime::js_runtime::eval_function(builder_js, params)
}

fn field_should_apply(params: &Map<String, Value>, field: &RequestFieldDsl) -> bool {
    let Some(when) = &field.when else {
        return true;
    };
    let Some(condition_obj) = when.as_object() else {
        return true;
    };

    for (key, expected) in condition_obj {
        let actual = get_value(params, key).unwrap_or(Value::Null);
        if actual != *expected {
            return false;
        }
    }

    true
}

fn get_value(params: &Map<String, Value>, from: &str) -> Option<Value> {
    if !from.contains('.') {
        return params.get(from).cloned();
    }

    let mut current = Value::Object(params.clone());
    for part in from.split('.') {
        match current {
            Value::Object(obj) => {
                current = obj.get(part)?.clone();
            }
            _ => return None,
        }
    }

    Some(current)
}

fn apply_transforms(mut value: Value, transforms: &[RequestTransformDsl]) -> Value {
    for transform in transforms {
        value = match transform.name.as_str() {
            "trim" => Value::String(value.as_str().unwrap_or_default().trim().to_string()),
            "string" => Value::String(match value {
                Value::String(s) => s,
                _ => value.to_string(),
            }),
            "number" => {
                let raw = if let Some(n) = value.as_f64() {
                    n
                } else {
                    value.as_str().unwrap_or("0").parse::<f64>().unwrap_or(0.0)
                };
                Number::from_f64(raw)
                    .map(Value::Number)
                    .unwrap_or(Value::Null)
            }
            "boolean" => Value::Bool(value.as_bool().unwrap_or(false)),
            "join" => join_array(value, transform),
            _ => value,
        }
    }
    value
}

fn join_array(value: Value, transform: &RequestTransformDsl) -> Value {
    let sep = transform
        .args
        .get("separator")
        .and_then(Value::as_str)
        .unwrap_or(",");

    let Some(items) = value.as_array() else {
        return value;
    };

    let merged = items
        .iter()
        .map(|item| item.as_str().map(|s| s.to_string()).unwrap_or_else(|| item.to_string()))
        .collect::<Vec<String>>()
        .join(sep);

    Value::String(merged)
}

fn is_empty(value: Option<&Value>) -> bool {
    match value {
        None => true,
        Some(Value::Null) => true,
        Some(Value::String(s)) => s.trim().is_empty(),
        Some(Value::Array(arr)) => arr.is_empty(),
        Some(Value::Object(obj)) => obj.is_empty(),
        _ => false,
    }
}

fn strip_internal_params(params: &Map<String, Value>) -> Map<String, Value> {
    params
        .iter()
        .filter_map(|(key, value)| {
            if key.starts_with(INTERNAL_PARAM_PREFIX) {
                None
            } else {
                Some((key.clone(), value.clone()))
            }
        })
        .collect()
}

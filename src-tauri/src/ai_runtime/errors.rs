use std::fmt::{Display, Formatter};

#[derive(Debug, Clone)]
pub struct AiRuntimeError {
    pub code: &'static str,
    pub message: String,
}

impl AiRuntimeError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn with_context(self, context: impl Into<String>) -> Self {
        Self {
            code: self.code,
            message: format!("{}: {}", context.into(), self.message),
        }
    }
}

impl Display for AiRuntimeError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl From<reqwest::Error> for AiRuntimeError {
    fn from(value: reqwest::Error) -> Self {
        Self::new("http_error", value.to_string())
    }
}

impl From<std::io::Error> for AiRuntimeError {
    fn from(value: std::io::Error) -> Self {
        Self::new("io_error", value.to_string())
    }
}

pub type AiResult<T> = Result<T, AiRuntimeError>;

//! 共用核心：与平台无关。这里不出现任何系统接口，平台相关的都在 `crate::platform`。

pub mod activity;
pub mod health;
pub mod pacer;
pub mod protocol;
pub mod session;
pub mod timing;

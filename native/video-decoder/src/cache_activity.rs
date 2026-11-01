//! 前台持共享意向锁，后台逐提交领取独占额度；文件只承载内核锁，不存心跳或活动状态。
use crate::protocol::ServiceError;
use std::fs::{File, OpenOptions, TryLockError};
use std::path::PathBuf;

pub struct CacheActivity {
    root: PathBuf,
    foreground: Option<File>,
    submission: Option<(String, File)>,
}

impl Default for CacheActivity {
    fn default() -> Self {
        Self { root: std::env::temp_dir().join("henji-web-cache-coordination"), foreground: None, submission: None }
    }
}

impl CacheActivity {
    fn open(&self, name: &str) -> Result<File, ServiceError> {
        std::fs::create_dir_all(&self.root).map_err(io_error)?;
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        // 持有期间禁止删除/替换锁文件；否则另一个文件身份会绕过已经持有的锁。
        #[cfg(windows)] {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(3);
        }
        options.open(self.root.join(name)).map_err(io_error)
    }

    pub fn foreground(&mut self, active: bool) -> Result<(), ServiceError> {
        if !active { self.foreground = None; }
        else if self.foreground.is_none() {
            let file = self.open("foreground.lock")?;
            // 其他前台也持共享锁；唯一独占者只做一次状态检查，绝不持锁等后台排空。
            file.lock_shared().map_err(io_error)?;
            self.foreground = Some(file);
        }
        Ok(())
    }

    pub fn acquire(&mut self, lease: String) -> Result<bool, ServiceError> {
        if lease.is_empty() { return Err(ServiceError::new("INVALID_REQUEST", "网页补录提交租约为空")); }
        if self.foreground.is_some() || self.submission.is_some() { return Ok(false); }
        let budget = self.open("submission.lock")?;
        if !try_lock(&budget)? { return Ok(false); }
        let intent = self.open("foreground.lock")?;
        if !try_lock(&intent)? { return Ok(false); }
        self.submission = Some((lease, budget));
        Ok(true)
    }

    pub fn release(&mut self, lease: &str) -> bool {
        if !self.submission.as_ref().is_some_and(|(token, _)| token == lease) { return false; }
        self.submission = None;
        true
    }
}

fn try_lock(file: &File) -> Result<bool, ServiceError> {
    match file.try_lock() { Ok(()) => Ok(true), Err(TryLockError::WouldBlock) => Ok(false), Err(TryLockError::Error(error)) => Err(io_error(error)) }
}
fn io_error(error: std::io::Error) -> ServiceError { ServiceError::new("INTERNAL", format!("网页补录活动协调失败：{error}")) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn foregrounds_overlap_and_submissions_release_on_drop() {
        let root = std::env::temp_dir().join(format!("henji-cache-activity-test-{}", std::process::id()));
        let make = || CacheActivity { root: root.clone(), foreground: None, submission: None };
        let (mut first, mut second, mut worker) = (make(), make(), make());
        first.foreground(true).unwrap(); second.foreground(true).unwrap();
        assert!(!worker.acquire("work".into()).unwrap());
        first.foreground(false).unwrap();
        assert!(!worker.acquire("work".into()).unwrap());
        drop(second);
        assert!(worker.acquire("work".into()).unwrap());
        assert!(!worker.release("stale"));
        assert!(!first.acquire("next".into()).unwrap());
        // 新的前台不用等待在途后台提交；下一提交必须让出。
        first.foreground(true).unwrap();
        assert!(worker.release("work"));
        assert!(!worker.acquire("again".into()).unwrap());
        first.foreground(false).unwrap();
        assert!(worker.acquire("again".into()).unwrap());
        drop(worker);
        assert!(first.acquire("next".into()).unwrap());
        drop(first);
        std::fs::remove_dir_all(root).unwrap();
    }
}

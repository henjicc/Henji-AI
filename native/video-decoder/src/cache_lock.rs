//! 网页缓存段写租约。获取、提交与释放都在控制线程，避免互斥体的线程所有权被异步任务破坏。
use crate::protocol::ServiceError;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[cfg(windows)]
struct KernelMutex(windows::Win32::Foundation::HANDLE, std::marker::PhantomData<std::rc::Rc<()>>);

#[cfg(windows)]
impl KernelMutex {
    fn acquire(key: &str) -> Result<Option<Self>, ServiceError> {
        use windows::Win32::Foundation::{CloseHandle, WAIT_ABANDONED, WAIT_OBJECT_0, WAIT_TIMEOUT};
        use windows::Win32::System::Threading::{CreateMutexW, WaitForSingleObject};
        let name: Vec<u16> = format!("Local\\Henji.WebCache.{key}").encode_utf16().chain(Some(0)).collect();
        unsafe {
            let handle = CreateMutexW(None, false, windows::core::PCWSTR(name.as_ptr())).map_err(native_error)?;
            match WaitForSingleObject(handle, 0) {
                WAIT_OBJECT_0 | WAIT_ABANDONED => Ok(Some(Self(handle, std::marker::PhantomData))),
                WAIT_TIMEOUT => { let _ = CloseHandle(handle); Ok(None) }
                _ => { let error = windows::core::Error::from_thread(); let _ = CloseHandle(handle); Err(native_error(error)) }
            }
        }
    }
}

#[cfg(windows)]
fn native_error(error: windows::core::Error) -> ServiceError { ServiceError::new("INTERNAL", format!("网页缓存内核锁失败：{error}")) }

#[cfg(windows)]
impl Drop for KernelMutex {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::System::Threading::ReleaseMutex(self.0);
            let _ = windows::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(not(windows))]
struct KernelMutex;
#[cfg(not(windows))]
impl KernelMutex {
    fn acquire(_key: &str) -> Result<Option<Self>, ServiceError> { Err(ServiceError::new("UNSUPPORTED_FORMAT", "此平台尚未启用网页缓存")) }
}

struct Lease { token: String, _mutex: KernelMutex, published: Option<PathBuf> }
#[derive(Default)]
pub struct CacheLocks { held: HashMap<String, Lease> }

impl CacheLocks {
    pub fn acquire(&mut self, key: String, token: String) -> Result<bool, ServiceError> {
        if key.len() != 64 || !key.bytes().all(|b| b.is_ascii_hexdigit()) || token.is_empty() {
            return Err(ServiceError::new("INVALID_REQUEST", "网页缓存锁身份无效"));
        }
        // Windows 允许同线程重复获取；业务租约必须仍然互斥。
        if self.held.contains_key(&key) { return Ok(false); }
        let Some(mutex) = KernelMutex::acquire(&key)? else { return Ok(false); };
        self.held.insert(key, Lease { token, _mutex: mutex, published: None });
        Ok(true)
    }
    fn require(&mut self, key: &str, token: &str) -> Result<&mut Lease, ServiceError> {
        self.held.get_mut(key).filter(|lease| lease.token == token).ok_or_else(|| ServiceError::new("SESSION_GONE", "网页缓存段写租约已失效"))
    }
    pub fn release(&mut self, key: &str, token: &str) -> bool {
        if !self.held.get(key).is_some_and(|lease| lease.token == token) { return false; }
        self.held.remove(key); true
    }
    pub fn prepare(&mut self, key: &str, token: &str, destination: &Path) -> Result<(), ServiceError> {
        self.require(key, token)?;
        let (Some(parent), Some(name)) = (destination.parent(), destination.file_name()) else {
            return Err(ServiceError::new("INVALID_REQUEST", "网页缓存段目录无效"));
        };
        let prefix = format!("{}.tmp-", name.to_string_lossy());
        // 枚举和删除也必须由持锁线程执行；主进程的迟到 I/O 不能清掉新实例刚建立的临时族。
        for entry in std::fs::read_dir(parent).map_err(io_error)? {
            let entry = entry.map_err(io_error)?;
            if entry.file_name().to_string_lossy().starts_with(&prefix) { remove_family(&entry.path())?; }
        }
        Ok(())
    }
    pub fn commit(&mut self, key: &str, token: &str, temporary: &Path, destination: &Path) -> Result<(), ServiceError> {
        let lease = self.require(key, token)?;
        if lease.published.is_some() || temporary == destination || temporary.parent() != destination.parent() {
            return Err(ServiceError::new("INVALID_REQUEST", "网页缓存发布必须是同目录的一次段族替换"));
        }
        // 由持锁进程执行 rename；若进程退出释放了锁，旧主进程无法在新持有者之后迟到发布。
        remove_family(destination)?;
        std::fs::rename(temporary, destination).map_err(io_error)?;
        lease.published = Some(destination.to_path_buf());
        Ok(())
    }
    pub fn rollback(&mut self, key: &str, token: &str) -> Result<(), ServiceError> {
        let lease = self.require(key, token)?;
        if let Some(directory) = &lease.published { remove_family(directory)?; }
        lease.published = None;
        Ok(())
    }
    pub fn discard(&mut self, key: &str, token: &str, destination: &Path) -> Result<bool, ServiceError> {
        self.require(key, token)?;
        let name = destination.file_name().ok_or_else(|| ServiceError::new("INVALID_REQUEST", "网页缓存段目录无效"))?;
        let temporary = destination.with_file_name(format!("{}.tmp-evicted-{token}", name.to_string_lossy()));
        // 先整体撤出可读名字，再删除族成员；失败或进程退出只留下可被 prepare 回收的临时族。
        match std::fs::rename(destination, &temporary) {
            Ok(()) => { remove_family(&temporary)?; Ok(true) }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(io_error(error)),
        }
    }
}
fn io_error(error: std::io::Error) -> ServiceError { ServiceError::new("INTERNAL", format!("网页缓存段族写入失败：{error}")) }
fn remove_family(directory: &Path) -> Result<(), ServiceError> {
    match std::fs::remove_dir_all(directory) { Ok(()) => Ok(()), Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(error) => Err(io_error(error)) }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn discards_whole_family_only_with_current_lease() {
        let key = format!("{:064x}", u64::from(std::process::id()) + (3u64 << 32));
        let root = std::env::temp_dir().join(format!("henji-family-{}", std::process::id()));
        let destination = root.join("segment");
        std::fs::create_dir_all(&destination).unwrap();
        for name in ["video.mp4", "geometry.json", "manifest.json"] { std::fs::write(destination.join(name), b"content").unwrap(); }
        let mut locks = CacheLocks::default();
        assert!(locks.acquire(key.clone(), "current".into()).unwrap());
        assert!(locks.discard(&key, "expired", &destination).is_err());
        assert_eq!(std::fs::read_dir(&destination).unwrap().count(), 3);
        assert!(locks.discard(&key, "current", &destination).unwrap());
        assert!(!destination.exists());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        assert!(!locks.discard(&key, "current", &destination).unwrap());
        std::fs::remove_dir(&root).unwrap();
    }
    #[test]
    fn excludes_threads_and_stale_leases_cannot_publish_or_release() {
        let key = format!("{:064x}", std::process::id());
        let mut locks = CacheLocks::default();
        assert!(locks.acquire(key.clone(), "first".into()).unwrap());
        assert!(!locks.acquire(key.clone(), "second".into()).unwrap());
        let other = key.clone();
        assert!(!std::thread::spawn(move || CacheLocks::default().acquire(other, "other".into()).unwrap()).join().unwrap());
        assert!(!locks.release(&key, "second"));
        assert!(locks.commit(&key, "second", Path::new("tmp"), Path::new("ready")).is_err());
        assert!(locks.release(&key, "first"));
        assert!(std::thread::spawn(move || CacheLocks::default().acquire(key, "other".into()).unwrap()).join().unwrap());
    }
    #[test]
    fn abandoned_mutex_is_recoverable() {
        let key = format!("{:064x}", u64::from(std::process::id()) + (1u64 << 32));
        let other = key.clone();
        std::thread::spawn(move || {
            let mutex = KernelMutex::acquire(&other).unwrap().unwrap();
            // 模拟持有线程未释放即退出，保留句柄以让对象进入 abandoned 状态。
            let handle = mutex.0.0 as usize;
            std::mem::forget(mutex);
            handle
        }).join().map(|handle| {
            let mutex = KernelMutex::acquire(&key).unwrap().unwrap();
            drop(mutex);
            unsafe { windows::Win32::Foundation::CloseHandle(windows::Win32::Foundation::HANDLE(handle as *mut _)).unwrap(); }
        }).unwrap();
    }
}

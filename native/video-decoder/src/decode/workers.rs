//! CUDA 驱动在线程退出后仍保留线程状态；解码任务复用常驻线程，资源仍按会话关闭。
//! 使用已有 Rayon 管理工作线程，每个并发会话独占一条，避免长任务堵住有界计算池。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};

use crate::streams::{StreamResources, StreamTask};

struct Worker {
    pool: rayon::ThreadPool,
    busy: AtomicBool,
}

pub fn spawn(job: impl FnOnce() -> Box<dyn StreamResources> + Send + 'static) -> std::io::Result<StreamTask> {
    static WORKERS: OnceLock<Mutex<Vec<Arc<Worker>>>> = OnceLock::new();
    let mut workers = WORKERS.get_or_init(|| Mutex::new(Vec::new())).lock().map_err(|_| std::io::Error::other("解码工作线程登记不可用"))?;
    let worker = match workers.iter().find(|worker| !worker.busy.load(Ordering::Acquire)) {
        Some(worker) => worker.clone(),
        None => {
            let index = workers.len();
            let pool = rayon::ThreadPoolBuilder::new().num_threads(1).thread_name(move |_| format!("decode-worker-{index}"))
                .build().map_err(std::io::Error::other)?;
            let worker = Arc::new(Worker { pool, busy: AtomicBool::new(false) });
            workers.push(worker.clone());
            worker
        }
    };
    worker.busy.store(true, Ordering::Release);
    drop(workers);
    let (sender, receiver) = mpsc::channel();
    let finished = Arc::new(AtomicBool::new(false));
    let mark = finished.clone();
    let owner = worker.clone();
    worker.pool.spawn(move || {
        // 把会话 panic 交回既有流治理，不让 Rayon 的孤立任务 panic 终止整个服务。
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(job));
        owner.busy.store(false, Ordering::Release);
        let _ = sender.send(result);
        mark.store(true, Ordering::Release);
    });
    Ok(StreamTask::Resident { receiver, finished })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    struct Resources;
    impl StreamResources for Resources {
        fn release(self: Box<Self>) -> Vec<String> { Vec::new() }
    }

    fn result(task: StreamTask) -> std::thread::Result<Box<dyn StreamResources>> {
        let StreamTask::Resident { receiver, .. } = task else { panic!("需要常驻任务") };
        receiver.recv_timeout(Duration::from_secs(5)).expect("会话应完成")
    }

    #[test]
    fn blocked_session_does_not_block_another_session() {
        let (ready, started) = mpsc::channel();
        let (release, waiting) = mpsc::channel();
        let first = spawn(move || {
            ready.send(()).unwrap();
            waiting.recv().unwrap();
            Box::new(Resources)
        }).unwrap();
        started.recv_timeout(Duration::from_secs(5)).unwrap();
        let second = spawn(|| Box::new(Resources)).unwrap();
        let completed = result(second);
        release.send(()).unwrap();
        assert!(completed.is_ok());
        assert!(result(first).is_ok());
    }

    #[test]
    fn session_panic_returns_to_owner_and_worker_remains_usable() {
        let failed = spawn(|| panic!("模拟解码任务异常")).unwrap();
        assert!(result(failed).is_err());
        assert!(result(spawn(|| Box::new(Resources)).unwrap()).is_ok());
    }
}

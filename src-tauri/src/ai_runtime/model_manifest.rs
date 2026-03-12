use crate::ai_runtime::types::{ModelManifest, ModelManifestItem};
use once_cell::sync::Lazy;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::RwLock;

#[derive(Default)]
pub struct ModelManifestStore {
    models: HashMap<String, ModelManifestItem>,
}

impl ModelManifestStore {
    fn from_manifest(manifest: ModelManifest) -> Self {
        let mut models = HashMap::new();
        for item in manifest.models {
            models.insert(item.model_id.clone(), item);
        }
        Self { models }
    }

    pub fn get(&self, model_id: &str) -> Option<&ModelManifestItem> {
        self.models.get(model_id)
    }

    pub fn provider_ids(&self) -> Vec<String> {
        let mut ids = HashSet::new();
        for model in self.models.values() {
            ids.insert(model.provider_id.clone());
        }
        ids.into_iter().collect()
    }

    pub fn len(&self) -> usize {
        self.models.len()
    }
}

static MANIFEST_STORE: Lazy<RwLock<ModelManifestStore>> =
    Lazy::new(|| RwLock::new(load_manifest_store()));

pub fn get_manifest_store() -> &'static RwLock<ModelManifestStore> {
    &MANIFEST_STORE
}

pub fn reload_manifest_store() -> usize {
    let next = load_manifest_store();
    let count = next.len();
    if let Ok(mut guard) = MANIFEST_STORE.write() {
        *guard = next;
    }
    count
}

fn load_manifest_store() -> ModelManifestStore {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("src-tauri/resources/model-manifest.json"));
        candidates.push(cwd.join("resources/model-manifest.json"));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("resources/model-manifest.json"));
            candidates.push(dir.join("../resources/model-manifest.json"));
        }
    }

    for path in candidates {
        if !path.exists() {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(manifest) = serde_json::from_str::<ModelManifest>(&content) {
                return ModelManifestStore::from_manifest(manifest);
            }
        }
    }

    ModelManifestStore::default()
}

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub name: String,
    pub gcode: String,
    pub status: JobStatus,
    pub created_by: String,
    pub created_at: String,
    
    pub tool: Option<String>,
    
    pub material: Option<String>,
    
    pub estimated_time: Option<String>,
    
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Approved,
    Running,
    Completed,
    Cancelled,
    Error(String),
}

pub struct JobQueue {
    jobs: Mutex<Vec<Job>>,
    data_dir: std::path::PathBuf,
}

impl JobQueue {
    pub fn new(data_dir: &Path) -> Self {
        let queue = Self {
            jobs: Mutex::new(Vec::new()),
            data_dir: data_dir.to_path_buf(),
        };
        queue.load_from_disk();
        queue
    }

    fn jobs_file(&self) -> std::path::PathBuf {
        self.data_dir.join("jobs.json")
    }

    fn load_from_disk(&self) {
        let path = self.jobs_file();
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(jobs) = serde_json::from_str::<Vec<Job>>(&content) {
                    if let Ok(mut guard) = self.jobs.lock() {
                        *guard = jobs;
                    }
                }
            }
        }
    }

    fn save_to_disk(&self) {
        if let Ok(guard) = self.jobs.lock() {
            let path = self.jobs_file();
            let _ = fs::create_dir_all(&self.data_dir);
            if let Ok(content) = serde_json::to_string_pretty(&*guard) {
                let _ = fs::write(path, content);
            }
        }
    }

    pub fn list(&self) -> Vec<Job> {
        self.jobs.lock().map(|g| g.clone()).unwrap_or_default()
    }

    pub fn add(&self, mut job: Job) -> Job {
        if job.id.is_empty() {
            job.id = format!("job_{}", uuid::Uuid::new_v4());
        }
        job.status = JobStatus::Queued;
        if let Ok(mut guard) = self.jobs.lock() {
            guard.push(job.clone());
        }
        self.save_to_disk();
        job
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        if let Ok(mut guard) = self.jobs.lock() {
            let len_before = guard.len();
            guard.retain(|j| j.id != id);
            if guard.len() == len_before {
                return Err("Trabajo no encontrado".to_string());
            }
        }
        self.save_to_disk();
        Ok(())
    }

    pub fn update_status(&self, id: &str, status: JobStatus) -> Result<(), String> {
        if let Ok(mut guard) = self.jobs.lock() {
            if let Some(job) = guard.iter_mut().find(|j| j.id == id) {
                job.status = status;
            } else {
                return Err("Trabajo no encontrado".to_string());
            }
        }
        self.save_to_disk();
        Ok(())
    }

}

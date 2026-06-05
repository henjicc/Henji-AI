use henji_ai::ai_runtime::progress_learning::{
    export_progress_seed_file, resolve_default_progress_db_path,
    resolve_default_progress_seed_export_path,
};
use std::path::PathBuf;
use tracing::{error, info};

fn parse_arg_value(args: &[String], flag: &str) -> Option<String> {
    args.windows(2)
        .find(|window| window[0] == flag)
        .map(|window| window[1].clone())
}

fn main() {
    tracing_subscriber::fmt().with_target(false).init();
    if let Err(error) = run() {
        error!(message = %error, "[progress-export] failed");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = std::env::args().skip(1).collect::<Vec<String>>();
    let db_path = parse_arg_value(&args, "--db-path")
        .map(PathBuf::from)
        .unwrap_or(resolve_default_progress_db_path()?);
    let output_path = parse_arg_value(&args, "--output")
        .map(PathBuf::from)
        .unwrap_or(resolve_default_progress_seed_export_path()?);

    let summaries = export_progress_seed_file(&db_path, &output_path)?;
    info!(db = %db_path.display(), "[progress-export] db");
    info!(output = %output_path.display(), "[progress-export] output");
    if summaries.is_empty() {
        info!("[progress-export] no valid samples found");
        return Ok(());
    }

    for summary in summaries {
        info!(
            model = %summary.model_id,
            profile = %summary.profile_key,
            global_ms = summary.global_ms,
            global_samples = summary.global_sample_count,
            global_trimmed = summary.global_trimmed,
            "[progress-export] summary"
        );
        for (bucket, bucket_summary) in summary.buckets {
            info!(
                model = %summary.model_id,
                profile = %summary.profile_key,
                bucket = %bucket,
                duration_ms = bucket_summary.duration_ms,
                sample_count = bucket_summary.sample_count,
                trimmed = bucket_summary.trimmed,
                "[progress-export] bucket"
            );
        }
    }

    Ok(())
}

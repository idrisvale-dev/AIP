use anyhow::{Context, Result};
use std::path::Path;
use std::process::Command;

use crate::config::Config;
use crate::session::WorktreeInfo;

/// Create a new git worktree for an agent session.
pub fn create_for_session(session_id: &str, cfg: &Config) -> Result<WorktreeInfo> {
    let repo_root = std::env::current_dir().context("Failed to resolve repository root")?;
    create_for_session_in_repo(session_id, cfg, &repo_root)
}

pub(crate) fn create_for_session_in_repo(
    session_id: &str,
    cfg: &Config,
    repo_root: &Path,
) -> Result<WorktreeInfo> {
    let branch = format!("ecc/{session_id}");
    let path = cfg.worktree_root.join(session_id);

    // Get current branch as base
    let base = get_current_branch(repo_root)?;

    std::fs::create_dir_all(&cfg.worktree_root)
        .context("Failed to create worktree root directory")?;

    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(["worktree", "add", "-b", &branch])
        .arg(&path)
        .arg("HEAD")
        .output()
        .context("Failed to run git worktree add")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git worktree add failed: {stderr}");
    }

    tracing::info!(
        "Created worktree at {} on branch {}",
        path.display(),
        branch
    );

    Ok(WorktreeInfo {
        path,
        branch,
        base_branch: base,
    })
}

/// Remove a worktree and its branch.
pub fn remove(path: &Path) -> Result<()> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["worktree", "remove", "--force"])
        .arg(path)
        .output()
        .context("Failed to remove worktree")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!("Worktree removal warning: {stderr}");
    }

    Ok(())
}

/// List all active worktrees.
pub fn list() -> Result<Vec<String>> {
    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .output()
        .context("Failed to list worktrees")?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let worktrees: Vec<String> = stdout
        .lines()
        .filter(|l| l.starts_with("worktree "))
        .map(|l| l.trim_start_matches("worktree ").to_string())
        .collect();

    Ok(worktrees)
}

pub fn diff_summary(worktree: &WorktreeInfo) -> Result<Option<String>> {
    let base_ref = format!("{}...HEAD", worktree.base_branch);
    let committed = git_diff_shortstat(&worktree.path, &[&base_ref])?;
    let working = git_diff_shortstat(&worktree.path, &[])?;

    let mut parts = Vec::new();
    if let Some(committed) = committed {
        parts.push(format!("Branch {committed}"));
    }
    if let Some(working) = working {
        parts.push(format!("Working tree {working}"));
    }

    if parts.is_empty() {
        Ok(Some(format!("Clean relative to {}", worktree.base_branch)))
    } else {
        Ok(Some(parts.join(" | ")))
    }
}

fn git_diff_shortstat(worktree_path: &Path, extra_args: &[&str]) -> Result<Option<String>> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(worktree_path)
        .arg("diff")
        .arg("--shortstat");
    command.args(extra_args);

    let output = command
        .output()
        .context("Failed to generate worktree diff summary")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!(
            "Worktree diff summary warning for {}: {stderr}",
            worktree_path.display()
        );
        return Ok(None);
    }

    let summary = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if summary.is_empty() {
        Ok(None)
    } else {
        Ok(Some(summary))
    }
}

fn get_current_branch(repo_root: &Path) -> Result<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .context("Failed to get current branch")?;

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::Result;
    use std::fs;
    use std::process::Command;
    use uuid::Uuid;

    fn run_git(repo: &Path, args: &[&str]) -> Result<()> {
        let output = Command::new("git").arg("-C").arg(repo).args(args).output()?;
        if !output.status.success() {
            anyhow::bail!("{}", String::from_utf8_lossy(&output.stderr));
        }
        Ok(())
    }

    #[test]
    fn diff_summary_reports_clean_and_dirty_worktrees() -> Result<()> {
        let root = std::env::temp_dir().join(format!("ecc2-worktree-{}", Uuid::new_v4()));
        let repo = root.join("repo");
        fs::create_dir_all(&repo)?;

        run_git(&repo, &["init", "-b", "main"])?;
        run_git(&repo, &["config", "user.email", "ecc@example.com"])?;
        run_git(&repo, &["config", "user.name", "ECC"])?;
        fs::write(repo.join("README.md"), "hello\n")?;
        run_git(&repo, &["add", "README.md"])?;
        run_git(&repo, &["commit", "-m", "init"])?;

        let worktree_dir = root.join("wt-1");
        run_git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "ecc/test",
                worktree_dir.to_str().expect("utf8 path"),
                "HEAD",
            ],
        )?;

        let info = WorktreeInfo {
            path: worktree_dir.clone(),
            branch: "ecc/test".to_string(),
            base_branch: "main".to_string(),
        };

        assert_eq!(diff_summary(&info)?, Some("Clean relative to main".to_string()));

        fs::write(worktree_dir.join("README.md"), "hello\nmore\n")?;
        let dirty = diff_summary(&info)?.expect("dirty summary");
        assert!(dirty.contains("Working tree"));
        assert!(dirty.contains("file changed"));

        let _ = Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["worktree", "remove", "--force"])
            .arg(&worktree_dir)
            .output();
        let _ = fs::remove_dir_all(root);
        Ok(())
    }
}

use anyhow::{Context, Result};
use std::collections::{BTreeMap, HashSet};
use std::fmt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;

use super::output::SessionOutputStore;
use super::runtime::capture_command_output;
use super::store::StateStore;
use super::{Session, SessionMetrics, SessionState};
use crate::config::Config;
use crate::observability::{log_tool_call, ToolCallEvent, ToolLogEntry, ToolLogPage, ToolLogger};
use crate::worktree;

pub async fn create_session(
    db: &StateStore,
    cfg: &Config,
    task: &str,
    agent_type: &str,
    use_worktree: bool,
) -> Result<String> {
    let repo_root =
        std::env::current_dir().context("Failed to resolve current working directory")?;
    queue_session_in_dir(db, cfg, task, agent_type, use_worktree, &repo_root).await
}

pub fn list_sessions(db: &StateStore) -> Result<Vec<Session>> {
    db.list_sessions()
}

pub fn get_status(db: &StateStore, id: &str) -> Result<SessionStatus> {
    let session = resolve_session(db, id)?;
    let session_id = session.id.clone();
    Ok(SessionStatus {
        session,
        parent_session: db.latest_task_handoff_source(&session_id)?,
        delegated_children: db.delegated_children(&session_id, 5)?,
    })
}

pub fn get_team_status(db: &StateStore, id: &str, depth: usize) -> Result<TeamStatus> {
    let root = resolve_session(db, id)?;
    let unread_counts = db.unread_message_counts()?;
    let mut visited = HashSet::new();
    visited.insert(root.id.clone());

    let mut descendants = Vec::new();
    collect_delegation_descendants(
        db,
        &root.id,
        depth,
        1,
        &unread_counts,
        &mut visited,
        &mut descendants,
    )?;

    Ok(TeamStatus {
        root,
        unread_messages: unread_counts,
        descendants,
    })
}

pub async fn assign_session(
    db: &StateStore,
    cfg: &Config,
    lead_id: &str,
    task: &str,
    agent_type: &str,
    use_worktree: bool,
) -> Result<AssignmentOutcome> {
    let repo_root =
        std::env::current_dir().context("Failed to resolve current working directory")?;
    assign_session_in_dir_with_runner_program(
        db,
        cfg,
        lead_id,
        task,
        agent_type,
        use_worktree,
        &repo_root,
        &std::env::current_exe().context("Failed to resolve ECC executable path")?,
    )
    .await
}

pub async fn stop_session(db: &StateStore, id: &str) -> Result<()> {
    stop_session_with_options(db, id, true).await
}

pub fn record_tool_call(
    db: &StateStore,
    session_id: &str,
    tool_name: &str,
    input_summary: &str,
    output_summary: &str,
    duration_ms: u64,
) -> Result<ToolLogEntry> {
    let session = db
        .get_session(session_id)?
        .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;

    let event = ToolCallEvent::new(
        session.id.clone(),
        tool_name,
        input_summary,
        output_summary,
        duration_ms,
    );
    let entry = log_tool_call(db, &event)?;
    db.increment_tool_calls(&session.id)?;

    Ok(entry)
}

pub fn query_tool_calls(
    db: &StateStore,
    session_id: &str,
    page: u64,
    page_size: u64,
) -> Result<ToolLogPage> {
    let session = db
        .get_session(session_id)?
        .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;

    ToolLogger::new(db).query(&session.id, page, page_size)
}

pub async fn resume_session(db: &StateStore, _cfg: &Config, id: &str) -> Result<String> {
    resume_session_with_program(db, id, None).await
}

async fn resume_session_with_program(
    db: &StateStore,
    id: &str,
    runner_executable_override: Option<&Path>,
) -> Result<String> {
    let session = resolve_session(db, id)?;

    if session.state == SessionState::Completed {
        anyhow::bail!("Completed sessions cannot be resumed: {}", session.id);
    }

    if session.state == SessionState::Running {
        anyhow::bail!("Session is already running: {}", session.id);
    }

    db.update_state_and_pid(&session.id, &SessionState::Pending, None)?;
    let runner_executable = match runner_executable_override {
        Some(program) => program.to_path_buf(),
        None => std::env::current_exe().context("Failed to resolve ECC executable path")?,
    };
    spawn_session_runner_for_program(
        &session.task,
        &session.id,
        &session.agent_type,
        &session.working_dir,
        &runner_executable,
    )
    .await
    .with_context(|| format!("Failed to resume session {}", session.id))?;
    Ok(session.id)
}

async fn assign_session_in_dir_with_runner_program(
    db: &StateStore,
    cfg: &Config,
    lead_id: &str,
    task: &str,
    agent_type: &str,
    use_worktree: bool,
    repo_root: &Path,
    runner_program: &Path,
) -> Result<AssignmentOutcome> {
    let lead = resolve_session(db, lead_id)?;
    let delegates = direct_delegate_sessions(db, &lead.id, agent_type)?;

    if let Some(idle_delegate) = delegates
        .iter()
        .filter(|session| session.state == SessionState::Idle)
        .min_by_key(|session| session.updated_at)
    {
        send_task_handoff(db, &lead, &idle_delegate.id, task, "reused idle delegate")?;
        return Ok(AssignmentOutcome {
            session_id: idle_delegate.id.clone(),
            action: AssignmentAction::ReusedIdle,
        });
    }

    if delegates.len() < cfg.max_parallel_sessions {
        let session_id = queue_session_in_dir_with_runner_program(
            db,
            cfg,
            task,
            agent_type,
            use_worktree,
            repo_root,
            runner_program,
        )
        .await?;
        send_task_handoff(db, &lead, &session_id, task, "spawned new delegate")?;
        return Ok(AssignmentOutcome {
            session_id,
            action: AssignmentAction::Spawned,
        });
    }

    if let Some(active_delegate) = delegates
        .iter()
        .filter(|session| matches!(session.state, SessionState::Running | SessionState::Pending))
        .min_by_key(|session| session.updated_at)
    {
        send_task_handoff(
            db,
            &lead,
            &active_delegate.id,
            task,
            "reused active delegate at capacity",
        )?;
        return Ok(AssignmentOutcome {
            session_id: active_delegate.id.clone(),
            action: AssignmentAction::ReusedActive,
        });
    }

    let session_id = queue_session_in_dir_with_runner_program(
        db,
        cfg,
        task,
        agent_type,
        use_worktree,
        repo_root,
        runner_program,
    )
    .await?;
    send_task_handoff(db, &lead, &session_id, task, "spawned fallback delegate")?;
    Ok(AssignmentOutcome {
        session_id,
        action: AssignmentAction::Spawned,
    })
}

fn collect_delegation_descendants(
    db: &StateStore,
    session_id: &str,
    remaining_depth: usize,
    current_depth: usize,
    unread_counts: &std::collections::HashMap<String, usize>,
    visited: &mut HashSet<String>,
    descendants: &mut Vec<DelegatedSessionSummary>,
) -> Result<()> {
    if remaining_depth == 0 {
        return Ok(());
    }

    for child_id in db.delegated_children(session_id, 50)? {
        if !visited.insert(child_id.clone()) {
            continue;
        }

        let Some(session) = db.get_session(&child_id)? else {
            continue;
        };

        descendants.push(DelegatedSessionSummary {
            depth: current_depth,
            unread_messages: unread_counts.get(&child_id).copied().unwrap_or(0),
            session,
        });

        collect_delegation_descendants(
            db,
            &child_id,
            remaining_depth.saturating_sub(1),
            current_depth + 1,
            unread_counts,
            visited,
            descendants,
        )?;
    }

    Ok(())
}

pub async fn cleanup_session_worktree(db: &StateStore, id: &str) -> Result<()> {
    let session = resolve_session(db, id)?;

    if session.state == SessionState::Running {
        stop_session_with_options(db, &session.id, true).await?;
        db.clear_worktree(&session.id)?;
        return Ok(());
    }

    if let Some(worktree) = session.worktree.as_ref() {
        crate::worktree::remove(&worktree.path)?;
        db.clear_worktree(&session.id)?;
    }

    Ok(())
}

pub async fn delete_session(db: &StateStore, id: &str) -> Result<()> {
    let session = resolve_session(db, id)?;

    if matches!(
        session.state,
        SessionState::Pending | SessionState::Running | SessionState::Idle
    ) {
        anyhow::bail!(
            "Cannot delete active session {} while it is {}",
            session.id,
            session.state
        );
    }

    if let Some(worktree) = session.worktree.as_ref() {
        let _ = crate::worktree::remove(&worktree.path);
    }

    db.delete_session(&session.id)?;
    Ok(())
}

fn agent_program(agent_type: &str) -> Result<PathBuf> {
    match agent_type {
        "claude" => Ok(PathBuf::from("claude")),
        other => anyhow::bail!("Unsupported agent type: {other}"),
    }
}

fn resolve_session(db: &StateStore, id: &str) -> Result<Session> {
    let session = if id == "latest" {
        db.get_latest_session()?
    } else {
        db.get_session(id)?
    };

    session.ok_or_else(|| anyhow::anyhow!("Session not found: {id}"))
}

pub async fn run_session(
    cfg: &Config,
    session_id: &str,
    task: &str,
    agent_type: &str,
    working_dir: &Path,
) -> Result<()> {
    let db = StateStore::open(&cfg.db_path)?;
    let session = resolve_session(&db, session_id)?;

    if session.state != SessionState::Pending {
        tracing::info!(
            "Skipping run_session for {} because state is {}",
            session_id,
            session.state
        );
        return Ok(());
    }

    let agent_program = agent_program(agent_type)?;
    let command = build_agent_command(&agent_program, task, session_id, working_dir);
    capture_command_output(
        cfg.db_path.clone(),
        session_id.to_string(),
        command,
        SessionOutputStore::default(),
    )
    .await?;
    Ok(())
}

async fn queue_session_in_dir(
    db: &StateStore,
    cfg: &Config,
    task: &str,
    agent_type: &str,
    use_worktree: bool,
    repo_root: &Path,
) -> Result<String> {
    queue_session_in_dir_with_runner_program(
        db,
        cfg,
        task,
        agent_type,
        use_worktree,
        repo_root,
        &std::env::current_exe().context("Failed to resolve ECC executable path")?,
    )
    .await
}

async fn queue_session_in_dir_with_runner_program(
    db: &StateStore,
    cfg: &Config,
    task: &str,
    agent_type: &str,
    use_worktree: bool,
    repo_root: &Path,
    runner_program: &Path,
) -> Result<String> {
    let session = build_session_record(task, agent_type, use_worktree, cfg, repo_root)?;
    db.insert_session(&session)?;

    let working_dir = session
        .worktree
        .as_ref()
        .map(|worktree| worktree.path.as_path())
        .unwrap_or(repo_root);

    match spawn_session_runner_for_program(task, &session.id, agent_type, working_dir, runner_program).await {
        Ok(()) => Ok(session.id),
        Err(error) => {
            db.update_state(&session.id, &SessionState::Failed)?;

            if let Some(worktree) = session.worktree.as_ref() {
                let _ = crate::worktree::remove(&worktree.path);
            }

            Err(error.context(format!("Failed to queue session {}", session.id)))
        }
    }
}

fn build_session_record(
    task: &str,
    agent_type: &str,
    use_worktree: bool,
    cfg: &Config,
    repo_root: &Path,
) -> Result<Session> {
    let id = uuid::Uuid::new_v4().to_string()[..8].to_string();
    let now = chrono::Utc::now();

    let worktree = if use_worktree {
        Some(worktree::create_for_session_in_repo(&id, cfg, repo_root)?)
    } else {
        None
    };
    let working_dir = worktree
        .as_ref()
        .map(|worktree| worktree.path.clone())
        .unwrap_or_else(|| repo_root.to_path_buf());

    Ok(Session {
        id,
        task: task.to_string(),
        agent_type: agent_type.to_string(),
        working_dir,
        state: SessionState::Pending,
        pid: None,
        worktree,
        created_at: now,
        updated_at: now,
        metrics: SessionMetrics::default(),
    })
}

async fn create_session_in_dir(
    db: &StateStore,
    cfg: &Config,
    task: &str,
    agent_type: &str,
    use_worktree: bool,
    repo_root: &Path,
    agent_program: &Path,
) -> Result<String> {
    let session = build_session_record(task, agent_type, use_worktree, cfg, repo_root)?;

    db.insert_session(&session)?;

    let working_dir = session
        .worktree
        .as_ref()
        .map(|worktree| worktree.path.as_path())
        .unwrap_or(repo_root);

    match spawn_claude_code(agent_program, task, &session.id, working_dir).await {
        Ok(pid) => {
            db.update_pid(&session.id, Some(pid))?;
            db.update_state(&session.id, &SessionState::Running)?;
            Ok(session.id)
        }
        Err(error) => {
            db.update_state(&session.id, &SessionState::Failed)?;

            if let Some(worktree) = session.worktree.as_ref() {
                let _ = crate::worktree::remove(&worktree.path);
            }

            Err(error.context(format!("Failed to start session {}", session.id)))
        }
    }
}

async fn spawn_session_runner(
    task: &str,
    session_id: &str,
    agent_type: &str,
    working_dir: &Path,
) -> Result<()> {
    spawn_session_runner_for_program(
        task,
        session_id,
        agent_type,
        working_dir,
        &std::env::current_exe().context("Failed to resolve ECC executable path")?,
    )
    .await
}

fn direct_delegate_sessions(db: &StateStore, lead_id: &str, agent_type: &str) -> Result<Vec<Session>> {
    let mut sessions = Vec::new();
    for child_id in db.delegated_children(lead_id, 50)? {
        let Some(session) = db.get_session(&child_id)? else {
            continue;
        };

        if session.agent_type != agent_type {
            continue;
        }

        if matches!(
            session.state,
            SessionState::Pending | SessionState::Running | SessionState::Idle
        ) {
            sessions.push(session);
        }
    }

    Ok(sessions)
}

fn send_task_handoff(
    db: &StateStore,
    from_session: &Session,
    to_session_id: &str,
    task: &str,
    routing_reason: &str,
) -> Result<()> {
    let context = format!(
        "Assigned by {} [{}] | cwd {}{} | {}",
        from_session.id,
        from_session.agent_type,
        from_session.working_dir.display(),
        from_session
            .worktree
            .as_ref()
            .map(|worktree| format!(
                " | worktree {} ({})",
                worktree.branch,
                worktree.path.display()
            ))
            .unwrap_or_default(),
        routing_reason
    );

    crate::comms::send(
        db,
        &from_session.id,
        to_session_id,
        &crate::comms::MessageType::TaskHandoff {
            task: task.to_string(),
            context,
        },
    )
}

async fn spawn_session_runner_for_program(
    task: &str,
    session_id: &str,
    agent_type: &str,
    working_dir: &Path,
    current_exe: &Path,
) -> Result<()> {
    let child = Command::new(current_exe)
        .arg("run-session")
        .arg("--session-id")
        .arg(session_id)
        .arg("--task")
        .arg(task)
        .arg("--agent")
        .arg(agent_type)
        .arg("--cwd")
        .arg(working_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .with_context(|| {
            format!(
                "Failed to spawn ECC runner from {}",
                current_exe.display()
            )
        })?;

    child
        .id()
        .ok_or_else(|| anyhow::anyhow!("ECC runner did not expose a process id"))?;
    Ok(())
}

fn build_agent_command(agent_program: &Path, task: &str, session_id: &str, working_dir: &Path) -> Command {
    let mut command = Command::new(agent_program);
    command
        .arg("--print")
        .arg("--name")
        .arg(format!("ecc-{session_id}"))
        .arg(task)
        .current_dir(working_dir)
        .stdin(Stdio::null());
    command
}

async fn spawn_claude_code(
    agent_program: &Path,
    task: &str,
    session_id: &str,
    working_dir: &Path,
) -> Result<u32> {
    let mut command = build_agent_command(agent_program, task, session_id, working_dir);
    let child = command
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .with_context(|| {
            format!(
                "Failed to spawn Claude Code from {}",
                agent_program.display()
            )
        })?;

    child
        .id()
        .ok_or_else(|| anyhow::anyhow!("Claude Code did not expose a process id"))
}

async fn stop_session_with_options(
    db: &StateStore,
    id: &str,
    cleanup_worktree: bool,
) -> Result<()> {
    let session = resolve_session(db, id)?;

    if let Some(pid) = session.pid {
        kill_process(pid).await?;
    }

    db.update_pid(&session.id, None)?;
    db.update_state(&session.id, &SessionState::Stopped)?;

    if cleanup_worktree {
        if let Some(worktree) = session.worktree.as_ref() {
            crate::worktree::remove(&worktree.path)?;
        }
    }

    Ok(())
}

#[cfg(unix)]
async fn kill_process(pid: u32) -> Result<()> {
    send_signal(pid, libc::SIGTERM)?;
    tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
    send_signal(pid, libc::SIGKILL)?;
    Ok(())
}

#[cfg(unix)]
fn send_signal(pid: u32, signal: i32) -> Result<()> {
    let outcome = unsafe { libc::kill(pid as i32, signal) };
    if outcome == 0 {
        return Ok(());
    }

    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        return Ok(());
    }

    Err(error).with_context(|| format!("Failed to kill process {pid}"))
}

#[cfg(not(unix))]
async fn kill_process(pid: u32) -> Result<()> {
    let status = Command::new("taskkill")
        .args(["/F", "/PID", &pid.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .with_context(|| format!("Failed to invoke taskkill for process {pid}"))?;

    if status.success() {
        Ok(())
    } else {
        anyhow::bail!("taskkill failed for process {pid}");
    }
}

pub struct SessionStatus {
    session: Session,
    parent_session: Option<String>,
    delegated_children: Vec<String>,
}

pub struct TeamStatus {
    root: Session,
    unread_messages: std::collections::HashMap<String, usize>,
    descendants: Vec<DelegatedSessionSummary>,
}

pub struct AssignmentOutcome {
    pub session_id: String,
    pub action: AssignmentAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssignmentAction {
    Spawned,
    ReusedIdle,
    ReusedActive,
}

struct DelegatedSessionSummary {
    depth: usize,
    unread_messages: usize,
    session: Session,
}

impl fmt::Display for SessionStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = &self.session;
        writeln!(f, "Session: {}", s.id)?;
        writeln!(f, "Task:    {}", s.task)?;
        writeln!(f, "Agent:   {}", s.agent_type)?;
        writeln!(f, "State:   {}", s.state)?;
        if let Some(parent) = self.parent_session.as_ref() {
            writeln!(f, "Parent:  {}", parent)?;
        }
        if let Some(pid) = s.pid {
            writeln!(f, "PID:     {}", pid)?;
        }
        if let Some(ref wt) = s.worktree {
            writeln!(f, "Branch:  {}", wt.branch)?;
            writeln!(f, "Worktree: {}", wt.path.display())?;
        }
        writeln!(f, "Tokens:  {}", s.metrics.tokens_used)?;
        writeln!(f, "Tools:   {}", s.metrics.tool_calls)?;
        writeln!(f, "Files:   {}", s.metrics.files_changed)?;
        writeln!(f, "Cost:    ${:.4}", s.metrics.cost_usd)?;
        if !self.delegated_children.is_empty() {
            writeln!(f, "Children: {}", self.delegated_children.join(", "))?;
        }
        writeln!(f, "Created: {}", s.created_at)?;
        write!(f, "Updated: {}", s.updated_at)
    }
}

impl fmt::Display for TeamStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "Lead:    {} [{}]", self.root.id, self.root.state)?;
        writeln!(f, "Task:    {}", self.root.task)?;
        writeln!(f, "Agent:   {}", self.root.agent_type)?;
        if let Some(worktree) = self.root.worktree.as_ref() {
            writeln!(f, "Branch:  {}", worktree.branch)?;
        }

        let lead_unread = self.unread_messages.get(&self.root.id).copied().unwrap_or(0);
        writeln!(f, "Inbox:   {}", lead_unread)?;

        if self.descendants.is_empty() {
            return write!(f, "Board:   no delegated sessions");
        }

        writeln!(f, "Board:")?;
        let mut lanes: BTreeMap<&'static str, Vec<&DelegatedSessionSummary>> = BTreeMap::new();
        for summary in &self.descendants {
            lanes.entry(session_state_label(&summary.session.state))
                .or_default()
                .push(summary);
        }

        for lane in [
            "Running",
            "Idle",
            "Pending",
            "Failed",
            "Stopped",
            "Completed",
        ] {
            let Some(items) = lanes.get(lane) else {
                continue;
            };

            writeln!(f, "  {lane}:")?;
            for item in items {
                writeln!(
                    f,
                    "    - {}{} [{}] | inbox {} | {}",
                    "  ".repeat(item.depth.saturating_sub(1)),
                    item.session.id,
                    item.session.agent_type,
                    item.unread_messages,
                    item.session.task
                )?;
            }
        }

        Ok(())
    }
}

fn session_state_label(state: &SessionState) -> &'static str {
    match state {
        SessionState::Pending => "Pending",
        SessionState::Running => "Running",
        SessionState::Idle => "Idle",
        SessionState::Completed => "Completed",
        SessionState::Failed => "Failed",
        SessionState::Stopped => "Stopped",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Config, PaneLayout, Theme};
    use crate::session::{Session, SessionMetrics, SessionState};
    use anyhow::{Context, Result};
    use chrono::{Duration, Utc};
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::process::Command as StdCommand;
    use std::thread;
    use std::time::Duration as StdDuration;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(label: &str) -> Result<Self> {
            let path =
                std::env::temp_dir().join(format!("ecc2-{}-{}", label, uuid::Uuid::new_v4()));
            fs::create_dir_all(&path)?;
            Ok(Self { path })
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn build_config(root: &Path) -> Config {
        Config {
            db_path: root.join("state.db"),
            worktree_root: root.join("worktrees"),
            max_parallel_sessions: 4,
            max_parallel_worktrees: 4,
            session_timeout_secs: 60,
            heartbeat_interval_secs: 5,
            default_agent: "claude".to_string(),
            cost_budget_usd: 10.0,
            token_budget: 500_000,
            theme: Theme::Dark,
            pane_layout: PaneLayout::Horizontal,
            risk_thresholds: Config::RISK_THRESHOLDS,
        }
    }

    fn build_session(id: &str, state: SessionState, updated_at: chrono::DateTime<Utc>) -> Session {
        Session {
            id: id.to_string(),
            task: format!("task-{id}"),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state,
            pid: None,
            worktree: None,
            created_at: updated_at - Duration::minutes(1),
            updated_at,
            metrics: SessionMetrics::default(),
        }
    }

    fn init_git_repo(path: &Path) -> Result<()> {
        fs::create_dir_all(path)?;
        run_git(path, ["init", "-q"])?;
        fs::write(path.join("README.md"), "hello\n")?;
        run_git(path, ["add", "README.md"])?;
        run_git(
            path,
            [
                "-c",
                "user.name=ECC Tests",
                "-c",
                "user.email=ecc-tests@example.com",
                "commit",
                "-qm",
                "init",
            ],
        )?;
        Ok(())
    }

    fn run_git<const N: usize>(path: &Path, args: [&str; N]) -> Result<()> {
        let status = StdCommand::new("git")
            .args(args)
            .current_dir(path)
            .status()
            .with_context(|| format!("failed to run git in {}", path.display()))?;

        if !status.success() {
            anyhow::bail!("git command failed in {}", path.display());
        }

        Ok(())
    }

    fn write_fake_claude(root: &Path) -> Result<(PathBuf, PathBuf)> {
        let script_path = root.join("fake-claude.sh");
        let log_path = root.join("fake-claude.log");
        let script = format!(
            "#!/usr/bin/env python3\nimport os\nimport pathlib\nimport signal\nimport sys\nimport time\n\nlog_path = pathlib.Path(r\"{}\")\nlog_path.write_text(os.getcwd() + \"\\n\", encoding=\"utf-8\")\nwith log_path.open(\"a\", encoding=\"utf-8\") as handle:\n    handle.write(\" \".join(sys.argv[1:]) + \"\\n\")\n\ndef handle_term(signum, frame):\n    raise SystemExit(0)\n\nsignal.signal(signal.SIGTERM, handle_term)\nwhile True:\n    time.sleep(0.1)\n",
            log_path.display()
        );

        fs::write(&script_path, script)?;
        let mut permissions = fs::metadata(&script_path)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&script_path, permissions)?;

        Ok((script_path, log_path))
    }

    fn wait_for_file(path: &Path) -> Result<String> {
        for _ in 0..200 {
            if path.exists() {
                return fs::read_to_string(path)
                    .with_context(|| format!("failed to read {}", path.display()));
            }

            thread::sleep(StdDuration::from_millis(20));
        }

        anyhow::bail!("timed out waiting for {}", path.display());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn create_session_spawns_process_and_marks_session_running() -> Result<()> {
        let tempdir = TestDir::new("manager-create-session")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let (fake_claude, log_path) = write_fake_claude(tempdir.path())?;

        let session_id = create_session_in_dir(
            &db,
            &cfg,
            "implement lifecycle",
            "claude",
            false,
            &repo_root,
            &fake_claude,
        )
        .await?;

        let session = db
            .get_session(&session_id)?
            .context("session should exist")?;
        assert_eq!(session.state, SessionState::Running);
        assert!(
            session.pid.is_some(),
            "spawned session should persist a pid"
        );

        let log = wait_for_file(&log_path)?;
        assert!(log.contains(repo_root.to_string_lossy().as_ref()));
        assert!(log.contains("--print"));
        assert!(log.contains("implement lifecycle"));

        stop_session_with_options(&db, &session_id, false).await?;
        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn stop_session_kills_process_and_optionally_cleans_worktree() -> Result<()> {
        let tempdir = TestDir::new("manager-stop-session")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let (fake_claude, _) = write_fake_claude(tempdir.path())?;

        let keep_id = create_session_in_dir(
            &db,
            &cfg,
            "keep worktree",
            "claude",
            true,
            &repo_root,
            &fake_claude,
        )
        .await?;
        let keep_session = db.get_session(&keep_id)?.context("keep session missing")?;
        keep_session.pid.context("keep session pid missing")?;
        let keep_worktree = keep_session
            .worktree
            .clone()
            .context("keep session worktree missing")?
            .path;

        stop_session_with_options(&db, &keep_id, false).await?;

        let stopped_keep = db
            .get_session(&keep_id)?
            .context("stopped keep session missing")?;
        assert_eq!(stopped_keep.state, SessionState::Stopped);
        assert_eq!(stopped_keep.pid, None);
        assert!(
            keep_worktree.exists(),
            "worktree should remain when cleanup is disabled"
        );

        let cleanup_id = create_session_in_dir(
            &db,
            &cfg,
            "cleanup worktree",
            "claude",
            true,
            &repo_root,
            &fake_claude,
        )
        .await?;
        let cleanup_session = db
            .get_session(&cleanup_id)?
            .context("cleanup session missing")?;
        let cleanup_worktree = cleanup_session
            .worktree
            .clone()
            .context("cleanup session worktree missing")?
            .path;

        stop_session_with_options(&db, &cleanup_id, true).await?;
        assert!(
            !cleanup_worktree.exists(),
            "worktree should be removed when cleanup is enabled"
        );

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn resume_session_requeues_failed_session() -> Result<()> {
        let tempdir = TestDir::new("manager-resume-session")?;
        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "deadbeef".to_string(),
            task: "resume previous task".to_string(),
            agent_type: "claude".to_string(),
            working_dir: tempdir.path().join("resume-working-dir"),
            state: SessionState::Failed,
            pid: Some(31337),
            worktree: None,
            created_at: now - Duration::minutes(1),
            updated_at: now,
            metrics: SessionMetrics::default(),
        })?;

        fs::create_dir_all(tempdir.path().join("resume-working-dir"))?;
        let (fake_claude, log_path) = write_fake_claude(tempdir.path())?;

        let resumed_id = resume_session_with_program(&db, "deadbeef", Some(&fake_claude)).await?;
        let resumed = db
            .get_session(&resumed_id)?
            .context("resumed session should exist")?;

        assert_eq!(resumed.state, SessionState::Pending);
        assert_eq!(resumed.pid, None);

        let log = wait_for_file(&log_path)?;
        assert!(log.contains("run-session"));
        assert!(log.contains("--session-id"));
        assert!(log.contains("deadbeef"));
        assert!(log.contains("resume previous task"));
        assert!(log.contains(tempdir.path().join("resume-working-dir").to_string_lossy().as_ref()));

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn cleanup_session_worktree_removes_path_and_clears_metadata() -> Result<()> {
        let tempdir = TestDir::new("manager-cleanup-worktree")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let (fake_claude, _) = write_fake_claude(tempdir.path())?;

        let session_id = create_session_in_dir(
            &db,
            &cfg,
            "cleanup later",
            "claude",
            true,
            &repo_root,
            &fake_claude,
        )
        .await?;

        stop_session_with_options(&db, &session_id, false).await?;
        let stopped = db
            .get_session(&session_id)?
            .context("stopped session should exist")?;
        let worktree_path = stopped
            .worktree
            .clone()
            .context("stopped session worktree missing")?
            .path;
        assert!(worktree_path.exists(), "worktree should still exist before cleanup");

        cleanup_session_worktree(&db, &session_id).await?;

        let cleaned = db
            .get_session(&session_id)?
            .context("cleaned session should still exist")?;
        assert!(cleaned.worktree.is_none(), "worktree metadata should be cleared");
        assert!(!worktree_path.exists(), "worktree path should be removed");

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn delete_session_removes_inactive_session_and_worktree() -> Result<()> {
        let tempdir = TestDir::new("manager-delete-session")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let (fake_claude, _) = write_fake_claude(tempdir.path())?;

        let session_id = create_session_in_dir(
            &db,
            &cfg,
            "delete later",
            "claude",
            true,
            &repo_root,
            &fake_claude,
        )
        .await?;

        stop_session_with_options(&db, &session_id, false).await?;
        let stopped = db
            .get_session(&session_id)?
            .context("stopped session should exist")?;
        let worktree_path = stopped
            .worktree
            .clone()
            .context("stopped session worktree missing")?
            .path;

        delete_session(&db, &session_id).await?;

        assert!(db.get_session(&session_id)?.is_none(), "session should be deleted");
        assert!(!worktree_path.exists(), "worktree path should be removed");

        Ok(())
    }

    #[test]
    fn get_status_supports_latest_alias() -> Result<()> {
        let tempdir = TestDir::new("manager-latest-status")?;
        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let older = Utc::now() - Duration::minutes(2);
        let newer = Utc::now();

        db.insert_session(&build_session("older", SessionState::Running, older))?;
        db.insert_session(&build_session("newer", SessionState::Idle, newer))?;

        let status = get_status(&db, "latest")?;
        assert_eq!(status.session.id, "newer");

        Ok(())
    }

    #[test]
    fn get_status_surfaces_handoff_lineage() -> Result<()> {
        let tempdir = TestDir::new("manager-status-lineage")?;
        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&build_session("parent", SessionState::Running, now - Duration::minutes(2)))?;
        db.insert_session(&build_session("child", SessionState::Pending, now - Duration::minutes(1)))?;
        db.insert_session(&build_session("sibling", SessionState::Idle, now))?;

        db.send_message(
            "parent",
            "child",
            "{\"task\":\"Review auth flow\",\"context\":\"Delegated from parent\"}",
            "task_handoff",
        )?;
        db.send_message(
            "parent",
            "sibling",
            "{\"task\":\"Check billing\",\"context\":\"Delegated from parent\"}",
            "task_handoff",
        )?;

        let status = get_status(&db, "parent")?;
        let rendered = status.to_string();

        assert!(rendered.contains("Children:"));
        assert!(rendered.contains("child"));
        assert!(rendered.contains("sibling"));

        let child_status = get_status(&db, "child")?;
        assert_eq!(child_status.parent_session.as_deref(), Some("parent"));

        Ok(())
    }

    #[test]
    fn get_team_status_groups_delegated_children() -> Result<()> {
        let tempdir = TestDir::new("manager-team-status")?;
        let _cfg = build_config(tempdir.path());
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&build_session("lead", SessionState::Running, now - Duration::minutes(3)))?;
        db.insert_session(&build_session("worker-a", SessionState::Running, now - Duration::minutes(2)))?;
        db.insert_session(&build_session("worker-b", SessionState::Pending, now - Duration::minutes(1)))?;
        db.insert_session(&build_session("reviewer", SessionState::Completed, now))?;

        db.send_message(
            "lead",
            "worker-a",
            "{\"task\":\"Implement auth\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;
        db.send_message(
            "lead",
            "worker-b",
            "{\"task\":\"Check billing\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;
        db.send_message(
            "worker-a",
            "reviewer",
            "{\"task\":\"Review auth\",\"context\":\"Delegated from worker-a\"}",
            "task_handoff",
        )?;

        let team = get_team_status(&db, "lead", 2)?;
        let rendered = team.to_string();

        assert!(rendered.contains("Lead:    lead [running]"));
        assert!(rendered.contains("Running:"));
        assert!(rendered.contains("Pending:"));
        assert!(rendered.contains("Completed:"));
        assert!(rendered.contains("worker-a"));
        assert!(rendered.contains("worker-b"));
        assert!(rendered.contains("reviewer"));

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn assign_session_reuses_idle_delegate_when_available() -> Result<()> {
        let tempdir = TestDir::new("manager-assign-reuse-idle")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead".to_string(),
            task: "lead task".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(42),
            worktree: None,
            created_at: now - Duration::minutes(2),
            updated_at: now - Duration::minutes(2),
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "idle-worker".to_string(),
            task: "old worker task".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Idle,
            pid: Some(99),
            worktree: None,
            created_at: now - Duration::minutes(1),
            updated_at: now - Duration::minutes(1),
            metrics: SessionMetrics::default(),
        })?;
        db.send_message(
            "lead",
            "idle-worker",
            "{\"task\":\"old worker task\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;

        let (fake_runner, _) = write_fake_claude(tempdir.path())?;
        let outcome = assign_session_in_dir_with_runner_program(
            &db,
            &cfg,
            "lead",
            "Review billing edge cases",
            "claude",
            true,
            &repo_root,
            &fake_runner,
        )
        .await?;

        assert_eq!(outcome.session_id, "idle-worker");
        assert_eq!(outcome.action, AssignmentAction::ReusedIdle);

        let messages = db.list_messages_for_session("idle-worker", 10)?;
        assert!(messages.iter().any(|message| {
            message.msg_type == "task_handoff"
                && message.content.contains("Review billing edge cases")
        }));

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn assign_session_spawns_when_team_has_capacity() -> Result<()> {
        let tempdir = TestDir::new("manager-assign-spawn")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead".to_string(),
            task: "lead task".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(42),
            worktree: None,
            created_at: now - Duration::minutes(3),
            updated_at: now - Duration::minutes(3),
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "busy-worker".to_string(),
            task: "existing work".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(55),
            worktree: None,
            created_at: now - Duration::minutes(2),
            updated_at: now - Duration::minutes(2),
            metrics: SessionMetrics::default(),
        })?;
        db.send_message(
            "lead",
            "busy-worker",
            "{\"task\":\"existing work\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;

        let (fake_runner, _) = write_fake_claude(tempdir.path())?;
        let outcome = assign_session_in_dir_with_runner_program(
            &db,
            &cfg,
            "lead",
            "New delegated task",
            "claude",
            true,
            &repo_root,
            &fake_runner,
        )
        .await?;

        assert_eq!(outcome.action, AssignmentAction::Spawned);
        assert_ne!(outcome.session_id, "busy-worker");

        let spawned = db
            .get_session(&outcome.session_id)?
            .context("spawned delegated session missing")?;
        assert_eq!(spawned.state, SessionState::Pending);

        let messages = db.list_messages_for_session(&outcome.session_id, 10)?;
        assert!(messages.iter().any(|message| {
            message.msg_type == "task_handoff"
                && message.content.contains("New delegated task")
        }));

        Ok(())
    }
}

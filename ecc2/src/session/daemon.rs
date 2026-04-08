use anyhow::Result;
use std::future::Future;
use std::time::Duration;
use tokio::time;

use super::manager;
use super::store::StateStore;
use super::SessionState;
use crate::config::Config;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct DispatchPassSummary {
    routed: usize,
    deferred: usize,
    leads: usize,
}

/// Background daemon that monitors sessions, handles heartbeats,
/// and cleans up stale resources.
pub async fn run(db: StateStore, cfg: Config) -> Result<()> {
    tracing::info!("ECC daemon started");
    resume_crashed_sessions(&db)?;

    let heartbeat_interval = Duration::from_secs(cfg.heartbeat_interval_secs);
    let timeout = Duration::from_secs(cfg.session_timeout_secs);

    loop {
        if let Err(e) = check_sessions(&db, timeout) {
            tracing::error!("Session check failed: {e}");
        }

        if let Err(e) = coordinate_backlog_cycle(&db, &cfg).await {
            tracing::error!("Backlog coordination pass failed: {e}");
        }

        time::sleep(heartbeat_interval).await;
    }
}

pub fn resume_crashed_sessions(db: &StateStore) -> Result<()> {
    let failed_sessions = resume_crashed_sessions_with(db, pid_is_alive)?;
    if failed_sessions > 0 {
        tracing::warn!("Marked {failed_sessions} crashed sessions as failed during daemon startup");
    }
    Ok(())
}

fn resume_crashed_sessions_with<F>(db: &StateStore, is_pid_alive: F) -> Result<usize>
where
    F: Fn(u32) -> bool,
{
    let sessions = db.list_sessions()?;
    let mut failed_sessions = 0;

    for session in sessions {
        if session.state != SessionState::Running {
            continue;
        }

        let is_alive = session.pid.is_some_and(&is_pid_alive);
        if is_alive {
            continue;
        }

        tracing::warn!(
            "Session {} was left running with stale pid {:?}; marking it failed",
            session.id,
            session.pid
        );
        db.update_state_and_pid(&session.id, &SessionState::Failed, None)?;
        failed_sessions += 1;
    }

    Ok(failed_sessions)
}

fn check_sessions(db: &StateStore, timeout: Duration) -> Result<()> {
    let sessions = db.list_sessions()?;

    for session in sessions {
        if session.state != SessionState::Running {
            continue;
        }

        let elapsed = chrono::Utc::now()
            .signed_duration_since(session.updated_at)
            .to_std()
            .unwrap_or(Duration::ZERO);

        if elapsed > timeout {
            tracing::warn!("Session {} timed out after {:?}", session.id, elapsed);
            db.update_state_and_pid(&session.id, &SessionState::Failed, None)?;
        }
    }

    Ok(())
}

async fn maybe_auto_dispatch(db: &StateStore, cfg: &Config) -> Result<usize> {
    let summary = maybe_auto_dispatch_with_recorder(cfg, || {
        manager::auto_dispatch_backlog(
            db,
            cfg,
            &cfg.default_agent,
            true,
            cfg.max_parallel_sessions,
        )
    }, |routed, leads| db.record_daemon_dispatch_pass(routed, leads))
    .await?;
    Ok(summary.routed)
}

async fn coordinate_backlog_cycle(db: &StateStore, cfg: &Config) -> Result<()> {
    coordinate_backlog_cycle_with(
        cfg,
        || {
            maybe_auto_dispatch_with_recorder(cfg, || {
                manager::auto_dispatch_backlog(
                    db,
                    cfg,
                    &cfg.default_agent,
                    true,
                    cfg.max_parallel_sessions,
                )
            }, |routed, leads| db.record_daemon_dispatch_pass(routed, leads))
        },
        || {
            maybe_auto_rebalance_with_recorder(cfg, || {
                manager::rebalance_all_teams(
                    db,
                    cfg,
                    &cfg.default_agent,
                    true,
                    cfg.max_parallel_sessions,
                )
            }, |rerouted, leads| db.record_daemon_rebalance_pass(rerouted, leads))
        },
    )
    .await?;
    Ok(())
}

async fn coordinate_backlog_cycle_with<DF, DFut, RF, RFut>(
    _cfg: &Config,
    dispatch: DF,
    rebalance: RF,
) -> Result<(DispatchPassSummary, usize, DispatchPassSummary)>
where
    DF: Fn() -> DFut,
    DFut: Future<Output = Result<DispatchPassSummary>>,
    RF: Fn() -> RFut,
    RFut: Future<Output = Result<usize>>,
{
    let first_dispatch = dispatch().await?;
    let rebalanced = rebalance().await?;
    let recovery_dispatch = if first_dispatch.deferred > 0 && rebalanced > 0 {
        let recovery = dispatch().await?;
        if recovery.routed > 0 {
            tracing::info!(
                "Recovered {} deferred task handoff(s) after rebalancing",
                recovery.routed
            );
        }
        recovery
    } else {
        DispatchPassSummary::default()
    };

    Ok((first_dispatch, rebalanced, recovery_dispatch))
}

async fn maybe_auto_dispatch_with<F, Fut>(cfg: &Config, dispatch: F) -> Result<usize>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<Vec<manager::LeadDispatchOutcome>>>,
{
    Ok(maybe_auto_dispatch_with_recorder(cfg, dispatch, |_, _| Ok(())).await?.routed)
}

async fn maybe_auto_dispatch_with_recorder<F, Fut, R>(
    cfg: &Config,
    dispatch: F,
    mut record: R,
) -> Result<DispatchPassSummary>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<Vec<manager::LeadDispatchOutcome>>>,
    R: FnMut(usize, usize) -> Result<()>,
{
    if !cfg.auto_dispatch_unread_handoffs {
        return Ok(DispatchPassSummary::default());
    }

    let outcomes = dispatch().await?;
    let routed: usize = outcomes
        .iter()
        .map(|outcome| {
            outcome
                .routed
                .iter()
                .filter(|item| manager::assignment_action_routes_work(item.action))
                .count()
        })
        .sum();
    let deferred: usize = outcomes
        .iter()
        .map(|outcome| {
            outcome
                .routed
                .iter()
                .filter(|item| !manager::assignment_action_routes_work(item.action))
                .count()
        })
        .sum();
    let leads = outcomes.len();
    record(routed, leads)?;

    if routed > 0 {
        tracing::info!(
            "Auto-dispatched {routed} task handoff(s) across {} lead session(s)",
            leads
        );
    }
    if deferred > 0 {
        tracing::warn!(
            "Deferred {deferred} task handoff(s) because delegate teams were saturated"
        );
    }

    Ok(DispatchPassSummary {
        routed,
        deferred,
        leads,
    })
}

async fn maybe_auto_rebalance(db: &StateStore, cfg: &Config) -> Result<usize> {
    maybe_auto_rebalance_with_recorder(cfg, || {
        manager::rebalance_all_teams(
            db,
            cfg,
            &cfg.default_agent,
            true,
            cfg.max_parallel_sessions,
        )
    }, |rerouted, leads| db.record_daemon_rebalance_pass(rerouted, leads))
    .await
}

async fn maybe_auto_rebalance_with<F, Fut>(cfg: &Config, rebalance: F) -> Result<usize>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<Vec<manager::LeadRebalanceOutcome>>>,
{
    maybe_auto_rebalance_with_recorder(cfg, rebalance, |_, _| Ok(())).await
}

async fn maybe_auto_rebalance_with_recorder<F, Fut, R>(
    cfg: &Config,
    rebalance: F,
    mut record: R,
) -> Result<usize>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<Vec<manager::LeadRebalanceOutcome>>>,
    R: FnMut(usize, usize) -> Result<()>,
{
    if !cfg.auto_dispatch_unread_handoffs {
        return Ok(0);
    }

    let outcomes = rebalance().await?;
    let rerouted: usize = outcomes.iter().map(|outcome| outcome.rerouted.len()).sum();
    record(rerouted, outcomes.len())?;

    if rerouted > 0 {
        tracing::info!(
            "Auto-rebalanced {rerouted} task handoff(s) across {} lead session(s)",
            outcomes.len()
        );
    }

    Ok(rerouted)
}

#[cfg(unix)]
fn pid_is_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }

    // SAFETY: kill(pid, 0) probes process existence without delivering a signal.
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    if result == 0 {
        return true;
    }

    matches!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(code) if code == libc::EPERM
    )
}

#[cfg(not(unix))]
fn pid_is_alive(_pid: u32) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::manager::{
        AssignmentAction, InboxDrainOutcome, LeadDispatchOutcome, LeadRebalanceOutcome,
        RebalanceOutcome,
    };
    use crate::session::{Session, SessionMetrics, SessionState};
    use std::path::PathBuf;

    fn temp_db_path() -> PathBuf {
        std::env::temp_dir().join(format!("ecc2-daemon-test-{}.db", uuid::Uuid::new_v4()))
    }

    fn sample_session(id: &str, state: SessionState, pid: Option<u32>) -> Session {
        let now = chrono::Utc::now();
        Session {
            id: id.to_string(),
            task: "Recover crashed worker".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state,
            pid,
            worktree: None,
            created_at: now,
            updated_at: now,
            metrics: SessionMetrics::default(),
        }
    }

    #[test]
    fn resume_crashed_sessions_marks_dead_running_sessions_failed() -> Result<()> {
        let path = temp_db_path();
        let store = StateStore::open(&path)?;
        store.insert_session(&sample_session(
            "deadbeef",
            SessionState::Running,
            Some(4242),
        ))?;

        resume_crashed_sessions_with(&store, |_| false)?;

        let session = store
            .get_session("deadbeef")?
            .expect("session should still exist");
        assert_eq!(session.state, SessionState::Failed);
        assert_eq!(session.pid, None);

        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn resume_crashed_sessions_keeps_live_running_sessions_running() -> Result<()> {
        let path = temp_db_path();
        let store = StateStore::open(&path)?;
        store.insert_session(&sample_session(
            "alive123",
            SessionState::Running,
            Some(7777),
        ))?;

        resume_crashed_sessions_with(&store, |_| true)?;

        let session = store
            .get_session("alive123")?
            .expect("session should still exist");
        assert_eq!(session.state, SessionState::Running);
        assert_eq!(session.pid, Some(7777));

        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[tokio::test]
    async fn maybe_auto_dispatch_noops_when_disabled() -> Result<()> {
        let path = temp_db_path();
        let _store = StateStore::open(&path)?;
        let cfg = Config::default();
        let invoked = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let invoked_flag = invoked.clone();

        let routed = maybe_auto_dispatch_with(&cfg, move || {
            let invoked_flag = invoked_flag.clone();
            async move {
                invoked_flag.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(Vec::new())
            }
        })
        .await?;

        assert_eq!(routed, 0);
        assert!(!invoked.load(std::sync::atomic::Ordering::SeqCst));
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[tokio::test]
    async fn maybe_auto_dispatch_reports_total_routed_work() -> Result<()> {
        let path = temp_db_path();
        let _store = StateStore::open(&path)?;
        let mut cfg = Config::default();
        cfg.auto_dispatch_unread_handoffs = true;

        let routed = maybe_auto_dispatch_with(&cfg, || async move {
            Ok(vec![
                LeadDispatchOutcome {
                    lead_session_id: "lead-a".to_string(),
                    unread_count: 2,
                    routed: vec![
                        InboxDrainOutcome {
                            message_id: 1,
                            task: "Task A".to_string(),
                            session_id: "worker-a".to_string(),
                            action: AssignmentAction::Spawned,
                        },
                        InboxDrainOutcome {
                            message_id: 2,
                            task: "Task B".to_string(),
                            session_id: "worker-b".to_string(),
                            action: AssignmentAction::ReusedIdle,
                        },
                    ],
                },
                LeadDispatchOutcome {
                    lead_session_id: "lead-b".to_string(),
                    unread_count: 1,
                    routed: vec![InboxDrainOutcome {
                        message_id: 3,
                        task: "Task C".to_string(),
                        session_id: "worker-c".to_string(),
                        action: AssignmentAction::ReusedActive,
                    }],
                },
            ])
        })
        .await?;

        assert_eq!(routed, 3);
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[tokio::test]
    async fn maybe_auto_dispatch_records_latest_pass() -> Result<()> {
        let path = temp_db_path();
        let mut cfg = Config::default();
        cfg.auto_dispatch_unread_handoffs = true;

        let recorded = std::sync::Arc::new(std::sync::Mutex::new(None));
        let recorded_clone = recorded.clone();

        let routed = maybe_auto_dispatch_with_recorder(
            &cfg,
            || async move {
                Ok(vec![LeadDispatchOutcome {
                    lead_session_id: "lead-a".to_string(),
                    unread_count: 3,
                    routed: vec![
                        InboxDrainOutcome {
                            message_id: 1,
                            task: "task-a".to_string(),
                            session_id: "worker-a".to_string(),
                            action: AssignmentAction::Spawned,
                        },
                        InboxDrainOutcome {
                            message_id: 2,
                            task: "task-b".to_string(),
                            session_id: "worker-b".to_string(),
                            action: AssignmentAction::Spawned,
                        },
                    ],
                }])
            },
            move |count, leads| {
                *recorded_clone.lock().unwrap() = Some((count, leads));
                Ok(())
            },
        )
        .await?;

        assert_eq!(routed.routed, 2);
        assert_eq!(routed.deferred, 0);
        assert_eq!(*recorded.lock().unwrap(), Some((2, 1)));
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[tokio::test]
    async fn coordinate_backlog_cycle_retries_after_rebalance_when_dispatch_deferred() -> Result<()> {
        let cfg = Config {
            auto_dispatch_unread_handoffs: true,
            ..Config::default()
        };
        let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let calls_clone = calls.clone();

        let (first, rebalanced, recovery) = coordinate_backlog_cycle_with(
            &cfg,
            move || {
                let calls_clone = calls_clone.clone();
                async move {
                    let call = calls_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Ok(match call {
                        0 => DispatchPassSummary {
                            routed: 0,
                            deferred: 2,
                            leads: 1,
                        },
                        _ => DispatchPassSummary {
                            routed: 2,
                            deferred: 0,
                            leads: 1,
                        },
                    })
                }
            },
            || async move { Ok(1) },
        )
        .await?;

        assert_eq!(first.deferred, 2);
        assert_eq!(rebalanced, 1);
        assert_eq!(recovery.routed, 2);
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 2);
        Ok(())
    }

    #[tokio::test]
    async fn coordinate_backlog_cycle_skips_retry_without_rebalance() -> Result<()> {
        let cfg = Config {
            auto_dispatch_unread_handoffs: true,
            ..Config::default()
        };
        let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let calls_clone = calls.clone();

        let (first, rebalanced, recovery) = coordinate_backlog_cycle_with(
            &cfg,
            move || {
                let calls_clone = calls_clone.clone();
                async move {
                    calls_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Ok(DispatchPassSummary {
                        routed: 0,
                        deferred: 2,
                        leads: 1,
                    })
                }
            },
            || async move { Ok(0) },
        )
        .await?;

        assert_eq!(first.deferred, 2);
        assert_eq!(rebalanced, 0);
        assert_eq!(recovery, DispatchPassSummary::default());
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        Ok(())
    }

    #[tokio::test]
    async fn maybe_auto_rebalance_noops_when_disabled() -> Result<()> {
        let path = temp_db_path();
        let _store = StateStore::open(&path)?;
        let cfg = Config::default();
        let invoked = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let invoked_flag = invoked.clone();

        let rerouted = maybe_auto_rebalance_with(&cfg, move || {
            let invoked_flag = invoked_flag.clone();
            async move {
                invoked_flag.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(Vec::new())
            }
        })
        .await?;

        assert_eq!(rerouted, 0);
        assert!(!invoked.load(std::sync::atomic::Ordering::SeqCst));
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[tokio::test]
    async fn maybe_auto_rebalance_reports_total_rerouted_work() -> Result<()> {
        let path = temp_db_path();
        let _store = StateStore::open(&path)?;
        let mut cfg = Config::default();
        cfg.auto_dispatch_unread_handoffs = true;

        let rerouted = maybe_auto_rebalance_with(&cfg, || async move {
            Ok(vec![
                LeadRebalanceOutcome {
                    lead_session_id: "lead-a".to_string(),
                    rerouted: vec![
                        RebalanceOutcome {
                            from_session_id: "worker-a".to_string(),
                            message_id: 1,
                            task: "Task A".to_string(),
                            session_id: "worker-b".to_string(),
                            action: AssignmentAction::ReusedIdle,
                        },
                        RebalanceOutcome {
                            from_session_id: "worker-a".to_string(),
                            message_id: 2,
                            task: "Task B".to_string(),
                            session_id: "worker-c".to_string(),
                            action: AssignmentAction::Spawned,
                        },
                    ],
                },
                LeadRebalanceOutcome {
                    lead_session_id: "lead-b".to_string(),
                    rerouted: vec![RebalanceOutcome {
                        from_session_id: "worker-d".to_string(),
                        message_id: 3,
                        task: "Task C".to_string(),
                        session_id: "worker-e".to_string(),
                        action: AssignmentAction::ReusedActive,
                    }],
                },
            ])
        })
        .await?;

        assert_eq!(rerouted, 3);
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[tokio::test]
    async fn maybe_auto_rebalance_records_latest_pass() -> Result<()> {
        let path = temp_db_path();
        let mut cfg = Config::default();
        cfg.auto_dispatch_unread_handoffs = true;

        let recorded = std::sync::Arc::new(std::sync::Mutex::new(None));
        let recorded_clone = recorded.clone();

        let rerouted = maybe_auto_rebalance_with_recorder(
            &cfg,
            || async move {
                Ok(vec![LeadRebalanceOutcome {
                    lead_session_id: "lead-a".to_string(),
                    rerouted: vec![RebalanceOutcome {
                        from_session_id: "worker-a".to_string(),
                        message_id: 7,
                        task: "task-a".to_string(),
                        session_id: "worker-b".to_string(),
                        action: AssignmentAction::ReusedIdle,
                    }],
                }])
            },
            move |count, leads| {
                *recorded_clone.lock().unwrap() = Some((count, leads));
                Ok(())
            },
        )
        .await?;

        assert_eq!(rerouted, 1);
        assert_eq!(*recorded.lock().unwrap(), Some((1, 1)));
        let _ = std::fs::remove_file(path);
        Ok(())
    }
}

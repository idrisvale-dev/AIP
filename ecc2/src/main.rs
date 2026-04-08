mod comms;
mod config;
mod observability;
mod session;
mod tui;
mod worktree;

use anyhow::Result;
use clap::Parser;
use serde::Serialize;
use std::path::PathBuf;
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(name = "ecc", version, about = "ECC 2.0 — Agentic IDE control plane")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(clap::Subcommand, Debug)]
enum Commands {
    /// Launch the TUI dashboard
    Dashboard,
    /// Start a new agent session
    Start {
        /// Task description for the agent
        #[arg(short, long)]
        task: String,
        /// Agent type (claude, codex, custom)
        #[arg(short, long, default_value = "claude")]
        agent: String,
        /// Create a dedicated worktree for this session
        #[arg(short, long)]
        worktree: bool,
        /// Source session to delegate from
        #[arg(long)]
        from_session: Option<String>,
    },
    /// Delegate a new session from an existing one
    Delegate {
        /// Source session ID or alias
        from_session: String,
        /// Task description for the delegated session
        #[arg(short, long)]
        task: Option<String>,
        /// Agent type (claude, codex, custom)
        #[arg(short, long, default_value = "claude")]
        agent: String,
        /// Create a dedicated worktree for the delegated session
        #[arg(short, long, default_value_t = true)]
        worktree: bool,
    },
    /// Route work to an existing delegate when possible, otherwise spawn a new one
    Assign {
        /// Lead session ID or alias
        from_session: String,
        /// Task description for the assignment
        #[arg(short, long)]
        task: String,
        /// Agent type (claude, codex, custom)
        #[arg(short, long, default_value = "claude")]
        agent: String,
        /// Create a dedicated worktree if a new delegate must be spawned
        #[arg(short, long, default_value_t = true)]
        worktree: bool,
    },
    /// Route unread task handoffs from a lead session inbox through the assignment policy
    DrainInbox {
        /// Lead session ID or alias
        session_id: String,
        /// Agent type for routed delegates
        #[arg(short, long, default_value = "claude")]
        agent: String,
        /// Create a dedicated worktree if new delegates must be spawned
        #[arg(short, long, default_value_t = true)]
        worktree: bool,
        /// Maximum unread task handoffs to route
        #[arg(long, default_value_t = 5)]
        limit: usize,
    },
    /// Sweep unread task handoffs across lead sessions and route them through the assignment policy
    AutoDispatch {
        /// Agent type for routed delegates
        #[arg(short, long, default_value = "claude")]
        agent: String,
        /// Create a dedicated worktree if new delegates must be spawned
        #[arg(short, long, default_value_t = true)]
        worktree: bool,
        /// Maximum lead sessions to sweep in one pass
        #[arg(long, default_value_t = 10)]
        lead_limit: usize,
    },
    /// Dispatch unread handoffs, then rebalance delegate backlog across lead teams
    CoordinateBacklog {
        /// Agent type for routed delegates
        #[arg(short, long, default_value = "claude")]
        agent: String,
        /// Create a dedicated worktree if new delegates must be spawned
        #[arg(short, long, default_value_t = true)]
        worktree: bool,
        /// Maximum lead sessions to sweep in one pass
        #[arg(long, default_value_t = 10)]
        lead_limit: usize,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
        /// Return a non-zero exit code from the final coordination health
        #[arg(long)]
        check: bool,
        /// Keep coordinating until the backlog is healthy, saturated, or max passes is reached
        #[arg(long)]
        until_healthy: bool,
        /// Maximum coordination passes when using --until-healthy
        #[arg(long, default_value_t = 5)]
        max_passes: usize,
    },
    /// Show global coordination, backlog, and daemon policy status
    CoordinationStatus {
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
        /// Return a non-zero exit code when backlog or saturation needs attention
        #[arg(long)]
        check: bool,
    },
    /// Coordinate only when backlog pressure actually needs work
    MaintainCoordination {
        /// Agent type for routed delegates
        #[arg(short, long, default_value = "claude")]
        agent: String,
        /// Create a dedicated worktree if new delegates must be spawned
        #[arg(short, long, default_value_t = true)]
        worktree: bool,
        /// Maximum lead sessions to sweep in one pass
        #[arg(long, default_value_t = 10)]
        lead_limit: usize,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
        /// Return a non-zero exit code from the final coordination health
        #[arg(long)]
        check: bool,
        /// Maximum coordination passes when maintenance is needed
        #[arg(long, default_value_t = 5)]
        max_passes: usize,
    },
    /// Rebalance unread handoffs across lead teams with backed-up delegates
    RebalanceAll {
        /// Agent type for routed delegates
        #[arg(short, long, default_value = "claude")]
        agent: String,
        /// Create a dedicated worktree if new delegates must be spawned
        #[arg(short, long, default_value_t = true)]
        worktree: bool,
        /// Maximum lead sessions to sweep in one pass
        #[arg(long, default_value_t = 10)]
        lead_limit: usize,
    },
    /// Rebalance unread handoffs off backed-up delegates onto clearer team capacity
    RebalanceTeam {
        /// Lead session ID or alias
        session_id: String,
        /// Agent type for routed delegates
        #[arg(short, long, default_value = "claude")]
        agent: String,
        /// Create a dedicated worktree if new delegates must be spawned
        #[arg(short, long, default_value_t = true)]
        worktree: bool,
        /// Maximum handoffs to reroute in one pass
        #[arg(long, default_value_t = 5)]
        limit: usize,
    },
    /// List active sessions
    Sessions,
    /// Show session details
    Status {
        /// Session ID or alias
        session_id: Option<String>,
    },
    /// Show delegated team board for a session
    Team {
        /// Lead session ID or alias
        session_id: Option<String>,
        /// Delegation depth to traverse
        #[arg(long, default_value_t = 2)]
        depth: usize,
    },
    /// Stop a running session
    Stop {
        /// Session ID or alias
        session_id: String,
    },
    /// Resume a failed or stopped session
    Resume {
        /// Session ID or alias
        session_id: String,
    },
    /// Send or inspect inter-session messages
    Messages {
        #[command(subcommand)]
        command: MessageCommands,
    },
    /// Run as background daemon
    Daemon,
    #[command(hide = true)]
    RunSession {
        #[arg(long)]
        session_id: String,
        #[arg(long)]
        task: String,
        #[arg(long)]
        agent: String,
        #[arg(long)]
        cwd: PathBuf,
    },
}

#[derive(clap::Subcommand, Debug)]
enum MessageCommands {
    /// Send a structured message between sessions
    Send {
        #[arg(long)]
        from: String,
        #[arg(long)]
        to: String,
        #[arg(long, value_enum)]
        kind: MessageKindArg,
        #[arg(long)]
        text: String,
        #[arg(long)]
        context: Option<String>,
        #[arg(long)]
        file: Vec<String>,
    },
    /// Show recent messages for a session
    Inbox {
        session_id: String,
        #[arg(long, default_value_t = 10)]
        limit: usize,
    },
}

#[derive(clap::ValueEnum, Clone, Debug)]
enum MessageKindArg {
    Handoff,
    Query,
    Response,
    Completed,
    Conflict,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();

    let cfg = config::Config::load()?;
    let db = session::store::StateStore::open(&cfg.db_path)?;

    match cli.command {
        Some(Commands::Dashboard) | None => {
            tui::app::run(db, cfg).await?;
        }
        Some(Commands::Start {
            task,
            agent,
            worktree: use_worktree,
            from_session,
        }) => {
            let session_id =
                session::manager::create_session(&db, &cfg, &task, &agent, use_worktree).await?;
            if let Some(from_session) = from_session {
                let from_id = resolve_session_id(&db, &from_session)?;
                send_handoff_message(&db, &from_id, &session_id)?;
            }
            println!("Session started: {session_id}");
        }
        Some(Commands::Delegate {
            from_session,
            task,
            agent,
            worktree: use_worktree,
        }) => {
            let from_id = resolve_session_id(&db, &from_session)?;
            let source = db
                .get_session(&from_id)?
                .ok_or_else(|| anyhow::anyhow!("Session not found: {from_id}"))?;
            let task = task.unwrap_or_else(|| {
                format!(
                    "Follow up on {}: {}",
                    short_session(&source.id),
                    source.task
                )
            });

            let session_id =
                session::manager::create_session(&db, &cfg, &task, &agent, use_worktree).await?;
            send_handoff_message(&db, &source.id, &session_id)?;
            println!(
                "Delegated session started: {} <- {}",
                session_id,
                short_session(&source.id)
            );
        }
        Some(Commands::Assign {
            from_session,
            task,
            agent,
            worktree: use_worktree,
        }) => {
            let lead_id = resolve_session_id(&db, &from_session)?;
            let outcome = session::manager::assign_session(
                &db,
                &cfg,
                &lead_id,
                &task,
                &agent,
                use_worktree,
            )
            .await?;
            if session::manager::assignment_action_routes_work(outcome.action) {
                println!(
                    "Assignment routed: {} -> {} ({})",
                    short_session(&lead_id),
                    short_session(&outcome.session_id),
                    match outcome.action {
                        session::manager::AssignmentAction::Spawned => "spawned",
                        session::manager::AssignmentAction::ReusedIdle => "reused-idle",
                        session::manager::AssignmentAction::ReusedActive => "reused-active",
                        session::manager::AssignmentAction::DeferredSaturated => unreachable!(),
                    }
                );
            } else {
                println!(
                    "Assignment deferred: {} is saturated; task stayed in {} inbox",
                    short_session(&lead_id),
                    short_session(&lead_id),
                );
            }
        }
        Some(Commands::DrainInbox {
            session_id,
            agent,
            worktree: use_worktree,
            limit,
        }) => {
            let lead_id = resolve_session_id(&db, &session_id)?;
            let outcomes = session::manager::drain_inbox(
                &db,
                &cfg,
                &lead_id,
                &agent,
                use_worktree,
                limit,
            )
            .await?;
            if outcomes.is_empty() {
                println!("No unread task handoffs for {}", short_session(&lead_id));
            } else {
                let routed_count = outcomes
                    .iter()
                    .filter(|outcome| session::manager::assignment_action_routes_work(outcome.action))
                    .count();
                let deferred_count = outcomes.len().saturating_sub(routed_count);
                println!(
                    "Processed {} inbox task handoff(s) from {} ({} routed, {} deferred)",
                    outcomes.len(),
                    short_session(&lead_id)
                    ,
                    routed_count,
                    deferred_count
                );
                for outcome in outcomes {
                    println!(
                        "- {} -> {} ({}) | {}",
                        outcome.message_id,
                        short_session(&outcome.session_id),
                        match outcome.action {
                            session::manager::AssignmentAction::Spawned => "spawned",
                            session::manager::AssignmentAction::ReusedIdle => "reused-idle",
                            session::manager::AssignmentAction::ReusedActive => "reused-active",
                            session::manager::AssignmentAction::DeferredSaturated => {
                                "deferred-saturated"
                            }
                        },
                        outcome.task
                    );
                }
            }
        }
        Some(Commands::AutoDispatch {
            agent,
            worktree: use_worktree,
            lead_limit,
        }) => {
            let outcomes = session::manager::auto_dispatch_backlog(
                &db,
                &cfg,
                &agent,
                use_worktree,
                lead_limit,
            )
            .await?;
            if outcomes.is_empty() {
                println!("No unread task handoff backlog found");
            } else {
                let total_processed: usize = outcomes.iter().map(|outcome| outcome.routed.len()).sum();
                let total_routed: usize = outcomes
                    .iter()
                    .map(|outcome| {
                        outcome
                            .routed
                            .iter()
                            .filter(|item| session::manager::assignment_action_routes_work(item.action))
                            .count()
                    })
                    .sum();
                let total_deferred = total_processed.saturating_sub(total_routed);
                println!(
                    "Auto-dispatch processed {} task handoff(s) across {} lead session(s) ({} routed, {} deferred)",
                    total_processed,
                    outcomes.len(),
                    total_routed,
                    total_deferred
                );
                for outcome in outcomes {
                    let routed = outcome
                        .routed
                        .iter()
                        .filter(|item| session::manager::assignment_action_routes_work(item.action))
                        .count();
                    let deferred = outcome.routed.len().saturating_sub(routed);
                    println!(
                        "- {} | unread {} | routed {} | deferred {}",
                        short_session(&outcome.lead_session_id),
                        outcome.unread_count,
                        routed,
                        deferred
                    );
                }
            }
        }
        Some(Commands::CoordinateBacklog {
            agent,
            worktree: use_worktree,
            lead_limit,
            json,
            check,
            until_healthy,
            max_passes,
        }) => {
            let pass_budget = if until_healthy {
                max_passes.max(1)
            } else {
                1
            };
            let run = run_coordination_loop(
                &db,
                &cfg,
                &agent,
                use_worktree,
                lead_limit,
                pass_budget,
                !json,
            )
            .await?;

            if json {
                println!("{}", serde_json::to_string_pretty(&run)?);
            }

            if check {
                let exit_code = run
                    .final_status
                    .as_ref()
                    .map(coordination_status_exit_code)
                    .unwrap_or(0);
                std::process::exit(exit_code);
            }
        }
        Some(Commands::CoordinationStatus { json, check }) => {
            let status = session::manager::get_coordination_status(&db, &cfg)?;
            println!("{}", format_coordination_status(&status, json)?);
            if check {
                std::process::exit(coordination_status_exit_code(&status));
            }
        }
        Some(Commands::MaintainCoordination {
            agent,
            worktree: use_worktree,
            lead_limit,
            json,
            check,
            max_passes,
        }) => {
            let initial_status = session::manager::get_coordination_status(&db, &cfg)?;
            let run = if matches!(
                initial_status.health,
                session::manager::CoordinationHealth::Healthy
            ) {
                None
            } else {
                Some(
                    run_coordination_loop(
                        &db,
                        &cfg,
                        &agent,
                        use_worktree,
                        lead_limit,
                        max_passes.max(1),
                        !json,
                    )
                    .await?,
                )
            };
            let final_status = run
                .as_ref()
                .and_then(|run| run.final_status.clone())
                .unwrap_or_else(|| initial_status.clone());

            if json {
                let payload = MaintainCoordinationRun {
                    skipped: run.is_none(),
                    initial_status,
                    run,
                    final_status: final_status.clone(),
                };
                println!("{}", serde_json::to_string_pretty(&payload)?);
            } else if run.is_none() {
                println!("Coordination already healthy");
            }

            if check {
                std::process::exit(coordination_status_exit_code(&final_status));
            }
        }
        Some(Commands::RebalanceAll {
            agent,
            worktree: use_worktree,
            lead_limit,
        }) => {
            let outcomes = session::manager::rebalance_all_teams(
                &db,
                &cfg,
                &agent,
                use_worktree,
                lead_limit,
            )
            .await?;
            if outcomes.is_empty() {
                println!("No delegate backlog needed global rebalancing");
            } else {
                let total_rerouted: usize =
                    outcomes.iter().map(|outcome| outcome.rerouted.len()).sum();
                println!(
                    "Rebalanced {} task handoff(s) across {} lead session(s)",
                    total_rerouted,
                    outcomes.len()
                );
                for outcome in outcomes {
                    println!(
                        "- {} | rerouted {}",
                        short_session(&outcome.lead_session_id),
                        outcome.rerouted.len()
                    );
                }
            }
        }
        Some(Commands::RebalanceTeam {
            session_id,
            agent,
            worktree: use_worktree,
            limit,
        }) => {
            let lead_id = resolve_session_id(&db, &session_id)?;
            let outcomes = session::manager::rebalance_team_backlog(
                &db,
                &cfg,
                &lead_id,
                &agent,
                use_worktree,
                limit,
            )
            .await?;
            if outcomes.is_empty() {
                println!("No delegate backlog needed rebalancing for {}", short_session(&lead_id));
            } else {
                println!(
                    "Rebalanced {} task handoff(s) for {}",
                    outcomes.len(),
                    short_session(&lead_id)
                );
                for outcome in outcomes {
                    println!(
                        "- {} | {} -> {} ({}) | {}",
                        outcome.message_id,
                        short_session(&outcome.from_session_id),
                        short_session(&outcome.session_id),
                        match outcome.action {
                            session::manager::AssignmentAction::Spawned => "spawned",
                            session::manager::AssignmentAction::ReusedIdle => "reused-idle",
                            session::manager::AssignmentAction::ReusedActive => "reused-active",
                            session::manager::AssignmentAction::DeferredSaturated => {
                                "deferred-saturated"
                            }
                        },
                        outcome.task
                    );
                }
            }
        }
        Some(Commands::Sessions) => {
            let sessions = session::manager::list_sessions(&db)?;
            for s in sessions {
                println!("{} [{}] {}", s.id, s.state, s.task);
            }
        }
        Some(Commands::Status { session_id }) => {
            let id = session_id.unwrap_or_else(|| "latest".to_string());
            let status = session::manager::get_status(&db, &id)?;
            println!("{status}");
        }
        Some(Commands::Team { session_id, depth }) => {
            let id = session_id.unwrap_or_else(|| "latest".to_string());
            let team = session::manager::get_team_status(&db, &id, depth)?;
            println!("{team}");
        }
        Some(Commands::Stop { session_id }) => {
            session::manager::stop_session(&db, &session_id).await?;
            println!("Session stopped: {session_id}");
        }
        Some(Commands::Resume { session_id }) => {
            let resumed_id = session::manager::resume_session(&db, &cfg, &session_id).await?;
            println!("Session resumed: {resumed_id}");
        }
        Some(Commands::Messages { command }) => match command {
            MessageCommands::Send {
                from,
                to,
                kind,
                text,
                context,
                file,
            } => {
                let from = resolve_session_id(&db, &from)?;
                let to = resolve_session_id(&db, &to)?;
                let message = build_message(kind, text, context, file)?;
                comms::send(&db, &from, &to, &message)?;
                println!("Message sent: {} -> {}", short_session(&from), short_session(&to));
            }
            MessageCommands::Inbox { session_id, limit } => {
                let session_id = resolve_session_id(&db, &session_id)?;
                let messages = db.list_messages_for_session(&session_id, limit)?;
                let unread_before = db
                    .unread_message_counts()?
                    .get(&session_id)
                    .copied()
                    .unwrap_or(0);
                if unread_before > 0 {
                    let _ = db.mark_messages_read(&session_id)?;
                }

                if messages.is_empty() {
                    println!("No messages for {}", short_session(&session_id));
                } else {
                    println!("Messages for {}", short_session(&session_id));
                    for message in messages {
                        println!(
                            "{} {} -> {} | {}",
                            message.timestamp.format("%H:%M:%S"),
                            short_session(&message.from_session),
                            short_session(&message.to_session),
                            comms::preview(&message.msg_type, &message.content)
                        );
                    }
                }
            }
        },
        Some(Commands::Daemon) => {
            println!("Starting ECC daemon...");
            session::daemon::run(db, cfg).await?;
        }
        Some(Commands::RunSession {
            session_id,
            task,
            agent,
            cwd,
        }) => {
            session::manager::run_session(&cfg, &session_id, &task, &agent, &cwd).await?;
        }
    }

    Ok(())
}

fn resolve_session_id(db: &session::store::StateStore, value: &str) -> Result<String> {
    if value == "latest" {
        return db
            .get_latest_session()?
            .map(|session| session.id)
            .ok_or_else(|| anyhow::anyhow!("No sessions found"));
    }

    db.get_session(value)?
        .map(|session| session.id)
        .ok_or_else(|| anyhow::anyhow!("Session not found: {value}"))
}

fn build_message(
    kind: MessageKindArg,
    text: String,
    context: Option<String>,
    files: Vec<String>,
) -> Result<comms::MessageType> {
    Ok(match kind {
        MessageKindArg::Handoff => comms::MessageType::TaskHandoff {
            task: text,
            context: context.unwrap_or_default(),
        },
        MessageKindArg::Query => comms::MessageType::Query { question: text },
        MessageKindArg::Response => comms::MessageType::Response { answer: text },
        MessageKindArg::Completed => comms::MessageType::Completed {
            summary: text,
            files_changed: files,
        },
        MessageKindArg::Conflict => {
            let file = files
                .first()
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("Conflict messages require at least one --file"))?;
            comms::MessageType::Conflict {
                file,
                description: context.unwrap_or(text),
            }
        }
    })
}

fn short_session(session_id: &str) -> String {
    session_id.chars().take(8).collect()
}

fn format_coordination_status(
    status: &session::manager::CoordinationStatus,
    json: bool,
) -> Result<String> {
    if json {
        return Ok(serde_json::to_string_pretty(status)?);
    }

    Ok(status.to_string())
}

async fn run_coordination_loop(
    db: &session::store::StateStore,
    cfg: &config::Config,
    agent: &str,
    use_worktree: bool,
    lead_limit: usize,
    pass_budget: usize,
    emit_progress: bool,
) -> Result<CoordinateBacklogRun> {
    let mut final_status = None;
    let mut pass_summaries = Vec::new();

    for pass in 1..=pass_budget.max(1) {
        let outcome =
            session::manager::coordinate_backlog(db, cfg, agent, use_worktree, lead_limit).await?;
        let mut summary = summarize_coordinate_backlog(&outcome);
        summary.pass = pass;
        pass_summaries.push(summary.clone());

        if emit_progress {
            if pass_budget > 1 {
                println!("Pass {pass}/{pass_budget}: {}", summary.message);
            } else {
                println!("{}", summary.message);
            }
        }

        let status = session::manager::get_coordination_status(db, cfg)?;
        let should_stop = matches!(
            status.health,
            session::manager::CoordinationHealth::Healthy
                | session::manager::CoordinationHealth::Saturated
                | session::manager::CoordinationHealth::EscalationRequired
        );
        final_status = Some(status);

        if should_stop {
            break;
        }
    }

    let run = CoordinateBacklogRun {
        pass_budget,
        passes: pass_summaries,
        final_status,
    };

    if emit_progress && pass_budget > 1 {
        if let Some(status) = run.final_status.as_ref() {
            println!(
                "Final coordination health: {:?} | mode {:?} | backlog {} handoff(s) across {} lead(s)",
                status.health, status.mode, status.backlog_messages, status.backlog_leads
            );
        }
    }

    Ok(run)
}

#[derive(Debug, Clone, Serialize)]
struct CoordinateBacklogPassSummary {
    pass: usize,
    processed: usize,
    routed: usize,
    deferred: usize,
    rerouted: usize,
    dispatched_leads: usize,
    rebalanced_leads: usize,
    remaining_backlog_sessions: usize,
    remaining_backlog_messages: usize,
    remaining_absorbable_sessions: usize,
    remaining_saturated_sessions: usize,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
struct CoordinateBacklogRun {
    pass_budget: usize,
    passes: Vec<CoordinateBacklogPassSummary>,
    final_status: Option<session::manager::CoordinationStatus>,
}

#[derive(Debug, Clone, Serialize)]
struct MaintainCoordinationRun {
    skipped: bool,
    initial_status: session::manager::CoordinationStatus,
    run: Option<CoordinateBacklogRun>,
    final_status: session::manager::CoordinationStatus,
}

fn summarize_coordinate_backlog(
    outcome: &session::manager::CoordinateBacklogOutcome,
) -> CoordinateBacklogPassSummary {
    let total_processed: usize = outcome
        .dispatched
        .iter()
        .map(|dispatch| dispatch.routed.len())
        .sum();
    let total_routed: usize = outcome
        .dispatched
        .iter()
        .map(|dispatch| {
            dispatch
                .routed
                .iter()
                .filter(|item| session::manager::assignment_action_routes_work(item.action))
                .count()
        })
        .sum();
    let total_deferred = total_processed.saturating_sub(total_routed);
    let total_rerouted: usize = outcome
        .rebalanced
        .iter()
        .map(|rebalance| rebalance.rerouted.len())
        .sum();

    let message = if total_routed == 0 && total_rerouted == 0 && outcome.remaining_backlog_sessions == 0 {
        "Backlog already clear".to_string()
    } else {
        format!(
            "Coordinated backlog: processed {} handoff(s) across {} lead(s) ({} routed, {} deferred); rebalanced {} handoff(s) across {} lead(s); remaining {} handoff(s) across {} session(s) [{} absorbable, {} saturated]",
            total_processed,
            outcome.dispatched.len(),
            total_routed,
            total_deferred,
            total_rerouted,
            outcome.rebalanced.len(),
            outcome.remaining_backlog_messages,
            outcome.remaining_backlog_sessions,
            outcome.remaining_absorbable_sessions,
            outcome.remaining_saturated_sessions
        )
    };

    CoordinateBacklogPassSummary {
        pass: 0,
        processed: total_processed,
        routed: total_routed,
        deferred: total_deferred,
        rerouted: total_rerouted,
        dispatched_leads: outcome.dispatched.len(),
        rebalanced_leads: outcome.rebalanced.len(),
        remaining_backlog_sessions: outcome.remaining_backlog_sessions,
        remaining_backlog_messages: outcome.remaining_backlog_messages,
        remaining_absorbable_sessions: outcome.remaining_absorbable_sessions,
        remaining_saturated_sessions: outcome.remaining_saturated_sessions,
        message,
    }
}

fn coordination_status_exit_code(status: &session::manager::CoordinationStatus) -> i32 {
    match status.health {
        session::manager::CoordinationHealth::Healthy => 0,
        session::manager::CoordinationHealth::BacklogAbsorbable => 1,
        session::manager::CoordinationHealth::Saturated
        | session::manager::CoordinationHealth::EscalationRequired => 2,
    }
}

fn send_handoff_message(
    db: &session::store::StateStore,
    from_id: &str,
    to_id: &str,
) -> Result<()> {
    let from_session = db
        .get_session(from_id)?
        .ok_or_else(|| anyhow::anyhow!("Session not found: {from_id}"))?;
    let context = format!(
        "Delegated from {} [{}] | cwd {}{}",
        short_session(&from_session.id),
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
            .unwrap_or_default()
    );

    comms::send(
        db,
        &from_session.id,
        to_id,
        &comms::MessageType::TaskHandoff {
            task: from_session.task,
            context,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_parses_resume_command() {
        let cli = Cli::try_parse_from(["ecc", "resume", "deadbeef"])
            .expect("resume subcommand should parse");

        match cli.command {
            Some(Commands::Resume { session_id }) => assert_eq!(session_id, "deadbeef"),
            _ => panic!("expected resume subcommand"),
        }
    }

    #[test]
    fn cli_parses_messages_send_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "messages",
            "send",
            "--from",
            "planner",
            "--to",
            "worker",
            "--kind",
            "query",
            "--text",
            "Need context",
        ])
        .expect("messages send should parse");

        match cli.command {
            Some(Commands::Messages {
                command:
                    MessageCommands::Send {
                        from,
                        to,
                        kind,
                        text,
                        ..
                    },
            }) => {
                assert_eq!(from, "planner");
                assert_eq!(to, "worker");
                assert!(matches!(kind, MessageKindArg::Query));
                assert_eq!(text, "Need context");
            }
            _ => panic!("expected messages send subcommand"),
        }
    }

    #[test]
    fn cli_parses_start_with_handoff_source() {
        let cli = Cli::try_parse_from([
            "ecc",
            "start",
            "--task",
            "Follow up",
            "--agent",
            "claude",
            "--from-session",
            "planner",
        ])
        .expect("start with handoff source should parse");

        match cli.command {
            Some(Commands::Start {
                from_session,
                task,
                agent,
                ..
            }) => {
                assert_eq!(task, "Follow up");
                assert_eq!(agent, "claude");
                assert_eq!(from_session.as_deref(), Some("planner"));
            }
            _ => panic!("expected start subcommand"),
        }
    }

    #[test]
    fn cli_parses_delegate_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "delegate",
            "planner",
            "--task",
            "Review auth changes",
            "--agent",
            "codex",
        ])
        .expect("delegate should parse");

        match cli.command {
            Some(Commands::Delegate {
                from_session,
                task,
                agent,
                ..
            }) => {
                assert_eq!(from_session, "planner");
                assert_eq!(task.as_deref(), Some("Review auth changes"));
                assert_eq!(agent, "codex");
            }
            _ => panic!("expected delegate subcommand"),
        }
    }

    #[test]
    fn cli_parses_team_command() {
        let cli = Cli::try_parse_from(["ecc", "team", "planner", "--depth", "3"])
            .expect("team should parse");

        match cli.command {
            Some(Commands::Team { session_id, depth }) => {
                assert_eq!(session_id.as_deref(), Some("planner"));
                assert_eq!(depth, 3);
            }
            _ => panic!("expected team subcommand"),
        }
    }

    #[test]
    fn cli_parses_assign_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "assign",
            "lead",
            "--task",
            "Review auth changes",
            "--agent",
            "claude",
        ])
        .expect("assign should parse");

        match cli.command {
            Some(Commands::Assign {
                from_session,
                task,
                agent,
                ..
            }) => {
                assert_eq!(from_session, "lead");
                assert_eq!(task, "Review auth changes");
                assert_eq!(agent, "claude");
            }
            _ => panic!("expected assign subcommand"),
        }
    }

    #[test]
    fn cli_parses_drain_inbox_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "drain-inbox",
            "lead",
            "--agent",
            "claude",
            "--limit",
            "3",
        ])
        .expect("drain-inbox should parse");

        match cli.command {
            Some(Commands::DrainInbox {
                session_id,
                agent,
                limit,
                ..
            }) => {
                assert_eq!(session_id, "lead");
                assert_eq!(agent, "claude");
                assert_eq!(limit, 3);
            }
            _ => panic!("expected drain-inbox subcommand"),
        }
    }

    #[test]
    fn cli_parses_auto_dispatch_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "auto-dispatch",
            "--agent",
            "claude",
            "--lead-limit",
            "4",
        ])
        .expect("auto-dispatch should parse");

        match cli.command {
            Some(Commands::AutoDispatch {
                agent,
                lead_limit,
                ..
            }) => {
                assert_eq!(agent, "claude");
                assert_eq!(lead_limit, 4);
            }
            _ => panic!("expected auto-dispatch subcommand"),
        }
    }

    #[test]
    fn cli_parses_coordinate_backlog_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "coordinate-backlog",
            "--agent",
            "claude",
            "--lead-limit",
            "7",
        ])
        .expect("coordinate-backlog should parse");

        match cli.command {
            Some(Commands::CoordinateBacklog {
                agent,
                lead_limit,
                check,
                until_healthy,
                max_passes,
                ..
            }) => {
                assert_eq!(agent, "claude");
                assert_eq!(lead_limit, 7);
                assert!(!check);
                assert!(!until_healthy);
                assert_eq!(max_passes, 5);
            }
            _ => panic!("expected coordinate-backlog subcommand"),
        }
    }

    #[test]
    fn cli_parses_coordinate_backlog_until_healthy_flags() {
        let cli = Cli::try_parse_from([
            "ecc",
            "coordinate-backlog",
            "--until-healthy",
            "--max-passes",
            "3",
        ])
        .expect("coordinate-backlog looping flags should parse");

        match cli.command {
            Some(Commands::CoordinateBacklog {
                json,
                until_healthy,
                max_passes,
                ..
            }) => {
                assert!(!json);
                assert!(until_healthy);
                assert_eq!(max_passes, 3);
            }
            _ => panic!("expected coordinate-backlog subcommand"),
        }
    }

    #[test]
    fn cli_parses_coordinate_backlog_json_flag() {
        let cli = Cli::try_parse_from(["ecc", "coordinate-backlog", "--json"])
            .expect("coordinate-backlog --json should parse");

        match cli.command {
            Some(Commands::CoordinateBacklog {
                json,
                check,
                until_healthy,
                max_passes,
                ..
            }) => {
                assert!(json);
                assert!(!check);
                assert!(!until_healthy);
                assert_eq!(max_passes, 5);
            }
            _ => panic!("expected coordinate-backlog subcommand"),
        }
    }

    #[test]
    fn cli_parses_coordinate_backlog_check_flag() {
        let cli = Cli::try_parse_from(["ecc", "coordinate-backlog", "--check"])
            .expect("coordinate-backlog --check should parse");

        match cli.command {
            Some(Commands::CoordinateBacklog {
                json,
                check,
                until_healthy,
                max_passes,
                ..
            }) => {
                assert!(!json);
                assert!(check);
                assert!(!until_healthy);
                assert_eq!(max_passes, 5);
            }
            _ => panic!("expected coordinate-backlog subcommand"),
        }
    }

    #[test]
    fn cli_parses_rebalance_all_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "rebalance-all",
            "--agent",
            "claude",
            "--lead-limit",
            "6",
        ])
        .expect("rebalance-all should parse");

        match cli.command {
            Some(Commands::RebalanceAll {
                agent,
                lead_limit,
                ..
            }) => {
                assert_eq!(agent, "claude");
                assert_eq!(lead_limit, 6);
            }
            _ => panic!("expected rebalance-all subcommand"),
        }
    }

    #[test]
    fn cli_parses_coordination_status_command() {
        let cli = Cli::try_parse_from(["ecc", "coordination-status"])
            .expect("coordination-status should parse");

        match cli.command {
            Some(Commands::CoordinationStatus { json, check }) => {
                assert!(!json);
                assert!(!check);
            }
            _ => panic!("expected coordination-status subcommand"),
        }
    }

    #[test]
    fn cli_parses_coordination_status_json_flag() {
        let cli = Cli::try_parse_from(["ecc", "coordination-status", "--json"])
            .expect("coordination-status --json should parse");

        match cli.command {
            Some(Commands::CoordinationStatus { json, check }) => {
                assert!(json);
                assert!(!check);
            }
            _ => panic!("expected coordination-status subcommand"),
        }
    }

    #[test]
    fn cli_parses_coordination_status_check_flag() {
        let cli = Cli::try_parse_from(["ecc", "coordination-status", "--check"])
            .expect("coordination-status --check should parse");

        match cli.command {
            Some(Commands::CoordinationStatus { json, check }) => {
                assert!(!json);
                assert!(check);
            }
            _ => panic!("expected coordination-status subcommand"),
        }
    }

    #[test]
    fn cli_parses_maintain_coordination_command() {
        let cli = Cli::try_parse_from(["ecc", "maintain-coordination"])
            .expect("maintain-coordination should parse");

        match cli.command {
            Some(Commands::MaintainCoordination {
                agent,
                json,
                check,
                max_passes,
                ..
            }) => {
                assert_eq!(agent, "claude");
                assert!(!json);
                assert!(!check);
                assert_eq!(max_passes, 5);
            }
            _ => panic!("expected maintain-coordination subcommand"),
        }
    }

    #[test]
    fn cli_parses_maintain_coordination_json_flag() {
        let cli = Cli::try_parse_from(["ecc", "maintain-coordination", "--json"])
            .expect("maintain-coordination --json should parse");

        match cli.command {
            Some(Commands::MaintainCoordination {
                json,
                check,
                max_passes,
                ..
            }) => {
                assert!(json);
                assert!(!check);
                assert_eq!(max_passes, 5);
            }
            _ => panic!("expected maintain-coordination subcommand"),
        }
    }

    #[test]
    fn cli_parses_maintain_coordination_check_flag() {
        let cli = Cli::try_parse_from(["ecc", "maintain-coordination", "--check"])
            .expect("maintain-coordination --check should parse");

        match cli.command {
            Some(Commands::MaintainCoordination {
                json,
                check,
                max_passes,
                ..
            }) => {
                assert!(!json);
                assert!(check);
                assert_eq!(max_passes, 5);
            }
            _ => panic!("expected maintain-coordination subcommand"),
        }
    }

    #[test]
    fn format_coordination_status_emits_json() {
        let status = session::manager::CoordinationStatus {
            backlog_leads: 2,
            backlog_messages: 5,
            absorbable_sessions: 1,
            saturated_sessions: 1,
            mode: session::manager::CoordinationMode::RebalanceFirstChronicSaturation,
            health: session::manager::CoordinationHealth::Saturated,
            operator_escalation_required: false,
            auto_dispatch_enabled: true,
            auto_dispatch_limit_per_session: 4,
            daemon_activity: session::store::DaemonActivity {
                last_dispatch_routed: 3,
                last_dispatch_deferred: 1,
                last_dispatch_leads: 2,
                ..Default::default()
            },
        };

        let rendered =
            format_coordination_status(&status, true).expect("json formatting should succeed");
        let value: serde_json::Value =
            serde_json::from_str(&rendered).expect("valid json should be emitted");
        assert_eq!(value["backlog_leads"], 2);
        assert_eq!(value["backlog_messages"], 5);
        assert_eq!(value["daemon_activity"]["last_dispatch_routed"], 3);
    }

    #[test]
    fn coordination_status_exit_codes_reflect_pressure() {
        let clear = session::manager::CoordinationStatus {
            backlog_leads: 0,
            backlog_messages: 0,
            absorbable_sessions: 0,
            saturated_sessions: 0,
            mode: session::manager::CoordinationMode::DispatchFirst,
            health: session::manager::CoordinationHealth::Healthy,
            operator_escalation_required: false,
            auto_dispatch_enabled: false,
            auto_dispatch_limit_per_session: 5,
            daemon_activity: Default::default(),
        };
        assert_eq!(coordination_status_exit_code(&clear), 0);

        let absorbable = session::manager::CoordinationStatus {
            backlog_messages: 2,
            backlog_leads: 1,
            absorbable_sessions: 1,
            health: session::manager::CoordinationHealth::BacklogAbsorbable,
            ..clear.clone()
        };
        assert_eq!(coordination_status_exit_code(&absorbable), 1);

        let saturated = session::manager::CoordinationStatus {
            saturated_sessions: 1,
            health: session::manager::CoordinationHealth::Saturated,
            ..absorbable
        };
        assert_eq!(coordination_status_exit_code(&saturated), 2);
    }

    #[test]
    fn summarize_coordinate_backlog_reports_clear_state() {
        let summary = summarize_coordinate_backlog(&session::manager::CoordinateBacklogOutcome {
            dispatched: Vec::new(),
            rebalanced: Vec::new(),
            remaining_backlog_sessions: 0,
            remaining_backlog_messages: 0,
            remaining_absorbable_sessions: 0,
            remaining_saturated_sessions: 0,
        });

        assert_eq!(summary.message, "Backlog already clear");
        assert_eq!(summary.processed, 0);
        assert_eq!(summary.rerouted, 0);
    }

    #[test]
    fn summarize_coordinate_backlog_structures_counts() {
        let summary = summarize_coordinate_backlog(&session::manager::CoordinateBacklogOutcome {
            dispatched: vec![session::manager::LeadDispatchOutcome {
                lead_session_id: "lead".into(),
                unread_count: 2,
                routed: vec![
                    session::manager::InboxDrainOutcome {
                        message_id: 1,
                        task: "one".into(),
                        session_id: "a".into(),
                        action: session::manager::AssignmentAction::Spawned,
                    },
                    session::manager::InboxDrainOutcome {
                        message_id: 2,
                        task: "two".into(),
                        session_id: "lead".into(),
                        action: session::manager::AssignmentAction::DeferredSaturated,
                    },
                ],
            }],
            rebalanced: vec![session::manager::LeadRebalanceOutcome {
                lead_session_id: "lead".into(),
                rerouted: vec![session::manager::RebalanceOutcome {
                    from_session_id: "a".into(),
                    message_id: 3,
                    task: "three".into(),
                    session_id: "b".into(),
                    action: session::manager::AssignmentAction::ReusedIdle,
                }],
            }],
            remaining_backlog_sessions: 1,
            remaining_backlog_messages: 2,
            remaining_absorbable_sessions: 1,
            remaining_saturated_sessions: 0,
        });

        assert_eq!(summary.processed, 2);
        assert_eq!(summary.routed, 1);
        assert_eq!(summary.deferred, 1);
        assert_eq!(summary.rerouted, 1);
        assert_eq!(summary.dispatched_leads, 1);
        assert_eq!(summary.rebalanced_leads, 1);
        assert_eq!(summary.remaining_backlog_messages, 2);
    }

    #[test]
    fn cli_parses_rebalance_team_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "rebalance-team",
            "lead",
            "--agent",
            "claude",
            "--limit",
            "2",
        ])
        .expect("rebalance-team should parse");

        match cli.command {
            Some(Commands::RebalanceTeam {
                session_id,
                agent,
                limit,
                ..
            }) => {
                assert_eq!(session_id, "lead");
                assert_eq!(agent, "claude");
                assert_eq!(limit, 2);
            }
            _ => panic!("expected rebalance-team subcommand"),
        }
    }
}

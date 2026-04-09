use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaneLayout {
    #[default]
    Horizontal,
    Vertical,
    Grid,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct RiskThresholds {
    pub review: f64,
    pub confirm: f64,
    pub block: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct BudgetAlertThresholds {
    pub advisory: f64,
    pub warning: f64,
    pub critical: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub db_path: PathBuf,
    pub worktree_root: PathBuf,
    pub worktree_branch_prefix: String,
    pub max_parallel_sessions: usize,
    pub max_parallel_worktrees: usize,
    pub session_timeout_secs: u64,
    pub heartbeat_interval_secs: u64,
    pub auto_terminate_stale_sessions: bool,
    pub default_agent: String,
    pub auto_dispatch_unread_handoffs: bool,
    pub auto_dispatch_limit_per_session: usize,
    pub auto_create_worktrees: bool,
    pub auto_merge_ready_worktrees: bool,
    pub cost_budget_usd: f64,
    pub token_budget: u64,
    pub budget_alert_thresholds: BudgetAlertThresholds,
    pub theme: Theme,
    pub pane_layout: PaneLayout,
    pub pane_navigation: PaneNavigationConfig,
    pub linear_pane_size_percent: u16,
    pub grid_pane_size_percent: u16,
    pub risk_thresholds: RiskThresholds,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct PaneNavigationConfig {
    pub focus_sessions: String,
    pub focus_output: String,
    pub focus_metrics: String,
    pub focus_log: String,
    pub move_left: String,
    pub move_down: String,
    pub move_up: String,
    pub move_right: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaneNavigationAction {
    FocusSlot(usize),
    MoveLeft,
    MoveDown,
    MoveUp,
    MoveRight,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Theme {
    Dark,
    Light,
}

impl Default for Config {
    fn default() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        Self {
            db_path: home.join(".claude").join("ecc2.db"),
            worktree_root: PathBuf::from("/tmp/ecc-worktrees"),
            worktree_branch_prefix: "ecc".to_string(),
            max_parallel_sessions: 8,
            max_parallel_worktrees: 6,
            session_timeout_secs: 3600,
            heartbeat_interval_secs: 30,
            auto_terminate_stale_sessions: false,
            default_agent: "claude".to_string(),
            auto_dispatch_unread_handoffs: false,
            auto_dispatch_limit_per_session: 5,
            auto_create_worktrees: true,
            auto_merge_ready_worktrees: false,
            cost_budget_usd: 10.0,
            token_budget: 500_000,
            budget_alert_thresholds: Self::BUDGET_ALERT_THRESHOLDS,
            theme: Theme::Dark,
            pane_layout: PaneLayout::Horizontal,
            pane_navigation: PaneNavigationConfig::default(),
            linear_pane_size_percent: 35,
            grid_pane_size_percent: 50,
            risk_thresholds: Self::RISK_THRESHOLDS,
        }
    }
}

impl Config {
    pub const RISK_THRESHOLDS: RiskThresholds = RiskThresholds {
        review: 0.35,
        confirm: 0.60,
        block: 0.85,
    };

    pub const BUDGET_ALERT_THRESHOLDS: BudgetAlertThresholds = BudgetAlertThresholds {
        advisory: 0.50,
        warning: 0.75,
        critical: 0.90,
    };

    pub fn config_path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".claude")
            .join("ecc2.toml")
    }

    pub fn cost_metrics_path(&self) -> PathBuf {
        self.db_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("metrics")
            .join("costs.jsonl")
    }

    pub fn tool_activity_metrics_path(&self) -> PathBuf {
        self.db_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("metrics")
            .join("tool-usage.jsonl")
    }

    pub fn effective_budget_alert_thresholds(&self) -> BudgetAlertThresholds {
        self.budget_alert_thresholds.sanitized()
    }

    pub fn load() -> Result<Self> {
        let config_path = Self::config_path();

        if config_path.exists() {
            let content = std::fs::read_to_string(&config_path)?;
            let config: Config = toml::from_str(&content)?;
            Ok(config)
        } else {
            Ok(Config::default())
        }
    }

    pub fn save(&self) -> Result<()> {
        self.save_to_path(&Self::config_path())
    }

    pub fn save_to_path(&self, path: &std::path::Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let content = toml::to_string_pretty(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }
}

impl Default for PaneNavigationConfig {
    fn default() -> Self {
        Self {
            focus_sessions: "1".to_string(),
            focus_output: "2".to_string(),
            focus_metrics: "3".to_string(),
            focus_log: "4".to_string(),
            move_left: "ctrl-h".to_string(),
            move_down: "ctrl-j".to_string(),
            move_up: "ctrl-k".to_string(),
            move_right: "ctrl-l".to_string(),
        }
    }
}

impl PaneNavigationConfig {
    pub fn action_for_key(&self, key: KeyEvent) -> Option<PaneNavigationAction> {
        [
            (&self.focus_sessions, PaneNavigationAction::FocusSlot(1)),
            (&self.focus_output, PaneNavigationAction::FocusSlot(2)),
            (&self.focus_metrics, PaneNavigationAction::FocusSlot(3)),
            (&self.focus_log, PaneNavigationAction::FocusSlot(4)),
            (&self.move_left, PaneNavigationAction::MoveLeft),
            (&self.move_down, PaneNavigationAction::MoveDown),
            (&self.move_up, PaneNavigationAction::MoveUp),
            (&self.move_right, PaneNavigationAction::MoveRight),
        ]
        .into_iter()
        .find_map(|(binding, action)| shortcut_matches(binding, key).then_some(action))
    }

    pub fn focus_shortcuts_label(&self) -> String {
        [
            self.focus_sessions.as_str(),
            self.focus_output.as_str(),
            self.focus_metrics.as_str(),
            self.focus_log.as_str(),
        ]
        .into_iter()
        .map(shortcut_label)
        .collect::<Vec<_>>()
        .join("/")
    }

    pub fn movement_shortcuts_label(&self) -> String {
        [
            self.move_left.as_str(),
            self.move_down.as_str(),
            self.move_up.as_str(),
            self.move_right.as_str(),
        ]
        .into_iter()
        .map(shortcut_label)
        .collect::<Vec<_>>()
        .join("/")
    }
}

fn shortcut_matches(spec: &str, key: KeyEvent) -> bool {
    parse_shortcut(spec)
        .is_some_and(|(modifiers, code)| key.modifiers == modifiers && key.code == code)
}

fn parse_shortcut(spec: &str) -> Option<(KeyModifiers, KeyCode)> {
    let normalized = spec.trim().to_ascii_lowercase().replace('+', "-");
    if normalized.is_empty() {
        return None;
    }

    if normalized == "tab" {
        return Some((KeyModifiers::NONE, KeyCode::Tab));
    }

    if normalized == "shift-tab" || normalized == "s-tab" {
        return Some((KeyModifiers::SHIFT, KeyCode::BackTab));
    }

    if let Some(rest) = normalized
        .strip_prefix("ctrl-")
        .or_else(|| normalized.strip_prefix("c-"))
    {
        return parse_single_char(rest).map(|ch| (KeyModifiers::CONTROL, KeyCode::Char(ch)));
    }

    parse_single_char(&normalized).map(|ch| (KeyModifiers::NONE, KeyCode::Char(ch)))
}

fn parse_single_char(value: &str) -> Option<char> {
    let mut chars = value.chars();
    let ch = chars.next()?;
    (chars.next().is_none()).then_some(ch)
}

fn shortcut_label(spec: &str) -> String {
    let normalized = spec.trim().to_ascii_lowercase().replace('+', "-");
    if normalized == "tab" {
        return "Tab".to_string();
    }
    if normalized == "shift-tab" || normalized == "s-tab" {
        return "S-Tab".to_string();
    }
    if let Some(rest) = normalized
        .strip_prefix("ctrl-")
        .or_else(|| normalized.strip_prefix("c-"))
    {
        if let Some(ch) = parse_single_char(rest) {
            return format!("Ctrl+{ch}");
        }
    }
    normalized
}

impl Default for RiskThresholds {
    fn default() -> Self {
        Config::RISK_THRESHOLDS
    }
}

impl Default for BudgetAlertThresholds {
    fn default() -> Self {
        Config::BUDGET_ALERT_THRESHOLDS
    }
}

impl BudgetAlertThresholds {
    pub fn sanitized(self) -> Self {
        let values = [self.advisory, self.warning, self.critical];
        let valid = values.into_iter().all(f64::is_finite)
            && self.advisory > 0.0
            && self.advisory < self.warning
            && self.warning < self.critical
            && self.critical < 1.0;

        if valid {
            self
        } else {
            Self::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{BudgetAlertThresholds, Config, PaneLayout};
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    use uuid::Uuid;

    #[test]
    fn default_includes_positive_budget_thresholds() {
        let config = Config::default();

        assert!(config.cost_budget_usd > 0.0);
        assert!(config.token_budget > 0);
    }

    #[test]
    fn missing_budget_fields_fall_back_to_defaults() {
        let legacy_config = r#"
db_path = "/tmp/ecc2.db"
worktree_root = "/tmp/ecc-worktrees"
max_parallel_sessions = 8
max_parallel_worktrees = 6
session_timeout_secs = 3600
heartbeat_interval_secs = 30
auto_terminate_stale_sessions = false
default_agent = "claude"
theme = "Dark"
"#;

        let config: Config = toml::from_str(legacy_config).unwrap();
        let defaults = Config::default();

        assert_eq!(
            config.worktree_branch_prefix,
            defaults.worktree_branch_prefix
        );
        assert_eq!(config.cost_budget_usd, defaults.cost_budget_usd);
        assert_eq!(config.token_budget, defaults.token_budget);
        assert_eq!(
            config.budget_alert_thresholds,
            defaults.budget_alert_thresholds
        );
        assert_eq!(config.pane_layout, defaults.pane_layout);
        assert_eq!(config.pane_navigation, defaults.pane_navigation);
        assert_eq!(
            config.linear_pane_size_percent,
            defaults.linear_pane_size_percent
        );
        assert_eq!(
            config.grid_pane_size_percent,
            defaults.grid_pane_size_percent
        );
        assert_eq!(config.risk_thresholds, defaults.risk_thresholds);
        assert_eq!(
            config.auto_dispatch_unread_handoffs,
            defaults.auto_dispatch_unread_handoffs
        );
        assert_eq!(
            config.auto_dispatch_limit_per_session,
            defaults.auto_dispatch_limit_per_session
        );
        assert_eq!(config.auto_create_worktrees, defaults.auto_create_worktrees);
        assert_eq!(
            config.auto_merge_ready_worktrees,
            defaults.auto_merge_ready_worktrees
        );
        assert_eq!(
            config.auto_terminate_stale_sessions,
            defaults.auto_terminate_stale_sessions
        );
    }

    #[test]
    fn default_pane_layout_is_horizontal() {
        assert_eq!(Config::default().pane_layout, PaneLayout::Horizontal);
    }

    #[test]
    fn default_pane_sizes_match_dashboard_defaults() {
        let config = Config::default();

        assert_eq!(config.linear_pane_size_percent, 35);
        assert_eq!(config.grid_pane_size_percent, 50);
    }

    #[test]
    fn pane_layout_deserializes_from_toml() {
        let config: Config = toml::from_str(r#"pane_layout = "grid""#).unwrap();

        assert_eq!(config.pane_layout, PaneLayout::Grid);
    }

    #[test]
    fn worktree_branch_prefix_deserializes_from_toml() {
        let config: Config = toml::from_str(r#"worktree_branch_prefix = "bots/ecc""#).unwrap();

        assert_eq!(config.worktree_branch_prefix, "bots/ecc");
    }

    #[test]
    fn pane_navigation_deserializes_from_toml() {
        let config: Config = toml::from_str(
            r#"
[pane_navigation]
focus_sessions = "q"
focus_output = "w"
focus_metrics = "e"
focus_log = "r"
move_left = "a"
move_down = "s"
move_up = "w"
move_right = "d"
"#,
        )
        .unwrap();

        assert_eq!(config.pane_navigation.focus_sessions, "q");
        assert_eq!(config.pane_navigation.focus_output, "w");
        assert_eq!(config.pane_navigation.focus_metrics, "e");
        assert_eq!(config.pane_navigation.focus_log, "r");
        assert_eq!(config.pane_navigation.move_left, "a");
        assert_eq!(config.pane_navigation.move_down, "s");
        assert_eq!(config.pane_navigation.move_up, "w");
        assert_eq!(config.pane_navigation.move_right, "d");
    }

    #[test]
    fn pane_navigation_matches_default_shortcuts() {
        let navigation = Config::default().pane_navigation;

        assert_eq!(
            navigation.action_for_key(KeyEvent::new(KeyCode::Char('1'), KeyModifiers::NONE)),
            Some(super::PaneNavigationAction::FocusSlot(1))
        );
        assert_eq!(
            navigation.action_for_key(KeyEvent::new(KeyCode::Char('l'), KeyModifiers::CONTROL)),
            Some(super::PaneNavigationAction::MoveRight)
        );
    }

    #[test]
    fn pane_navigation_matches_custom_shortcuts() {
        let navigation = super::PaneNavigationConfig {
            focus_sessions: "q".to_string(),
            focus_output: "w".to_string(),
            focus_metrics: "e".to_string(),
            focus_log: "r".to_string(),
            move_left: "a".to_string(),
            move_down: "s".to_string(),
            move_up: "w".to_string(),
            move_right: "d".to_string(),
        };

        assert_eq!(
            navigation.action_for_key(KeyEvent::new(KeyCode::Char('e'), KeyModifiers::NONE)),
            Some(super::PaneNavigationAction::FocusSlot(3))
        );
        assert_eq!(
            navigation.action_for_key(KeyEvent::new(KeyCode::Char('d'), KeyModifiers::NONE)),
            Some(super::PaneNavigationAction::MoveRight)
        );
    }

    #[test]
    fn default_risk_thresholds_are_applied() {
        assert_eq!(Config::default().risk_thresholds, Config::RISK_THRESHOLDS);
    }

    #[test]
    fn default_budget_alert_thresholds_are_applied() {
        assert_eq!(
            Config::default().budget_alert_thresholds,
            Config::BUDGET_ALERT_THRESHOLDS
        );
    }

    #[test]
    fn budget_alert_thresholds_deserialize_from_toml() {
        let config: Config = toml::from_str(
            r#"
[budget_alert_thresholds]
advisory = 0.40
warning = 0.70
critical = 0.85
"#,
        )
        .unwrap();

        assert_eq!(
            config.budget_alert_thresholds,
            BudgetAlertThresholds {
                advisory: 0.40,
                warning: 0.70,
                critical: 0.85,
            }
        );
        assert_eq!(
            config.effective_budget_alert_thresholds(),
            config.budget_alert_thresholds
        );
    }

    #[test]
    fn invalid_budget_alert_thresholds_fall_back_to_defaults() {
        let config: Config = toml::from_str(
            r#"
[budget_alert_thresholds]
advisory = 0.80
warning = 0.70
critical = 1.10
"#,
        )
        .unwrap();

        assert_eq!(
            config.effective_budget_alert_thresholds(),
            Config::BUDGET_ALERT_THRESHOLDS
        );
    }

    #[test]
    fn save_round_trips_automation_settings() {
        let path = std::env::temp_dir().join(format!("ecc2-config-{}.toml", Uuid::new_v4()));
        let mut config = Config::default();
        config.auto_dispatch_unread_handoffs = true;
        config.auto_dispatch_limit_per_session = 9;
        config.auto_create_worktrees = false;
        config.auto_merge_ready_worktrees = true;
        config.worktree_branch_prefix = "bots/ecc".to_string();
        config.budget_alert_thresholds = BudgetAlertThresholds {
            advisory: 0.45,
            warning: 0.70,
            critical: 0.88,
        };
        config.pane_navigation.focus_metrics = "e".to_string();
        config.pane_navigation.move_right = "d".to_string();
        config.linear_pane_size_percent = 42;
        config.grid_pane_size_percent = 55;

        config.save_to_path(&path).unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        let loaded: Config = toml::from_str(&content).unwrap();

        assert!(loaded.auto_dispatch_unread_handoffs);
        assert_eq!(loaded.auto_dispatch_limit_per_session, 9);
        assert!(!loaded.auto_create_worktrees);
        assert!(loaded.auto_merge_ready_worktrees);
        assert_eq!(loaded.worktree_branch_prefix, "bots/ecc");
        assert_eq!(
            loaded.budget_alert_thresholds,
            BudgetAlertThresholds {
                advisory: 0.45,
                warning: 0.70,
                critical: 0.88,
            }
        );
        assert_eq!(loaded.pane_navigation.focus_metrics, "e");
        assert_eq!(loaded.pane_navigation.move_right, "d");
        assert_eq!(loaded.linear_pane_size_percent, 42);
        assert_eq!(loaded.grid_pane_size_percent, 55);

        let _ = std::fs::remove_file(path);
    }
}

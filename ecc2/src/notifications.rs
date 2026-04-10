use anyhow::Result;
use chrono::{DateTime, Local, Timelike};
use serde::{Deserialize, Serialize};

#[cfg(not(test))]
use anyhow::Context;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotificationEvent {
    SessionCompleted,
    SessionFailed,
    BudgetAlert,
    ApprovalRequest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct QuietHoursConfig {
    pub enabled: bool,
    pub start_hour: u8,
    pub end_hour: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct DesktopNotificationConfig {
    pub enabled: bool,
    pub session_completed: bool,
    pub session_failed: bool,
    pub budget_alerts: bool,
    pub approval_requests: bool,
    pub quiet_hours: QuietHoursConfig,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompletionSummaryDelivery {
    #[default]
    Desktop,
    TuiPopup,
    DesktopAndTuiPopup,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct CompletionSummaryConfig {
    pub enabled: bool,
    pub delivery: CompletionSummaryDelivery,
}

#[derive(Debug, Clone)]
pub struct DesktopNotifier {
    config: DesktopNotificationConfig,
}

impl Default for QuietHoursConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            start_hour: 22,
            end_hour: 8,
        }
    }
}

impl QuietHoursConfig {
    pub fn sanitized(self) -> Self {
        let valid = self.start_hour <= 23 && self.end_hour <= 23;
        if valid {
            self
        } else {
            Self::default()
        }
    }

    pub fn is_active(&self, now: DateTime<Local>) -> bool {
        if !self.enabled {
            return false;
        }

        let quiet = self.clone().sanitized();
        if quiet.start_hour == quiet.end_hour {
            return false;
        }

        let hour = now.hour() as u8;
        if quiet.start_hour < quiet.end_hour {
            hour >= quiet.start_hour && hour < quiet.end_hour
        } else {
            hour >= quiet.start_hour || hour < quiet.end_hour
        }
    }
}

impl Default for DesktopNotificationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            session_completed: true,
            session_failed: true,
            budget_alerts: true,
            approval_requests: true,
            quiet_hours: QuietHoursConfig::default(),
        }
    }
}

impl DesktopNotificationConfig {
    pub fn sanitized(self) -> Self {
        Self {
            quiet_hours: self.quiet_hours.sanitized(),
            ..self
        }
    }

    pub fn allows(&self, event: NotificationEvent, now: DateTime<Local>) -> bool {
        let config = self.clone().sanitized();
        if !config.enabled || config.quiet_hours.is_active(now) {
            return false;
        }

        match event {
            NotificationEvent::SessionCompleted => config.session_completed,
            NotificationEvent::SessionFailed => config.session_failed,
            NotificationEvent::BudgetAlert => config.budget_alerts,
            NotificationEvent::ApprovalRequest => config.approval_requests,
        }
    }
}

impl Default for CompletionSummaryConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            delivery: CompletionSummaryDelivery::Desktop,
        }
    }
}

impl CompletionSummaryConfig {
    pub fn desktop_enabled(&self) -> bool {
        self.enabled
            && matches!(
                self.delivery,
                CompletionSummaryDelivery::Desktop | CompletionSummaryDelivery::DesktopAndTuiPopup
            )
    }

    pub fn popup_enabled(&self) -> bool {
        self.enabled
            && matches!(
                self.delivery,
                CompletionSummaryDelivery::TuiPopup | CompletionSummaryDelivery::DesktopAndTuiPopup
            )
    }
}

impl DesktopNotifier {
    pub fn new(config: DesktopNotificationConfig) -> Self {
        Self {
            config: config.sanitized(),
        }
    }

    pub fn notify(&self, event: NotificationEvent, title: &str, body: &str) -> bool {
        match self.try_notify(event, title, body, Local::now()) {
            Ok(sent) => sent,
            Err(error) => {
                tracing::warn!("Failed to send desktop notification: {error}");
                false
            }
        }
    }

    fn try_notify(
        &self,
        event: NotificationEvent,
        title: &str,
        body: &str,
        now: DateTime<Local>,
    ) -> Result<bool> {
        if !self.config.allows(event, now) {
            return Ok(false);
        }

        let Some((program, args)) = notification_command(std::env::consts::OS, title, body) else {
            return Ok(false);
        };

        run_notification_command(&program, &args)?;
        Ok(true)
    }
}

fn notification_command(platform: &str, title: &str, body: &str) -> Option<(String, Vec<String>)> {
    match platform {
        "macos" => Some((
            "osascript".to_string(),
            vec![
                "-e".to_string(),
                format!(
                    "display notification \"{}\" with title \"{}\"",
                    sanitize_osascript(body),
                    sanitize_osascript(title)
                ),
            ],
        )),
        "linux" => Some((
            "notify-send".to_string(),
            vec![
                "--app-name".to_string(),
                "ECC 2.0".to_string(),
                title.trim().to_string(),
                body.trim().to_string(),
            ],
        )),
        _ => None,
    }
}

#[cfg(not(test))]
fn run_notification_command(program: &str, args: &[String]) -> Result<()> {
    let status = std::process::Command::new(program)
        .args(args)
        .status()
        .with_context(|| format!("launch {program}"))?;

    if status.success() {
        Ok(())
    } else {
        anyhow::bail!("{program} exited with {status}");
    }
}

#[cfg(test)]
fn run_notification_command(_program: &str, _args: &[String]) -> Result<()> {
    Ok(())
}

fn sanitize_osascript(value: &str) -> String {
    value
        .replace('\\', "")
        .replace('"', "\u{201C}")
        .replace('\n', " ")
}

#[cfg(test)]
mod tests {
    use super::{
        notification_command, DesktopNotificationConfig, DesktopNotifier, NotificationEvent,
        QuietHoursConfig,
    };
    use chrono::{Local, TimeZone};

    #[test]
    fn quiet_hours_support_cross_midnight_ranges() {
        let quiet_hours = QuietHoursConfig {
            enabled: true,
            start_hour: 22,
            end_hour: 8,
        };

        assert!(quiet_hours.is_active(Local.with_ymd_and_hms(2026, 4, 9, 23, 0, 0).unwrap()));
        assert!(quiet_hours.is_active(Local.with_ymd_and_hms(2026, 4, 9, 7, 0, 0).unwrap()));
        assert!(!quiet_hours.is_active(Local.with_ymd_and_hms(2026, 4, 9, 14, 0, 0).unwrap()));
    }

    #[test]
    fn quiet_hours_support_same_day_ranges() {
        let quiet_hours = QuietHoursConfig {
            enabled: true,
            start_hour: 9,
            end_hour: 17,
        };

        assert!(quiet_hours.is_active(Local.with_ymd_and_hms(2026, 4, 9, 10, 0, 0).unwrap()));
        assert!(!quiet_hours.is_active(Local.with_ymd_and_hms(2026, 4, 9, 18, 0, 0).unwrap()));
    }

    #[test]
    fn notification_preferences_respect_event_flags() {
        let mut config = DesktopNotificationConfig::default();
        config.session_completed = false;
        let now = Local.with_ymd_and_hms(2026, 4, 9, 12, 0, 0).unwrap();

        assert!(!config.allows(NotificationEvent::SessionCompleted, now));
        assert!(config.allows(NotificationEvent::BudgetAlert, now));
    }

    #[test]
    fn notifier_skips_delivery_during_quiet_hours() {
        let mut config = DesktopNotificationConfig::default();
        config.quiet_hours = QuietHoursConfig {
            enabled: true,
            start_hour: 22,
            end_hour: 8,
        };
        let notifier = DesktopNotifier::new(config);

        assert!(!notifier
            .try_notify(
                NotificationEvent::ApprovalRequest,
                "ECC 2.0: Approval needed",
                "worker-123 needs review",
                Local.with_ymd_and_hms(2026, 4, 9, 23, 0, 0).unwrap(),
            )
            .unwrap());
    }

    #[test]
    fn macos_notifications_use_osascript() {
        let (program, args) =
            notification_command("macos", "ECC 2.0: Completed", "Task finished").unwrap();

        assert_eq!(program, "osascript");
        assert_eq!(args[0], "-e");
        assert!(args[1].contains("display notification"));
        assert!(args[1].contains("ECC 2.0: Completed"));
    }

    #[test]
    fn linux_notifications_use_notify_send() {
        let (program, args) =
            notification_command("linux", "ECC 2.0: Approval needed", "worker-123").unwrap();

        assert_eq!(program, "notify-send");
        assert_eq!(args[0], "--app-name");
        assert_eq!(args[1], "ECC 2.0");
        assert_eq!(args[2], "ECC 2.0: Approval needed");
        assert_eq!(args[3], "worker-123");
    }
}

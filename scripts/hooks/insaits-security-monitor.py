#!/usr/bin/env python3
"""
InsAIts Security Monitor — PostToolUse Hook for Claude Code
============================================================

Real-time security monitoring for Claude Code tool outputs.
Catches credential exposure, prompt injection, behavioral anomalies,
hallucination chains, and 20+ other anomaly types — runs 100% locally.

Writes audit events to .insaits_audit_session.jsonl for forensic tracing.

Setup:
  pip install insa-its

  Add to .claude/settings.json:
  {
    "hooks": {
      "PostToolUse": [
        {
          "matcher": ".*",
          "hooks": [
            {
              "type": "command",
              "command": "python scripts/hooks/insaits-security-monitor.py"
            }
          ]
        }
      ]
    }
  }

How it works:
  Claude Code passes tool result as JSON on stdin.
  This script runs InsAIts anomaly detection on the output.
  Exit code 0 = clean (pass through).
  Exit code 2 = critical issue found (blocks action, shows feedback to Claude).

Detections include:
  - Credential exposure (API keys, tokens, passwords in output)
  - Prompt injection patterns
  - Hallucination indicators (phantom citations, fact contradictions)
  - Behavioral anomalies (context loss, semantic drift)
  - Tool description divergence
  - Shorthand emergence / jargon drift

All processing is local — no data leaves your machine.

Author: Cristi Bogdan — YuyAI (https://github.com/Nomadu27/InsAIts)
License: Apache 2.0
"""

import sys
import json
import os
import hashlib
import time

# Try importing InsAIts SDK
try:
    from insa_its import insAItsMonitor
    INSAITS_AVAILABLE = True
except ImportError:
    INSAITS_AVAILABLE = False

AUDIT_FILE = ".insaits_audit_session.jsonl"


def extract_content(data):
    """Extract inspectable text from a Claude Code tool result."""
    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})
    tool_result = data.get("tool_response", {})

    text = ""
    context = ""

    if tool_name in ("Write", "Edit", "MultiEdit"):
        text = tool_input.get("content", "") or tool_input.get("new_string", "")
        context = "file:" + tool_input.get("file_path", "")[:80]
    elif tool_name == "Bash":
        if isinstance(tool_result, dict):
            text = tool_result.get("output", "") or tool_result.get("stdout", "")
        elif isinstance(tool_result, str):
            text = tool_result
        context = "bash:" + str(tool_input.get("command", ""))[:80]
    elif "content" in data:
        content = data["content"]
        if isinstance(content, list):
            text = "\n".join(
                b.get("text", "") for b in content if b.get("type") == "text"
            )
        elif isinstance(content, str):
            text = content
        context = data.get("task", "")

    return text, context


def write_audit(event):
    """Append an audit event to the JSONL audit log."""
    try:
        event["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        event["hash"] = hashlib.sha256(
            json.dumps(event, sort_keys=True).encode()
        ).hexdigest()[:16]
        with open(AUDIT_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(event) + "\n")
    except OSError:
        pass


def format_feedback(anomalies):
    """Format detected anomalies as feedback for Claude Code."""
    lines = [
        "== InsAIts Security Monitor — Issues Detected ==",
        "",
    ]
    for i, a in enumerate(anomalies, 1):
        sev = getattr(a, "severity", "MEDIUM")
        atype = getattr(a, "type", "UNKNOWN")
        detail = getattr(a, "detail", "")
        lines.extend([
            f"{i}. [{sev}] {atype}",
            f"   {detail[:120]}",
            "",
        ])
    lines.extend([
        "-" * 56,
        "Fix the issues above before continuing.",
        "Audit log: " + AUDIT_FILE,
    ])
    return "\n".join(lines)


def main():
    raw = sys.stdin.read().strip()
    if not raw:
        sys.exit(0)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {"content": raw}

    text, context = extract_content(data)

    # Skip very short or binary content
    if len(text.strip()) < 10:
        sys.exit(0)

    if not INSAITS_AVAILABLE:
        print(
            "[InsAIts] Not installed. Run: pip install insa-its",
            file=sys.stderr,
        )
        sys.exit(0)

    # Enable dev mode (no API key needed for local detection)
    os.environ.setdefault("INSAITS_DEV_MODE", "true")

    monitor = insAItsMonitor(session_name="claude-code-hook")
    result = monitor.send_message(
        text=text[:4000],
        sender_id="claude-code",
        llm_id=os.environ.get("INSAITS_MODEL", "claude-opus"),
    )

    anomalies = result.get("anomalies", [])

    # Write audit event regardless of findings
    write_audit({
        "tool": data.get("tool_name", "unknown"),
        "context": context,
        "anomaly_count": len(anomalies),
        "anomaly_types": [getattr(a, "type", "") for a in anomalies],
        "text_length": len(text),
    })

    if not anomalies:
        if os.environ.get("INSAITS_VERBOSE"):
            print("[InsAIts] Clean — no anomalies.", file=sys.stderr)
        sys.exit(0)

    # Check severity
    has_critical = any(
        getattr(a, "severity", "") in ("CRITICAL", "critical") for a in anomalies
    )

    feedback = format_feedback(anomalies)

    if has_critical:
        print(feedback)  # stdout -> Claude Code shows to model
        sys.exit(2)      # block action
    else:
        print(feedback, file=sys.stderr)  # stderr -> logged only
        sys.exit(0)


if __name__ == "__main__":
    main()

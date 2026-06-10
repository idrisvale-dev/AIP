# Hook Integration for Session-Stop Self-Evaluation

Add this hook to `hooks/hooks.json` to automatically trigger self-evaluation at the end of every session:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "true",
        "hooks": [
          {
            "type": "command",
            "command": "echo '[Self-Eval] Session complete. Consider running agent-self-evaluation to rate your output.'"
          }
        ],
        "description": "Remind agent to self-evaluate at session end"
      }
    ]
  }
}
```

## Integration with the Python Evaluator

The `scripts/evaluate.py` script can be used as a standalone tool:

```bash
# Pipe agent output directly
echo "Your agent response here" | python3 skills/agent-self-evaluation/scripts/evaluate.py

# From files
python3 skills/agent-self-evaluation/scripts/evaluate.py --task task.txt --output response.txt
```

To integrate it into hooks, capture the last agent output to a file first, then run the evaluator:

```json
{
  "PostToolUse": [
    {
      "matcher": "tool == \"Bash\" && tool_input.command matches \"(test|pytest|npm test|go test)\"",
      "hooks": [
        {
          "type": "command",
          "command": "echo '[Self-Eval] Tests completed. Consider running agent-self-evaluation.'"
        }
      ],
      "description": "Remind agent to self-evaluate after test runs"
    }
  ]
}
```

These hooks are opt-in. Add them to your local `hooks/hooks.json` if you want automated evaluation prompts.

## Manual Usage (Recommended)

The most reliable approach is manual invocation — the agent runs self-evaluation as part of its workflow when the `agent-self-evaluation` skill is active, without requiring hook configuration. The skill's "When to Activate" section already covers trigger conditions (multi-file changes, debugging sessions, design documents).

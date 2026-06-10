# Agent Self-Evaluation Report Template

Copy this template and fill in after completing a task. Keep it in your conversation — the user sees it inline.

```
============================================================
AGENT SELF-EVALUATION REPORT
============================================================

  Accuracy         █████ 5/5    or    ███░░ 3/5
    + [Evidence: passing tests, verified claims]
    - [Gaps: unverified claims, hedging language]

  Completeness      █████ 5/5
    + [What's covered: all requirements + edge cases]
    - [What's missing: explicitly acknowledge gaps]

  Clarity           █████ 5/5
    + [Structure: headings, code blocks, bullet points]
    - [Issues: undefined terms, wall of text, no summary]

  Actionability     █████ 5/5
    + [User can: merge PR, run command, review file]
    - [Blockers: missing steps, vague suggestions]

  Conciseness       █████ 5/5
    + [Tight: no repetition, high information density]
    - [Bloat: filler, meta-commentary, repeated points]

  OVERALL           X.X/5

TOP IMPROVEMENTS:
  [Only list axes scoring < 4, ranked by user impact]
```

## Quick Reference: Scoring Triggers

| If you see this... | Accuracy | Completeness | Clarity | Actionability | Conciseness |
|---|---|---|---|---|---|
| "should work" / "probably fine" | ≤4 | — | — | — | — |
| "I think" / "I believe" | ≤4 | — | — | — | — |
| No test output cited | ≤4 | — | — | — | — |
| "TODO" / "FIXME" left behind | ≤3 | ≤3 | — | ≤3 | — |
| Missing error handling | — | ≤3 | — | — | — |
| Only happy path covered | — | ≤3 | — | — | — |
| Wall-of-text paragraph (>200 words) | — | — | ≤3 | — | — |
| No headings or structure | — | — | ≤3 | — | — |
| "You should..." without specifics | — | — | — | ≤3 | — |
| No PR or file created | — | — | — | ≤3 | — |
| User needs to figure out next step | — | — | — | ≤2 | — |
| Repeated points (3+ times) | — | — | — | — | ≤3 |
| "Let me explain..." / "To summarize..." x3+ | — | — | — | — | ≤3 |
| Output >15x longer than task | — | — | — | — | ≤3 |

## When to Skip

Skip the evaluation if:
- Task was a single tool call (e.g., "read this file" — nothing to evaluate)
- User explicitly says "don't evaluate" or "just do it"
- Task is purely conversational (greeting, small talk)
- You're mid-workflow and the user will judge the final output, not intermediate steps

## Post-Evaluation Actions

| Overall Score | What to do |
|---|---|
| ≥4.5 | Deliver. No changes needed. |
| 3.5–4.4 | Flag the top improvement but deliver. Fix if <30 seconds. |
| 2.5–3.4 | State what you'd change. Ask user: "Should I redo [axis] or deliver as-is?" |
| <2.5 | Don't deliver. Say: "This scored __ because __. Let me redo this with [specific fix]." Then redo. |

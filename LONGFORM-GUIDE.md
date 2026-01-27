# The Longform Guide to Everything Claude Code

> Advanced techniques that separate productive sessions from wasteful ones. Token economics, memory persistence, verification patterns, parallelization strategies, and compound effects of building reusable workflows.

## Preface

In "The Shorthand Guide to Everything Claude Code", I covered the foundational setup: skills and commands, hooks, subagents, MCPs, plugins, and the configuration patterns that form the backbone of an effective Claude Code workflow.

This longform guide goes deeper into techniques that make the difference between being plagued by context rot within the first hour, versus maintaining productive sessions for hours. These patterns have been refined over 10+ months of daily use.

**Themes:** Token economics, memory persistence, verification patterns, parallelization strategies, and the compound effects of building reusable workflows.

## Context & Memory Management

For sharing memory across sessions, create a skill or command that summarizes progress and saves to a `.tmp` file in your `.claude` folder. The next day it can use that as context and pick up where you left off.

### Session Storage Pattern

Create one file per session: `~/.claude/sessions/YYYY-MM-DD-topic.tmp`

Each session file should contain:
- What approaches worked (with evidence)
- Which approaches failed
- Which approaches haven't been attempted
- What's left to do

### Clearing Context Strategically

Once you have your plan set and context cleared, you can work from the plan. This is useful when you've accumulated a lot of exploration context that's no longer relevant to execution.

**Disable auto-compact** for more control. Manually compact at logical intervals:
- Compact after exploration, before execution
- Compact after completing a milestone, before starting next

### Advanced: Dynamic System Prompt Injection

Instead of solely putting everything in `.claude/rules/` which loads every session, use CLI flags to inject context dynamically:

```bash
claude --system-prompt "$(cat memory.md)"
```

This ensures content gets weighted appropriately in the instruction hierarchy.

### Memory Persistence Hooks

Chain these together for continuous memory across sessions:

- **PreCompact Hook**: Before context compaction happens, save important state to a file
- **SessionStart Hook**: On new session, load previous context automatically
- **SessionEnd Hook**: On session end, persist learnings to a file

## Continuous Learning / Memory

### The Problem

Wasted tokens, wasted context, wasted time. You repeat prompts because Claude ran into the same problem or gave the same response you've heard before.

### The Solution

When Claude Code discovers something non-trivial - a debugging technique, a workaround, a project-specific pattern - it saves that knowledge as a new skill. Next time a similar problem comes up, the skill gets loaded automatically.

Use a **Stop hook** (runs once at session end) instead of **UserPromptSubmit** (runs on every message and adds latency). The script analyzes the session for patterns worth extracting and saves them as reusable skills in `~/.claude/skills/learned/`.

### Manual Extraction

Run `/learn` mid-session when you've just solved something non-trivial. It prompts you to extract the pattern, drafts a skill file, and asks for confirmation before saving.

## Token Optimization

### Primary Strategy: Subagent Architecture

Optimize tools and subagent architecture to delegate the cheapest model sufficient for the task:

- **Haiku**: Repetitive tasks, clear instructions, "worker" in multi-agent setup
- **Sonnet**: 90% of coding tasks (default)
- **Opus**: First attempt failed, 5+ files, architectural decisions, security-critical code

### Model Selection Quick Reference

```
Default: Sonnet for most coding
Upgrade to Opus if: First attempt failed, task spans 5+ files, architectural decisions
Downgrade to Haiku if: Repetitive, instructions very clear, worker agent
```

### Tool-Specific Optimizations

- Replace `grep` with `mgrep` - ~50% token reduction on average
- Run background processes outside Claude if you don't need Claude to process entire output
- Use `tmux` for long-running commands

### Modular Codebase Benefits

A modular codebase with reusable utilities, functions, and hooks:
- Reduces token costs (main files hundreds of lines instead of thousands)
- Gets tasks done right on first try (fewer re-prompts)
- Helps Claude avoid large file reads that cause token overflow

### System Prompt Slimming

Claude Code's system prompt takes ~18k tokens (~9% of 200k context). Can be reduced to ~10k tokens with patches, saving ~7,300 tokens (41% of static overhead).

## Verification Loops and Evals

### Observability Methods

1. **Hook-based logging**: PostToolUse hook logs what Claude enacted and exact changes
2. **Diff-based comparison**: Compare same task with and without skill across worktrees
3. **Tmux tracing**: Monitor thinking stream and output when skills trigger

### Eval Pattern Types

**Checkpoint-Based Evals:**
- Set explicit checkpoints in workflow
- Verify against defined criteria
- If verification fails, Claude must fix before proceeding
- Good for linear workflows with clear milestones

**Continuous Evals:**
- Run every N minutes or after major changes
- Full test suite, build status, lint
- Report regressions immediately
- Good for long-running sessions

### Key Metrics

- **pass@k**: At least ONE of k attempts succeeds (use when you just need it to work)
- **pass^k**: ALL k attempts must succeed (use when consistency is essential)

### Building an Eval Roadmap

1. Start early - 20-50 simple tasks from real failures
2. Convert user-reported failures into test cases
3. Write unambiguous tasks
4. Build balanced problem sets
5. Build robust harness
6. Grade what agent produced, not the path it took
7. Read transcripts from many trials
8. Monitor for saturation

## Parallelization

### Defining Scopes

When forking conversations in a multi-Claude terminal setup:
- Define scope for actions in fork and original conversation
- Aim for minimal overlap
- Choose orthogonal tasks to prevent interference

### Preferred Pattern

- Main chat: Code changes
- Forks: Questions about codebase state, research on external services, doc pulls

### On Arbitrary Terminal Counts

Don't set arbitrary amounts like 5 local + 5 upstream. Add terminal/instance out of true necessity:
- Use scripts if you can
- Let Claude spawn instance in tmux if possible
- Minimum viable parallelization is key

### Git Worktrees

For overlapping parallel instances without conflicts:

```bash
git worktree add ../project-feature-a feature-a
git worktree add ../project-feature-b feature-b
git worktree add ../project-refactor refactor-branch

# Each worktree gets its own Claude instance
cd ../project-feature-a && claude
```

Benefits:
- No git conflicts
- Clean working directory per instance
- Easy to compare outputs
- Can benchmark same task across approaches

### The Cascade Method

Organize with "cascade" pattern:
- Open new tasks in new tabs to the right
- Sweep left to right, oldest to newest
- Maintain consistent direction flow
- Focus on at most 3-4 tasks (more = mental overhead grows faster than productivity)

## Groundwork

### Two-Instance Kickoff Pattern

For new projects, start with 2 Claude instances:

**Instance 1: Scaffolding Agent**
- Lays down scaffold and groundwork
- Creates project structure
- Sets up configs (CLAUDE.md, rules, agents)
- Establishes conventions
- Gets skeleton in place

**Instance 2: Deep Research Agent**
- Connects to services, web search
- Creates detailed PRD
- Creates architecture diagrams
- Compiles references with actual documentation clips

### Minimal Starting Requirements

What you need minimally to start is fine - quicker than feeding in links for Claude to scrape or using Firecrawl MCP. Use those when deep in work and Claude is getting syntax wrong or using dated functions.

### llms.txt Pattern

Many documentation sites offer `/llms.txt` - a clean, LLM-optimized version of documentation. Request with `/llms.txt` on their docs page and feed directly to Claude.

## Philosophy: Build Reusable Patterns

From [@omarsar0](https://x.com/@omarsar0): "Early on, I spent time building reusable workflows/patterns. Tedious to build, but this had a wild compounding effect as models and agent harnesses improved."

### What to Invest In

- Subagents
- Skills
- Commands
- Planning patterns
- MCP tools
- Context engineering patterns

### Why It Compounds

"The best part is that all these workflows are transferable to other agents." Once built, they work across model upgrades. **Investment in patterns > investment in specific model tricks.**

## Best Practices for Agents & Sub-Agents

### The Sub-Agent Context Problem

Sub-agents exist to save context by returning summaries instead of dumping everything. But the orchestrator has semantic context the sub-agent lacks. The sub-agent only knows the literal query, not the PURPOSE behind it. Summaries often miss key details.

### Iterative Retrieval Pattern

1. Orchestrator evaluates every sub-agent return
2. Ask follow-up questions before accepting
3. Sub-agent goes back to source and gets answers
4. Loop until sufficient (max 3 cycles)

**Key:** Pass objective context, not just the query.

### Sequential Phase Pattern

```
Phase 1: RESEARCH → research-summary.md
Phase 2: PLAN → plan.md
Phase 3: IMPLEMENT → code changes
Phase 4: REVIEW → review-comments.md
Phase 5: VERIFY → done or loop back
```

**Rules:**
1. Each agent gets ONE clear input, produces ONE clear output
2. Outputs become inputs for next phase
3. Never skip phases
4. Use `/clear` between agents
5. Store intermediate outputs in files

## Tips and Tricks

### MCPs Are Replaceable

Most MCPs (GitHub, Supabase, Vercel, etc.) are just wrappers around robust CLIs. Instead of having the MCP loaded full-time (context cost), create skills and commands that use the CLI directly.

Example: Instead of GitHub MCP, create `/gh-pr` command wrapping `gh pr create` with your preferred options.

**Note:** With lazy loading, the context window issue is mostly solved, but token usage and cost are not. CLI + skills approach still effective.

## Video

Full end-to-end project walkthrough covering both guides in action is planned, demonstrating:
- Full project setup with configs from shorthand guide
- Advanced techniques from longform guide
- Real-time token optimization
- Verification loops in practice
- Memory management across sessions
- Two-instance kickoff pattern
- Parallel workflows with git worktrees

## References

- [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [YK: 32 Claude Code Tips](https://agenticcoding.substack.com/p/32-claude-code-tips-from-basics-to)
- [RLanceMartin: Session Reflection Pattern](https://rlancemartin.github.io/2025/12/01/claude_diary/)

---

*Everything covered in both guides is available on GitHub at [everything-claude-code](https://github.com/affaan-m/everything-claude-code)*

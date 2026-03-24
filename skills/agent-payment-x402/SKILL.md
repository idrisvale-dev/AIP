---
name: agent-payment-x402
description: Add x402 payment execution to AI agents — per-task budgets, spending controls, and non-custodial wallets via MCP tools. Use when agents need to pay for APIs, services, or other agents.
origin: community
---

# Agent Payment Execution (x402)

Enable AI agents to make autonomous payments with built-in spending controls. Uses the x402 HTTP payment protocol and MCP tools so agents can pay for external services, APIs, or other agents without custodial risk.

## When to Use

Use when: your agent needs to pay for an API call, purchase a service, settle with another agent, enforce per-task spending limits, or manage a non-custodial wallet. Pairs naturally with cost-aware-llm-pipeline and mcp-server-patterns skills.

## Core Concepts

### x402 Protocol
x402 extends HTTP 402 (Payment Required) into a machine-negotiable flow. When a server returns `402`, the agent's payment tool automatically negotiates price, checks budget, signs a transaction, and retries — no human in the loop.

### Spending Controls
Every payment tool call enforces a `SpendingPolicy`:
- **Per-task budget** — max spend for a single agent action
- **Per-session budget** — cumulative limit across an entire session
- **Allowlisted recipients** — restrict which addresses/services the agent can pay
- **Rate limits** — max transactions per minute/hour

### Non-Custodial Wallets
Agents hold their own keys via ERC-4337 smart accounts. The orchestrator sets policy; the agent can only spend within bounds. No pooled funds, no custodial risk.

## MCP Integration

The payment layer exposes standard MCP tools that slot into any Claude Code or agent harness setup:

```json
{
  "mcpServers": {
    "agentpay": {
      "command": "npx",
      "args": ["-y", "agentwallet-sdk"]
    }
  }
}
```

### Available Tools

| Tool | Purpose |
|------|---------|
| `get_balance` | Check agent wallet balance |
| `send_payment` | Send payment to address or ENS |
| `check_spending` | Query remaining budget |
| `set_policy` | Configure spending limits |
| `list_transactions` | Audit trail of all payments |

## Example: Pay-Per-API-Call Agent

```typescript
// In your CLAUDE.md or agent config:
// 1. Add agentpay MCP server (see above)
// 2. Set spending policy in your skill/hook:

// Hook: pre-tool check
if (toolName === "web_search" && apiCost > 0) {
  const budget = await mcp.call("agentpay", "check_spending");
  if (budget.remaining < apiCost) {
    return { error: "Budget exceeded for this task" };
  }
}
```

## Best Practices

- **Set budgets before delegation**: When spawning sub-agents, attach a SpendingPolicy. Never give an agent unlimited spend.
- **Audit trails**: Use `list_transactions` in post-task hooks to log what was spent and why.
- **Fail closed**: If the payment tool is unreachable, block the paid action — don't fall back to unmetered access.
- **Pair with security-review**: Payment tools are high-privilege. Apply the same scrutiny as shell access.
- **Test with testnets first**: Use Base Sepolia for development; switch to Base mainnet for production.

## Production Reference

- **npm**: [`agentwallet-sdk`](https://www.npmjs.com/package/agentwallet-sdk)
- **Merged into NVIDIA NeMo Agent Toolkit**: [PR #17](https://github.com/NVIDIA/NeMo-Agent-Toolkit-Examples/pull/17) — x402 payment tool for NVIDIA's agent examples
- **Protocol spec**: [x402.org](https://x402.org)

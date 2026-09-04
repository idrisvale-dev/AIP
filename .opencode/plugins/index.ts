/**
 * AIP Plugins for OpenCode
 *
 * This module exports all AIP plugins for OpenCode integration.
 * Plugins provide hook-based automation that mirrors Claude Code's hook system
 * while taking advantage of OpenCode's more sophisticated 20+ event types.
 */

export { AIPHooksPlugin, default } from "./aip-hooks.js"

// Re-export for named imports
export * from "./aip-hooks.js"

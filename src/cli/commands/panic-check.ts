/**
 * openlore panic-check
 *
 * Reads panic-state.json and outputs a structured JSON decision for the
 * Claude Code PreToolUse hook. Always exits 0 — severity is encoded in
 * the payload, not the exit code, so the hook runtime never sees an error.
 *
 * Designed for minimal startup overhead: imports only node built-ins and
 * constants. Heavy MCP dependencies are never loaded.
 */

import { Command } from 'commander';
import { readPanicState, writePanicState, buildPanicCheckOutput } from '../../core/services/mcp-handlers/panic-response.js';
import { readOpenLoreConfig } from '../../core/services/config-manager.js';
import { emit } from '../../core/services/telemetry.js';

type HookFormat = 'claude' | 'kilo' | 'codex';

export const panicCheckCommand = new Command('panic-check')
  .description('Check current panic level (PreToolUse hook consumer)')
  .option('-d, --directory <path>', 'Project directory', process.cwd())
  .option('-f, --format <format>', 'Hook format: claude|kilo|codex', 'claude')
  .action(async (options: { directory: string; format: string }) => {
    try {
      const dir = options.directory;
      const format = options.format as HookFormat;

      // Policy gate — config is single source of truth
      const cfg = await readOpenLoreConfig(dir);
      const mode = cfg?.panicResponse?.mode ?? 'off';

      if (mode === 'off' || mode === 'observe') {
        // Panic disabled or observe-only: hook passes through silently
        process.exit(0);
      }

      const state = readPanicState(dir);

      // NOTE: Gryph runtime enrichment is deferred (see adopt-agent-behavioral-
      // governance proposal). The panic-check hook consumes MCP-path panic state
      // only; the Gryph background observer lands as a separate change.

      const output = buildPanicCheckOutput(state);

      if (output.decision === 'warn') {
        const newCount = state.interventionCountSinceStable + 1;
        const now = new Date().toISOString();
        writePanicState(dir, {
          ...state,
          lastHookInterventionAt: now,
          gryphWindowStart: now,
          interventionCountSinceStable: newCount,
        });
        emit(dir, 'panic', {
          event: 'hook_intervention',
          channel: 'pre_tool_use',
          format,
          panic_level: state.panicLevel,
          severity: output.severity,
          directive_mode: newCount >= 3,
          intervention_count: newCount,
        });
      }

      process.stdout.write(formatOutput(output, format) + '\n');
    } catch {
      // fail-open: any error → silent exit 0
    }
    process.exit(0);
  });

function formatOutput(output: ReturnType<typeof buildPanicCheckOutput>, format: HookFormat): string {
  // claude and codex both consume raw JSON — codex uses the same Claude Code hook schema
  if (format === 'claude' || format === 'codex') {
    return JSON.stringify(output);
  }

  // kilo: plain-text message (some runtimes just want a string signal)
  if (output.decision === 'allow') return '';
  return output.message ?? `[PANIC:${output.severity?.toUpperCase() ?? 'WARN'}] Destabilization detected — call orient().`;
}

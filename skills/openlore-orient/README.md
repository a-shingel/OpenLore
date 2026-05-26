# openlore-orient — Claude Code Skill

A drop-in Claude Code [Skill](https://docs.claude.com/en/docs/claude-code/skills) that teaches the model to call OpenLore's `orient()` at the start of every task in this repo, instead of grepping blind.

## What it is

OpenLore maintains a deterministic, graph-native model of your codebase — every function, every caller, every spec section, every file. The `orient` tool collapses what would otherwise be a chain of `analyze_codebase → search_code → search_specs → suggest_insertion_points` into a single call that returns the exact context the agent needs for the task at hand.

This skill bundle ships the prompt and the wrappers Claude Code needs to know about `orient`. Once installed, Claude Code's system prompt picks it up automatically and the model invokes it when relevant — no `CLAUDE.md` editing required.

## Install

### Option 1 — user-scope (recommended)

Available across every project on your machine. From the OpenLore repo root:

```sh
npm run skill:install-local
```

This copies `skills/openlore-orient/` into `~/.claude/skills/openlore-orient/`. Idempotent — re-run any time to upgrade.

### Option 2 — project-scope

Available only in the current project. From this OpenLore repo:

```sh
cp -R skills/openlore-orient /path/to/your-project/.claude/skills/
```

### Option 3 — via `openlore install` *(future)*

Once OpenLore spec-01's `openlore install --agent claude-code` is shipped on npm, it will copy this skill into the target project's `.claude/skills/` automatically as part of the standard install flow. No separate step needed.

## What's in the bundle

| File | Purpose |
|---|---|
| `SKILL.md` | The manifest + instructions Claude Code reads. Frontmatter declares the skill; body sections describe when/how/what-not-to-do. |
| `scripts/orient.sh` | POSIX wrapper around `npx --yes openlore orient --json --task "<task>"`. |
| `scripts/orient.ps1` | PowerShell equivalent for Windows. |
| `examples/example-orient-output.json` | Real (redacted) output captured from this repo, so a reader can see the JSON shape without us writing a schema doc. |
| `examples/example-task-prompt.md` | A short worked example of the full loop: task → orient call → output → next step. |

## Known limitations

The `openlore orient --json --task "..."` CLI subcommand is not yet shipped on npm — `orient` is currently exposed only as an MCP tool. The shell wrappers will exit non-zero until a follow-up spec adds the CLI subcommand. In the meantime, use the MCP path documented inside `SKILL.md`.

See `TODO(spec-02-followup)` markers in `SKILL.md` and the wrappers.

## License

MIT, matching the [parent OpenLore repository](https://github.com/clay-good/OpenLore).

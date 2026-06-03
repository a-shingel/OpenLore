/**
 * Task derivation for `openlore prove` (Spec 25 Q2).
 *
 * The benchmark's win shows up on orientation questions about an unfamiliar
 * codebase. We auto-derive such questions from the user's own call graph, with
 * an oracle taken from the graph itself (so correctness is verifiable without a
 * human). Pure + deterministic so it unit-tests without a repo.
 */

/** Minimal call-graph fact per function — adapted from the EdgeStore by the CLI. */
export interface GraphFact {
  name: string;
  filePath: string;
  callerNames: string[];
  calleeNames: string[];
  isEntryPoint: boolean;
}

export interface ProveTask {
  id: string;
  prompt: string;
  /** Answer is correct if it contains AT LEAST ONE of these (case-insensitive). */
  mustIncludeAny: string[];
  /** Short note on what structural fact this probes. */
  probes: string;
}

/** True iff the agent's answer contains at least one oracle substring. */
export function scoreAnswer(task: ProveTask, answer: string): boolean {
  const a = answer.toLowerCase();
  return task.mustIncludeAny.some(s => a.includes(s.toLowerCase()));
}

/**
 * Derive up to `max` orientation tasks from graph facts. Deterministic: facts
 * are sorted by a stable key before selection so the same graph yields the same
 * tasks. Returns [] when the graph is too sparse to form an oracle-able task.
 */
export function deriveTasks(facts: GraphFact[], max = 3): ProveTask[] {
  const tasks: ProveTask[] = [];

  // Stable ordering: most-called first, then by name (tie-break) — no Date/random.
  const byCallers = [...facts].sort(
    (a, b) => b.callerNames.length - a.callerNames.length || a.name.localeCompare(b.name),
  );

  // Task 1 — the hub: "which function is called by the most others?"
  const hub = byCallers[0];
  if (hub && hub.callerNames.length >= 2) {
    tasks.push({
      id: 'hub',
      prompt:
        'In this codebase, which single function is called by the most other functions? ' +
        'Answer with just the function name.',
      mustIncludeAny: [hub.name],
      probes: `most-called function (${hub.name}, ${hub.callerNames.length} callers)`,
    });

    // Task 2 — a caller of the hub (any valid caller counts).
    tasks.push({
      id: 'caller',
      prompt: `Name one function that directly calls \`${hub.name}\` in this codebase.`,
      mustIncludeAny: hub.callerNames.slice(0, 25),
      probes: `a direct caller of ${hub.name}`,
    });
  }

  // Task 3 — an entry point's callee: "what does <entry> invoke?"
  const entry = byCallers.find(f => f.isEntryPoint && f.calleeNames.length >= 2)
    ?? [...facts].sort((a, b) => b.calleeNames.length - a.calleeNames.length || a.name.localeCompare(b.name))[0];
  if (entry && entry.calleeNames.length >= 2) {
    tasks.push({
      id: 'callee',
      prompt: `Name one function that \`${entry.name}\` calls (directly invokes) in this codebase.`,
      mustIncludeAny: entry.calleeNames.slice(0, 25),
      probes: `a callee of ${entry.name}`,
    });
  }

  return tasks.slice(0, max);
}

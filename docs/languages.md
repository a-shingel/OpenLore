# Supported languages

OpenLore extracts a call graph (functions as nodes, calls as edges) per file via
tree-sitter. Every language rides the same primitives (`FunctionNode` /
`CallEdge` / `ClassNode`) and is surfaced by every MCP tool with no tool-side
changes. Extraction is **static and name-based**: a call becomes an edge only
when the callee name resolves to a function declared in the project. Dynamic
dispatch, reflection, `eval`, and computed/variable call targets emit **no
edge** rather than a wrong one.

## Languages

| Language | Extensions | Grouping (ClassNode) | Notes |
|---|---|---|---|
| TypeScript / JavaScript | `.ts` `.tsx` `.js` `.jsx` | classes | — |
| Python | `.py` | classes | — |
| Go | `.go` | structs (file-module) | — |
| Rust | `.rs` | impl/traits | — |
| Ruby | `.rb` | classes/modules | — |
| Java | `.java` | classes/interfaces | — |
| C++ | `.cpp` `.cc` `.cxx` `.hpp` `.h`* | classes/namespaces | `.h` default (see below) |
| Swift | `.swift` | classes/structs | — |
| **C#** | `.cs` | namespace/class/struct/record/interface | methods, constructors, local functions; `this.M()`, `Class.M()` |
| **Kotlin** | `.kt` `.kts` | class/object/interface/companion | extension functions record the receiver type in `className` |
| **PHP** | `.php` `.phtml` | class/trait/interface/enum | `$this->m()`, `Class::m()`, free `foo()` |
| **C** | `.c` `.h`* | none (file scope) | functions + calls; no classes |
| **Scala** | `.scala` `.sc` | object/class/trait | `def`; `obj.m()`, `Obj.m()` |
| **Dart** | `.dart` | class/mixin/extension/enum | functions, methods, constructors |
| **Lua** | `.lua` | none (file scope) | `function`, `local function`, `t.f()` / `t:m()` |
| **Elixir** | `.ex` `.exs` | `defmodule` | `def`/`defp`/`defmacro`; local + `Mod.fun()`; multi-clause collapses to one node with clause count in the signature |
| **Bash/Shell** | `.sh` `.bash` | none (file scope) | edges only to project-defined functions, never external binaries (`grep`, `ls`, …) |

The nine bold languages were added in spec-08. C#, Kotlin, PHP, and C were
previously *detected but never graphed* (a "phantom language" bug — files were
counted but produced an empty graph); spec-08 fixes that.

## The `.h` rule

`.h` headers are claimed by both C and C++. Resolution, in order:

1. A `.h` in a project containing any `.cpp`/`.cc`/`.cxx`/`.hpp` → **C++**.
2. A `.h` in a project with `.c` files and no C++ sources → **C**.
3. A standalone / ambiguous `.h` → **C++** (default).

The C++ grammar is a superset, so misclassifying a C header as C++ is low-harm;
the reverse loses templates/namespaces, so the heuristic biases toward C++.

## Graceful degradation

Each grammar is a native module. If a grammar fails to install or is
ABI-incompatible with the host `tree-sitter` binding, its loader fails **soft**:
OpenLore logs one warning —

```
language <X> grammar unavailable — files will be indexed for search but not graphed
```

— and skips graph extraction for that language only. `analyze` never crashes,
and every other language is unaffected. Files of the unavailable language are
still walked and indexed for search (BM25).

> Environment note: tree-sitter grammars built against ABI 15 (tree-sitter
> 0.25+) require a matching host binding. On hosts pinned to an older
> `tree-sitter` (ABI 14), such grammars degrade as above. Lua and Dart ship only
> ABI-15 builds today, so they graph wherever an ABI-15-capable host binding is
> installed and degrade gracefully elsewhere.

## Out of scope

Not call-graph-shaped (need a different model): SQL, R, MATLAB, HTML/CSS,
Markdown/JSON/YAML config (except where claimed as Infrastructure-as-Code).
Deferred general-purpose languages: Objective-C, Perl, Haskell, Clojure, F#,
Groovy, OCaml, Zig, Nim, Julia, Erlang, VB.NET, PowerShell, Fortran, COBOL.

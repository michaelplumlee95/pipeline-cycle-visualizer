# CLAUDE.md

## What this is

A static, single-page MIPS pipeline cycle visualizer for a CS331 class project. The user types a short MIPS program, and the app shows how it moves through a classic 5-stage pipeline (IF, ID, EX, MEM, WB) as an instruction-by-cycle table, with data-hazard stalls drawn as bubbles. Plain HTML/CSS/JS: no build step, no package manager, no framework, no dependencies.

It is the sibling of `../kmap-solver` and deliberately matches its stack, look, and code conventions. When in doubt about style, read that project. `design.md` is the visual and behavioral spec for this one.

## Running

Open `index.html` directly in a browser (or serve the directory with any static file server). There is no dev server or build process.

Tests, Node built-ins only (exits non-zero on failure):

```
node tests/run.js
```

`tests/harness.js` loads the real `script.js` into a `vm` sandbox with a stub DOM and appends a test-only export line at load time, so `script.js` is not modified and there is no duplicated logic to keep in sync. `PIPE_SCRIPT=/path/to/copy.js` runs the suite against a modified copy, which is useful for mutation checks.

`tests/oracle.js` is an independent cycle-by-cycle pipeline model that shares no timing formulas with `script.js`; `oracle.test.js` compares the two on hand-picked and seeded random programs. When changing simulator timing, change the rule in `design.md` first, then both implementations.

Still to write: `tests/E2E_CHECKLIST.md`, the manual browser pass for what a stub DOM can't see (layout, focus, console errors, ~375px viewport).

## Planned layout

```
index.html        static skeleton
style.css         one flat stylesheet, tokens in :root
script.js         everything, inside one DOMContentLoaded closure
design.md         visual + pipeline-semantics spec
tests/            run.js, lib.js, harness.js, oracle.js, *.test.js
```

## Architecture

- **Single source of truth.** State is the program text plus the derived simulation trace. Every view re-renders from it; there is no state held in the DOM.
- **Three layers, in this order:** `assemble` (text to instruction objects, with line-numbered errors), `simulate` (instructions to a per-cycle trace), `renderX` (trace to HTML). Keep `assemble` and `simulate` pure so tests can call them without a DOM.
- **Trace shape.** One row per instruction occurrence, one cell per cycle: a stage name (`IF`..`WB`), a stall marker (`ID` repeated as a held stage, shown as a bubble), or empty. Each stall cell records why (which register, which producer) so the UI can explain it.
- **Rendering.** `renderX` builds an HTML string with template literals, assigns it to a container's `innerHTML`, then re-attaches listeners. All user text goes through `escapeHtml`. Ids travel in `data-*` attributes. Typing in the editor re-assembles and re-simulates on every change (no separate "run" action), but must not rebuild the focused textarea.

## Pipeline semantics (v1)

Full detail is in `design.md`. The short version:

- Classic 5-stage, one instruction fetched per cycle when not stalled.
- Register file is written in the first half of WB and read in the second half of ID, so a consumer may read in the same cycle its producer is in WB.
- **No forwarding.** A RAW hazard stalls the consumer in ID until the producer reaches WB. Back-to-back dependency costs 2 bubbles. `lw` followed by a dependent instruction costs the same.
- **Branches and jumps stall fetch.** No prediction and no flush. `beq` resolves in EX, so 2 fetch bubbles follow it. `j` resolves in ID, so 1 follows it. Taken or not taken, the cost is identical; fetch then resumes at the correct address.
- Supported instructions: `add sub and or slt addi lw sw beq j nop`. Labels, `#` comments, and `$t0`-style or `$8`-style register names are accepted.

## Conventions

Match kmap-solver exactly:

- JS: 4-space indent, single quotes, semicolons, camelCase, `const`/`let` only, arrow functions, `Math.pow` not `**`. Functions are nested declarations inside the DOMContentLoaded closure. No classes, no modules.
- CSS: kebab-case, BEM-ish without `__`/`--` (`.cycle-cell`, `.stall-note`). State is a plain `.active` class. Section comments like `/* Cycle Table */`. All colors come from `:root` tokens; do not hardcode greys or rgba values the way kmap-solver does (see `design.md`).
- HTML: 4-space indent, `lang="en"`, viewport meta, semantic `header`/`main`/`section`, kebab-case ids, script at the end of `body`.
- Files: lowercase single words for code; `snake_case` or lowercase for docs; tests are `<topic>.test.js`.
- Comments: moderate density, explain why rather than what. Section dividers look like `// --- Simulating ---`.
- Commits: imperative, sentence-case, no prefix (e.g. "Add stall detection for load-use hazards"). Default branch is `main`; this repo currently sits on `master` with no commits, so rename before the first push.

## Design intent

- Progressive disclosure: start with a short preloaded example already visible, not an empty page.
- The editor and the cycle table stay visually linked: hovering or focusing an instruction in one highlights its row/line in the other.
- Color encodes identity: each stage has one color, used identically in the table, legend, and any explanation text. Stalls have their own color and are never confused with a stage.
- Immediate feedback: the table recomputes on every edit. Errors show inline with the offending line, not as alerts.
- Explain, don't just show: every bubble can say why it exists ("waiting for $t1 from `lw`, available in WB at cycle 5").
- Clean and minimal; no decoration that distracts from the pipeline.

## Out of scope for v1

Data forwarding, branch prediction and flush, delay slots, an animated datapath diagram, register and memory panels, stepping backward, and instructions beyond the list above. Forwarding on/off is the planned first extension; design the simulator so a hazard-resolution strategy can be swapped in without rewriting the trace format.

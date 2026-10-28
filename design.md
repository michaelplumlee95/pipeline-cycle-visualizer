# Design

Visual and behavioral spec for the MIPS pipeline cycle visualizer. It reuses the kmap-solver design system so the two projects read as a family, and promotes that project's hardcoded values to tokens.

## Principles

1. **Scaffolding and progressive disclosure.** Open on a working example so the table is never empty. A dropdown of example programs (no hazards, back-to-back RAW, load-use, branch, jump) teaches each behavior in turn.
2. **Visual connection.** The editor line, the table row, and any stall explanation refer to the same instruction and highlight together. Color encodes identity and means the same thing everywhere.
3. **Immediate feedback.** The table recomputes on every keystroke. There is no "run" button. Errors appear next to the offending line.
4. **Clarity and minimalism.** Keep the UI clean. Avoid decoration that distracts from the relationship between instructions and cycles. Use textbook notation (IF, ID, EX, MEM, WB; instruction rows by cycle columns).
5. **Accessibility.** Labeled controls, `aria-label` on the table, text and not color alone for stalls, and keyboard-focusable instruction rows. (kmap-solver lists keyboard support as a goal but does not implement it; this project should.)

## Layout

- `body`: flex column, centered, `min-height: 100vh`, zero margin.
- `.container`: `width: 90%; max-width: 1200px; padding: 2rem`.
- Header centered, `margin-bottom: 2rem`, purple `h1`.
- `.app-layout`: `display: grid; grid-template-columns: 1fr 2fr; gap: 2rem`. Collapses to `1fr` at `max-width: 768px` (the only breakpoint).
  - Left column: **Program** card (example picker, assembly textarea, inline errors).
  - Right column: **Pipeline** card (legend, cycle table, summary line) and an **Explanation** card listing each stall in plain words.
- The cycle table scrolls horizontally inside its card (`overflow-x: auto`) when the program is long. It never causes page-level horizontal scroll.

## Tokens

All of `:root`. The first eight are copied from kmap-solver; the rest replace values it hardcodes.

```css
:root {
    --bg-color: #121212;
    --surface-color: #262626;
    --primary-color: #bb86fc;
    --secondary-color: #03dac6;
    --text-color: #e0e0e0;
    --border-color: #333;
    --card-border: #484848;
    --highlight-color: #3700b3;
    --font-family: 'Inter', sans-serif;

    --mono-family: 'Courier New', Courier, monospace;
    --muted-color: #aaa;
    --danger-color: #ff5555;
    --danger-bg: rgba(255, 85, 85, 0.15);
    --overlay-weak: rgba(255, 255, 255, 0.05);
    --overlay-strong: rgba(255, 255, 255, 0.1);
    --inset-bg: rgba(0, 0, 0, 0.2);
    --teal-tint: rgba(3, 218, 198, 0.1);
}
```

Stage and stall colors reuse the kmap-solver accent palette (Dracula-ish) and are defined as tokens too:

| Meaning | Token | Value |
| --- | --- | --- |
| IF | `--stage-if` | `#8be9fd` |
| ID | `--stage-id` | `#50fa7b` |
| EX | `--stage-ex` | `#ffb86c` |
| MEM | `--stage-mem` | `#ff79c6` |
| WB | `--stage-wb` | `#bd93f9` |
| Stall / bubble | `--stall-color` | `#ff5555` |

A stage cell is a tinted fill of its color (about 20% alpha) with a solid 1px border and the stage name as text. A stall cell uses `--stall-color`, a dashed border, and the held stage name in muted text plus a bubble glyph, so it is distinguishable without color. Verify contrast of each stage color on `--surface-color` before shipping.

Deliberate deviation from kmap-solver: `--surface-color` is lightened from `#1e1e1e` to `#262626` and cards get a `--card-border` outline, because cards were hard to tell apart from the `#121212` background.

## Typography

- UI text: Inter (400, 500, 600, 700) from Google Fonts with `preconnect`, falling back to `sans-serif`.
- Assembly, register names, and table cell labels: `var(--mono-family)`.
- Sizes: h1 default, h2 `1.2rem`, card labels `0.85-0.95rem`, table cells `0.9rem` mono, textarea `1rem` mono.

## Spacing, shape, motion

- Spacing in `rem`, steps of 0.25, 0.5, 0.75, 1, 1.5, 2.
- Cards: `background: var(--surface-color); border: 1px solid var(--card-border); padding: 1.5rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.3)`. Card `h2`: `margin-top: 0; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; margin-bottom: 1rem`.
- Controls (select, button): `padding: 0.5rem 1rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--surface-color); color: var(--text-color); font-family: inherit; cursor: pointer`. Hover: `background: var(--border-color)`.
- Textarea and inset panels: `background: var(--inset-bg); border-radius: 4px`.
- Motion: only `transition: background-color 0.2s`. No other animation.
- No icon libraries and no emoji. Glyphs only where needed (a bubble marker in stall cells).

## Components

- **Example picker.** A `select` above the editor. Choosing one replaces the textarea contents.
- **Assembly editor.** Monospace textarea, one instruction per line. Error lines list below it as `Line N: message` in `--danger-color` on `--danger-bg`.
- **Cycle table.** Rows are instructions in program order (labeled with the source text, e.g. `lw $t0, 0($t1)`); columns are cycles `1..N`. Header cells use `--overlay-weak`. Cells are centered, `1px solid var(--border-color)`. Row hover and focus use `--overlay-strong`. Cell width is fixed (about 56px) so columns line up.
- **Legend.** Swatch (`0.75rem` square, `border-radius: 2px`) plus label for each stage and for stall. Uses `:empty { display: none }` if ever conditional.
- **Summary line.** Total cycles, instructions, stall count, and CPI, in a `--inset-bg` box.
- **Explanation list.** One item per stall: which instruction waits, on which register, from which producer, and which cycle it clears. Hovering an item highlights the matching table cells.
- **Segmented toggle** (reserved for the future forwarding on/off switch): joined buttons, outer radii 4px, `.active` uses `--highlight-color` background, `--primary-color` border, white text.

## Pipeline semantics

The simulator and the table must agree with these rules exactly.

1. Five stages: IF, ID, EX, MEM, WB. One instruction enters IF per cycle unless fetch is stalled.
2. Every instruction passes through all five stages, including `sw`, `beq`, `j`, and `nop` (they simply do nothing in some stages). This keeps the table regular.
3. Register file: written in the first half of WB, read in the second half of ID. A consumer's ID may be in the same cycle as its producer's WB.
4. **RAW stall (no forwarding).** An instruction may complete ID only in a cycle `>=` the WB cycle of the youngest older instruction that writes one of its source registers. Until then it holds ID and the instruction behind it holds IF.
   - Producer at cycles IF=1, ID=2, EX=3, MEM=4, WB=5; a dependent next instruction would naturally be in ID at 3, so it stalls in cycles 3 and 4 and reads in 5: **2 bubbles**.
   - One unrelated instruction between them: 1 bubble. Two unrelated: 0.
   - `lw` as producer behaves identically (no forwarding, so no special load-use case).
5. `$0` / `$zero` is never a hazard source.
6. **Control.** `j` resolves in ID: the next fetch occurs the cycle after `j`'s ID, giving 1 bubble in IF. `beq` reads its sources in ID (subject to RAW stalls), resolves in EX, and the next fetch occurs the cycle after its EX, giving 2 bubbles in IF (plus any RAW stall cycles). Taken and not-taken cost the same; fetch resumes at the correct address.
7. Execution is traced by following control flow. Register values are not computed, so `j` is always followed but `beq` is always traced as not taken (fall through); its timing cost is the same either way. Cap the trace (for example 200 instructions) and show a notice if the program does not terminate.
8. Supported instructions: `add sub and or slt` (R-type), `addi lw sw` (I-type, `offset(base)` for memory), `beq` (label target), `j` (label target), `nop`. Anything else is an inline error. Only register dependencies are modeled; memory contents and register values are not computed in v1.

Each stall cell stores `{ reg, producerIndex, clearsAtCycle }` so the Explanation list and tooltips never recompute hazard logic.

## Out of scope for v1

Forwarding, branch prediction and flush, delay slots, datapath diagram, register and memory panels, step-back controls. Planned first extension: a forwarding on/off segmented toggle that changes only the hazard-resolution rule while keeping the trace format.

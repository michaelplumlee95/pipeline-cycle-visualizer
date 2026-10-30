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
- **Datapath** card: full width below `.app-layout` (`margin-top: 2rem`). The diagram scrolls horizontally inside its own container below about 1000px of card width; it never causes page-level horizontal scroll.
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

A stage cell is a tinted fill of its color (about 20% alpha) with a solid 1px inset ring and the stage name as text. A stall cell uses `--stall-color`, a dashed 1px outline, and the held stage name in muted text plus a bubble glyph, so it is distinguishable without color. Verify contrast of each stage color on `--surface-color` before shipping.

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
- **Cycle table.** Rows are instructions in program order (labeled with the source text, e.g. `lw $t0, 0($t1)`); columns are cycles `1..N`. Header cells use `--overlay-weak`. Cells are centered, `1px solid var(--border-color)`. Row hover and focus use `--overlay-strong`. Cell width is fixed (about 56px) so columns line up. The table uses `border-collapse: separate` with borders on the right and bottom of each cell, so the pinned instruction column fully covers cells scrolling beneath it, and the scroll container has no left padding for the same reason. `:root` sets `color-scheme: dark` so scrollbars match the theme. `.container` is `box-sizing: border-box` so it fits a 375px viewport.
- **Legend.** Swatch (`0.75rem` square, `border-radius: 2px`) plus label for each stage and for stall. Uses `:empty { display: none }` if ever conditional.
- **Summary line.** Total cycles, instructions, stall count, and CPI, in a `--inset-bg` box.
- **Explanation list.** One item per stall: which instruction waits, on which register, from which producer, and which cycle it clears. Hovering an item highlights the matching table cells.
- **Datapath.** See "Datapath view" below.
- **Segmented toggle** (forwarding off / on, top of the Pipeline card): two joined buttons labeled "No forwarding" and "Forwarding", outer radii 4px, `.active` uses `--highlight-color` background, `--primary-color` border, `--text-color` text, and `aria-pressed` reflects the state. The choice persists while editing and changes the table, summary, explanations, and datapath together. Forwarded EX cells show a small `fwd` marker (not color alone) and share a `data-stall` id with their explanation line for hover linking. The summary adds a "Forwards" count when forwarding is on.

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

9. **Forwarding (toggle, off by default).** A segmented toggle in the Pipeline card switches the hazard rule; rules 1-3 and 5-8 do not change, only rule 4 does. With forwarding on, a result is bypassed to the EX stage instead of waiting for the register file:
   - An instruction needs its sources at the start of its own EX. An ALU-type producer (`add sub and or slt addi`) has its result at the end of its EX, so the next instruction forwards it from **EX/MEM** with no stall.
   - A `lw` producer has its data at the end of its MEM, so the consumer forwards it from **MEM/WB**. A dependent instruction directly behind a `lw` stalls **1 bubble** (the load-use hazard). One unrelated instruction between them: 0 bubbles.
   - The instruction two behind an ALU-type producer forwards from **MEM/WB**. Three or more behind reads the register file normally (rule 3), with no forwarding.
   - An instruction may complete ID only in a cycle `>= producer's ID cycle + 1` for an ALU-type producer, or `>= producer's ID cycle + 2` for `lw`. For several sources, the latest requirement wins.
   - `sw` forwards its store data (`rt`) the same way, into the EX/MEM write-data path. `beq` forwards both compare operands, since it compares in EX. `$0` is never forwarded.
   - Control timing (rule 6) is unchanged: a `beq` still costs 2 fetch bubbles and a `j` 1.
   - Each EX cell records `forwards: [{ reg, operand: 'A' | 'B', from: 'EX/MEM' | 'MEM/WB', producerIndex }]`; an operand that merely reads the register file is not listed. `operand` is the ALU input the value feeds: A is the `rs`/base register, B is the `rt` register (for `sw`, the store data).
   - The Explanation list gets a line per forward, and the stall text for a load-use hazard names the MEM/WB forward.

Each stall cell stores `{ reg, producerIndex, clearsAtCycle }` so the Explanation list and tooltips never recompute hazard logic.

## Datapath view

A hand-authored inline SVG redraw of the course's pipelined MIPS datapath (PC, instruction memory, IF/ID, register file, sign extend, ID/EX, ALU and ALU control, branch adder, shift left 2, EX/MEM, AND gate and PCSrc mux, data memory, MEM/WB, write-back mux, RegDst mux, control signal labels). It shows one clock cycle at a time and has no animation.

**Cycle selection.** `selectedCycle` is the user's choice (default 5). The cycle shown is `min(selectedCycle, totalCycles)`, so a short program does not permanently lower the choice. Clicking a cycle header or any cell in that column selects it; Prev/Next buttons and the left/right arrow keys (with focus in the Datapath card) step. The selected column gets `.cycle-selected` in the table. Header cells are focusable and take Enter or Space.

**Ids.** Every part has an id with the prefix `dp-`: blocks (`dp-alu`), wires (`dp-w-regs-idex-a`), control labels (`dp-c-alusrc`), stage regions (`dp-region-ex`) and stage labels (`dp-label-ex`). `script.js` only toggles classes on these and sets label text. Nothing in the SVG is rebuilt.

**Highlight rule.** Each stage with an instruction in the selected cycle gets its stage color (`--stage-*`, the same colors as the table and legend) on its region and on the blocks, wires and control labels that instruction uses in that stage, chosen by opcode (table below). A wire belongs to the stage doing the work with it. A pipeline register is lit by the stage that fills it (IF/ID by IF, ID/EX by ID, EX/MEM by EX, MEM/WB by MEM). The register file is two elements: `dp-regs` is the read port (ID) and `dp-regs-write` is the write port (WB). Unused parts stay in `--card-border` strokes.

**Bubbles.** A stage with no instruction is a *bubble* when some instruction passed through that stage earlier and another passes later; before the first and after the last it is just empty (no styling). A bubble region gets a dashed `--stall-color` outline and the label `bubble`. An instruction held in ID by a RAW stall keeps its ID color, adds the dashed outline, and lights only its register read (`dp-regs`, `dp-w-ifid-rs`, `dp-w-ifid-rt`), since the value is not yet usable. An instruction held in IF lights only `dp-pc`, `dp-imem`, `dp-w-pc-imem`. The reason for each bubble or hold comes from the stall cell in the trace (`reason`); stages downstream of a stall say "Bubble from an earlier stall". The caption under the diagram lists every stage with its instruction or reason, so nothing depends on color.

**Opcode to lit parts.** (`R` = add sub and or slt; ids without the `dp-` prefix; "all" below means the listed common sets.)

- IF, every instruction: `pc imem add4 pcmux ifid w-pc-imem w-pc-add4 w-const4 w-add4-ifid w-add4-pcmux w-pcmux-pc w-imem-ifid`.
- ID, every instruction except `j` and `nop`: `regs signext idex w-ifid-rs w-ifid-rt w-ifid-signext w-signext-idex w-ifid-idex-pc w-ifid-rt-idex w-ifid-rd-idex w-regs-idex-a w-regs-idex-b`. `j` lights only `w-ifid-pcmux-jump`. `nop` lights nothing but the region.
- EX:
  - `R`: `alu alumux aluctl regdstmux exmem w-idex-alu-a w-idex-b-alumux w-alumux-alu w-idex-imm-trunk w-idex-aluctl w-aluctl-alu w-alu-exmem w-idex-rt-regdst w-idex-rd-regdst w-regdst-exmem c-alusrc c-aluop c-regdst`.
  - `addi`, `lw`: as `R` but `w-idex-alumux-imm` replaces `w-idex-b-alumux`.
  - `sw`: `alu alumux aluctl exmem w-idex-alu-a w-idex-alumux-imm w-idex-imm-trunk w-alumux-alu w-idex-aluctl w-aluctl-alu w-alu-exmem w-idex-b-exmem c-alusrc c-aluop` (no RegDst path).
  - `beq`: `alu alumux aluctl shift2 badd exmem w-idex-alu-a w-idex-b-alumux w-alumux-alu w-idex-aluctl w-aluctl-alu w-alu-zero w-idex-imm-trunk w-idex-shift2 w-shift2-badd w-idex-badd-pc w-badd-exmem c-alusrc c-aluop`.
  - `j`, `nop`: none.
- MEM:
  - `R`, `addi`: `memwb w-exmem-alu w-alu-memwb w-exmem-memwb-dest`.
  - `lw`: `memwb dmem w-exmem-alu w-alu-dmem-addr w-dmem-memwb w-exmem-memwb-dest c-memread`.
  - `sw`: `dmem w-exmem-alu w-alu-dmem-addr w-exmem-dmem-wd c-memwrite` (nothing is passed to MEM/WB).
  - `beq`: `and w-exmem-and-branch w-exmem-and-zero w-and-pcsrc w-exmem-pcmux c-branch`.
  - `j`, `nop`: none.
- WB:
  - `R`, `addi`: `regs-write wbmux w-memwb-wbmux-alu w-wbmux-regs w-memwb-regs-dest c-memtoreg c-regwrite`.
  - `lw`: same with `w-memwb-wbmux-mem` instead of `w-memwb-wbmux-alu`.
  - `sw`, `beq`, `j`, `nop`: none (no register write).

**Known gap versus the simulator.** The course diagram resolves the branch in MEM (AND gate and PCSrc). The simulator resolves `beq` in EX (design rule 6), so the diagram lights the compare and branch-target hardware in EX and the AND/PCSrc path one cycle later in MEM. Fetch resumes on the simulator's schedule, not the diagram's.

**Accessibility.** The SVG has `role="img"` and an `aria-label`. The caption list, with `aria-live="polite"` on the cycle status, repeats each stage's content in text. Stage labels carry `tabindex="0"` and link to the table row via `data-row` (hover and focus, like stall cells).

**Forwarding.** The SVG always contains the forwarding hardware: two forwarding muxes (`dp-fwdmux-a`, `dp-fwdmux-b`) in front of the ALU, a forwarding unit (`dp-fwdunit`), the two feedback buses (`dp-w-fwd-fb-exmem` from EX/MEM, `dp-w-fwd-fb-memwb` from the write-back mux), and their control wires and labels. They carry the class `dp-fwd` and are `display: none` unless `#datapath` has the class `forwarding`. The straight no-forwarding wires into the ALU carry `dp-nofwd` and are hidden when it does. The two sets are separate elements so the diagram can switch on a whim without moving anything.

With forwarding on, an EX instruction lights the forwarding-mux path for each operand it uses. An operand that is forwarded lights its feedback bus and the matching mux input instead of the ID/EX input, plus `dp-fwdunit`, the control wires, and `dp-c-forwarda` or `dp-c-forwardb`. The caption names the source ("$t0 forwarded from EX/MEM").

## Out of scope for v1

Branch prediction and flush, delay slots, datapath animation and autoplay, register and memory panels, step-back controls. 

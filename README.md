# MIPS Pipeline Cycle Visualizer

A web-based interactive tool for seeing how instructions move through a classic 5-stage MIPS pipeline. Designed for CS331 students to visualize how pipelining overlaps instructions and where data hazards force stalls.

**[Open the visualizer](https://michaelplumlee95.github.io/pipeline-cycle-visualizer/)** (no install needed)

## Features

*   **Instruction-by-Cycle Table**: One row per instruction, one column per cycle, with each cell showing the stage (IF, ID, EX, MEM, WB) that instruction is in, like the diagrams in the textbook.
*   **Data Hazard Stalls**: When an instruction needs a register that an earlier instruction hasn't written yet, it waits in ID. Stalls are drawn as dashed red bubble cells, and the instruction behind it is held in IF.
*   **Control Stalls**: Fetch waits after `beq` and `j` until the branch resolves, shown as bubbles in the IF column.
*   **Stall Explanations**: Every stall (and, with forwarding on, every forward) is explained in plain words: which instruction waits, on which register, from which producer, and the cycle it finally reads the value. Hover an explanation to highlight its cells in the table, or the reverse.
*   **Forwarding Toggle**: Switch between "No forwarding" and "Forwarding" at any time to compare the same program both ways. With forwarding, results are bypassed straight to EX, so back-to-back dependencies stop stalling and only a load followed by its use still costs one bubble. Forwarded EX cells are marked `fwd` and explained below the table.
*   **Datapath Diagram**: A pipelined MIPS datapath that lights up the parts each instruction uses in the cycle you pick (click a cycle header, or use Prev/Next and the arrow keys). Each stage keeps its table color, bubbles are dashed, and with forwarding on the forwarding muxes and unit appear and highlight the bypass path.
*   **Real-time Updates**: The table recomputes on every keystroke. There is no "run" button.
*   **Inline Errors**: Mistakes show up next to the program with a line number, such as an unknown instruction or an undefined label.
*   **Example Programs**: A dropdown of ready-made programs for each case: no hazards, back-to-back dependency, load then use, an independent instruction in between, a branch, and a jump.
*   **Summary Numbers**: Total cycles, instruction count, data stalls, fetch bubbles, and CPI.

## How to Use

### Running the App
**Quickest way**: open the [live site](https://michaelplumlee95.github.io/pipeline-cycle-visualizer/) in any browser.

To run it locally instead, note that this is a static web application, so you don't need to install any complex dependencies.

1.  **Download**: Clone this repository or download the ZIP file.
2.  **Open**: Double-click `index.html` to open it in your web browser.

### Using the Visualizer
1.  **Pick an Example**: Use the dropdown to load a sample program, or type your own in the text box. Choosing "Custom" keeps what you typed.
2.  **Write MIPS**: One instruction per line. Labels (`done:`), `#` comments, and both `$t0`-style and `$8`-style register names work.
3.  **Read the Table**: Follow a row left to right to see one instruction's journey through the stages. Dashed red cells are stalls.
4.  **Read the Explanations**: Each stall is listed under the table with its cause.

### Supported Instructions

| Type | Instructions |
| --- | --- |
| R-type | `add`, `sub`, `and`, `or`, `slt` |
| Immediate / memory | `addi`, `lw`, `sw` (written `offset(base)`) |
| Control | `beq` (to a label), `j` (to a label) |
| Other | `nop` |

## How the Pipeline Is Modeled

*   **Five stages**: IF, ID, EX, MEM, WB. Every instruction passes through all five, one new instruction enters per cycle unless fetch is stalled.
*   **Register file timing**: Written in the first half of WB and read in the second half of ID, so a dependent instruction can read in the same cycle its producer is in WB.
*   **No forwarding**: A dependent instruction waits in ID until the producer reaches WB. A back-to-back dependency costs 2 bubbles, and `lw` is treated the same. One unrelated instruction in between leaves 1 bubble, and two leave none.
*   **Branches and jumps stall fetch**: There is no prediction and no flush. `j` resolves in ID (1 fetch bubble) and `beq` resolves in EX (2 fetch bubbles).
*   **Values are not computed**: Only register dependencies are modeled. Because of that, `beq` is always drawn as not taken, though its timing cost is the same either way. `j` is always followed.
*   **`$zero`** is never a hazard, and a loop that never ends is cut off after 200 instructions.

## Learning Objectives

This tool is intended to help you verify your manual work and understand:
*   **Pipeline Overlap**: Why n instructions finish in n + 4 cycles when nothing stalls.
*   **RAW Hazards**: How a read-after-write dependency delays an instruction, and how distance between the two instructions changes the cost.
*   **Why Forwarding Matters**: Compare the stall counts here with what you expect once forwarding is added.
*   **Control Hazards**: What a branch costs when the pipeline has to wait for it to resolve.
*   **CPI**: How stalls push cycles per instruction above 1.

## Not Included Yet

Data forwarding, branch prediction and flushing, delay slots, a datapath diagram, register and memory panels, and stepping backward. Forwarding on/off is the planned first addition.

## Tests

```
node tests/run.js
```

The tests need Node but nothing else. They load the real `script.js` and check the assembler, the pipeline timing, and the rendering. The timing is also compared against an independent cycle-by-cycle model on hundreds of random programs. `tests/E2E_CHECKLIST.md` is a manual browser checklist for what automated tests can't see, like layout and focus.

See `design.md` for the visual and pipeline specification and `CLAUDE.md` for the code conventions.

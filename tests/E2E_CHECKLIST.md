# Browser end-to-end checklist

Automated tests (`node tests/run.js`) cover assembling, pipeline timing, state, and generated markup against a stub DOM.
They can't see real layout, focus, or CSS, so walk through these in a browser after UI changes
(open `index.html` directly). Console must show **zero errors** throughout.

1. **Default**: loads on "Back-to-back RAW" with the picker showing that name; the table has 3 rows, the dependent `sub` and `and` each show two dashed red `ID o` cells (plus dashed `IF` cells for the `and` held behind), the summary reads Cycles 11 / Instructions 3 / Data stalls 4, and 2 explanations appear below.
2. **Examples**: step through every entry in the picker. The textarea fills, the table redraws, and "No hazards" shows no dashed cells and the text "No stalls". "Branch" shows 4 bubble cells before the instruction after `beq` (2 from `beq` waiting on `$t0`, then 2 fetch bubbles; the summary's Fetch bubbles reads 2), and "Jump" shows 1 after `j` and skips the instruction after it.
3. **Stage colors**: IF, ID, EX, MEM, WB cells match their legend swatches; stall cells are dashed red with the bubble glyph and are distinguishable from stages with color ignored (try a grayscale screenshot).
4. **Live editing**: type in the textarea. The table updates on every keystroke, focus and caret never jump, and the picker switches to "Custom". Picking "Custom" afterwards leaves the text alone.
5. **Errors**: enter `bogus $t0`. A red `Line 1: ...` message appears under the textarea, the table is replaced by "Fix the errors", and the summary and explanations clear (no empty bar left where the summary was). Fixing the line restores everything.
6. **Edge programs**: an empty textarea shows "Enter a program"; `top: j top` stops at 200 instructions with the red notice in the summary and does not hang the page; a long program (30+ instructions) scrolls the table horizontally inside its card with the instruction column pinned on the left and no page-level horizontal scroll. While scrolled right, nothing shows through or beside the pinned column, and the scrollbar is dark, not white.
7. **Linked highlights**: hover a stall explanation; its dashed cells get a purple outline. Hover a dashed cell; its explanation highlights. Tab into a table row and an explanation (both focusable); the focus ring is visible.
8. **Card contrast**: cards are clearly distinct from the page background, and buttons and the dropdown still read as controls.
9. **Narrow viewport** (~375px; if the browser window can't be resized, load `index.html` in a 375px-wide iframe): there is no horizontal page scroll, the layout collapses to one column (Program above Pipeline), the picker and textarea fit without overflow, and the table scrolls inside its card instead of breaking the page.
10. **Pages build**: after pushing, the published site matches the local page and the console is clean (Inter font loads from Google Fonts).

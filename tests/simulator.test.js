// B. Simulator: hand-computed timing for each rule in design.md, "Pipeline semantics".
const { assert, suite, test } = require('./lib');
const { createApp } = require('./harness');

const { api } = createApp();

function run(code) {
    const a = api.assemble(code);
    assert.deepEqual(a.errors, [], 'program should assemble');
    return api.simulate(a.instrs);
}

// "IF ID ID* EX" style string for one row, so expected timelines read like the textbook.
function line(r, i) {
    const out = [];
    for (let c = 1; c <= r.totalCycles; c++) {
        const cell = r.rows[i].cells[c];
        out.push(!cell ? '.' : cell.kind === 'control' ? 'o' : cell.stage + (cell.stall ? '*' : ''));
    }
    return out.join(' ');
}

suite('B. Simulator: no hazards');

test('a single instruction takes 5 cycles', () => {
    const r = run('nop');
    assert.equal(r.totalCycles, 5);
    assert.equal(line(r, 0), 'IF ID EX MEM WB');
});

test('independent instructions overlap: n instructions take n + 4 cycles', () => {
    const r = run('nop\nnop\nnop\nnop');
    assert.equal(r.totalCycles, 8);
    assert.equal(r.dataStalls, 0);
    assert.equal(line(r, 3), '. . . IF ID EX MEM WB');
});

test('an empty program has an empty trace', () => {
    const r = api.simulate([]);
    assert.deepEqual([r.rows, r.totalCycles, r.dataStalls, r.fetchBubbles, r.explanations, r.truncated],
        [[], 0, 0, 0, [], false]);
});

suite('B. Simulator: RAW stalls (no forwarding, split-cycle register file)');

test('back-to-back dependency costs 2 bubbles', () => {
    const r = run('add $t0, $t1, $t2\nsub $t3, $t0, $t4');
    assert.equal(line(r, 0), 'IF ID EX MEM WB . . .');
    assert.equal(line(r, 1), '. IF ID* ID* ID EX MEM WB');
    assert.equal(r.totalCycles, 8);
    assert.equal(r.dataStalls, 2);
});

test('the consumer reads in the same cycle the producer is in WB', () => {
    const r = run('add $t0, $t1, $t2\nsub $t3, $t0, $t4');
    assert.equal(r.rows[1].idEnd, r.rows[0].idEnd + 3);
});

test('one independent instruction between them leaves 1 bubble', () => {
    const r = run('add $t0, $t1, $t2\nor $t4, $t5, $t6\nsub $t3, $t0, $t7');
    assert.equal(line(r, 2), '. . IF ID* ID EX MEM WB');
    assert.equal(r.dataStalls, 1);
});

test('two instructions between them leave no stall', () => {
    const r = run('add $t0, $t1, $t2\nnop\nnop\nsub $t3, $t0, $t7');
    assert.equal(r.dataStalls, 0);
    assert.equal(r.totalCycles, 8);
});

test('lw has no special load-use penalty beyond the normal RAW rule', () => {
    const r = run('lw $t0, 0($t1)\nadd $t2, $t0, $t3');
    assert.equal(r.dataStalls, 2);
});

test('sw stalls on the register it stores', () => {
    assert.equal(run('add $t0, $t1, $t2\nsw $t0, 0($t3)').dataStalls, 2);
});

test('sw stalls on its base register', () => {
    assert.equal(run('add $t3, $t1, $t2\nsw $t0, 0($t3)').dataStalls, 2);
});

test('lw stalls on its base register', () => {
    assert.equal(run('addi $t1, $zero, 4\nlw $t0, 0($t1)').dataStalls, 2);
});

test('addi reads one register, not a phantom second', () => {
    assert.equal(run('add $t1, $t2, $t3\naddi $t0, $t1, 5').dataStalls, 2);
    assert.equal(run('add $t1, $t2, $t3\naddi $t1, $t0, 5').dataStalls, 0);
});

test('$zero as a source is never a hazard', () => {
    assert.equal(run('addi $zero, $zero, 1\nadd $t0, $zero, $zero').dataStalls, 0);
    assert.equal(run('addi $0, $t1, 1\nadd $t0, $0, $0').dataStalls, 0);
});

test('write-after-write is not a hazard', () => {
    assert.equal(run('add $t0, $t1, $t2\nadd $t0, $t3, $t4').dataStalls, 0);
});

test('write-after-read is not a hazard', () => {
    assert.equal(run('add $t0, $t1, $t2\nadd $t1, $t3, $t4').dataStalls, 0);
});

test('the youngest older writer is the one waited on', () => {
    const r = run('add $t0, $s0, $s0\nadd $t0, $s1, $s1\nsub $t2, $t0, $s2');
    // the second add is in WB at cycle 6; waiting only for the first (WB 5) would stall 1
    assert.equal(r.rows[2].idEnd, 6);
    assert.equal(r.dataStalls, 2);
});

test('with two hazardous sources, the later producer decides', () => {
    const r = run('add $t0, $s0, $s0\nadd $t1, $s1, $s1\nadd $t2, $t0, $t1');
    assert.equal(r.rows[2].idEnd, 6);
    assert.equal(r.dataStalls, 2);
    assert.match(r.rows[2].cells[4].reason, /\$t1/);
});

test('a dependency chain: the stalled instruction holds the one behind it in IF', () => {
    const r = run('add $t0, $s0, $s0\nadd $t1, $t0, $s1\nadd $t2, $t1, $s2');
    assert.equal(line(r, 0), 'IF ID EX MEM WB . . . . . .');
    assert.equal(line(r, 1), '. IF ID* ID* ID EX MEM WB . . .');
    assert.equal(line(r, 2), '. . IF IF* IF* ID* ID* ID EX MEM WB');
    assert.equal(r.totalCycles, 11);
    assert.equal(r.dataStalls, 4);
});

test('held-IF cells are stalls with no explanation of their own', () => {
    const r = run('add $t0, $s0, $s0\nadd $t1, $t0, $s1\nadd $t2, $t1, $s2');
    const held = r.rows[2].cells[4];
    assert.equal(held.kind, 'held');
    assert.equal(held.stallId, undefined);
});

suite('B. Simulator: control flow');

test('j resolves in ID: 1 fetch bubble, then fetch resumes at the target', () => {
    const r = run('addi $t0, $zero, 1\nj skip\nadd $t1, $t0, $t0\nskip:\nsub $t2, $t0, $t0');
    assert.deepEqual(r.rows.map(x => x.ins.op), ['addi', 'j', 'sub']);
    assert.equal(line(r, 1), '. IF ID EX MEM WB . .');
    assert.equal(line(r, 2), '. . o IF ID EX MEM WB');
    assert.equal(r.fetchBubbles, 1);
});

test('beq resolves in EX: 2 fetch bubbles', () => {
    const r = run('beq $t0, $t1, done\nadd $t2, $s0, $s1\ndone:\nnop');
    assert.equal(line(r, 0), 'IF ID EX MEM WB . . . .');
    assert.equal(line(r, 1), '. o o IF ID EX MEM WB .');
    assert.equal(r.fetchBubbles, 2);
});

test('beq is traced as not taken, so the fall-through instruction executes', () => {
    const r = run('beq $t0, $t1, done\nadd $t2, $s0, $s1\ndone:\nnop');
    assert.deepEqual(r.rows.map(x => x.ins.op), ['beq', 'add', 'nop']);
});

test('beq stalls on its source registers like any other reader', () => {
    const r = run('add $t0, $s0, $s0\nbeq $t0, $t1, end\nend:\nnop');
    assert.equal(r.dataStalls, 2);
    assert.equal(r.rows[1].idEnd, 5);
    // resolves in EX at 6, so fetch resumes at 7
    assert.equal(r.rows[2].ifCycle, 7);
});

test('a stalled j delays the fetch that follows it', () => {
    const r = run('add $t0, $s0, $s0\nj end\nend:\nnop');
    // j would be in ID at 3 but waits for nothing (j reads no registers)
    assert.equal(r.dataStalls, 0);
    assert.equal(r.rows[2].ifCycle, r.rows[1].idEnd + 1);
});

test('j to the very next instruction still costs the bubble', () => {
    const r = run('j next\nnext:\nnop');
    assert.equal(r.rows.length, 2);
    assert.equal(r.fetchBubbles, 1);
    assert.equal(r.rows[1].ifCycle, 3);
});

test('j to the end of the program stops the trace', () => {
    const r = run('j end\nnop\nend:');
    assert.equal(r.rows.length, 1);
    assert.equal(r.fetchBubbles, 0);
});

test('a final branch with nothing after it adds no bubbles', () => {
    assert.equal(run('nop\nbeq $t0, $t1, x\nx:').fetchBubbles, 0);
});

test('an endless loop is cut off at the instruction cap', () => {
    const r = run('top: j top');
    assert.equal(r.rows.length, api.maxInstructions);
    assert.equal(r.truncated, true);
    assert.equal(r.totalCycles, 2 * api.maxInstructions + 3);
});

test('a normal program is not marked truncated', () => {
    assert.equal(run('nop\nnop').truncated, false);
});

test('a finite backward loop is not possible without values, but a forward jump chain terminates', () => {
    const r = run('j a\nnop\na: j b\nnop\nb: nop');
    assert.deepEqual(r.rows.map(x => x.ins.op), ['j', 'j', 'nop']);
    assert.equal(r.fetchBubbles, 2);
});

suite('B. Simulator: explanations and cell metadata');

test('a data stall produces one explanation naming the register, producer, line, and cycles', () => {
    const r = run('nop\nadd $t0, $t1, $t2\nsub $t3, $t0, $t4');
    assert.equal(r.explanations.length, 1);
    const m = r.explanations[0].message;
    assert.match(m, /sub \$t3, \$t0, \$t4 waits in ID for \$t0 from add \$t0, \$t1, \$t2/);
    assert.match(m, /line 2/);
    assert.match(m, /cycle 6/); // producer IF 2, ID 3, WB 6
    assert.match(m, /stalls 2 cycles/);
});

test('singular wording for a one-cycle stall', () => {
    const r = run('add $t0, $t1, $t2\nnop\nsub $t3, $t0, $t4');
    assert.match(r.explanations[0].message, /stalls 1 cycle and/);
});

test('stall cells carry the id of their explanation', () => {
    const r = run('add $t0, $s0, $s0\nsub $t1, $t0, $s1\nadd $t2, $s2, $s2\nsub $t3, $t2, $s3');
    const ids = new Set();
    r.rows.forEach(row => Object.values(row.cells).forEach(c => { if (c.stallId !== undefined) ids.add(c.stallId); }));
    assert.deepEqual([...ids].sort((a, b) => a - b), [0, 1]);
    assert.deepEqual(r.explanations.map(e => e.id), [0, 1]);
});

test('a control bubble explanation names the branch and the cycle it resolves', () => {
    const r = run('j end\nend:\nnop');
    assert.equal(r.explanations.length, 1);
    assert.match(r.explanations[0].message, /j end resolves in ID at cycle 2/);
    const beq = run('beq $t0, $t1, end\nend:\nnop');
    assert.match(beq.explanations[0].message, /resolves in EX at cycle 3/);
});

test('data stall cells are ID cells; control cells are IF cells', () => {
    const r = run('add $t0, $t1, $t2\nsub $t3, $t0, $t4\nj end\nend:');
    assert.equal(r.rows[1].cells[3].stage, 'ID');
    assert.equal(r.rows[1].cells[3].kind, 'data');
});

test('summary numbers are consistent with the rows', () => {
    const r = run('add $t0, $t1, $t2\nsub $t3, $t0, $t4\nbeq $t3, $t0, x\nnop\nx:');
    const lastWb = r.rows[r.rows.length - 1].idEnd + 3;
    assert.equal(r.totalCycles, lastWb);
    const stalls = r.rows.reduce((n, row) => n + (row.idEnd - row.idStart), 0);
    assert.equal(r.dataStalls, stalls);
});

test('every row has IF, ID, EX, MEM, WB exactly once as non-stall cells, in order', () => {
    const r = run('add $t0, $t1, $t2\nsub $t3, $t0, $t4\nlw $t5, 0($t3)\nsw $t5, 0($t3)\nj x\nx: nop');
    r.rows.forEach(row => {
        const real = Object.keys(row.cells).map(Number).sort((a, b) => a - b)
            .filter(c => !row.cells[c].stall).map(c => row.cells[c].stage);
        assert.deepEqual(real, ['IF', 'ID', 'EX', 'MEM', 'WB']);
    });
});

test('rows never share a stage in the same cycle (no structural hazards)', () => {
    const r = run('add $t0, $t1, $t2\nsub $t3, $t0, $t4\nlw $t5, 0($t3)\nsw $t5, 0($t3)\nbeq $t5, $t3, x\nnop\nx: nop');
    for (let c = 1; c <= r.totalCycles; c++) {
        ['IF', 'ID', 'EX', 'MEM', 'WB'].forEach(stage => {
            const n = r.rows.filter(row => row.cells[c] && row.cells[c].stage === stage && row.cells[c].kind !== 'control').length;
            assert.ok(n <= 1, `cycle ${c}: ${n} instructions in ${stage}`);
        });
    }
});

suite('B. Simulator: bundled examples');

const example = id => run(api.examples.find(e => e.id === id).code);

test('every example assembles cleanly', () => {
    api.examples.forEach(e => assert.deepEqual(api.assemble(e.code).errors, [], e.id));
});

test('example ids are unique and none is empty', () => {
    assert.equal(new Set(api.examples.map(e => e.id)).size, api.examples.length);
    api.examples.forEach(e => assert.ok(e.code.trim().length > 0, e.id));
});

test('"No hazards" really has no stalls and no explanations', () => {
    const r = example('no-hazards');
    assert.equal(r.dataStalls, 0);
    assert.equal(r.fetchBubbles, 0);
    assert.deepEqual(r.explanations, []);
});

test('"Back-to-back RAW" shows 2 bubbles per dependent instruction', () => {
    assert.ok(example('back-to-back').dataStalls >= 2);
    assert.equal(example('back-to-back').rows[1].idEnd - example('back-to-back').rows[1].idStart, 2);
});

test('"Load then use" stalls on the lw result', () => {
    const r = example('load-use');
    assert.equal(r.rows[1].idEnd - r.rows[1].idStart, 2);
});

test('"Independent instruction between" stalls exactly once', () => {
    assert.equal(example('spaced').dataStalls, 1);
});

test('"Branch" exercises beq fetch bubbles and "Jump" exercises j', () => {
    assert.equal(example('branch').fetchBubbles, 2);
    assert.equal(example('jump').fetchBubbles, 1);
});

suite('B. Simulator: structural limits');

test('an instruction held in IF keeps the next one out of IF', () => {
    // regression: the next instruction used to enter IF while its predecessor was still held there
    const r = run('add $t0, $s0, $s0\nadd $t1, $t0, $s1\nadd $t2, $t1, $s2\nadd $t3, $s3, $s3');
    assert.equal(line(r, 2), '. . IF IF* IF* ID* ID* ID EX MEM WB .');
    assert.equal(line(r, 3), '. . . . . IF IF* IF* ID EX MEM WB');
});

// C. Cross-check script.js's direct timing formulas against the cycle-by-cycle oracle.
const { assert, suite, test, note, mulberry32 } = require('./lib');
const { createApp } = require('./harness');
const { simulateOracle } = require('./oracle');

const { api } = createApp();

const regs = ['$t0', '$t1', '$t2', '$t3', '$zero', '$s0'];

// Targets only point forward, so every generated program terminates.
function randomProgram(rand) {
    const pick = arr => arr[Math.floor(rand() * arr.length)];
    const n = 1 + Math.floor(rand() * 12);
    const body = [];
    const labelAt = new Set();
    for (let i = 0; i < n; i++) {
        const r = rand();
        if (r < 0.35) body.push(`${pick(['add', 'sub', 'and', 'or', 'slt'])} ${pick(regs)}, ${pick(regs)}, ${pick(regs)}`);
        else if (r < 0.5) body.push(`addi ${pick(regs)}, ${pick(regs)}, ${Math.floor(rand() * 9)}`);
        else if (r < 0.65) body.push(`lw ${pick(regs)}, ${4 * Math.floor(rand() * 4)}(${pick(regs)})`);
        else if (r < 0.75) body.push(`sw ${pick(regs)}, ${4 * Math.floor(rand() * 4)}(${pick(regs)})`);
        else if (r < 0.9) {
            const t = i + 1 + Math.floor(rand() * (n - i));
            labelAt.add(t);
            body.push(`beq ${pick(regs)}, ${pick(regs)}, L${t}`);
        } else if (r < 0.96) {
            const t = i + 1 + Math.floor(rand() * (n - i));
            labelAt.add(t);
            body.push(`j L${t}`);
        } else body.push('nop');
    }
    const lines = [];
    for (let i = 0; i <= n; i++) {
        if (labelAt.has(i)) lines.push(`L${i}:`);
        if (i < n) lines.push(body[i]);
    }
    return lines.join('\n');
}

function compare(code) {
    const a = api.assemble(code);
    assert.deepEqual(a.errors, [], 'generated program should assemble:\n' + code);
    const sim = api.simulate(a.instrs);
    const ref = simulateOracle(a.instrs, api.maxInstructions);
    const where = '\n' + code;

    assert.equal(sim.rows.length, ref.path.length, 'path length' + where);
    assert.equal(sim.totalCycles, ref.total, 'total cycles' + where);

    let stalls = 0;
    sim.rows.forEach((row, i) => {
        assert.equal(row.ins.line, ref.path[i].line, `row ${i} is the wrong instruction` + where);
        let idCycles = 0;
        for (let c = 1; c <= ref.total; c++) {
            const cell = row.cells[c];
            const want = ref.stageAt[i][c];
            if (want === 'ID') idCycles++;
            if (cell && cell.kind === 'control') {
                assert.equal(want, undefined, `row ${i} cycle ${c}: control bubble but oracle has ${want}` + where);
            } else {
                assert.equal(cell ? cell.stage : undefined, want, `row ${i} cycle ${c}` + where);
            }
        }
        stalls += idCycles - 1;
    });
    assert.equal(sim.dataStalls, stalls, 'data stalls' + where);

    let bubbles = 0;
    ref.path.forEach((ins, i) => {
        if (i < ref.path.length - 1) bubbles += ins.op === 'j' ? 1 : ins.op === 'beq' ? 2 : 0;
    });
    assert.equal(sim.fetchBubbles, bubbles, 'fetch bubbles' + where);
}

suite('C. Oracle cross-check');

test('hand-picked programs agree with the oracle', () => {
    [
        'nop',
        'add $t0, $t1, $t2\nsub $t3, $t0, $t4',
        'add $t0, $s0, $s0\nadd $t1, $t0, $s1\nadd $t2, $t1, $s2',
        'lw $t0, 0($t1)\nadd $t2, $t0, $t3\nsw $t2, 4($t1)',
        'addi $t0, $zero, 1\nbeq $t0, $t1, done\nadd $t2, $t0, $t0\ndone:\nor $t4, $t2, $t2',
        'addi $t0, $zero, 1\nj skip\nadd $t1, $t0, $t0\nskip:\nsub $t2, $t0, $t0',
        'add $t0, $s0, $s0\nbeq $t0, $t1, end\nend:\nnop',
    ].forEach(compare);
});

test('every bundled example agrees with the oracle', () => {
    api.examples.forEach(e => compare(e.code));
});

test('the endless-loop cap agrees with the oracle', () => compare('top: j top'));

test('500 random programs agree with the oracle', () => {
    const rand = mulberry32(331);
    for (let i = 0; i < 500; i++) compare(randomProgram(rand));
    note('seed 331, 500 programs');
});

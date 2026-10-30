// F. Forwarding mode of simulate(): hand-computed timings (the oracle covers the random sweep).
const { assert, suite, test } = require('./lib');
const { createApp } = require('./harness');

const { api } = createApp();

function run(code, forwarding) {
    const a = api.assemble(code);
    assert.deepEqual(a.errors, []);
    return api.simulate(a.instrs, forwarding);
}

// The EX cell of row i
const exCell = (r, i) => {
    const row = r.rows[i];
    return row.cells[row.idEnd + 1];
};

suite('F. Forwarding');

test('forwarding is off unless asked for, and records no forwards', () => {
    const r = run('add $t0, $t1, $t2\nsub $t3, $t0, $t4');
    assert.equal(r.forwarding, false);
    assert.equal(r.forwardCount, 0);
    assert.equal(r.dataStalls, 2);
    assert.equal(exCell(r, 1).forwards, undefined);
});

test('back-to-back ALU dependency has no stall and forwards from EX/MEM', () => {
    const r = run('add $t0, $t1, $t2\nsub $t3, $t0, $t4', true);
    assert.equal(r.dataStalls, 0);
    assert.equal(r.totalCycles, 6);
    assert.deepEqual(exCell(r, 1).forwards, [{ reg: '$t0', operand: 'A', producerIndex: 0, from: 'EX/MEM' }]);
    assert.equal(r.explanations.length, 1);
    assert.equal(r.explanations[0].forward, true);
    assert.equal(exCell(r, 1).forwardId, r.explanations[0].id);
});

test('one instruction between forwards from MEM/WB', () => {
    const r = run('add $t0, $t1, $t2\nor $t4, $t5, $t6\nsub $t3, $t0, $t7', true);
    assert.equal(r.dataStalls, 0);
    assert.deepEqual(exCell(r, 2).forwards.map(f => f.from), ['MEM/WB']);
    assert.equal(exCell(r, 1).forwards, undefined);
});

test('two instructions between read the register file with no forward', () => {
    const r = run('add $t0, $t1, $t2\nnop\nnop\nsub $t3, $t0, $t7', true);
    assert.equal(r.dataStalls, 0);
    assert.equal(exCell(r, 3).forwards, undefined);
    assert.equal(r.forwardCount, 0);
});

test('load-use still costs one bubble and forwards from MEM/WB', () => {
    const r = run('lw $t0, 0($t1)\nadd $t2, $t0, $t3', true);
    assert.equal(r.dataStalls, 1);
    assert.equal(r.rows[1].cells[3].stall, true);
    assert.match(r.rows[1].cells[3].reason, /Waiting for \$t0 from lw \$t0, 0\(\$t1\)/);
    assert.equal(r.rows[1].idEnd, 4);
    assert.deepEqual(exCell(r, 1).forwards.map(f => f.from), ['MEM/WB']);
    assert.match(r.explanations[0].message, /Even with forwarding/);
});

test('one instruction between a load and its use removes the bubble', () => {
    const r = run('lw $t0, 0($t1)\nnop\nadd $t2, $t0, $t3', true);
    assert.equal(r.dataStalls, 0);
    assert.deepEqual(exCell(r, 2).forwards.map(f => f.from), ['MEM/WB']);
});

test('sw forwards its store data as operand B and its base as operand A', () => {
    const r = run('add $t0, $t1, $t2\nadd $t3, $t4, $t5\nsw $t0, 0($t3)', true);
    const f = exCell(r, 2).forwards;
    assert.deepEqual(f.map(x => [x.reg, x.operand, x.from]), [['$t0', 'B', 'MEM/WB'], ['$t3', 'A', 'EX/MEM']]);
});

test('both sources of one instruction can be forwarded; $zero never is', () => {
    const r = run('add $t0, $t1, $t2\nadd $t3, $t0, $t0\nadd $t4, $zero, $t3', true);
    assert.equal(exCell(r, 1).forwards.length, 2);
    assert.deepEqual(exCell(r, 2).forwards.map(f => f.reg), ['$t3']);
    assert.equal(r.forwardCount, 3);
});

test('beq forwards its operands but still costs two fetch bubbles', () => {
    const r = run('add $t0, $t1, $t2\nbeq $t0, $t3, end\nnop\nend:\nnop', true);
    assert.equal(r.dataStalls, 0);
    assert.equal(r.fetchBubbles, 2);
    assert.deepEqual(exCell(r, 1).forwards.map(f => f.operand), ['A']);
});

test('the youngest writer is the one forwarded from', () => {
    const r = run('add $t0, $t1, $t2\naddi $t0, $t1, 1\nsub $t3, $t0, $t4', true);
    assert.equal(exCell(r, 2).forwards[0].producerIndex, 1);
});

test('forwarding on a bundled example matches its documented stalls', () => {
    const ex = id => api.examples.find(e => e.id === id).code;
    assert.equal(run(ex('back-to-back'), true).dataStalls, 0);
    assert.equal(run(ex('load-use'), true).dataStalls, 1);
    assert.equal(run(ex('spaced'), true).dataStalls, 0);
});

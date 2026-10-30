const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { suite, test } = require('./lib');
const { createApp, datapathIds } = require('./harness');

suite('E. Datapath');

const app = createApp();
const { api } = app;

// Runs a program through the real assemble + simulate and returns the datapath state for one cycle
function stateFor(code, cycle) {
    const assembled = api.assemble(code);
    assert.deepEqual(assembled.errors, []);
    const result = api.simulate(assembled.instrs);
    return { result, state: api.datapathState(result, cycle) };
}

test('a lone R-type instruction lights its path stage by stage', () => {
    const code = 'add $t0, $t1, $t2';
    const expectIds = {
        IF: ['pc', 'imem', 'w-imem-ifid'],
        ID: ['regs', 'w-ifid-rs', 'w-regs-idex-a'],
        EX: ['alu', 'w-idex-b-alumux', 'c-regdst', 'w-regdst-exmem'],
        MEM: ['w-alu-memwb'],
        WB: ['regs-write', 'w-memwb-wbmux-alu', 'w-memwb-regs-dest'],
    };
    ['IF', 'ID', 'EX', 'MEM', 'WB'].forEach((stage, i) => {
        const slot = stateFor(code, i + 1).state[stage];
        assert.equal(slot.kind, 'active', stage);
        assert.equal(slot.text, 'add $t0, $t1, $t2');
        expectIds[stage].forEach(id => assert.ok(slot.ids.includes(id), stage + ' lights ' + id));
    });
    assert.ok(!stateFor(code, 3).state.EX.ids.includes('w-idex-alumux-imm'));
});

test('lw and addi use the immediate; lw reads memory and writes back from it', () => {
    const lw = stateFor('lw $t0, 4($t1)', 3).state.EX;
    assert.ok(lw.ids.includes('w-idex-alumux-imm'));
    assert.ok(!lw.ids.includes('w-idex-b-alumux'));
    assert.ok(stateFor('lw $t0, 4($t1)', 4).state.MEM.ids.includes('dmem'));
    assert.ok(stateFor('lw $t0, 4($t1)', 4).state.MEM.ids.includes('c-memread'));
    assert.ok(stateFor('lw $t0, 4($t1)', 5).state.WB.ids.includes('w-memwb-wbmux-mem'));
    assert.ok(stateFor('addi $t0, $t1, 4', 3).state.EX.ids.includes('w-idex-alumux-imm'));
});

test('sw writes memory, skips the register write-back, and has no RegDst path', () => {
    const code = 'sw $t0, 4($t1)';
    const ex = stateFor(code, 3).state.EX;
    assert.ok(ex.ids.includes('w-idex-b-exmem'));
    assert.ok(!ex.ids.includes('c-regdst'));
    const mem = stateFor(code, 4).state.MEM;
    assert.ok(mem.ids.includes('c-memwrite') && mem.ids.includes('w-exmem-dmem-wd'));
    assert.deepEqual(stateFor(code, 5).state.WB.ids, []);
    assert.equal(stateFor(code, 5).state.WB.kind, 'active');
});

test('beq lights the compare in EX and the AND/PCSrc path in MEM, with no write-back', () => {
    const code = 'beq $t0, $t1, done\ndone:\nnop';
    const ex = stateFor(code, 3).state.EX;
    ['badd', 'shift2', 'w-alu-zero'].forEach(id => assert.ok(ex.ids.includes(id), id));
    assert.ok(!ex.ids.includes('c-regdst'));
    const mem = stateFor(code, 4).state.MEM;
    ['and', 'w-and-pcsrc', 'c-branch'].forEach(id => assert.ok(mem.ids.includes(id), id));
    assert.deepEqual(stateFor(code, 5).state.WB.ids, []);
});

test('j lights only the jump wire in ID, and nop only its regions', () => {
    const j = stateFor('j end\nend:\nnop', 2).state.ID;
    assert.deepEqual(j.ids, ['w-ifid-pcmux-jump']);
    const nop = stateFor('nop', 3).state.EX;
    assert.equal(nop.kind, 'active');
    assert.deepEqual(nop.ids, []);
});

test('a RAW stall holds the instruction in ID and leaves a bubble behind it', () => {
    const code = 'add $t0, $t1, $t2\nsub $t3, $t0, $t4';
    const s = stateFor(code, 4).state; // sub stalled in ID at cycles 3 and 4; add is in MEM
    assert.equal(s.ID.kind, 'stalled');
    assert.equal(s.ID.text, 'sub $t3, $t0, $t4');
    assert.deepEqual(s.ID.ids, ['regs', 'w-ifid-rs', 'w-ifid-rt']);
    assert.equal(s.EX.kind, 'bubble');
    assert.match(s.EX.reason, /Waiting for \$t0 from add/);
    assert.equal(s.MEM.kind, 'active');
    // The bubble keeps moving down the pipeline, still blaming its cause
    const later = stateFor(code, 5).state;
    assert.equal(later.MEM.kind, 'bubble');
    assert.match(later.MEM.reason, /Waiting for \$t0/);
    assert.equal(later.ID.kind, 'active');
});

test('fetch after beq leaves IF bubbles with the control reason', () => {
    const s = stateFor('beq $t0, $t1, done\nnop\ndone:\nnop', 3).state;
    assert.equal(s.IF.kind, 'bubble');
    assert.match(s.IF.reason, /Fetch waits for beq/);
});

test('an instruction held in IF behind a stall is held, not a bubble', () => {
    const s = stateFor('add $t0, $t1, $t2\nsub $t3, $t0, $t4\nor $t5, $t6, $t7', 4).state;
    assert.equal(s.IF.kind, 'held');
    assert.equal(s.IF.text, 'or $t5, $t6, $t7');
});

test('pipeline fill and drain are empty, not bubbles', () => {
    const code = 'add $t0, $t1, $t2';
    assert.equal(stateFor(code, 1).state.WB.kind, 'empty');
    assert.equal(stateFor(code, 5).state.IF.kind, 'empty');
    // Out-of-range cycles leave everything empty
    ['IF', 'ID', 'EX', 'MEM', 'WB'].forEach(st => {
        assert.equal(stateFor(code, 0).state[st].kind, 'empty');
        assert.equal(stateFor(code, 99).state[st].kind, 'empty');
    });
});

test('each slot carries its row index so the label can link to the table', () => {
    const s = stateFor('add $t0, $t1, $t2\nor $t4, $t5, $t6', 3).state;
    assert.equal(s.IF.row, -1);
    assert.equal(s.ID.row, 1);
    assert.equal(s.EX.row, 0);
});

suite('E. Datapath forwarding');

function stateFwd(code, cycle, forwarding) {
    const result = api.simulate(api.assemble(code).instrs, forwarding);
    return api.datapathState(result, cycle);
}

test('without forwarding the straight ALU wires light and no forwarding part does', () => {
    const ex = stateFwd('add $t0, $t1, $t2\nsub $t3, $t0, $t4', 3, false).EX;
    assert.ok(ex.ids.includes('w-idex-alu-a'));
    assert.deepEqual(ex.ids.filter(id => /fwd/.test(id)), []);
});

test('with forwarding the muxes light, and a forwarded operand uses its bus instead of ID/EX', () => {
    const ex = stateFwd('add $t0, $t1, $t2\nsub $t3, $t0, $t4', 4, true).EX; // sub in EX, $t0 from EX/MEM
    ['fwdmux-a', 'fwdmux-b', 'w-fwd-a-alu', 'w-fwd-b-alumux', 'w-fwd-idex-b', 'fwdunit',
        'w-fwd-fb-exmem', 'w-fwd-exmem-a', 'w-fwd-ctl', 'w-fwd-ctl-a', 'c-forwarda'].forEach(id => {
        assert.ok(ex.ids.includes(id), id);
    });
    ['w-fwd-idex-a', 'w-idex-alu-a', 'w-fwd-fb-memwb', 'c-forwardb'].forEach(id => {
        assert.ok(!ex.ids.includes(id), id + ' should be off');
    });
    assert.equal(ex.forwards.length, 1);
});

test('a MEM/WB forward lights the other bus', () => {
    const ex = stateFwd('lw $t0, 0($t1)\nadd $t2, $t0, $t3', 5, true).EX;
    assert.ok(ex.ids.includes('w-fwd-fb-memwb') && ex.ids.includes('w-fwd-memwb-a'));
    assert.ok(!ex.ids.includes('w-fwd-fb-exmem'));
});

test('an op with no rt operand never lights mux B, and sw feeds the store-data path', () => {
    assert.ok(!stateFwd('addi $t0, $t1, 1', 3, true).EX.ids.includes('fwdmux-b'));
    assert.ok(!stateFwd('lw $t0, 0($t1)', 3, true).EX.ids.includes('fwdmux-b'));
    const sw = stateFwd('add $t0, $t1, $t2\nadd $t3, $t4, $t5\nsw $t0, 0($t3)', 5, true).EX;
    ['w-fwd-b-exmem', 'w-fwd-memwb-b', 'w-fwd-exmem-a', 'fwdmux-b'].forEach(id => assert.ok(sw.ids.includes(id), id));
    assert.ok(!sw.ids.includes('w-fwd-b-alumux'));
});

test('an ID stall in forwarding mode still holds with the register read only', () => {
    const code = 'lw $t0, 0($t1)\nadd $t2, $t0, $t3';
    assert.equal(stateFwd(code, 3, true).ID.kind, 'stalled');
    assert.equal(stateFwd(code, 4, true).EX.kind, 'bubble');
});

suite('E. Datapath view');

test('the default cycle is 5, clamped to short programs without losing the choice', () => {
    const a = createApp();
    assert.equal(a.el('cycle-status').textContent, 'Cycle 5 of 11');
    a.type('nop\nnop');
    assert.equal(a.el('cycle-status').textContent, 'Cycle 5 of 6');
    a.type('nop');
    assert.equal(a.el('cycle-status').textContent, 'Cycle 5 of 5');
    a.type('nop\nnop\nnop\nnop\nnop');
    assert.equal(a.el('cycle-status').textContent, 'Cycle 5 of 9');
    a.type('nop');
    assert.equal(a.el('cycle-status').textContent, 'Cycle 5 of 5');
});

test('prev and next step the cycle, stop at the ends, and mark the table column', () => {
    const a = createApp();
    a.type('nop\nnop'); // 6 cycles
    const next = a.el('cycle-next');
    const prev = a.el('cycle-prev');
    next.dispatch('click');
    assert.equal(a.el('cycle-status').textContent, 'Cycle 6 of 6');
    assert.equal(next.disabled, true);
    next.dispatch('click');
    assert.equal(a.el('cycle-status').textContent, 'Cycle 6 of 6');
    for (let i = 0; i < 9; i++) prev.dispatch('click');
    assert.equal(a.el('cycle-status').textContent, 'Cycle 1 of 6');
    assert.equal(prev.disabled, true);
    const selected = a.doc.querySelectorAll('[data-cycle]').filter(e => e._classes.has('cycle-selected'));
    assert.ok(selected.length > 0);
    assert.ok(selected.every(e => e.dataset.cycle === '1'));
});

test('clicking a table header selects that cycle and lights the datapath classes', () => {
    const a = createApp();
    a.type('add $t0, $t1, $t2');
    const head = a.doc.querySelectorAll('[data-cycle="3"]').find(e => e.tag === 'th');
    a.el('cycle-table-container').dispatch('click', { target: head });
    assert.equal(a.el('cycle-status').textContent, 'Cycle 3 of 5');
    const alu = a.el('dp-alu');
    assert.ok(alu.classList.contains('active') && alu.classList.contains('stage-ex'));
    assert.ok(!a.el('dp-dmem').classList.contains('active'));
    assert.equal(a.el('dp-label-ex').textContent, 'add $t0, $t1, $t2');
    assert.equal(a.el('dp-label-ex').dataset.row, '0');
    assert.equal(a.el('dp-label-id').dataset.row, undefined);
});

test('stale highlights clear when the cycle changes', () => {
    const a = createApp();
    a.type('add $t0, $t1, $t2');
    a.el('cycle-prev').dispatch('click'); // 4
    assert.ok(a.el('dp-w-alu-memwb').classList.contains('stage-mem'));
    assert.ok(!a.el('dp-alu').classList.contains('active'));
    a.el('cycle-prev').dispatch('click'); // 3
    assert.ok(!a.el('dp-w-alu-memwb').classList.contains('active'));
    assert.ok(!a.el('dp-w-alu-memwb').classList.contains('stage-mem'));
});

test('a bubble styles its region and labels it', () => {
    const a = createApp(); // back-to-back RAW at cycle 5: EX is a bubble
    assert.ok(a.el('dp-region-ex').classList.contains('dp-bubble'));
    assert.match(a.el('dp-label-ex').textContent, /^bubble/);
    assert.ok(!a.el('dp-alu').classList.contains('active'));
});

test('errors and empty programs say so and disable the buttons', () => {
    const a = createApp();
    a.type('bogus');
    assert.match(a.el('cycle-status').textContent, /Fix the errors/);
    assert.equal(a.el('cycle-next').disabled, true);
    assert.equal(a.html('datapath-caption'), '');
    a.type('');
    assert.match(a.el('cycle-status').textContent, /Enter a program/);
});

test('the caption lists each occupied stage and escapes program text', () => {
    const a = createApp();
    a.type('add $t0, $t1, $t2');
    a.el('cycle-prev').dispatch('click');
    a.el('cycle-prev').dispatch('click'); // cycle 3: EX
    assert.match(a.html('datapath-caption'), /caption-stage stage-ex">EX<\/span>add \$t0, \$t1, \$t2/);
});

suite('E. Datapath ids');

// Every id the code may light must exist in the SVG, and every part of the SVG must be lit by
// at least one real program in at least one mode (found by running them, not by reading tables).
const sweep = [
    'add $t0, $t1, $t2\nsub $t3, $t0, $t4\nor $t5, $t3, $t0\nslt $t6, $t5, $t0\nand $t7, $t6, $t5',
    'lw $t0, 0($t1)\nadd $t2, $t0, $t3\nsw $t2, 4($t1)\nlw $t4, 0($t2)\nsw $t4, 8($t4)',
    'addi $t0, $zero, 1\nbeq $t0, $t1, done\nadd $t2, $t0, $t0\ndone:\nj end\nnop\nend:\nnop',
    'add $t0, $t1, $t2\nor $t4, $t5, $t6\nsub $t3, $t0, $t7\naddi $t1, $t3, 4\nsw $t3, 0($t1)',
];

test('SVG ids and lit ids match', () => {
    const svgIds = datapathIds().map(id => id.slice(3));
    const missing = api.dpLitIds.filter(id => !svgIds.includes(id));
    assert.deepEqual(missing, [], 'lit ids with no SVG element');

    const lit = new Set();
    [false, true].forEach(fwd => sweep.forEach(code => {
        const result = api.simulate(api.assemble(code).instrs, fwd);
        for (let c = 1; c <= result.totalCycles; c++) {
            const state = api.datapathState(result, c);
            Object.values(state).forEach(slot => slot.ids.forEach(id => lit.add(id)));
        }
    }));
    const structural = id => /^(region|label)-/.test(id);
    const unreachable = svgIds.filter(id => !structural(id) && !lit.has(id));
    assert.deepEqual(unreachable, [], 'SVG parts no program lights');
    const unknown = [...lit].filter(id => !api.dpLitIds.includes(id));
    assert.deepEqual(unknown, [], 'lit ids missing from the clear list');
});

test('the SVG has no duplicate ids and a region and label for every stage', () => {
    const ids = datapathIds();
    assert.equal(new Set(ids).size, ids.length);
    ['if', 'id', 'ex', 'mem', 'wb'].forEach(s => {
        assert.ok(ids.includes('dp-region-' + s));
        assert.ok(ids.includes('dp-label-' + s));
    });
});

suite('E. Forwarding toggle');

test('starts with forwarding off and the datapath without the forwarding class', () => {
    const a = createApp();
    assert.ok(!a.el('datapath').classList.contains('forwarding'));
    assert.match(a.html('summary'), /Data stalls<\/span><strong>4/);
});

test('toggling forwarding re-simulates every view on the same program', () => {
    const a = createApp(); // back-to-back RAW
    assert.match(a.html('summary'), /Data stalls<\/span><strong>4/);
    a.forwarding(true);
    assert.ok(a.el('forwarding-on').classList.contains('active'));
    assert.ok(!a.el('forwarding-off').classList.contains('active'));
    assert.equal(a.el('forwarding-on').attrs['aria-pressed'], 'true');
    assert.ok(a.el('datapath').classList.contains('forwarding'));
    assert.match(a.html('summary'), /Data stalls<\/span><strong>0/);
    assert.match(a.html('summary'), /Forwards<\/span><strong>3/);
    assert.equal((a.html('cycle-table-container').match(/cycle-cell stall/g) || []).length, 0);
    assert.equal((a.html('cycle-table-container').match(/cycle-cell stage-ex forwarded/g) || []).length, 2);
    assert.match(a.html('explanation-list'), /explanation-item forward/);
    a.forwarding(false);
    assert.match(a.html('summary'), /Data stalls<\/span><strong>4/);
    assert.doesNotMatch(a.html('summary'), /Forwards/);
    assert.ok(!a.el('datapath').classList.contains('forwarding'));
    assert.equal(a.el('forwarding-off').attrs['aria-pressed'], 'true');
    assert.equal(a.el('forwarding-on').attrs['aria-pressed'], 'false');
});

test('a forwarded cell shares a data-stall id with its explanation for hover linking', () => {
    const a = createApp();
    a.forwarding(true);
    const cell = a.doc.querySelectorAll('[data-stall]').find(e => e.tag === 'td');
    assert.ok(cell._classes.has('forwarded'));
    const item = a.doc.querySelectorAll('[data-stall="' + cell.dataset.stall + '"]').find(e => e.tag === 'li');
    assert.ok(item);
});

test('the forwarding choice survives editing and the selected cycle is kept', () => {
    const a = createApp();
    a.forwarding(true);
    a.type('lw $t0, 0($t1)\nadd $t2, $t0, $t3');
    assert.ok(a.el('datapath').classList.contains('forwarding'));
    assert.match(a.html('summary'), /Data stalls<\/span><strong>1/);
    assert.match(a.el('cycle-status').textContent, /^Cycle 5 of /);
});

test('the caption says what was forwarded', () => {
    const a = createApp();
    a.forwarding(true);
    a.type('add $t0, $t1, $t2\nsub $t3, $t0, $t4');
    a.el('cycle-prev').dispatch('click'); // 5 of 6 -> 4: sub in EX
    assert.match(a.html('datapath-caption'), /\$t0 forwarded from EX\/MEM/);
});

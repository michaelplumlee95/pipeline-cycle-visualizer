// A. Assembler: text -> instruction objects, with line-numbered errors.
const { assert, suite, test } = require('./lib');
const { createApp } = require('./harness');

const { api } = createApp();
const asm = text => api.assemble(text);
const ok = text => {
    const r = asm(text);
    assert.deepEqual(r.errors, [], 'unexpected errors');
    return r.instrs;
};
const err = text => asm(text).errors;

suite('A. Assembler: valid input');

test('parses each supported instruction', () => {
    const ins = ok('add $t0, $t1, $t2\nsub $t0, $t1, $t2\nand $t0, $t1, $t2\nor $t0, $t1, $t2\n' +
        'slt $t0, $t1, $t2\naddi $t0, $t1, 5\nlw $t0, 4($t1)\nsw $t0, 4($t1)\nbeq $t0, $t1, x\nj x\nnop\nx:\n');
    assert.deepEqual(ins.map(i => i.op), ['add', 'sub', 'and', 'or', 'slt', 'addi', 'lw', 'sw', 'beq', 'j', 'nop']);
});

test('R-type: dest is rd, sources are rs and rt', () => {
    const [i] = ok('add $t0, $t1, $t2');
    assert.equal(i.dest.n, 8);
    assert.deepEqual(i.srcs.map(s => s.n), [9, 10]);
});

test('addi: dest is rt, one source', () => {
    const [i] = ok('addi $t0, $t1, -5');
    assert.equal(i.dest.n, 8);
    assert.deepEqual(i.srcs.map(s => s.n), [9]);
});

test('lw writes rt and reads the base; sw writes nothing and reads rt and base', () => {
    const [lw, sw] = ok('lw $t0, 4($t1)\nsw $t2, 8($t3)');
    assert.equal(lw.dest.n, 8);
    assert.deepEqual(lw.srcs.map(s => s.n), [9]);
    assert.equal(sw.dest, null);
    assert.deepEqual(sw.srcs.map(s => s.n), [10, 11]);
});

test('beq reads two registers and writes nothing; j and nop touch no registers', () => {
    const [b, j, n] = ok('beq $t0, $t1, x\nj x\nnop\nx:\n');
    assert.equal(b.dest, null);
    assert.deepEqual(b.srcs.map(s => s.n), [8, 9]);
    assert.deepEqual([j.dest, j.srcs, n.dest, n.srcs], [null, [], null, []]);
});

test('numeric and symbolic register names map to the same register', () => {
    const [i] = ok('add $8, $t1, $zero');
    assert.equal(i.dest.n, 8);
    assert.equal(i.srcs[1].n, 0);
    const names = { $zero: 0, $at: 1, $v0: 2, $a0: 4, $t0: 8, $t7: 15, $s0: 16, $s7: 23, $t8: 24, $t9: 25, $gp: 28, $sp: 29, $fp: 30, $ra: 31, $31: 31, $0: 0 };
    Object.entries(names).forEach(([name, n]) => {
        assert.equal(ok('add ' + name + ', $t0, $t0')[0].dest.n, n, name);
    });
});

test('register names and opcodes are case-insensitive', () => {
    const [i] = ok('ADD $T0, $T1, $T2');
    assert.equal(i.op, 'add');
    assert.equal(i.dest.n, 8);
});

test('keeps the register name as typed, for explanations', () => {
    assert.equal(ok('add $t0, $t1, $t2')[0].dest.name, '$t0');
});

test('immediates: decimal, negative, hex', () => {
    ok('addi $t0, $t1, 10\naddi $t0, $t1, -10\naddi $t0, $t1, 0x1F\naddi $t0, $t1, -0x10');
});

test('memory operand: offset optional, spaces allowed', () => {
    ok('lw $t0, ($t1)\nlw $t0, 0($t1)\nlw $t0, -4( $t1 )\nsw $t0, 0x10($sp)');
});

test('comments, blank lines, and indentation are ignored; line numbers still count them', () => {
    const ins = ok('# header\n\n   add $t0, $t1, $t2   # trailing\n\n\tsub $t3, $t0, $t4');
    assert.deepEqual(ins.map(i => i.line), [3, 5]);
});

test('text is normalized to single spaces for display', () => {
    assert.equal(ok('add    $t0,   $t1, $t2')[0].text, 'add $t0, $t1, $t2');
});

test('labels resolve to the next instruction, on their own line or sharing one', () => {
    const ins = ok('j end\nadd $t0, $t1, $t2\nend:\nnop');
    assert.equal(ins[0].target, 2);
    const same = ok('j end\nend: nop');
    assert.equal(same[0].target, 1);
});

test('stacked labels point at the same instruction', () => {
    const ins = ok('j b\na:\nb: nop');
    assert.equal(ins[0].target, 1);
});

test('a label after the last instruction targets the end of the program', () => {
    const ins = ok('j end\nnop\nend:');
    assert.equal(ins[0].target, 2);
    assert.equal(ins.length, 2);
});

test('backward label (loop) resolves', () => {
    const ins = ok('top: add $t0, $t0, $t0\nj top');
    assert.equal(ins[1].target, 0);
});

test('empty and comment-only programs assemble to nothing', () => {
    assert.deepEqual(asm(''), { instrs: [], errors: [] });
    assert.deepEqual(asm('# nothing\n\n'), { instrs: [], errors: [] });
});

suite('A. Assembler: errors');

test('unsupported instruction reports its line', () => {
    const [e] = err('add $t0, $t1, $t2\nmul $t0, $t1, $t2');
    assert.equal(e.line, 2);
    assert.match(e.message, /Unsupported instruction "mul"/);
});

test('wrong operand counts are errors for every format', () => {
    ['add $t0, $t1', 'add $t0, $t1, $t2, $t3', 'addi $t0, $t1', 'lw $t0', 'sw $t0, 0($t1), 1',
        'beq $t0, $t1', 'j', 'j a, b', 'nop $t0'].forEach(line => {
        assert.equal(err(line + '\na:').length, 1, line);
    });
});

test('bad registers are errors', () => {
    ['add $t0, $t1, $t99', 'add $t0, $t1, $32', 'add $t0, $t1, t2', 'add $t0, $t1, 5', 'add $t0, $t1, $',
        'lw $t0, 0($bogus)', 'lw $t0, 0(t1)'].forEach(line => {
        assert.equal(err(line).length, 1, line);
    });
});

test('bad immediates and offsets are errors', () => {
    ['addi $t0, $t1, five', 'addi $t0, $t1, 1.5', 'addi $t0, $t1, 0xZZ', 'lw $t0, abc($t1)'].forEach(line => {
        assert.equal(err(line).length, 1, line);
    });
});

test('malformed memory operand is an error', () => {
    ['lw $t0, 4', 'lw $t0, 4($t1', 'sw $t0, $t1'].forEach(line => assert.equal(err(line).length, 1, line));
});

test('unknown label is reported on the branch line', () => {
    const [e] = err('nop\nj nowhere');
    assert.equal(e.line, 2);
    assert.match(e.message, /Unknown label "nowhere"/);
});

test('duplicate label is an error on the second definition', () => {
    const [e] = err('a: nop\nnop\na: nop');
    assert.equal(e.line, 3);
    assert.match(e.message, /already defined/);
});

test('branch operand must look like a label', () => {
    assert.equal(err('beq $t0, $t1, 5').length, 1);
    assert.equal(err('j 5').length, 1);
});

test('all errors are collected and sorted by line', () => {
    const errors = err('foo\nj missing\nadd $t0\n');
    assert.deepEqual(errors.map(e => e.line), [1, 2, 3]);
});

test('a bad line does not stop later valid lines from assembling', () => {
    const r = asm('bogus\nadd $t0, $t1, $t2');
    assert.equal(r.errors.length, 1);
    assert.equal(r.instrs.length, 1);
    assert.equal(r.instrs[0].line, 2);
});

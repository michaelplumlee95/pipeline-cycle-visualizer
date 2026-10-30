// D. Rendering and events, through the real script.js and a stub DOM.
const { assert, suite, test } = require('./lib');
const { createApp } = require('./harness');

const count = (html, re) => (html.match(re) || []).length;

suite('D. Initial render');

test('opens on a working example, not an empty page', () => {
    const app = createApp();
    assert.ok(app.input.value.trim().length > 0);
    assert.ok(app.rows().length > 0);
    assert.equal(app.el('program-errors').innerHTML, '');
});

test('the example picker lists every example plus Custom, and selects the loaded one', () => {
    const app = createApp();
    const html = app.html('example-select');
    assert.equal(count(html, /<option /g), app.api.examples.length + 1);
    assert.match(html, /value="">Custom</);
    assert.equal(app.select.value, app.api.examples[1].id);
});

test('the legend shows all five stages and the stall swatch', () => {
    const html = createApp().html('stage-legend');
    ['IF', 'ID', 'EX', 'MEM', 'WB'].forEach(s => assert.ok(html.includes('stage-' + s.toLowerCase()), s));
    assert.match(html, /legend-swatch stall/);
});

suite('D. Table');

test('one row per instruction and one header per cycle', () => {
    const app = createApp();
    app.type('add $t0, $t1, $t2\nsub $t3, $t0, $t4');
    assert.equal(app.rows().length, 2);
    assert.equal(count(app.html('cycle-table-container'), /<th scope="col"/g), 8);
});

test('stall cells are dashed-class cells with a reason in the tooltip', () => {
    const app = createApp();
    app.type('add $t0, $t1, $t2\nsub $t3, $t0, $t4');
    const html = app.html('cycle-table-container');
    assert.equal(count(html, /cycle-cell stall/g), 2);
    assert.match(html, /title="Waiting for \$t0 from add \$t0, \$t1, \$t2"/);
});

test('each row shows its source line number', () => {
    const app = createApp();
    app.type('# c\nadd $t0, $t1, $t2');
    assert.match(app.html('cycle-table-container'), /L2<\/span>add \$t0, \$t1, \$t2/);
});

test('summary reports cycles, instructions, stalls, bubbles, and CPI', () => {
    const app = createApp();
    app.type('add $t0, $t1, $t2\nsub $t3, $t0, $t4');
    const html = app.html('summary');
    assert.match(html, /Cycles<\/span><strong>8</);
    assert.match(html, /Instructions<\/span><strong>2</);
    assert.match(html, /Data stalls<\/span><strong>2</);
    assert.match(html, /Fetch bubbles<\/span><strong>0</);
    assert.match(html, /CPI<\/span><strong>4\.00</);
});

test('the endless-loop notice appears in the summary', () => {
    const app = createApp();
    app.type('top: j top');
    assert.match(app.html('summary'), /Trace stopped after 200 instructions/);
});

test('an empty program shows a prompt and clears the other panels', () => {
    const app = createApp();
    app.type('');
    assert.match(app.html('cycle-table-container'), /Enter a program/);
    assert.equal(app.html('summary'), '');
    assert.equal(app.html('explanation-list'), '');
});

suite('D. Errors');

test('errors list with line numbers and replace the table', () => {
    const app = createApp();
    app.type('nop\nbogus $t0');
    assert.match(app.html('program-errors'), /Line 2: Unsupported instruction &quot;bogus&quot;/);
    assert.match(app.html('cycle-table-container'), /Fix the errors/);
    assert.equal(app.rows().length, 0);
    assert.equal(app.html('summary'), '');
});

test('fixing the error brings the table back and clears the message', () => {
    const app = createApp();
    app.type('bogus');
    app.type('nop');
    assert.equal(app.html('program-errors'), '');
    assert.equal(app.rows().length, 1);
});

test('user text in an error is HTML-escaped', () => {
    const app = createApp();
    app.type('<script>alert(1)</script>');
    const html = app.html('program-errors');
    assert.ok(!html.includes('<script>'));
    assert.match(html, /&lt;script&gt;/);
});

test('instruction text in the table is HTML-escaped', () => {
    assert.equal(createApp().api.escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

suite('D. Explanations');

test('one list item per stall, linked to the table by id', () => {
    const app = createApp();
    app.type('add $t0, $t1, $t2\nsub $t3, $t0, $t4');
    const items = app.doc.all.filter(e => e.tag === 'li' && e._owner === app.el('explanation-list'));
    assert.equal(items.length, 1);
    assert.ok(app.doc.querySelectorAll('[data-stall="0"]').length >= 3); // item + 2 cells
});

test('a program with no stalls says so', () => {
    const app = createApp();
    app.type('nop\nnop');
    assert.match(app.html('explanation-list'), /No stalls/);
});

suite('D. Events');

test('choosing an example fills the textarea and re-renders', () => {
    const app = createApp();
    app.chooseExample('no-hazards');
    const ex = app.api.examples.find(e => e.id === 'no-hazards');
    assert.equal(app.input.value, ex.code);
    assert.equal(app.api.getProgramText(), ex.code);
    assert.equal(app.rows().length, 4);
    assert.match(app.html('explanation-list'), /No stalls/);
});

test('every example in the picker can be chosen without errors', () => {
    const app = createApp();
    app.api.examples.forEach(e => {
        app.chooseExample(e.id);
        assert.equal(app.html('program-errors'), '', e.id);
        assert.ok(app.rows().length > 0, e.id);
    });
});

test('typing switches the picker to Custom', () => {
    const app = createApp();
    app.chooseExample('no-hazards');
    app.type('nop');
    assert.equal(app.select.value, '');
});

test('choosing Custom leaves the text alone', () => {
    const app = createApp();
    app.type('nop\nnop\nnop');
    app.chooseExample('');
    assert.equal(app.input.value, 'nop\nnop\nnop');
    assert.equal(app.rows().length, 3);
});

test('typing never rebuilds the textarea (focus survives)', () => {
    const app = createApp();
    const before = app.input.htmlWrites || 0;
    app.type('nop');
    app.type('nop\nnop');
    assert.equal(app.input.htmlWrites || 0, before);
    assert.equal(app.input.value, 'nop\nnop');
});

test('hovering a stall cell links it to its explanation, and leaving unlinks', () => {
    const app = createApp();
    app.type('add $t0, $t1, $t2\nsub $t3, $t0, $t4');
    const cell = app.doc.querySelectorAll('[data-stall="0"]').find(e => e.tag === 'td');
    app.doc.dispatch('mouseover', cell);
    const linked = () => app.doc.querySelectorAll('[data-stall="0"]').filter(e => e._classes.has('linked'));
    assert.equal(linked().length, app.doc.querySelectorAll('[data-stall="0"]').length);
    app.doc.dispatch('mouseout', cell);
    assert.equal(linked().length, 0);
});

test('hovering something without a stall id does nothing', () => {
    const app = createApp();
    app.type('nop');
    const cell = app.cells()[0];
    app.doc.dispatch('mouseover', cell);
    assert.equal(app.doc.all.filter(e => e._classes.has('linked')).length, 0);
});

test('hover handlers do not re-render panels', () => {
    const app = createApp();
    app.type('add $t0, $t1, $t2\nsub $t3, $t0, $t4');
    const table = app.el('cycle-table-container');
    const writes = table.htmlWrites;
    app.doc.dispatch('mouseover', app.doc.querySelectorAll('[data-stall="0"]')[0]);
    assert.equal(table.htmlWrites, writes);
});

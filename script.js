document.addEventListener('DOMContentLoaded', () => {
    const stages = ['IF', 'ID', 'EX', 'MEM', 'WB'];
    const maxInstructions = 200; // dynamic instructions traced before giving up on a loop
    const bubbleGlyph = '○';

    const examples = [
        {
            id: 'no-hazards',
            name: 'No hazards',
            code: 'addi $t0, $zero, 5\naddi $t1, $zero, 7\naddi $t2, $zero, 9\nadd  $t3, $s0, $s1\n'
        },
        {
            id: 'back-to-back',
            name: 'Back-to-back RAW',
            code: 'add $t0, $t1, $t2\nsub $t3, $t0, $t4\nand $t5, $t3, $t0\n'
        },
        {
            id: 'load-use',
            name: 'Load then use',
            code: 'lw  $t0, 0($t1)\nadd $t2, $t0, $t3\nsw  $t2, 4($t1)\n'
        },
        {
            id: 'spaced',
            name: 'Independent instruction between',
            code: 'add $t0, $t1, $t2\nor  $t4, $t5, $t6\nsub $t3, $t0, $t7\n'
        },
        {
            id: 'branch',
            name: 'Branch (beq)',
            code: 'addi $t0, $zero, 1\nbeq  $t0, $t1, done\nadd  $t2, $t0, $t0\nsub  $t3, $t2, $t0\ndone:\nor   $t4, $t2, $t3\n'
        },
        {
            id: 'jump',
            name: 'Jump (j)',
            code: 'addi $t0, $zero, 1\nj    skip\nadd  $t1, $t0, $t0\nskip:\nsub  $t2, $t0, $t0\n'
        }
    ];

    // --- State ---
    let programText = examples[1].code;
    let exampleId = examples[1].id; // '' once the user edits the text

    const exampleSelect = document.getElementById('example-select');
    const programInput = document.getElementById('program-input');
    const programErrors = document.getElementById('program-errors');
    const stageLegend = document.getElementById('stage-legend');
    const tableContainer = document.getElementById('cycle-table-container');
    const summary = document.getElementById('summary');
    const explanationList = document.getElementById('explanation-list');

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // --- Assembling ---

    function buildRegisterMap() {
        const map = {};
        const names = ['zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3'];
        names.forEach((name, i) => { map[name] = i; });
        for (let i = 0; i < 8; i++) map['t' + i] = 8 + i;
        for (let i = 0; i < 8; i++) map['s' + i] = 16 + i;
        map.t8 = 24;
        map.t9 = 25;
        map.k0 = 26;
        map.k1 = 27;
        map.gp = 28;
        map.sp = 29;
        map.fp = 30;
        map.ra = 31;
        return map;
    }

    const registerMap = buildRegisterMap();

    // Returns { n, name } or null. Numeric names ($8) and symbolic names ($t0) are both accepted.
    function parseRegister(token) {
        const m = token.match(/^\$(\w+)$/);
        if (!m) return null;
        const body = m[1].toLowerCase();
        if (/^\d+$/.test(body)) {
            const n = parseInt(body, 10);
            return n <= 31 ? { n, name: token } : null;
        }
        return registerMap.hasOwnProperty(body) ? { n: registerMap[body], name: token } : null;
    }

    function parseImmediate(token) {
        if (/^-?\d+$/.test(token)) return parseInt(token, 10);
        if (/^-?0x[0-9a-f]+$/i.test(token)) return parseInt(token, 16);
        return null;
    }

    // offset(base) with the offset optional; returns { base } or null
    function parseMemoryOperand(token) {
        const m = token.match(/^(-?\w+)?\(\s*(\$\w+)\s*\)$/);
        if (!m) return null;
        if (m[1] !== undefined && parseImmediate(m[1]) === null) return null;
        const base = parseRegister(m[2]);
        return base ? { base } : null;
    }

    const rTypeOps = ['add', 'sub', 'and', 'or', 'slt'];

    // Returns an instruction object or { error }. Only register dependencies are modeled, so
    // immediates are validated but not stored.
    function parseInstruction(line, lineNo) {
        const m = line.match(/^(\w+)\s*(.*)$/);
        if (!m) return { error: 'Cannot read "' + line + '"' };
        const op = m[1].toLowerCase();
        const operands = m[2] ? m[2].split(',').map(s => s.trim()) : [];
        const ins = { op, text: line.replace(/\s+/g, ' '), line: lineNo, dest: null, srcs: [], label: null, target: null };

        const needs = (count, form) => {
            if (operands.length === count) return null;
            return { error: op + ' expects ' + form };
        };
        const reg = token => parseRegister(token);

        if (rTypeOps.indexOf(op) !== -1) {
            const bad = needs(3, 'rd, rs, rt');
            if (bad) return bad;
            const [rd, rs, rt] = operands.map(reg);
            if (!rd || !rs || !rt) return { error: op + ' expects three registers like $t0, $t1, $t2' };
            ins.dest = rd;
            ins.srcs = [rs, rt];
        } else if (op === 'addi') {
            const bad = needs(3, 'rt, rs, immediate');
            if (bad) return bad;
            const rt = reg(operands[0]);
            const rs = reg(operands[1]);
            if (!rt || !rs || parseImmediate(operands[2]) === null) {
                return { error: 'addi expects two registers and a number, like addi $t0, $t1, 5' };
            }
            ins.dest = rt;
            ins.srcs = [rs];
        } else if (op === 'lw' || op === 'sw') {
            const bad = needs(2, 'rt, offset(base)');
            if (bad) return bad;
            const rt = reg(operands[0]);
            const mem = parseMemoryOperand(operands[1]);
            if (!rt || !mem) return { error: op + ' expects a register and offset(base), like ' + op + ' $t0, 4($t1)' };
            if (op === 'lw') {
                ins.dest = rt;
                ins.srcs = [mem.base];
            } else {
                ins.srcs = [rt, mem.base];
            }
        } else if (op === 'beq') {
            const bad = needs(3, 'rs, rt, label');
            if (bad) return bad;
            const rs = reg(operands[0]);
            const rt = reg(operands[1]);
            if (!rs || !rt || !/^[A-Za-z_]\w*$/.test(operands[2])) {
                return { error: 'beq expects two registers and a label, like beq $t0, $t1, done' };
            }
            ins.srcs = [rs, rt];
            ins.label = operands[2];
        } else if (op === 'j') {
            const bad = needs(1, 'a label');
            if (bad) return bad;
            if (!/^[A-Za-z_]\w*$/.test(operands[0])) return { error: 'j expects a label, like j loop' };
            ins.label = operands[0];
        } else if (op === 'nop') {
            if (operands.length) return { error: 'nop takes no operands' };
        } else {
            return { error: 'Unsupported instruction "' + m[1] + '"' };
        }
        return ins;
    }

    // Returns { instrs, errors }. Errors are { line, message }.
    function assemble(text) {
        const instrs = [];
        const labels = {};
        const errors = [];

        text.split('\n').forEach((raw, i) => {
            const lineNo = i + 1;
            let line = raw.replace(/#.*/, '').trim();
            // Peel off any leading labels so "loop: add ..." works on one line
            let m;
            while ((m = line.match(/^([A-Za-z_]\w*)\s*:\s*(.*)$/))) {
                if (labels.hasOwnProperty(m[1])) {
                    errors.push({ line: lineNo, message: 'Label "' + m[1] + '" is already defined' });
                } else {
                    labels[m[1]] = instrs.length;
                }
                line = m[2];
            }
            if (!line) return;
            const parsed = parseInstruction(line, lineNo);
            if (parsed.error) {
                errors.push({ line: lineNo, message: parsed.error });
            } else {
                instrs.push(parsed);
            }
        });

        instrs.forEach(ins => {
            if (ins.label === null) return;
            if (labels.hasOwnProperty(ins.label)) {
                ins.target = labels[ins.label];
            } else {
                errors.push({ line: ins.line, message: 'Unknown label "' + ins.label + '"' });
            }
        });

        errors.sort((a, b) => a.line - b.line);
        return { instrs, errors };
    }

    // --- Simulating ---

    const isControl = ins => ins.op === 'beq' || ins.op === 'j';

    // Turns assembled instructions into a per-cycle trace (see design.md, "Pipeline semantics").
    // Values are not computed, so beq is always traced as not taken; j is followed.
    function simulate(instrs) {
        const path = [];
        let pc = 0;
        let truncated = false;
        while (pc < instrs.length) {
            if (path.length >= maxInstructions) {
                truncated = true;
                break;
            }
            const ins = instrs[pc];
            path.push(ins);
            pc = ins.op === 'j' ? ins.target : pc + 1;
        }

        const rows = [];
        const explanations = [];
        let dataStalls = 0;
        let fetchBubbles = 0;

        path.forEach((ins, k) => {
            const prev = k > 0 ? rows[k - 1] : null;
            const afterControl = prev !== null && isControl(prev.ins);

            // A branch resolves in EX and a jump in ID; fetch resumes the cycle after.
            let ifCycle = 1;
            if (afterControl) ifCycle = prev.idEnd + (prev.ins.op === 'j' ? 1 : 2);
            else if (prev) ifCycle = prev.ifCycle + 1;

            // The instruction ahead holds ID while stalled, so this one holds IF behind it.
            const idStart = prev ? Math.max(ifCycle + 1, prev.idEnd + 1) : ifCycle + 1;

            // The youngest older writer finishes WB last, so scan backward for each source.
            let hazard = null;
            ins.srcs.forEach(src => {
                if (src.n === 0) return;
                for (let j = k - 1; j >= 0; j--) {
                    const d = rows[j].ins.dest;
                    if (d && d.n !== 0 && d.n === src.n) {
                        const wb = rows[j].idEnd + 3;
                        if (!hazard || wb > hazard.wb) hazard = { reg: src.name, producer: rows[j], wb };
                        break;
                    }
                }
            });
            const idEnd = hazard ? Math.max(idStart, hazard.wb) : idStart;

            const row = { index: k, ins, ifCycle, idStart, idEnd, cells: {} };
            row.cells[ifCycle] = { stage: 'IF', stall: false };

            if (afterControl) {
                const resolve = prev.ins.op === 'j' ? 'ID' : 'EX';
                const resolveCycle = prev.ins.op === 'j' ? prev.idEnd : prev.idEnd + 1;
                const stallId = explanations.length;
                for (let c = prev.ifCycle + 1; c < ifCycle; c++) {
                    row.cells[c] = {
                        stage: 'IF', stall: true, kind: 'control', stallId,
                        reason: 'Fetch waits for ' + prev.ins.text + ' to resolve'
                    };
                }
                fetchBubbles += prev.ins.op === 'j' ? 1 : 2;
                explanations.push({
                    id: stallId,
                    message: ins.text + ' is not fetched until cycle ' + ifCycle + ' because ' + prev.ins.text +
                        ' resolves in ' + resolve + ' at cycle ' + resolveCycle + '.'
                });
            } else {
                for (let c = ifCycle + 1; c < idStart; c++) {
                    row.cells[c] = { stage: 'IF', stall: true, kind: 'held', reason: 'Held in IF: the instruction ahead is stalled' };
                }
            }

            if (hazard && idEnd > idStart) {
                const stallId = explanations.length;
                for (let c = idStart; c < idEnd; c++) {
                    row.cells[c] = {
                        stage: 'ID', stall: true, kind: 'data', stallId,
                        reason: 'Waiting for ' + hazard.reg + ' from ' + hazard.producer.ins.text
                    };
                }
                dataStalls += idEnd - idStart;
                explanations.push({
                    id: stallId,
                    message: ins.text + ' waits in ID for ' + hazard.reg + ' from ' + hazard.producer.ins.text +
                        ' (line ' + hazard.producer.ins.line + '). Without forwarding, the value is written in WB at cycle ' +
                        hazard.wb + ', so ' + ins.text + ' stalls ' + (idEnd - idStart) +
                        ' cycle' + (idEnd - idStart === 1 ? '' : 's') + ' and reads it in cycle ' + idEnd + '.'
                });
            }

            row.cells[idEnd] = { stage: 'ID', stall: false };
            row.cells[idEnd + 1] = { stage: 'EX', stall: false };
            row.cells[idEnd + 2] = { stage: 'MEM', stall: false };
            row.cells[idEnd + 3] = { stage: 'WB', stall: false };
            rows.push(row);
        });

        const totalCycles = rows.length ? rows[rows.length - 1].idEnd + 3 : 0;
        return { rows, totalCycles, dataStalls, fetchBubbles, explanations, truncated };
    }

    // --- Rendering ---

    function renderExamples() {
        const options = examples.map(e => '<option value="' + e.id + '">' + escapeHtml(e.name) + '</option>');
        options.push('<option value="">Custom</option>');
        exampleSelect.innerHTML = options.join('');
        exampleSelect.value = exampleId;
    }

    function renderErrors(errors) {
        programErrors.innerHTML = errors
            .map(e => '<div class="error-line">Line ' + e.line + ': ' + escapeHtml(e.message) + '</div>')
            .join('');
    }

    function renderLegend() {
        const items = stages.map(s =>
            '<span class="legend-item"><span class="legend-swatch stage-' + s.toLowerCase() + '"></span>' + s + '</span>');
        items.push('<span class="legend-item"><span class="legend-swatch stall"></span>Stall ' + bubbleGlyph + '</span>');
        stageLegend.innerHTML = items.join('');
    }

    function renderCell(cell) {
        if (!cell) return '<td class="cycle-cell"></td>';
        if (!cell.stall) return '<td class="cycle-cell stage-' + cell.stage.toLowerCase() + '">' + cell.stage + '</td>';
        const link = cell.stallId !== undefined ? ' data-stall="' + cell.stallId + '"' : '';
        const label = cell.kind === 'control'
            ? bubbleGlyph
            : '<span class="stall-stage">' + cell.stage + '</span>' + bubbleGlyph;
        return '<td class="cycle-cell stall"' + link + ' title="' + escapeHtml(cell.reason) + '">' + label + '</td>';
    }

    function renderTable(result, errors) {
        if (errors.length) {
            tableContainer.innerHTML = '<p class="empty-note">Fix the errors in the program to see the pipeline.</p>';
            return;
        }
        if (!result.rows.length) {
            tableContainer.innerHTML = '<p class="empty-note">Enter a program to see the pipeline.</p>';
            return;
        }
        let html = '<table class="cycle-table" aria-label="Pipeline cycle table"><thead><tr><th class="instr-label">Instruction</th>';
        for (let c = 1; c <= result.totalCycles; c++) html += '<th scope="col">' + c + '</th>';
        html += '</tr></thead><tbody>';
        result.rows.forEach(row => {
            html += '<tr class="cycle-row" tabindex="0" data-row="' + row.index + '">' +
                '<th scope="row" class="instr-label"><span class="line-num">L' + row.ins.line + '</span>' +
                escapeHtml(row.ins.text) + '</th>';
            for (let c = 1; c <= result.totalCycles; c++) html += renderCell(row.cells[c]);
            html += '</tr>';
        });
        html += '</tbody></table>';
        tableContainer.innerHTML = html;
    }

    function renderSummary(result, errors) {
        if (errors.length || !result.rows.length) {
            summary.innerHTML = '';
            return;
        }
        const stat = (label, value) => '<div class="summary-stat"><span>' + label + '</span><strong>' + value + '</strong></div>';
        const cpi = (result.totalCycles / result.rows.length).toFixed(2);
        let html = stat('Cycles', result.totalCycles) + stat('Instructions', result.rows.length) +
            stat('Data stalls', result.dataStalls) + stat('Fetch bubbles', result.fetchBubbles) + stat('CPI', cpi);
        if (result.truncated) {
            html += '<div class="summary-notice">Trace stopped after ' + maxInstructions +
                ' instructions. The program may loop forever.</div>';
        }
        summary.innerHTML = html;
    }

    function renderExplanations(result, errors) {
        if (errors.length || !result.rows.length) {
            explanationList.innerHTML = '';
            return;
        }
        if (!result.explanations.length) {
            explanationList.innerHTML = '<li class="empty-note">No stalls. Every instruction moves through the pipeline without waiting.</li>';
            return;
        }
        explanationList.innerHTML = result.explanations
            .map(e => '<li class="explanation-item" tabindex="0" data-stall="' + e.id + '">' + escapeHtml(e.message) + '</li>')
            .join('');
    }

    function update() {
        const assembled = assemble(programText);
        const result = simulate(assembled.errors.length ? [] : assembled.instrs);
        renderErrors(assembled.errors);
        renderTable(result, assembled.errors);
        renderSummary(result, assembled.errors);
        renderExplanations(result, assembled.errors);
    }

    // --- Events ---

    // Toggles .linked on every element sharing a stall id, so hovering an explanation
    // lights up its table cells and the reverse. Class-only, so nothing is rebuilt.
    function setLinked(e, on) {
        const el = e.target.closest ? e.target.closest('[data-stall]') : null;
        if (!el) return;
        document.querySelectorAll('[data-stall="' + el.dataset.stall + '"]').forEach(other => {
            other.classList.toggle('linked', on);
        });
    }

    document.addEventListener('mouseover', e => setLinked(e, true));
    document.addEventListener('mouseout', e => setLinked(e, false));
    document.addEventListener('focusin', e => setLinked(e, true));
    document.addEventListener('focusout', e => setLinked(e, false));

    // Only the output panels re-render on typing; the textarea is never rebuilt so focus survives.
    programInput.addEventListener('input', () => {
        programText = programInput.value;
        exampleId = '';
        exampleSelect.value = '';
        update();
    });

    exampleSelect.addEventListener('change', () => {
        const example = examples.find(e => e.id === exampleSelect.value);
        if (!example) return;
        exampleId = example.id;
        programText = example.code;
        programInput.value = programText;
        update();
    });

    renderExamples();
    renderLegend();
    programInput.value = programText;
    update();
});

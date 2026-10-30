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
    let forwarding = false; // hazard-resolution strategy; only simulate() and the views downstream care
    let selectedCycle = 5; // the user's choice; the cycle actually shown is clamped to the trace
    let shownCycle = 0;
    let lastResult = { rows: [], totalCycles: 0 };
    let lastErrors = [];

    const exampleSelect = document.getElementById('example-select');
    const programInput = document.getElementById('program-input');
    const programErrors = document.getElementById('program-errors');
    const stageLegend = document.getElementById('stage-legend');
    const tableContainer = document.getElementById('cycle-table-container');
    const summary = document.getElementById('summary');
    const explanationList = document.getElementById('explanation-list');
    const forwardingOff = document.getElementById('forwarding-off');
    const forwardingOn = document.getElementById('forwarding-on');
    const datapathSvg = document.getElementById('datapath');
    const datapathSection = document.getElementById('datapath-section');
    const cyclePrev = document.getElementById('cycle-prev');
    const cycleNext = document.getElementById('cycle-next');
    const cycleStatus = document.getElementById('cycle-status');
    const datapathCaption = document.getElementById('datapath-caption');

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
    // With forwarding on, only the hazard rule changes: results are bypassed to EX, so only a
    // load followed by a dependent instruction still stalls.
    function simulate(instrs, forwarding) {
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
        let forwardCount = 0;

        path.forEach((ins, k) => {
            const prev = k > 0 ? rows[k - 1] : null;
            const afterControl = prev !== null && isControl(prev.ins);

            // A branch resolves in EX and a jump in ID; fetch resumes the cycle after.
            let ifCycle = 1;
            if (afterControl) ifCycle = prev.idEnd + (prev.ins.op === 'j' ? 1 : 2);
            // Only one instruction fits in IF, so the next one enters as the previous leaves it
            else if (prev) ifCycle = prev.idStart;

            // The instruction ahead holds ID while stalled, so this one holds IF behind it.
            const idStart = prev ? Math.max(ifCycle + 1, prev.idEnd + 1) : ifCycle + 1;

            // The youngest older writer finishes WB last, so scan backward for each source.
            // ready is the first ID cycle in which the value can be used: the cycle of the
            // producer's WB, or (forwarding) one cycle after an ALU result or two after a load.
            const writers = ins.srcs.map(src => {
                if (src.n === 0) return null;
                for (let j = k - 1; j >= 0; j--) {
                    const d = rows[j].ins.dest;
                    if (d && d.n !== 0 && d.n === src.n) return rows[j];
                }
                return null;
            });
            const readyAt = w => forwarding ? w.idEnd + (w.ins.op === 'lw' ? 2 : 1) : w.idEnd + 3;
            let hazard = null;
            ins.srcs.forEach((src, si) => {
                const w = writers[si];
                if (!w) return;
                const ready = readyAt(w);
                if (!hazard || ready > hazard.ready) hazard = { reg: src.name, producer: w, ready, wb: w.idEnd + 3 };
            });
            const idEnd = hazard ? Math.max(idStart, hazard.ready) : idStart;

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
                        reason: 'Waiting for ' + hazard.reg + ' from ' + hazard.producer.ins.text +
                            (forwarding ? ' (load data is not ready until the end of MEM)' : '')
                    };
                }
                dataStalls += idEnd - idStart;
                const plural = idEnd - idStart === 1 ? '' : 's';
                explanations.push({
                    id: stallId,
                    message: forwarding
                        ? ins.text + ' waits in ID for ' + hazard.reg + ' from ' + hazard.producer.ins.text +
                            ' (line ' + hazard.producer.ins.line + '). Even with forwarding, a load\'s data is not ready until the end of MEM, ' +
                            'so ' + ins.text + ' stalls ' + (idEnd - idStart) + ' cycle' + plural +
                            ' and gets it forwarded from MEM/WB into EX in cycle ' + (idEnd + 1) + '.'
                        : ins.text + ' waits in ID for ' + hazard.reg + ' from ' + hazard.producer.ins.text +
                            ' (line ' + hazard.producer.ins.line + '). Without forwarding, the value is written in WB at cycle ' +
                            hazard.wb + ', so ' + ins.text + ' stalls ' + (idEnd - idStart) +
                            ' cycle' + plural + ' and reads it in cycle ' + idEnd + '.'
                });
            }

            row.cells[idEnd] = { stage: 'ID', stall: false };
            row.cells[idEnd + 1] = { stage: 'EX', stall: false };
            if (forwarding) {
                // A source whose producer has not yet reached WB when this instruction leaves ID
                // is bypassed: from EX/MEM if the producer is in MEM during this EX, else MEM/WB.
                // A is the ALU's first input (rs or base register), B the rt register.
                const operands = ins.op === 'sw' ? ['B', 'A'] : ['A', 'B'];
                const forwards = [];
                ins.srcs.forEach((src, si) => {
                    const w = writers[si];
                    if (!w || idEnd >= w.idEnd + 3) return;
                    forwards.push({
                        reg: src.name, operand: operands[si], producerIndex: w.index,
                        from: idEnd + 1 === w.idEnd + 2 ? 'EX/MEM' : 'MEM/WB'
                    });
                });
                if (forwards.length) {
                    const forwardId = explanations.length;
                    row.cells[idEnd + 1].forwards = forwards;
                    row.cells[idEnd + 1].forwardId = forwardId;
                    forwardCount += forwards.length;
                    explanations.push({
                        id: forwardId,
                        forward: true,
                        message: ins.text + ' gets ' + forwards.map(f => f.reg + ' from ' + rows[f.producerIndex].ins.text +
                            ' (line ' + rows[f.producerIndex].ins.line + ') through the ' + f.from + ' forward').join(' and ') +
                            ' in EX at cycle ' + (idEnd + 1) + ', without waiting for the register file.'
                    });
                }
            }
            row.cells[idEnd + 2] = { stage: 'MEM', stall: false };
            row.cells[idEnd + 3] = { stage: 'WB', stall: false };
            rows.push(row);
        });

        const totalCycles = rows.length ? rows[rows.length - 1].idEnd + 3 : 0;
        return { rows, totalCycles, dataStalls, fetchBubbles, forwardCount, forwarding: !!forwarding, explanations, truncated };
    }

    // --- Datapath ---

    // Parts of the datapath lit per op and stage (ids without the "dp-" prefix; see design.md,
    // "Datapath view"). A wire belongs to the stage doing the work with it, and a pipeline
    // register to the stage that fills it.
    const dpIf = ['pc', 'imem', 'add4', 'pcmux', 'ifid', 'w-pc-imem', 'w-pc-add4', 'w-const4',
        'w-add4-ifid', 'w-add4-pcmux', 'w-pcmux-pc', 'w-imem-ifid'];
    const dpId = ['regs', 'signext', 'idex', 'w-ifid-rs', 'w-ifid-rt', 'w-ifid-signext', 'w-signext-idex',
        'w-ifid-idex-pc', 'w-ifid-rt-idex', 'w-ifid-rd-idex', 'w-regs-idex-a', 'w-regs-idex-b'];
    const dpExAlu = ['alu', 'alumux', 'aluctl', 'exmem', 'w-idex-alu-a', 'w-alumux-alu', 'w-idex-aluctl',
        'w-aluctl-alu', 'w-alu-exmem', 'w-idex-imm-trunk', 'c-alusrc', 'c-aluop'];
    const dpExDest = ['regdstmux', 'w-idex-rt-regdst', 'w-idex-rd-regdst', 'w-regdst-exmem', 'c-regdst'];
    const dpMemPass = ['w-exmem-alu', 'w-alu-memwb', 'w-exmem-memwb-dest', 'memwb'];
    const dpWb = ['regs-write', 'wbmux', 'w-wbmux-regs', 'w-memwb-regs-dest', 'c-memtoreg', 'c-regwrite'];

    const dpPaths = {
        rtype: {
            IF: dpIf,
            ID: dpId,
            EX: dpExAlu.concat(dpExDest, ['w-idex-b-alumux']),
            MEM: dpMemPass,
            WB: dpWb.concat(['w-memwb-wbmux-alu'])
        },
        addi: {
            IF: dpIf,
            ID: dpId,
            EX: dpExAlu.concat(dpExDest, ['w-idex-alumux-imm']),
            MEM: dpMemPass,
            WB: dpWb.concat(['w-memwb-wbmux-alu'])
        },
        lw: {
            IF: dpIf,
            ID: dpId,
            EX: dpExAlu.concat(dpExDest, ['w-idex-alumux-imm']),
            MEM: ['memwb', 'dmem', 'w-exmem-alu', 'w-alu-dmem-addr', 'w-dmem-memwb', 'w-exmem-memwb-dest', 'c-memread'],
            WB: dpWb.concat(['w-memwb-wbmux-mem'])
        },
        sw: {
            IF: dpIf,
            ID: dpId,
            EX: dpExAlu.concat(['w-idex-alumux-imm', 'w-idex-b-exmem']),
            MEM: ['dmem', 'w-exmem-alu', 'w-alu-dmem-addr', 'w-exmem-dmem-wd', 'c-memwrite'],
            WB: []
        },
        beq: {
            IF: dpIf,
            ID: dpId,
            EX: dpExAlu.filter(id => id !== 'w-alu-exmem').concat(['w-idex-b-alumux', 'w-alu-zero', 'shift2', 'badd',
                'w-idex-shift2', 'w-shift2-badd', 'w-idex-badd-pc', 'w-badd-exmem']),
            MEM: ['and', 'w-exmem-and-branch', 'w-exmem-and-zero', 'w-and-pcsrc', 'w-exmem-pcmux', 'c-branch'],
            WB: []
        },
        // The target is known in ID, so only the jump wire into the PC mux is lit there
        j: { IF: dpIf, ID: ['w-ifid-pcmux-jump'], EX: [], MEM: [], WB: [] },
        nop: { IF: dpIf, ID: [], EX: [], MEM: [], WB: [] }
    };

    // A stalled instruction has only attempted its register read; a held one has only fetched.
    const dpStalledId = ['regs', 'w-ifid-rs', 'w-ifid-rt'];
    const dpHeldIf = ['pc', 'imem', 'w-pc-imem'];

    function opClass(ins) {
        return rTypeOps.indexOf(ins.op) !== -1 ? 'rtype' : ins.op;
    }

    // Every part that exists only in forwarding mode (the dp-fwd elements in the SVG)
    const dpFwdIds = ['fwdmux-a', 'fwdmux-b', 'fwdunit', 'c-forwarda', 'c-forwardb',
        'w-fwd-idex-a', 'w-fwd-a-alu', 'w-fwd-idex-b', 'w-fwd-b-alumux', 'w-fwd-b-exmem',
        'w-fwd-fb-exmem', 'w-fwd-exmem-a', 'w-fwd-exmem-b', 'w-fwd-fb-memwb', 'w-fwd-memwb-a', 'w-fwd-memwb-b',
        'w-fwd-ctl', 'w-fwd-ctl-a', 'w-fwd-ctl-b'];
    // The straight wires into the ALU; with forwarding on they are replaced by paths through the muxes
    const dpDirectIds = ['w-idex-alu-a', 'w-idex-b-alumux', 'w-idex-b-exmem'];

    // EX parts for an instruction when forwarding is on. Operand A always goes through its mux; B does
    // only for ops that read rt. A forwarded operand lights its feedback bus and mux input instead of
    // the ID/EX input, and the forwarding unit lights up to show it made the choice.
    function forwardingExIds(op, forwards) {
        const base = dpPaths[op].EX;
        if (!base.length) return base;
        const ids = base.filter(id => dpDirectIds.indexOf(id) === -1);
        const from = {};
        forwards.forEach(f => { from[f.operand] = f.from; });
        ids.push('fwdmux-a', 'w-fwd-a-alu');
        if (!from.A) ids.push('w-fwd-idex-a');
        const toAlu = base.indexOf('w-idex-b-alumux') !== -1;
        if (toAlu || base.indexOf('w-idex-b-exmem') !== -1) {
            ids.push('fwdmux-b', toAlu ? 'w-fwd-b-alumux' : 'w-fwd-b-exmem');
            if (!from.B) ids.push('w-fwd-idex-b');
        }
        forwards.forEach(f => {
            const bus = f.from === 'EX/MEM' ? 'exmem' : 'memwb';
            const slot = f.operand.toLowerCase();
            [ 'w-fwd-fb-' + bus, 'w-fwd-' + bus + '-' + slot, 'fwdunit', 'w-fwd-ctl', 'w-fwd-ctl-' + slot, 'c-forward' + slot ]
                .forEach(id => { if (ids.indexOf(id) === -1) ids.push(id); });
        });
        return ids;
    }

    // What each stage is doing in one cycle. Pure, so tests can call it without a DOM.
    // Each stage is { kind, text, row, reason, ids } with kind one of
    // active | stalled | held | bubble | empty.
    function datapathState(result, cycle) {
        const state = {};
        stages.forEach(stage => {
            state[stage] = { kind: 'empty', text: '', row: -1, reason: '', ids: [], forwards: [] };
        });

        result.rows.forEach(row => {
            const cell = row.cells[cycle];
            if (!cell) return;
            const slot = state[cell.stage];
            if (cell.stall && cell.kind === 'control') {
                // The instruction waiting to be fetched is not in IF yet; the slot is a bubble
                slot.kind = 'bubble';
                slot.reason = cell.reason;
                return;
            }
            slot.text = row.ins.text;
            slot.row = row.index;
            if (!cell.stall) {
                slot.kind = 'active';
                slot.ids = dpPaths[opClass(row.ins)][cell.stage];
                if (cell.stage === 'EX' && result.forwarding) {
                    slot.forwards = cell.forwards || [];
                    slot.ids = forwardingExIds(opClass(row.ins), slot.forwards);
                }
            } else if (cell.kind === 'data') {
                slot.kind = 'stalled';
                slot.reason = cell.reason;
                slot.ids = dpStalledId;
            } else {
                slot.kind = 'held';
                slot.reason = cell.reason;
                slot.ids = dpHeldIf;
            }
        });

        // An empty stage is a bubble only if instructions went through it before and after
        // this cycle; before the first and after the last it is simply idle.
        stages.forEach(stage => {
            if (state[stage].kind !== 'empty') return;
            let before = false;
            let after = false;
            result.rows.forEach(row => {
                Object.keys(row.cells).forEach(key => {
                    const cell = row.cells[key];
                    if (cell.stage !== stage || cell.stall) return;
                    if (Number(key) < cycle) before = true;
                    if (Number(key) > cycle) after = true;
                });
            });
            if (!before || !after) return;
            state[stage].kind = 'bubble';
            // Trace the bubble back to its cause: a data stall in ID, or a fetch bubble in IF
            const depth = stages.indexOf(stage);
            let reason = 'Bubble from an earlier stall';
            result.rows.forEach(row => {
                const idCell = row.cells[cycle - (depth - 1)];
                if (depth >= 2 && idCell && idCell.stage === 'ID' && idCell.stall) reason = idCell.reason;
                const ifCell = row.cells[cycle - depth];
                if (depth >= 1 && ifCell && ifCell.stage === 'IF' && ifCell.stall && ifCell.kind === 'control') reason = ifCell.reason;
            });
            state[stage].reason = reason;
        });
        return state;
    }

    // Every id some op can light, so renderDatapath can clear exactly the elements it may have set.
    const dpLitIds = [];
    Object.keys(dpPaths).forEach(op => {
        stages.forEach(stage => {
            dpPaths[op][stage].forEach(id => {
                if (dpLitIds.indexOf(id) === -1) dpLitIds.push(id);
            });
        });
    });
    dpStalledId.concat(dpHeldIf, dpFwdIds).forEach(id => {
        if (dpLitIds.indexOf(id) === -1) dpLitIds.push(id);
    });

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

    function renderCell(cell, cycle) {
        const attrs = ' data-cycle="' + cycle + '"';
        const sel = cycle === shownCycle ? ' cycle-selected' : '';
        if (!cell) return '<td class="cycle-cell' + sel + '"' + attrs + '></td>';
        if (!cell.stall && cell.forwards) {
            const title = cell.forwards.map(f => f.reg + ' forwarded from ' + f.from).join(', ');
            return '<td class="cycle-cell stage-ex forwarded' + sel + '"' + attrs + ' data-stall="' + cell.forwardId +
                '" title="' + escapeHtml(title) + '">EX<span class="fwd-mark">fwd</span></td>';
        }
        if (!cell.stall) {
            return '<td class="cycle-cell stage-' + cell.stage.toLowerCase() + sel + '"' + attrs + '>' + cell.stage + '</td>';
        }
        const link = cell.stallId !== undefined ? ' data-stall="' + cell.stallId + '"' : '';
        const label = cell.kind === 'control'
            ? bubbleGlyph
            : '<span class="stall-stage">' + cell.stage + '</span>' + bubbleGlyph;
        return '<td class="cycle-cell stall' + sel + '"' + attrs + link + ' title="' + escapeHtml(cell.reason) + '">' + label + '</td>';
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
        for (let c = 1; c <= result.totalCycles; c++) {
            html += '<th scope="col" class="cycle-head' + (c === shownCycle ? ' cycle-selected' : '') +
                '" data-cycle="' + c + '" tabindex="0" title="Show cycle ' + c + ' in the datapath">' + c + '</th>';
        }
        html += '</tr></thead><tbody>';
        result.rows.forEach(row => {
            html += '<tr class="cycle-row" tabindex="0" data-row="' + row.index + '">' +
                '<th scope="row" class="instr-label"><span class="line-num">L' + row.ins.line + '</span>' +
                escapeHtml(row.ins.text) + '</th>';
            for (let c = 1; c <= result.totalCycles; c++) html += renderCell(row.cells[c], c);
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
            stat('Data stalls', result.dataStalls) + stat('Fetch bubbles', result.fetchBubbles);
        if (result.forwarding) html += stat('Forwards', result.forwardCount);
        html += stat('CPI', cpi);
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
            .map(e => '<li class="explanation-item' + (e.forward ? ' forward' : '') + '" tabindex="0" data-stall="' + e.id + '">' + escapeHtml(e.message) + '</li>')
            .join('');
    }

    // Tints the SVG parts for one stage color, or clears them when stage is null. Classes only,
    // so the hand-authored SVG is never rebuilt.
    function setPart(id, stage) {
        const el = document.getElementById('dp-' + id);
        if (!el) return;
        stages.forEach(s => el.classList.toggle('stage-' + s.toLowerCase(), s === stage));
        el.classList.toggle('active', stage !== null);
    }

    function renderDatapath() {
        const usable = !lastErrors.length && lastResult.rows.length > 0;
        const state = datapathState(usable ? lastResult : { rows: [], totalCycles: 0 }, shownCycle);
        datapathSvg.classList.toggle('forwarding', forwarding);

        const lit = {};
        stages.forEach(stage => {
            state[stage].ids.forEach(id => { lit[id] = stage; });
        });
        dpLitIds.forEach(id => setPart(id, lit[id] || null));

        const items = [];
        stages.forEach(stage => {
            const slot = state[stage];
            const key = stage.toLowerCase();
            const region = document.getElementById('dp-region-' + key);
            const label = document.getElementById('dp-label-' + key);
            const occupied = slot.kind === 'active' || slot.kind === 'stalled' || slot.kind === 'held';
            const flagged = slot.kind !== 'active' && slot.kind !== 'empty';
            if (region) {
                stages.forEach(s => region.classList.toggle('stage-' + s.toLowerCase(), occupied && s === stage));
                region.classList.toggle('active', occupied);
                region.classList.toggle('dp-bubble', slot.kind === 'bubble');
                region.classList.toggle('dp-stalled', slot.kind === 'stalled' || slot.kind === 'held');
            }
            if (label) {
                label.textContent = slot.kind === 'bubble' ? 'bubble ' + bubbleGlyph : slot.text + (flagged ? ' ' + bubbleGlyph : '');
                label.classList.toggle('dp-flagged', flagged);
                // Hovering the label links to the table row, like a stall cell does
                if (slot.row >= 0) label.dataset.row = String(slot.row);
                else delete label.dataset.row;
            }
            if (slot.kind === 'empty') return;
            const fwdNote = slot.forwards.length
                ? ' (' + slot.forwards.map(f => f.reg + ' forwarded from ' + f.from).join(', ') + ')' : '';
            const what = slot.kind === 'bubble' ? 'bubble: ' + slot.reason
                : slot.text + fwdNote + (flagged ? ' (' + slot.kind + '): ' + slot.reason : '');
            const link = slot.row >= 0 ? ' data-row="' + slot.row + '"' : '';
            items.push('<li class="caption-item' + (flagged ? ' flagged' : '') + '"' + link + '><span class="caption-stage stage-' +
                key + '">' + stage + '</span>' + escapeHtml(what) + '</li>');
        });

        cyclePrev.disabled = !usable || shownCycle <= 1;
        cycleNext.disabled = !usable || shownCycle >= lastResult.totalCycles;
        if (!usable) {
            cycleStatus.textContent = lastErrors.length ? 'Fix the errors in the program to see the datapath.' : 'Enter a program to see the datapath.';
            datapathCaption.innerHTML = '';
            return;
        }
        cycleStatus.textContent = 'Cycle ' + shownCycle + ' of ' + lastResult.totalCycles;
        datapathCaption.innerHTML = items.join('');
    }

    function update() {
        const assembled = assemble(programText);
        const result = simulate(assembled.errors.length ? [] : assembled.instrs, forwarding);
        lastResult = result;
        lastErrors = assembled.errors;
        shownCycle = assembled.errors.length ? 0 : Math.min(Math.max(1, selectedCycle), result.totalCycles);
        renderErrors(assembled.errors);
        renderTable(result, assembled.errors);
        renderSummary(result, assembled.errors);
        renderExplanations(result, assembled.errors);
        renderDatapath();
    }

    function setForwarding(on) {
        forwarding = on;
        forwardingOff.classList.toggle('active', !on);
        forwardingOn.classList.toggle('active', on);
        forwardingOff.setAttribute('aria-pressed', String(!on));
        forwardingOn.setAttribute('aria-pressed', String(on));
        update();
    }

    // Moves the datapath to another cycle. Only classes change in the table, so its scroll
    // position survives.
    function selectCycle(cycle) {
        if (!lastResult.totalCycles || lastErrors.length) return;
        selectedCycle = Math.min(Math.max(1, cycle), lastResult.totalCycles);
        shownCycle = selectedCycle;
        document.querySelectorAll('[data-cycle]').forEach(el => {
            el.classList.toggle('cycle-selected', Number(el.dataset.cycle) === shownCycle);
        });
        renderDatapath();
    }

    // --- Events ---

    // Toggles .linked on every element sharing a stall id or a row index, so hovering an
    // explanation lights up its table cells, and hovering a datapath label lights up its table
    // row, and the reverse. Class-only, so nothing is rebuilt.
    function setLinked(e, on) {
        if (!e.target.closest) return;
        ['stall', 'row'].forEach(key => {
            const el = e.target.closest('[data-' + key + ']');
            if (!el) return;
            document.querySelectorAll('[data-' + key + '="' + el.dataset[key] + '"]').forEach(other => {
                other.classList.toggle('linked', on);
            });
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

    tableContainer.addEventListener('click', e => {
        const el = e.target.closest ? e.target.closest('[data-cycle]') : null;
        if (el) selectCycle(Number(el.dataset.cycle));
    });

    tableContainer.addEventListener('keydown', e => {
        const head = e.target.closest ? e.target.closest('.cycle-head') : null;
        if (head && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            selectCycle(Number(head.dataset.cycle));
        }
    });

    forwardingOff.addEventListener('click', () => setForwarding(false));
    forwardingOn.addEventListener('click', () => setForwarding(true));

    cyclePrev.addEventListener('click', () => selectCycle(shownCycle - 1));
    cycleNext.addEventListener('click', () => selectCycle(shownCycle + 1));

    datapathSection.addEventListener('keydown', e => {
        if (e.key === 'ArrowLeft') selectCycle(shownCycle - 1);
        else if (e.key === 'ArrowRight') selectCycle(shownCycle + 1);
        else return;
        e.preventDefault();
    });

    renderExamples();
    renderLegend();
    programInput.value = programText;
    update();
});

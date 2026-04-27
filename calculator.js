/**
 * ============================================================
 * CALCPRO MK-IV — Full Calculator Logic
 * Modes: Standard | Scientific | Programmer
 * Features:
 *  - All basic arithmetic + chained ops
 *  - Scientific: sin/cos/tan (+ inverses), log, ln, pow, sqrt, cbrt, factorial, π, e, exp, |x|
 *  - Programmer: HEX/DEC/OCT/BIN, bitwise AND/OR/XOR/NOT/LSH/RSH, MOD
 *  - Memory: MC / MR / MS / M+ / M-
 *  - Degree / Radian toggle
 *  - Operation tape (full history)
 *  - Unit converter: Length / Weight / Temperature / Area
 *  - Quick keys (π, e, √2, φ, 1K, 1M, 1B, 1%)
 *  - Full keyboard support + backspace
 *  - Last-5 result panel
 * ============================================================
 */

(function () {
  'use strict';

  // =============================================
  // STATE
  // =============================================
  const S = {
    current:      '0',
    previous:     null,
    operator:     null,
    waitNew:      false,   // next digit replaces display
    justEval:     false,   // just pressed =
    memory:       0,
    useDegrees:   true,
    invMode:      false,
    mode:         'standard',  // standard | scientific | programmer
    progBase:     10,
    pendingPowBase: null,      // for xʸ operation
    tape:         [],          // { expr, result, isError }
    last5:        [],
  };

  // =============================================
  // DOM
  // =============================================
  const mainDisplay  = document.getElementById('mainDisplay');
  const exprLine     = document.getElementById('expressionLine');
  const subBase      = document.getElementById('subBase');
  const subWords     = document.getElementById('subWords');
  const memIndicator = document.getElementById('memIndicator');
  const modeLabel    = document.getElementById('modeLabel');
  const tapeScroll   = document.getElementById('tapeScroll');
  const tapeEmpty    = document.getElementById('tapeEmpty');
  const tapeCount    = document.getElementById('tapeCount');
  const tapeLast     = document.getElementById('tapeLast');
  const tapeClear    = document.getElementById('tapeClear');
  const last5El      = document.getElementById('last5');
  const toastEl      = document.getElementById('toast');
  const hexRow       = document.getElementById('hexRow');
  const convFromUnit = document.getElementById('convFromUnit');
  const convToUnit   = document.getElementById('convToUnit');
  const convFromVal  = document.getElementById('convFromVal');
  const convResult   = document.getElementById('convResult');
  const convUse      = document.getElementById('convUse');
  const convArrow    = document.querySelector('.conv-arrow');
  const indMem       = document.getElementById('ind-mem');
  const indInv       = document.getElementById('ind-inv');
  const indRad       = document.getElementById('ind-rad');
  const calcBody     = document.querySelector('.calc-body');

  // =============================================
  // DISPLAY UTILITIES
  // =============================================

  function fmt(num) {
    if (typeof num === 'string' && (num === 'Error' || num === 'Infinity' || num.includes('Error'))) return num;
    const n = parseFloat(num);
    if (isNaN(n)) return 'Error';
    if (!isFinite(n)) return n > 0 ? 'Infinity' : '-Infinity';
    if (Number.isInteger(n) && Math.abs(n) < 1e15) {
      return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
    if (Math.abs(n) >= 1e15 || (Math.abs(n) < 1e-9 && n !== 0)) {
      return n.toExponential(8).replace(/\.?0+e/, 'e');
    }
    const s = parseFloat(n.toPrecision(12)).toString();
    return s;
  }

  function updateDisplay(val, isError = false) {
    const str = isError ? val : fmt(val);
    mainDisplay.textContent = str;
    mainDisplay.className = '';
    if (isError) { mainDisplay.classList.add('error'); }
    else {
      const len = str.replace(/[^0-9.]/g, '').length;
      if (len > 14)      mainDisplay.classList.add('xsmall');
      else if (len > 9)  mainDisplay.classList.add('small');
    }
    mainDisplay.classList.add('flash');
    setTimeout(() => mainDisplay.classList.remove('flash'), 120);

    // Programmer sub-display
    if (S.mode === 'programmer' && !isError) {
      const iv = parseInt(parseFloat(val));
      if (!isNaN(iv)) {
        subBase.textContent = `HEX: ${iv.toString(16).toUpperCase()}  OCT: ${iv.toString(8)}  BIN: ${iv.toString(2)}`;
      } else {
        subBase.textContent = '';
      }
    } else {
      subBase.textContent = '';
    }
  }

  function setExpr(txt) {
    exprLine.textContent = txt || '\u00A0';
  }

  function showToast(msg, isErr = false) {
    toastEl.textContent = msg;
    toastEl.className = 'toast show' + (isErr ? ' error-toast' : '');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => { toastEl.className = 'toast'; }, 2200);
  }

  // =============================================
  // CORE ARITHMETIC
  // =============================================

  function compute(a, op, b) {
    const fa = parseFloat(a), fb = parseFloat(b);
    switch (op) {
      case '+': return fa + fb;
      case '−': return fa - fb;
      case '×': return fa * fb;
      case '÷': return fb === 0 ? 'Error:DIV0' : fa / fb;
      default:  return fb;
    }
  }

  function inputDigit(d) {
    // Programmer mode: restrict digits by base
    if (S.mode === 'programmer') {
      const base = S.progBase;
      const valid = '0123456789ABCDEF'.slice(0, base);
      if (!valid.includes(d.toUpperCase())) return;
    }

    if (S.waitNew || S.justEval) {
      S.current = d;
      S.waitNew = false;
      S.justEval = false;
    } else {
      const raw = S.current.replace(/[^0-9a-fA-F]/g, '');
      if (raw.length >= 15) return;
      S.current = S.current === '0' ? d : S.current + d;
    }
    updateDisplay(S.current);
  }

  function inputDot() {
    if (S.mode === 'programmer') return; // no decimals in programmer
    if (S.waitNew || S.justEval) {
      S.current = '0.';
      S.waitNew = false; S.justEval = false;
      mainDisplay.textContent = '0.';
      return;
    }
    if (!S.current.includes('.')) {
      S.current += '.';
      mainDisplay.textContent = S.current;
    }
  }

  function inputOperator(op) {
    if (S.operator && !S.waitNew && !S.justEval) {
      // Chain: evaluate pending first
      const res = compute(S.previous, S.operator, S.current);
      if (typeof res === 'string' && res.startsWith('Error')) { showError(res); return; }
      S.previous = String(res);
      S.current  = String(res);
      updateDisplay(S.current);
    } else {
      S.previous = S.current;
    }
    S.operator  = op;
    S.waitNew   = true;
    S.justEval  = false;
    setExpr(fmt(S.previous) + ' ' + op);
    highlightOp(op);
  }

  function doEquals() {
    if (!S.operator) return;
    const b   = S.current;
    const a   = S.previous;
    const op  = S.operator;
    const expr = fmt(a) + ' ' + op + ' ' + fmt(b) + ' =';
    const res  = compute(a, op, b);

    if (typeof res === 'string' && res.startsWith('Error')) {
      addTape(expr, 'Error', true);
      showError(res); return;
    }

    const resStr = String(res);
    setExpr(expr);
    updateDisplay(resStr);
    addTape(expr, fmt(resStr), false);
    addLast5(fmt(resStr));

    S.previous = resStr;
    S.current  = resStr;
    S.justEval = true;
    S.waitNew  = false;
    clearOpHighlight();
  }

  function clear() {
    S.current = '0'; S.previous = null; S.operator = null;
    S.waitNew = false; S.justEval = false; S.pendingPowBase = null;
    updateDisplay('0');
    setExpr('');
    clearOpHighlight();
  }

  function ce() {
    S.current = '0';
    S.waitNew = false;
    updateDisplay('0');
  }

  function backspace() {
    if (S.waitNew || S.justEval || S.current === 'Error') return;
    if (S.current.length <= 1 || (S.current.length === 2 && S.current.startsWith('-'))) {
      S.current = '0';
    } else {
      S.current = S.current.slice(0, -1);
    }
    updateDisplay(S.current);
  }

  function negate() {
    if (S.current === '0' || S.current === 'Error') return;
    S.current = S.current.startsWith('-') ? S.current.slice(1) : '-' + S.current;
    updateDisplay(S.current);
  }

  function percent() {
    const v = parseFloat(S.current);
    const res = S.previous && S.operator
      ? (parseFloat(S.previous) * v) / 100
      : v / 100;
    S.current = String(res);
    updateDisplay(S.current);
  }

  function showError(code = 'Error') {
    const msg = code === 'Error:DIV0' ? 'DIV BY ZERO' : 'ERROR';
    updateDisplay(msg, true);
    S.current = '0'; S.previous = null; S.operator = null;
    S.waitNew = false; S.justEval = false;
    clearOpHighlight();
    showToast(msg, true);
  }

  // =============================================
  // SCIENTIFIC FUNCTIONS
  // =============================================

  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;

  function toRad(x) { return S.useDegrees ? x * DEG2RAD : x; }
  function fromRad(x) { return S.useDegrees ? x * RAD2DEG : x; }

  function factorial(n) {
    n = Math.round(n);
    if (n < 0)  return NaN;
    if (n > 170) return Infinity;
    if (n === 0 || n === 1) return 1;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function sciOp(fn) {
    const x = parseFloat(S.current);
    let result;
    const inv = S.invMode;

    switch (fn) {
      case 'inv':
        S.invMode = !S.invMode;
        indInv.classList.toggle('active', S.invMode);
        document.querySelectorAll('.k-sci').forEach(b => b.classList.toggle('inv-active', S.invMode));
        // Update button labels
        updateSciLabels();
        return;

      case 'sin':  result = inv ? fromRad(Math.asin(x)) : Math.sin(toRad(x)); break;
      case 'cos':  result = inv ? fromRad(Math.acos(x)) : Math.cos(toRad(x)); break;
      case 'tan':  result = inv ? fromRad(Math.atan(x)) : Math.tan(toRad(x)); break;
      case 'log':  result = inv ? Math.pow(10, x) : Math.log10(x); break;
      case 'ln':   result = inv ? Math.exp(x)      : Math.log(x);  break;
      case 'sqrt': result = inv ? x * x            : Math.sqrt(x); break;
      case 'cbrt': result = Math.cbrt(x); break;
      case 'sqr':  result = x * x; break;
      case 'recip': result = x === 0 ? 'Error:DIV0' : 1 / x; break;
      case 'abs':  result = Math.abs(x); break;
      case 'factorial': result = factorial(x); break;
      case 'pi':   result = Math.PI; break;
      case 'e':    result = Math.E; break;
      case 'exp':  result = parseFloat(S.current + 'e'); return; // handled as operator
      case 'pow10': result = Math.pow(10, x); break;
      case 'pow':
        // Set up x^y
        S.previous = S.current;
        S.operator = '^';
        S.waitNew  = true;
        setExpr(fmt(S.current) + ' ^');
        return;
      case 'deg':
        S.useDegrees = !S.useDegrees;
        indRad.textContent = S.useDegrees ? 'DEG' : 'RAD';
        indRad.classList.toggle('active', true);
        showToast(S.useDegrees ? 'DEGREES MODE' : 'RADIANS MODE');
        return;
      case 'mod':
        S.previous = S.current;
        S.operator = '%OP';
        S.waitNew  = true;
        setExpr(fmt(S.current) + ' mod');
        return;
      default: return;
    }

    if (result === 'Error:DIV0') { showError('Error:DIV0'); return; }
    if (typeof result === 'number' && !isFinite(result)) { showError(); return; }
    if (typeof result === 'number' && isNaN(result)) { showError(); return; }

    S.current = String(result);
    S.justEval = true;
    S.waitNew = false;
    updateDisplay(S.current);
    addTape(fn + '(' + fmt(x) + ') =', fmt(result), false);
    addLast5(fmt(result));
  }

  // Patch compute to handle ^ and %OP
  const _origCompute = compute;
  window._compute = function(a, op, b) {
    if (op === '^') return Math.pow(parseFloat(a), parseFloat(b));
    if (op === '%OP') return parseFloat(a) % parseFloat(b);
    return _origCompute(a, op, b);
  };

  // Override compute
  function computeExt(a, op, b) {
    if (op === '^')   return Math.pow(parseFloat(a), parseFloat(b));
    if (op === '%OP') return parseFloat(a) % parseFloat(b);
    return compute(a, op, b);
  }

  // Override doEquals to use computeExt
  function doEqualsExt() {
    if (!S.operator) return;
    const b   = S.current;
    const a   = S.previous;
    const op  = S.operator;
    const opLabel = op === '^' ? '^' : op === '%OP' ? ' mod ' : (' ' + op + ' ');
    const expr = fmt(a) + opLabel + fmt(b) + ' =';
    const res  = computeExt(a, op, b);

    if (typeof res === 'string' && res.startsWith('Error')) {
      addTape(expr, 'Error', true);
      showError(res); return;
    }
    if (typeof res === 'number' && !isFinite(res)) { showError(); return; }

    const resStr = String(res);
    setExpr(expr);
    updateDisplay(resStr);
    addTape(expr, fmt(resStr), false);
    addLast5(fmt(resStr));

    S.previous = resStr;
    S.current  = resStr;
    S.justEval = true;
    S.waitNew  = false;
    clearOpHighlight();
  }

  function updateSciLabels() {
    const inv = S.invMode;
    const map = { sin: ['sin','asin'], cos: ['cos','acos'], tan: ['tan','atan'], log: ['log','10ˣ'], ln: ['ln','eˣ'], sqrt: ['√','x²'] };
    document.querySelectorAll('.k-sci[data-fn]').forEach(b => {
      const fn = b.dataset.fn;
      if (map[fn]) b.textContent = map[fn][inv ? 1 : 0];
    });
  }

  // =============================================
  // PROGRAMMER MODE
  // =============================================

  function setProgBase(base) {
    S.progBase = base;
    document.querySelectorAll('.base-btn').forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.base) === base);
    });

    // Enable/disable hex buttons
    if (hexRow) {
      hexRow.querySelectorAll('.k-hex').forEach(b => {
        const v = parseInt(b.dataset.d, 16);
        b.disabled = v >= base;
      });
    }

    // Enable/disable digit buttons
    document.querySelectorAll('#progPad .k-num[data-d]').forEach(b => {
      const v = parseInt(b.dataset.d);
      b.disabled = !isNaN(v) && v >= base;
    });

    // Convert current value to new base display
    const cur = parseInt(parseFloat(S.current));
    if (!isNaN(cur)) {
      subBase.textContent = `HEX: ${cur.toString(16).toUpperCase()}  OCT: ${cur.toString(8)}  BIN: ${cur.toString(2)}`;
    }

    showToast(['DEC','HEX','OCT','BIN'][['10','16','8','2'].indexOf(String(base))] + ' BASE');
  }

  function bitwiseOp(fn) {
    const x = parseInt(parseFloat(S.current));
    let result;
    switch (fn) {
      case 'not': result = ~x; break;
      case 'and': S.previous = S.current; S.operator = '&'; S.waitNew = true; setExpr(S.current + ' AND'); return;
      case 'or':  S.previous = S.current; S.operator = '|'; S.waitNew = true; setExpr(S.current + ' OR');  return;
      case 'xor': S.previous = S.current; S.operator = 'XOR'; S.waitNew = true; setExpr(S.current + ' XOR'); return;
      case 'lsh': S.previous = S.current; S.operator = '<<'; S.waitNew = true; setExpr(S.current + ' LSH'); return;
      case 'rsh': S.previous = S.current; S.operator = '>>'; S.waitNew = true; setExpr(S.current + ' RSH'); return;
      default: return;
    }
    S.current = String(result);
    S.justEval = true;
    updateDisplay(S.current);
    addTape(`NOT(${x}) =`, String(result), false);
    addLast5(String(result));
  }

  // Extend computeExt for bitwise
  const _cExt = computeExt;
  function computeFull(a, op, b) {
    const ia = parseInt(parseFloat(a)), ib = parseInt(parseFloat(b));
    switch (op) {
      case '&':   return ia & ib;
      case '|':   return ia | ib;
      case 'XOR': return ia ^ ib;
      case '<<':  return ia << ib;
      case '>>':  return ia >> ib;
      default: return _cExt(a, op, b);
    }
  }

  // =============================================
  // MEMORY OPERATIONS
  // =============================================

  function memOp(fn) {
    const cur = parseFloat(S.current);
    switch (fn) {
      case 'mc': S.memory = 0; memIndicator.textContent = ''; indMem.classList.remove('active'); showToast('MEMORY CLEARED'); break;
      case 'mr':
        if (S.memory !== 0) {
          S.current = String(S.memory);
          S.waitNew = false; S.justEval = true;
          updateDisplay(S.current);
        }
        break;
      case 'ms':
        S.memory = cur;
        memIndicator.textContent = 'M: ' + fmt(cur);
        indMem.classList.add('active');
        showToast('MEMORY STORED: ' + fmt(cur));
        break;
      case 'mplus':
        S.memory += cur;
        memIndicator.textContent = 'M: ' + fmt(S.memory);
        indMem.classList.add('active');
        showToast('M+ = ' + fmt(S.memory));
        break;
      case 'mminus':
        S.memory -= cur;
        memIndicator.textContent = 'M: ' + fmt(S.memory);
        indMem.classList.add('active');
        showToast('M− = ' + fmt(S.memory));
        break;
    }
  }

  // =============================================
  // TAPE
  // =============================================

  function addTape(expr, result, isError) {
    S.tape.unshift({ expr, result, isError });
    if (S.tape.length > 100) S.tape.pop();
    renderTape();
  }

  function renderTape() {
    tapeCount.textContent = S.tape.length;
    tapeLast.textContent = S.tape.length ? S.tape[0].result : '—';

    if (S.tape.length === 0) {
      tapeScroll.innerHTML = '';
      tapeScroll.appendChild(tapeEmpty);
      tapeEmpty.style.display = '';
      return;
    }
    tapeEmpty.style.display = 'none';
    tapeScroll.innerHTML = S.tape.map((t, i) => `
      <div class="tape-entry${t.isError ? ' tape-error' : ''}" data-index="${i}">
        <span class="te-expr">${t.expr}</span>
        <span class="te-result">${t.result}</span>
      </div>
    `).join('');

    tapeScroll.querySelectorAll('.tape-entry').forEach(el => {
      el.addEventListener('click', () => {
        const t = S.tape[parseInt(el.dataset.index)];
        if (!t.isError) {
          S.current = t.result.replace(/,/g, '');
          S.justEval = true; S.waitNew = false;
          updateDisplay(S.current);
          setExpr(t.expr);
        }
      });
    });
  }

  function addLast5(val) {
    S.last5.unshift(val);
    if (S.last5.length > 5) S.last5.pop();
    renderLast5();
  }

  function renderLast5() {
    if (!last5El) return;
    if (S.last5.length === 0) {
      last5El.innerHTML = '<div class="tape-empty">No results yet</div>';
      return;
    }
    last5El.innerHTML = S.last5.map(v => `
      <div class="last5-item" data-v="${v.replace(/,/g,'')}">
        <span>${v}</span>
        <span>${v}</span>
      </div>
    `).join('');
    last5El.querySelectorAll('.last5-item').forEach(el => {
      el.addEventListener('click', () => {
        S.current = el.dataset.v;
        S.justEval = true; S.waitNew = false;
        updateDisplay(S.current);
      });
    });
  }

  // =============================================
  // MODE SWITCHING
  // =============================================

  function switchMode(mode) {
    S.mode = mode;
    document.querySelectorAll('.mode-tab').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    document.getElementById('standardPad').classList.toggle('hidden', mode !== 'standard');
    document.getElementById('sciPad').classList.toggle('hidden', mode !== 'scientific');
    document.getElementById('progPad').classList.toggle('hidden', mode !== 'programmer');

    const labels = { standard: 'STANDARD', scientific: 'SCIENTIFIC', programmer: 'PROGRAMMER' };
    modeLabel.textContent = labels[mode];
    if (mode === 'programmer') setProgBase(S.progBase);
    clear();
  }

  // =============================================
  // UNIT CONVERTER
  // =============================================

  const CONV_DATA = {
    length: {
      units: ['Meter','Kilometer','Centimeter','Millimeter','Mile','Yard','Foot','Inch','Nautical Mile'],
      toBase: [1, 1000, 0.01, 0.001, 1609.344, 0.9144, 0.3048, 0.0254, 1852],
    },
    weight: {
      units: ['Kilogram','Gram','Milligram','Pound','Ounce','Ton (Metric)','Stone'],
      toBase: [1, 0.001, 0.000001, 0.453592, 0.0283495, 1000, 6.35029],
    },
    temp: {
      units: ['Celsius','Fahrenheit','Kelvin'],
      toBase: null, // special handling
    },
    area: {
      units: ['Sq Meter','Sq Kilometer','Sq Centimeter','Sq Mile','Sq Yard','Sq Foot','Acre','Hectare'],
      toBase: [1, 1e6, 0.0001, 2589988.11, 0.836127, 0.092903, 4046.86, 10000],
    },
  };

  let currentConvType = 'length';

  function populateConvUnits(type) {
    currentConvType = type;
    const d = CONV_DATA[type];
    [convFromUnit, convToUnit].forEach((sel, idx) => {
      sel.innerHTML = d.units.map((u, i) => `<option value="${i}">${u}</option>`).join('');
      sel.selectedIndex = idx === 1 ? 1 : 0;
    });
    doConvert();
  }

  function doConvert() {
    const type  = currentConvType;
    const fromI = parseInt(convFromUnit.value);
    const toI   = parseInt(convToUnit.value);
    const val   = parseFloat(convFromVal.value);
    if (isNaN(val)) { convResult.textContent = '—'; return; }

    let result;
    if (type === 'temp') {
      const units = CONV_DATA.temp.units;
      const fromU = units[fromI], toU = units[toI];
      let celsius;
      if (fromU === 'Celsius')    celsius = val;
      else if (fromU === 'Fahrenheit') celsius = (val - 32) * 5/9;
      else                        celsius = val - 273.15;
      if (toU === 'Celsius')      result = celsius;
      else if (toU === 'Fahrenheit') result = celsius * 9/5 + 32;
      else                        result = celsius + 273.15;
    } else {
      const d = CONV_DATA[type];
      const base = val * d.toBase[fromI];
      result = base / d.toBase[toI];
    }

    convResult.textContent = parseFloat(result.toPrecision(10)).toString();
  }

  convFromVal.addEventListener('input', doConvert);
  convFromUnit.addEventListener('change', doConvert);
  convToUnit.addEventListener('change', doConvert);
  convArrow && convArrow.addEventListener('click', () => {
    const tmp = convFromUnit.value;
    convFromUnit.value = convToUnit.value;
    convToUnit.value = tmp;
    doConvert();
  });
  convUse && convUse.addEventListener('click', () => {
    const v = convResult.textContent;
    if (v && v !== '—') {
      S.current = v;
      S.waitNew = false; S.justEval = true;
      updateDisplay(S.current);
      showToast('VALUE LOADED: ' + v);
    }
  });

  document.querySelectorAll('.conv-tab').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.conv-tab').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      populateConvUnits(b.dataset.conv);
    });
  });

  // =============================================
  // QUICK KEYS
  // =============================================

  document.querySelectorAll('.qk').forEach(b => {
    b.addEventListener('click', () => {
      S.current = b.dataset.val;
      S.waitNew = false; S.justEval = true;
      updateDisplay(S.current);
      showToast('LOADED: ' + b.dataset.val);
    });
  });

  // =============================================
  // OPERATOR HIGHLIGHT
  // =============================================

  function highlightOp(op) {
    document.querySelectorAll('.k-op').forEach(b => {
      b.classList.toggle('active', b.dataset.op === op);
    });
  }
  function clearOpHighlight() {
    document.querySelectorAll('.k-op').forEach(b => b.classList.remove('active'));
  }

  // =============================================
  // BUTTON CLICK HANDLER
  // =============================================

  calcBody.addEventListener('click', function (e) {
    const btn = e.target.closest('.k');
    if (!btn) return;

    // Ripple
    btn.style.transform = 'scale(0.92) translateY(1px)';
    setTimeout(() => { btn.style.transform = ''; }, 90);

    // Digit
    if (btn.dataset.d !== undefined) {
      if (btn.dataset.fn === 'dot') { inputDot(); return; }
      inputDigit(btn.dataset.d);
      return;
    }

    const fn = btn.dataset.fn;
    const op = btn.dataset.op;

    if (op) { inputOperator(op); return; }
    if (!fn) return;

    switch (fn) {
      case 'equals':  doEqualsExt(); break;
      case 'clear':   clear(); break;
      case 'ce':      ce(); break;
      case 'backspace': backspace(); break;
      case 'negate':  negate(); break;
      case 'percent': percent(); break;
      case 'recip':   sciOp('recip'); break;
      case 'sqrt':    sciOp('sqrt'); break;
      case 'sqr':     sciOp('sqr'); break;
      case 'dot':     inputDot(); break;
      // Memory
      case 'mc': case 'mr': case 'ms': case 'mplus': case 'mminus':
        memOp(fn); break;
      // Scientific
      case 'inv': case 'sin': case 'cos': case 'tan':
      case 'log': case 'ln': case 'pi': case 'e':
      case 'pow': case 'pow10': case 'exp': case 'abs':
      case 'factorial': case 'cbrt': case 'deg':
      case 'mod':
        sciOp(fn); break;
      // Bitwise
      case 'and': case 'or': case 'xor': case 'not':
      case 'lsh': case 'rsh':
        bitwiseOp(fn); break;
      default: break;
    }
  });

  // Mode tabs
  document.querySelectorAll('.mode-tab').forEach(b => {
    b.addEventListener('click', () => switchMode(b.dataset.mode));
  });

  // Base buttons
  document.querySelectorAll('.base-btn').forEach(b => {
    b.addEventListener('click', () => setProgBase(parseInt(b.dataset.base)));
  });

  // Tape clear
  tapeClear && tapeClear.addEventListener('click', () => {
    S.tape = [];
    renderTape();
    showToast('TAPE CLEARED');
  });

  // =============================================
  // KEYBOARD SUPPORT
  // =============================================

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey) return;
    const k = e.key;
    const digits = '0123456789';
    const hexExtra = 'abcdefABCDEF';

    if (digits.includes(k)) { e.preventDefault(); inputDigit(k); flash(`[data-d="${k}"]`); return; }
    if (S.mode === 'programmer' && hexExtra.includes(k)) {
      e.preventDefault(); inputDigit(k.toUpperCase());
      flash(`[data-d="${k.toUpperCase()}"]`); return;
    }
    if (k === '.')  { e.preventDefault(); inputDot(); flash('[data-fn="dot"]'); return; }
    if (k === '+')  { e.preventDefault(); inputOperator('+');  flash('[data-op="+"]'); return; }
    if (k === '-')  { e.preventDefault(); inputOperator('−');  flash('[data-op="−"]'); return; }
    if (k === '*')  { e.preventDefault(); inputOperator('×');  flash('[data-op="×"]'); return; }
    if (k === '/')  { e.preventDefault(); inputOperator('÷');  flash('[data-op="÷"]'); return; }
    if (k === 'Enter' || k === '=') { e.preventDefault(); doEqualsExt(); flash('[data-fn="equals"]'); return; }
    if (k === 'Escape')    { e.preventDefault(); clear(); flash('[data-fn="clear"]'); return; }
    if (k === 'Backspace') { e.preventDefault(); backspace(); flash('[data-fn="backspace"]'); return; }
    if (k === 'Delete')    { e.preventDefault(); ce(); flash('[data-fn="ce"]'); return; }
    if (k === '%')  { e.preventDefault(); percent(); flash('[data-fn="percent"]'); return; }
    if (k === 'n' || k === 'N') { negate(); return; }
    if (k === 'm' || k === 'M') { memOp('ms'); return; }
    if (k === 'r' || k === 'R') { memOp('mr'); return; }
  });

  function flash(selector) {
    const btns = document.querySelectorAll(selector);
    btns.forEach(b => {
      if (!b) return;
      b.style.transform = 'scale(0.92) translateY(1px)';
      b.style.filter = 'brightness(1.4)';
      setTimeout(() => { b.style.transform = ''; b.style.filter = ''; }, 90);
    });
  }

  // =============================================
  // INIT
  // =============================================

  updateDisplay('0');
  setExpr('');
  populateConvUnits('length');
  renderTape();
  renderLast5();

  // Keyboard shortcut hint
  setTimeout(() => showToast('KEYBOARD READY — +-*/=⌫ ESC'), 800);

})();

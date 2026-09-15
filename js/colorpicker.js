// colorpicker.js — 이지케이블 전용 단자 색상 선택 팝오버 (CapCut 스타일)
//
// 왜 만들었나: 브라우저 기본 <input type="color"> 는 OS 팝업이라 앱과 스타일이 다르고,
// "최근 사용 색상"을 앱 안에 붙일 자리도 없다. 그래서 공용 단자·부품 단자·신규 단자·
// 다중 선택 색상 변경 네 곳이 전부 이 팝오버 하나를 공유한다(트리거만 다르다).
//
// 구조: <button class="color-trigger"> 를 WE.colorPicker.attach() 로 팝오버에 연결한다.
// 팝오버 자체는 body 에 딱 하나만 만들어 재사용한다(싱글턴) — 열 때마다 새로 만들면
// 여러 트리거를 오갈 때 이전 팝업이 남는 문제가 생긴다.
var WE = window.WE || {};
window.WE = WE;

WE.colorPicker = (function () {
  var STORAGE_KEY = "we_recentTerminalColors_v1";   // Codex 1차 구현과 같은 키를 그대로 쓴다(기존 저장값 보존)
  var SWATCH = 22, GAP = 4;              // 스와치 칸 크기 — 팝오버 CSS 폭(200px 콘텐츠)과 짝을 맞춘 값이라 같이 바꿔야 한다
  var GRID_WIDTH = 200;                  // .cc-popover 안쪽 폭(220px 팝오버 - 좌우 10px 패딩)
  var RECENT_CAPACITY = Math.max(1, Math.floor((GRID_WIDTH + GAP) / (SWATCH + GAP))) * 3;   // 한 줄당 개수 × 3줄

  // 자주 쓰는 기본 색상 5개 — 앱 기본 프리셋(VCC 빨강·GND 회색·3V3 주황 등)과 같은 계열의 값을 쓴다
  var BASIC_COLORS = [
    { color: "#E53935", label: "빨강" },
    { color: "#000000", label: "검정" },
    { color: "#1E88E5", label: "파랑" },
    { color: "#43A047", label: "초록" },
    { color: "#FB8C00", label: "주황" }
  ];

  // 팝오버는 DOMContentLoaded 이후에 만들어지므로 i18n 의 마크업 일괄 치환이 닿지 않는다.
  // 문구는 전부 이걸 거쳐 넣는다. (사전은 js/i18n.js — 한국어 원문이 곧 키다)
  function t(ko) { return WE.i18n ? WE.i18n.t(ko) : ko; }

  // ---- 색상 변환 ----
  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function clampByte(n) { return Math.max(0, Math.min(255, Math.round(n) || 0)); }
  function rgbToHex(r, g, b) {
    function h2(n) { var s = clampByte(n).toString(16).toUpperCase(); return s.length < 2 ? "0" + s : s; }
    return "#" + h2(r) + h2(g) + h2(b);
  }
  function normalizeHex(hex) {
    var rgb = hexToRgb(hex);
    return rgb ? rgbToHex(rgb.r, rgb.g, rgb.b) : null;
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d !== 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return { h: h, s: max === 0 ? 0 : d / max, v: max };
  }
  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, r, g, b;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  }

  // ---- 최근 색상 저장 (localStorage) ----
  function loadRecent() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(raw) ? raw.map(normalizeHex).filter(Boolean) : [];
    } catch (e) { return []; }
  }
  function saveRecent(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, RECENT_CAPACITY))); }
    catch (e) { /* localStorage 사용 불가 — 세션 내에서만 동작 */ }
  }
  // 새로 지정한 색상을 맨 앞에 놓는다. 이미 있으면 중복 추가하지 않고 앞으로만 옮긴다.
  // 3줄(= RECENT_CAPACITY)을 넘으면 가장 오래된 것부터 잘려나간다.
  function rememberColor(hex) {
    hex = normalizeHex(hex); if (!hex) return;
    var list = loadRecent().filter(function (c) { return c !== hex; });
    list.unshift(hex);
    saveRecent(list);
    if (pop) renderRecent();
  }

  // ---- 팝오버 DOM (지연 생성 싱글턴) ----
  var pop = null;      // { el, sv, svThumb, hue, hueThumb, preview, hexInput, rgbInputs, ... }
  var state = null;    // 현재 열려 있는 트리거의 상태: { trigger, options, mode, hsv:{h,s,v} }

  function currentHex() {
    var rgb = hsvToRgb(state.hsv.h, state.hsv.s, state.hsv.v);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  }
  function setTriggerSwatch(trigger, hex) {
    if (!trigger) return;
    trigger.dataset.color = hex;
    trigger.style.setProperty("--swatch-color", hex);
  }
  // 팝오버 자체의 화면(SV 사각형·Hue 막대·미리보기·HEX/RGB 입력칸)을 현재 state.hsv 에 맞춰 다시 그린다.
  function paintPickerUi(hex) {
    pop.sv.style.backgroundColor = "hsl(" + Math.round(state.hsv.h) + ",100%,50%)";
    pop.svThumb.style.left = (state.hsv.s * 100) + "%";
    pop.svThumb.style.top = ((1 - state.hsv.v) * 100) + "%";
    pop.hueThumb.style.left = (state.hsv.h / 360 * 100) + "%";
    pop.preview.style.background = hex;
    if (document.activeElement !== pop.hexInput) pop.hexInput.value = hex.slice(1);
    var rgb = hexToRgb(hex);
    if (rgb) ["r", "g", "b"].forEach(function (ch) {
      var input = pop.rgbInputs[ch];
      if (document.activeElement !== input) input.value = String(rgb[ch]);
    });
  }
  // 외부에서 받은 hex 색 하나로 state.hsv 를 통째로 다시 계산한다.
  // (SV/Hue 드래그 중에는 이 경로를 쓰지 않는다 — 아래 설명 참고)
  function setHsvFromHex(hex) {
    hex = normalizeHex(hex) || "#1E88E5";
    var rgb = hexToRgb(hex);
    state.hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    paintPickerUi(hex);
    setTriggerSwatch(state.trigger, hex);
  }
  // 트리거가 등록해 둔 콜백을 부른다 — onInput(드래그 중 실시간) 아니면 onCommit(확정) 둘 중 하나만.
  // remember 가 true 일 때만 "최근 색상"에 남긴다 — 기본/최근 칸 클릭은 이미 있는 값이라 남기지 않는다.
  function fireCallback(hex, opts) {
    var options = state.options, committing = !opts || opts.commit !== false;
    if (committing) { if (options.onCommit) options.onCommit(hex); }
    else if (options.onInput) options.onInput(hex);
    if (opts && opts.remember) rememberColor(hex);
    setTriggerSwatch(state.trigger, hex);
  }
  // SV/Hue 드래그 도중 호출 — hsv 는 포인터 위치에서 이미 정해졌으니 hex→hsv 재계산(hexToHsv)을
  // 하지 않는다. 채도·명도가 0인 지점(회색·검정)에서 되돌아가면 Hue 값이 어긋나는 걸 막기 위해서다.
  function applyFromDrag(opts) {
    var hex = currentHex();
    paintPickerUi(hex);
    fireCallback(hex, opts);
  }
  // 기본/최근 색상 클릭, HEX·RGB 입력 확정 등 "정확한 색 하나"가 주어졌을 때 호출.
  function applyExactColor(hex, opts) {
    hex = normalizeHex(hex); if (!hex) return;
    setHsvFromHex(hex);
    fireCallback(hex, opts);
  }

  function recentCapacity() { return RECENT_CAPACITY; }
  function renderBasicColors() {
    pop.basicGrid.innerHTML = "";
    BASIC_COLORS.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "cc-swatch";
      b.style.setProperty("--swatch-color", c.color);
      b.title = t(c.label); b.setAttribute("aria-label", t(c.label));
      b.addEventListener("click", function () { applyExactColor(c.color, { commit: true, remember: false }); });
      pop.basicGrid.appendChild(b);
    });
  }
  function renderRecent() {
    var list = loadRecent().slice(0, recentCapacity());
    pop.recentGrid.innerHTML = "";
    pop.recentEmpty.hidden = list.length > 0;
    list.forEach(function (hex) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "cc-swatch";
      b.dataset.color = hex;
      b.style.setProperty("--swatch-color", hex);
      b.title = hex; b.setAttribute("aria-label", hex);
      b.addEventListener("click", function () { applyExactColor(hex, { commit: true, remember: false }); });
      pop.recentGrid.appendChild(b);
    });
  }

  function bindSv() {
    function fromEvent(e) {
      var r = pop.sv.getBoundingClientRect();
      state.hsv.s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      state.hsv.v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    }
    pop.sv.addEventListener("pointerdown", function (e) {
      if (!state) return;
      e.preventDefault();
      pop.sv.setPointerCapture(e.pointerId);
      fromEvent(e); applyFromDrag({ commit: false });
      function move(ev) { fromEvent(ev); applyFromDrag({ commit: false }); }
      function up(ev) {
        fromEvent(ev); applyFromDrag({ commit: true, remember: true });
        pop.sv.removeEventListener("pointermove", move);
        pop.sv.removeEventListener("pointerup", up);
      }
      pop.sv.addEventListener("pointermove", move);
      pop.sv.addEventListener("pointerup", up);
    });
  }
  function bindHue() {
    function fromEvent(e) {
      var r = pop.hue.getBoundingClientRect();
      state.hsv.h = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 360;
    }
    pop.hue.addEventListener("pointerdown", function (e) {
      if (!state) return;
      e.preventDefault();
      pop.hue.setPointerCapture(e.pointerId);
      fromEvent(e); applyFromDrag({ commit: false });
      function move(ev) { fromEvent(ev); applyFromDrag({ commit: false }); }
      function up(ev) {
        fromEvent(ev); applyFromDrag({ commit: true, remember: true });
        pop.hue.removeEventListener("pointermove", move);
        pop.hue.removeEventListener("pointerup", up);
      }
      pop.hue.addEventListener("pointermove", move);
      pop.hue.addEventListener("pointerup", up);
    });
  }
  function bindHexInput() {
    pop.hexInput.addEventListener("input", function () {
      var v = pop.hexInput.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6).toUpperCase();
      if (pop.hexInput.value !== v) pop.hexInput.value = v;
      if (/^[0-9A-F]{6}$/.test(v) && state) applyExactColor("#" + v, { commit: false });
    });
    function commit() {
      if (!state) return;
      var v = pop.hexInput.value.toUpperCase();
      if (/^[0-9A-F]{6}$/.test(v)) applyExactColor("#" + v, { commit: true, remember: true });
      else paintPickerUi(currentHex());   // 잘못된 값이면 현재 색으로 되돌린다
    }
    pop.hexInput.addEventListener("blur", commit);
    pop.hexInput.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault(); commit(); pop.hexInput.blur();
    });
  }
  function bindRgbInputs() {
    ["r", "g", "b"].forEach(function (ch) {
      var input = pop.rgbInputs[ch];
      input.addEventListener("input", function () {
        var v = input.value.replace(/[^0-9]/g, "").slice(0, 3);
        if (input.value !== v) input.value = v;
        var r = pop.rgbInputs.r.value, g = pop.rgbInputs.g.value, b = pop.rgbInputs.b.value;
        if (state && r !== "" && g !== "" && b !== "") {
          applyExactColor(rgbToHex(+r, +g, +b), { commit: false });
        }
      });
      function commit() {
        if (!state) return;
        applyExactColor(rgbToHex(+pop.rgbInputs.r.value || 0, +pop.rgbInputs.g.value || 0, +pop.rgbInputs.b.value || 0),
          { commit: true, remember: true });
      }
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        e.preventDefault(); commit(); input.blur();
      });
    });
  }
  function bindModeToggle() {
    pop.modeToggle.addEventListener("click", function () {
      if (!state) return;
      state.mode = state.mode === "hex" ? "rgb" : "hex";
      pop.hexField.hidden = state.mode !== "hex";
      pop.rgbField.hidden = state.mode !== "rgb";
      pop.modeToggle.textContent = state.mode === "hex" ? "RGB" : "HEX";
    });
  }

  function ensurePopover() {
    if (pop) return pop;
    var el = document.createElement("div");
    el.className = "cc-popover"; el.hidden = true;
    el.setAttribute("role", "dialog"); el.setAttribute("aria-label", t("색상 선택"));

    var sv = document.createElement("div"); sv.className = "cc-sv";
    var svThumb = document.createElement("div"); svThumb.className = "cc-sv-thumb";
    sv.appendChild(svThumb);

    var hue = document.createElement("div"); hue.className = "cc-hue";
    var hueThumb = document.createElement("div"); hueThumb.className = "cc-hue-thumb";
    hue.appendChild(hueThumb);

    var valueRow = document.createElement("div"); valueRow.className = "cc-value-row";
    var preview = document.createElement("div"); preview.className = "cc-preview";
    var hexField = document.createElement("div"); hexField.className = "cc-field cc-field-hex";
    var hash = document.createElement("span"); hash.className = "cc-hash"; hash.textContent = "#";
    var hexInput = document.createElement("input");
    hexInput.type = "text"; hexInput.maxLength = 6; hexInput.autocomplete = "off"; hexInput.spellcheck = false;
    hexInput.setAttribute("aria-label", t("HEX 색상"));
    hexField.appendChild(hash); hexField.appendChild(hexInput);
    var rgbField = document.createElement("div"); rgbField.className = "cc-field cc-field-rgb"; rgbField.hidden = true;
    var rgbInputs = {};
    ["r", "g", "b"].forEach(function (ch) {
      var inp = document.createElement("input");
      inp.type = "text"; inp.inputMode = "numeric"; inp.maxLength = 3;
      inp.setAttribute("aria-label", ch.toUpperCase());
      rgbField.appendChild(inp); rgbInputs[ch] = inp;
    });
    var modeToggle = document.createElement("button");
    modeToggle.type = "button"; modeToggle.className = "cc-mode-toggle"; modeToggle.textContent = "RGB";
    valueRow.appendChild(preview); valueRow.appendChild(hexField); valueRow.appendChild(rgbField); valueRow.appendChild(modeToggle);

    var basicSection = document.createElement("div"); basicSection.className = "cc-section";
    var basicGrid = document.createElement("div"); basicGrid.className = "cc-swatches cc-basic";
    basicSection.appendChild(basicGrid);

    var recentSection = document.createElement("div"); recentSection.className = "cc-section";
    var recentLabel = document.createElement("div"); recentLabel.className = "cc-section-label"; recentLabel.textContent = t("최근 색상");
    var recentGrid = document.createElement("div"); recentGrid.className = "cc-swatches cc-recent";
    var recentEmpty = document.createElement("div"); recentEmpty.className = "cc-empty"; recentEmpty.textContent = t("아직 없음");
    recentSection.appendChild(recentLabel); recentSection.appendChild(recentGrid); recentSection.appendChild(recentEmpty);

    el.appendChild(sv); el.appendChild(hue); el.appendChild(valueRow);
    el.appendChild(basicSection); el.appendChild(recentSection);
    document.body.appendChild(el);

    pop = {
      el: el, sv: sv, svThumb: svThumb, hue: hue, hueThumb: hueThumb, preview: preview,
      hexField: hexField, hexInput: hexInput, rgbField: rgbField, rgbInputs: rgbInputs, modeToggle: modeToggle,
      basicGrid: basicGrid, recentGrid: recentGrid, recentEmpty: recentEmpty
    };
    bindSv(); bindHue(); bindHexInput(); bindRgbInputs(); bindModeToggle();
    renderBasicColors();
    return pop;
  }

  // 트리거 버튼 기준으로 화면 안에 들어오게 위치를 잡는다(qcp 빠른 배선색 팝업과 같은 방식) —
  // 일단 아래쪽에 놓고, 실제 크기를 잰 다음 화면 밖으로 나가면 좌우/위아래를 접어 넣는다.
  function positionNear(trigger) {
    var r = trigger.getBoundingClientRect();
    pop.el.style.left = r.left + "px";
    pop.el.style.top = (r.bottom + 6) + "px";
    requestAnimationFrame(function () {
      if (!pop || pop.el.hidden) return;
      var pr = pop.el.getBoundingClientRect();
      var left = Math.min(r.left, window.innerWidth - pr.width - 8);
      var top = r.bottom + 6;
      if (top + pr.height > window.innerHeight - 8) top = r.top - pr.height - 6;
      pop.el.style.left = Math.max(8, left) + "px";
      pop.el.style.top = Math.max(8, top) + "px";
    });
  }

  function isOpenFor(trigger) { return !!(state && state.trigger === trigger && pop && !pop.el.hidden); }
  function close() {
    if (!pop || pop.el.hidden) return;
    pop.el.hidden = true;
    if (state && state.trigger) state.trigger.removeAttribute("aria-expanded");
    state = null;
  }
  function open(trigger, hex, options) {
    ensurePopover();
    if (state && state.trigger !== trigger) close();
    state = { trigger: trigger, options: options || {}, mode: "hex", hsv: { h: 0, s: 0, v: 0 } };
    pop.hexField.hidden = false; pop.rgbField.hidden = true; pop.modeToggle.textContent = "RGB";
    setHsvFromHex(hex);
    renderRecent();
    pop.el.hidden = false;
    positionNear(trigger);
    trigger.setAttribute("aria-expanded", "true");
  }

  // 트리거 버튼을 팝오버에 연결한다.
  //   options.getColor()   — 팝오버를 열 때 보여줄 현재 색 (없으면 트리거의 data-color)
  //   options.onInput(hex) — 드래그 등으로 실시간으로 값이 바뀔 때
  //   options.onCommit(hex)— 최종 값이 정해졌을 때(마우스를 뗐을 때, 입력 확정, 스와치 클릭)
  function attach(trigger, options) {
    options = options || {};
    trigger.classList.add("color-trigger");
    trigger.setAttribute("aria-haspopup", "dialog");
    var initial = normalizeHex(options.getColor ? options.getColor() : trigger.dataset.color) || "#1E88E5";
    setTriggerSwatch(trigger, initial);
    trigger.addEventListener("click", function () {
      if (isOpenFor(trigger)) { close(); return; }
      var color = normalizeHex(options.getColor ? options.getColor() : trigger.dataset.color) || "#1E88E5";
      open(trigger, color, options);
    });
  }

  document.addEventListener("pointerdown", function (e) {
    if (!pop || pop.el.hidden) return;
    if (pop.el.contains(e.target)) return;                              // 팝오버 안쪽은 각 컨트롤이 처리
    if (state && state.trigger && state.trigger.contains(e.target)) return; // 트리거 자체는 click 토글에 맡긴다
    close();
  });
  // Esc 는 "맨 위에 뜬 것 한 겹"만 닫는다.
  // 팝오버가 떠 있으면 여기서 삼켜야 한다 — 안 그러면 document → window 로 계속 올라가
  // 뒤에 있는 단자 배치 창(termeditor 의 window keydown)까지 같이 닫힌다.
  // capture 단계에서 잡는 이유: 아래(프리셋 관리 모달)보다 먼저 차례가 와야 하기 때문이다.
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || !pop || pop.el.hidden) return;
    close();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }, true);

  return {
    attach: attach,
    setSwatch: setTriggerSwatch,   // 팝오버를 열지 않고 트리거 미리보기만 바꿀 때 (예: 다중 선택 대상이 바뀔 때)
    close: close,
    normalizeHex: normalizeHex
  };
})();

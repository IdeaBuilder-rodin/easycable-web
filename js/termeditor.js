// termeditor.js — 단자 배치 전용 모달 (확대/축소·팬)
var WE = window.WE || {};
window.WE = WE;

WE.termeditor = (function () {
  var SVGNS = "http://www.w3.org/2000/svg";
  var modal, svg, content, termsG, viewport;
  var cmp = null;
  var baseW = 0, baseH = 0;
  var zoom = 1, panX = 0, panY = 0;
  var selTid = null;      // 마지막 선택(호환)
  var selTids = [];       // 다중 선택 단자 id
  var opened = false;
  var bound = false;
  var teMode = "place";   // 'place'(단자 배치) | 'select'(선택)
  var marqEl = null;      // 마퀴 사각형 요소
  var guidesG = null;     // 스마트 가이드(정렬 점선) 그룹
  var SNAP_PX = 6;        // 스냅 임계(화면 px)
  // 지역 undo(모달 열려 있으면 전역 히스토리가 커밋 안 되므로 별도 스택)
  var teUndo = [], teRedo = [], teLast = "";

  // 드래그 상태
  var drag = null; // { type:'term'|'pan', ... }
  var DRAG_THRESH = 4;

  function el(name, attrs) {
    var node = document.createElementNS(SVGNS, name);
    if (attrs) for (var k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  // ---- 단자 선택(다중) ----
  function isSel(tid) { return selTids.indexOf(tid) >= 0; }
  function setSingleSel(tid) { selTids = [tid]; selTid = tid; }
  function toggleSel(tid) {
    var i = selTids.indexOf(tid);
    if (i >= 0) selTids.splice(i, 1); else selTids.push(tid);
    selTid = selTids.length ? selTids[selTids.length - 1] : null;
  }
  function updateAlignVis() {
    var a = document.getElementById("teAlign"); if (a) a.hidden = selTids.length < 2;
  }
  function selectedTerms() {
    return selTids.map(function (id) { return WE.model.getTerminal(cmp, id); }).filter(Boolean);
  }
  function alignTerms(mode) {
    var ts = selectedTerms(); if (ts.length < 2) return;
    function avg(k) { return ts.reduce(function (s, t) { return s + t[k]; }, 0) / ts.length; }
    function distrib(k) {
      if (ts.length < 3) return;
      var s = ts.slice().sort(function (a, b) { return a[k] - b[k]; });
      var first = s[0][k], step = (s[s.length - 1][k] - first) / (s.length - 1);
      s.forEach(function (t, i) { t[k] = first + step * i; });
    }
    if (mode === "x") { var ax = avg("rx"); ts.forEach(function (t) { t.rx = ax; }); }
    else if (mode === "y") { var ay = avg("ry"); ts.forEach(function (t) { t.ry = ay; }); }
    else if (mode === "distX") distrib("rx");
    else if (mode === "distY") distrib("ry");
    renderTerminals(); buildList(); teCommit();
  }

  // ---- 지역 undo/redo ----
  function teSnap() { return JSON.stringify(cmp.terminals); }
  function teResetHistory() { teUndo = []; teRedo = []; teLast = teSnap(); }
  function teCommit() {
    var s = teSnap();
    if (s !== teLast) { teUndo.push(teLast); if (teUndo.length > 100) teUndo.shift(); teLast = s; teRedo = []; }
  }
  function teApply(json) {
    cmp.terminals = JSON.parse(json);
    selTids = selTids.filter(function (id) { return WE.model.getTerminal(cmp, id); });
    selTid = selTids[selTids.length - 1] || null;
    renderTerminals(); buildList(); updateAlignVis();
  }
  function teDoUndo() { if (!teUndo.length) return; teRedo.push(teLast); var j = teUndo.pop(); teLast = j; teApply(j); }
  function teDoRedo() { if (!teRedo.length) return; teUndo.push(teLast); var j = teRedo.pop(); teLast = j; teApply(j); }

  // ---- 모드 ----
  function setTeMode(m) {
    teMode = m;
    document.getElementById("teModePlace").classList.toggle("active", m === "place");
    document.getElementById("teModeSelect").classList.toggle("active", m === "select");
    if (svg) svg.style.cursor = (m === "select") ? "crosshair" : "";
  }

  // ---- 마퀴(사각 선택) ----
  function drawMarquee(rect) {
    if (!marqEl) { marqEl = el("rect", { "class": "te-marquee" }); content.appendChild(marqEl); }
    marqEl.setAttribute("x", rect.x); marqEl.setAttribute("y", rect.y);
    marqEl.setAttribute("width", rect.w); marqEl.setAttribute("height", rect.h);
    marqEl.setAttribute("stroke-width", 1 / zoom);
  }
  function removeMarquee() { if (marqEl && marqEl.parentNode) marqEl.parentNode.removeChild(marqEl); marqEl = null; }

  // ---- 스마트 가이드(정렬 스냅) ----
  // 드래그 중인 단자 t를 다른 단자의 x/y에 맞으면 스냅하고, 맞은 축에 점선 가이드를 그림
  function applySnap(t) {
    var x = t.rx * baseW, y = t.ry * baseH, tol = SNAP_PX / zoom;
    var bestX = null, bxd = tol, bestY = null, byd = tol;
    cmp.terminals.forEach(function (o) {
      if (o.id === t.id) return;
      var dx = Math.abs(o.rx * baseW - x); if (dx < bxd) { bxd = dx; bestX = o.rx; }
      var dy = Math.abs(o.ry * baseH - y); if (dy < byd) { byd = dy; bestY = o.ry; }
    });
    var gx = null, gy = null;
    if (bestX !== null) { t.rx = bestX; gx = bestX * baseW; }
    if (bestY !== null) { t.ry = bestY; gy = bestY * baseH; }
    drawGuides(gx, gy);
  }
  function drawGuides(gx, gy) {
    if (!guidesG) { guidesG = el("g", { "class": "te-guides" }); content.appendChild(guidesG); }
    guidesG.innerHTML = "";
    if (gx !== null) guidesG.appendChild(el("line", { x1: gx, y1: 0, x2: gx, y2: baseH, "class": "te-guide", "stroke-width": 1 / zoom }));
    if (gy !== null) guidesG.appendChild(el("line", { x1: 0, y1: gy, x2: baseW, y2: gy, "class": "te-guide", "stroke-width": 1 / zoom }));
  }
  function removeGuides() { if (guidesG && guidesG.parentNode) guidesG.parentNode.removeChild(guidesG); guidesG = null; }

  function open(component) {
    cmp = component;
    selTid = null; selTids = [];
    ensureDom();
    // 박스 비율을 이미지 원본 비율에 맞춤(레터박스 제거 → 캔버스와 단자 위치 일치)
    fitBoxToImage(function () {
      baseW = cmp.width; baseH = cmp.height;
      buildStatic();
      fillPlacePreset();
      setTeMode("place");
      teResetHistory();
      modal.hidden = false;
      opened = true;
      // 레이아웃 확정 후 맞춤
      requestAnimationFrame(function () { fit(); buildList(); updateAlignVis(); });
    });
  }
  // 부품 박스 높이를 이미지 원본 비율에 맞게 보정
  function fitBoxToImage(done) {
    if (!cmp.image) { done(); return; }
    var probe = new Image();
    probe.onload = function () {
      if (probe.width > 0) cmp.height = Math.max(10, Math.round(cmp.width * probe.height / probe.width));
      done();
    };
    probe.onerror = function () { done(); };
    probe.src = cmp.image;
  }

  function ensureDom() {
    if (bound) return;
    modal = document.getElementById("termModal");
    svg = document.getElementById("teSvg");
    content = document.getElementById("teContent");
    viewport = document.getElementById("teViewport");

    svg.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    svg.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);

    document.getElementById("teZoomIn").addEventListener("click", function () { zoomAt(centerXY(), 1.2); });
    document.getElementById("teZoomOut").addEventListener("click", function () { zoomAt(centerXY(), 1 / 1.2); });
    document.getElementById("teZoomFit").addEventListener("click", fit);
    document.getElementById("teDone").addEventListener("click", close);
    document.getElementById("tePresetManage").addEventListener("click", function () {
      if (WE.app.openPresetModal) WE.app.openPresetModal();
    });

    var list = document.getElementById("teList");
    list.addEventListener("input", onListInput);
    list.addEventListener("change", onListChange);
    list.addEventListener("click", onListClick);

    document.getElementById("teAlign").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-talign]");
      if (b) alignTerms(b.dataset.talign);
    });
    document.getElementById("teModePlace").addEventListener("click", function () { setTeMode("place"); });
    document.getElementById("teModeSelect").addEventListener("click", function () { setTeMode("select"); });

    bound = true;
  }

  // 이미지/테두리/단자 그룹 뼈대
  function buildStatic() {
    content.innerHTML = "";
    if (cmp.image) {
      var img = el("image", { x: 0, y: 0, width: baseW, height: baseH, preserveAspectRatio: "xMidYMid meet" });
      img.setAttributeNS("http://www.w3.org/1999/xlink", "href", cmp.image);
      img.setAttribute("href", cmp.image);
      content.appendChild(img);
    } else {
      content.appendChild(el("rect", { x: 0, y: 0, width: baseW, height: baseH, fill: "#dfe4ea" }));
    }
    content.appendChild(el("rect", { x: 0, y: 0, width: baseW, height: baseH, "class": "te-img-border" }));
    termsG = el("g", { "class": "te-terms" });
    content.appendChild(termsG);
    renderTerminals();
  }

  function applyTransform() {
    content.setAttribute("transform", "translate(" + panX + "," + panY + ") scale(" + zoom + ")");
    document.getElementById("teZoomLabel").textContent = Math.round(zoom * 100) + "%";
  }

  function renderTerminals() {
    if (!termsG) return;
    termsG.innerHTML = "";
    var r = 7 / zoom, hit = 13 / zoom, fs = 13 / zoom, off = 10 / zoom;
    cmp.terminals.forEach(function (t) {
      var cx = t.rx * baseW, cy = t.ry * baseH;
      var color = t.color || WE.model.DEFAULT_TERMINAL_COLOR;
      var g = el("g");
      g.appendChild(el("circle", {
        cx: cx, cy: cy, r: hit, fill: "#000", "fill-opacity": 0,
        "data-tid": t.id, style: "pointer-events:all;cursor:pointer"
      }));
      if (isSel(t.id)) {
        g.appendChild(el("circle", { cx: cx, cy: cy, r: r + 3 / zoom, fill: "none", stroke: "#1e88e5", "stroke-width": 2 / zoom, "pointer-events": "none" }));
      }
      g.appendChild(el("circle", { cx: cx, cy: cy, r: r, fill: color, stroke: "#fff", "stroke-width": 2 / zoom, "pointer-events": "none" }));
      var tx = el("text", { x: cx + off, y: cy - off * 0.5, "pointer-events": "none",
        style: "font:" + fs + "px 'Malgun Gothic',sans-serif;fill:#222;paint-order:stroke;stroke:#fff;stroke-width:" + (3 / zoom) + "px;user-select:none" });
      tx.textContent = t.name;
      g.appendChild(tx);
      termsG.appendChild(g);
    });
  }

  // ---- 좌표 변환 ----
  function clientToLocal(clientX, clientY) {
    var pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    var m = content.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    var p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }
  function svgXY(clientX, clientY) {
    var r = svg.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }
  function centerXY() {
    var r = svg.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // ---- 확대/축소 ----
  function zoomAt(clientPt, factor) {
    var s = svgXY(clientPt.x, clientPt.y);
    var lx = (s.x - panX) / zoom, ly = (s.y - panY) / zoom;
    zoom = Math.max(0.1, Math.min(20, zoom * factor));
    panX = s.x - lx * zoom;
    panY = s.y - ly * zoom;
    applyTransform();
    renderTerminals();
  }

  function onWheel(e) {
    e.preventDefault();
    zoomAt({ x: e.clientX, y: e.clientY }, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }

  function fit() {
    var vw = svg.clientWidth, vh = svg.clientHeight;
    if (!vw || !vh) return;
    zoom = Math.min(vw / baseW, vh / baseH) * 0.9;
    panX = (vw - baseW * zoom) / 2;
    panY = (vh - baseH * zoom) / 2;
    applyTransform();
    renderTerminals();
  }

  // ---- 포인터: 추가 / 단자드래그 / 팬 ----
  function onDown(e) {
    // 마우스 가운데(휠) 버튼 = 모드와 무관하게 항상 팬(화면 이동)
    if (e.button === 1) {
      drag = { type: "pan", sx: e.clientX, sy: e.clientY, panX0: panX, panY0: panY };
      svg.classList.add("panning");
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    var termEl = e.target.closest("[data-tid]");
    if (termEl) {
      var tid = termEl.getAttribute("data-tid");
      if (e.ctrlKey || e.metaKey) {           // Ctrl+클릭 = 다중선택 토글(드래그 없음)
        toggleSel(tid); renderTerminals(); buildList(); updateAlignVis();
        e.preventDefault(); return;
      }
      if (!isSel(tid)) setSingleSel(tid); else selTid = tid;   // 선택 밖이면 단일, 그룹 안이면 그룹 유지
      renderTerminals(); buildList(); updateAlignVis();
      // 선택된 단자 전체를 함께 드래그
      var start = clientToLocal(e.clientX, e.clientY), origs = {};
      selTids.forEach(function (id) { var t = WE.model.getTerminal(cmp, id); if (t) origs[id] = { rx: t.rx, ry: t.ry }; });
      drag = { type: "term", tids: selTids.slice(), origs: origs, start: start };
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    // 빈 곳: 모드/Ctrl에 따라 마퀴 or 팬/추가
    var ctrl = e.ctrlKey || e.metaKey;
    var marquee = (teMode === "select") ? !ctrl : ctrl;   // 선택모드=드래그 마퀴 / 배치모드=Ctrl드래그 마퀴
    if (marquee) {
      drag = { type: "marq", sx: e.clientX, sy: e.clientY };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    drag = { type: "pending", sx: e.clientX, sy: e.clientY, panX0: panX, panY0: panY, canAdd: (teMode === "place" && !ctrl) };
    svg.setPointerCapture(e.pointerId);
  }

  function onMove(e) {
    if (!drag) return;
    if (drag.type === "marq") {
      var a = clientToLocal(drag.sx, drag.sy), b = clientToLocal(e.clientX, e.clientY);
      drag.rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
      drawMarquee(drag.rect);
      return;
    }
    if (drag.type === "term") {
      var l = clientToLocal(e.clientX, e.clientY);
      var drx = (l.x - drag.start.x) / baseW, dry = (l.y - drag.start.y) / baseH;
      drag.tids.forEach(function (id) {
        var t = WE.model.getTerminal(cmp, id), o = drag.origs[id]; if (!t || !o) return;
        t.rx = Math.max(0, Math.min(1, o.rx + drx));
        t.ry = Math.max(0, Math.min(1, o.ry + dry));
      });
      // 단자 1개 드래그 시 다른 단자와 정렬되면 스냅 + 점선 가이드
      if (drag.tids.length === 1) applySnap(WE.model.getTerminal(cmp, drag.tids[0]));
      else removeGuides();
      renderTerminals(); buildList();
      return;
    }
    if (drag.type === "pending") {
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > DRAG_THRESH) {
        drag.type = "pan"; svg.classList.add("panning");
      } else return;
    }
    if (drag.type === "pan") {
      panX = drag.panX0 + (e.clientX - drag.sx);
      panY = drag.panY0 + (e.clientY - drag.sy);
      applyTransform();
    }
  }

  function onUp(e) {
    if (!drag) return;
    if (drag.type === "marq") {
      removeMarquee();
      if (drag.rect && (drag.rect.w > 2 || drag.rect.h > 2)) {
        var sel = [];
        cmp.terminals.forEach(function (t) {
          var x = t.rx * baseW, y = t.ry * baseH;
          if (x >= drag.rect.x && x <= drag.rect.x + drag.rect.w && y >= drag.rect.y && y <= drag.rect.y + drag.rect.h) sel.push(t.id);
        });
        selTids = sel; selTid = sel[sel.length - 1] || null;
      } else { selTids = []; selTid = null; }   // 작은 클릭 → 선택 해제
      renderTerminals(); buildList(); updateAlignVis();
    } else if (drag.type === "pending" && drag.canAdd) {
      // 배치 모드 순수 클릭 → 단자 추가
      var l = clientToLocal(e.clientX, e.clientY);
      if (l.x >= 0 && l.x <= baseW && l.y >= 0 && l.y <= baseH) {
        var t = WE.model.addTerminal(cmp, l.x / baseW, l.y / baseH, placePreset());
        applySnap(t); removeGuides();   // 추가 위치도 정렬되면 스냅
        setSingleSel(t.id);
        renderTerminals(); buildList(); updateAlignVis(); teCommit();
      }
    } else if (drag.type === "term") {
      removeGuides();
      teCommit();   // 단자 드래그 이동 확정
    }
    removeGuides();
    svg.classList.remove("panning");
    try { svg.releasePointerCapture(e.pointerId); } catch (err) {}
    drag = null;
  }

  function onKey(e) {
    if (!opened) return;
    var k = e.key.toLowerCase();
    var inInput = (document.activeElement && document.activeElement.tagName === "INPUT" && document.activeElement.type === "text");
    if ((e.ctrlKey || e.metaKey) && k === "z" && !inInput) { e.preventDefault(); if (e.shiftKey) teDoRedo(); else teDoUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === "y" && !inInput) { e.preventDefault(); teDoRedo(); return; }
    if (e.key === "Delete" || e.key === "Backspace") {
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "SELECT") return;
      if (selTids.length) {
        selTids.forEach(function (id) { WE.model.removeTerminal(cmp, id); });
        selTids = []; selTid = null;
        renderTerminals(); buildList(); updateAlignVis(); teCommit();
        e.preventDefault();
      }
    } else if (e.key === "Escape") {
      close();
    }
  }

  // ---- 배치 프리셋 ----
  function fillPlacePreset() {
    var sel = document.getElementById("tePlacePreset");
    var prev = sel.value;
    sel.innerHTML = "";
    var gen = document.createElement("option");
    gen.value = ""; gen.textContent = "(기본 T#)";
    sel.appendChild(gen);
    WE.presets.getAll().forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.id; o.textContent = p.label;
      sel.appendChild(o);
    });
    sel.value = prev;
  }
  function placePreset() {
    var sel = document.getElementById("tePlacePreset");
    if (!sel.value) return null;
    var p = WE.presets.get(sel.value);
    return p ? { name: p.label, color: p.color } : null;
  }

  // ---- 사이드 목록 ----
  function buildList() {
    var list = document.getElementById("teList");
    list.innerHTML = "";
    if (cmp.terminals.length === 0) {
      var p = document.createElement("p");
      p.className = "muted"; p.textContent = "단자 없음. 이미지를 클릭해 추가하세요.";
      list.appendChild(p); return;
    }
    cmp.terminals.forEach(function (t) {
      var row = document.createElement("div");
      row.className = "term-row" + (isSel(t.id) ? " sel" : "");
      row.dataset.tid = t.id;

      var color = document.createElement("input");
      color.className = "tcolor"; color.type = "color"; color.value = t.color || WE.model.DEFAULT_TERMINAL_COLOR;

      var name = document.createElement("input");
      name.className = "tname"; name.type = "text"; name.value = t.name;

      var sel = document.createElement("select");
      sel.className = "tpreset";
      var head = document.createElement("option");
      head.value = ""; head.textContent = "프리셋…";
      sel.appendChild(head);
      WE.presets.getAll().forEach(function (ps) {
        var o = document.createElement("option");
        o.value = ps.id; o.textContent = ps.label;
        sel.appendChild(o);
      });

      var del = document.createElement("button");
      del.className = "tdel"; del.textContent = "×"; del.title = "삭제";

      row.appendChild(color); row.appendChild(name); row.appendChild(sel); row.appendChild(del);
      list.appendChild(row);
    });
  }

  function onListInput(e) {
    var row = e.target.closest(".term-row"); if (!row) return;
    var t = WE.model.getTerminal(cmp, row.dataset.tid); if (!t) return;
    if (e.target.classList.contains("tname")) { t.name = e.target.value; renderTerminals(); }
    else if (e.target.classList.contains("tcolor")) { t.color = e.target.value; renderTerminals(); }
  }
  function onListChange(e) {
    if (e.target.classList.contains("tpreset")) {
      var row = e.target.closest(".term-row");
      var t = WE.model.getTerminal(cmp, row.dataset.tid);
      var p = WE.presets.get(e.target.value);
      if (t && p) { t.name = p.label; t.color = p.color; renderTerminals(); buildList(); }
      e.target.value = "";
      teCommit();
    } else if (e.target.classList.contains("tname") || e.target.classList.contains("tcolor")) {
      teCommit();   // 이름·색 편집 확정(blur) 시 한 단계
    }
  }
  function onListClick(e) {
    var row = e.target.closest(".term-row"); if (!row) return;
    if (e.target.classList.contains("tdel")) {
      var did = row.dataset.tid;
      WE.model.removeTerminal(cmp, did);
      var si = selTids.indexOf(did); if (si >= 0) selTids.splice(si, 1);
      if (selTid === did) selTid = selTids[selTids.length - 1] || null;
      renderTerminals(); buildList(); updateAlignVis(); teCommit();
    } else if (!e.target.matches("input,select,button")) {
      if (e.ctrlKey || e.metaKey) toggleSel(row.dataset.tid);
      else setSingleSel(row.dataset.tid);
      renderTerminals(); buildList(); updateAlignVis();
    }
  }

  function close() {
    modal.hidden = true;
    opened = false;
    if (WE.app.afterTerminalEdit) WE.app.afterTerminalEdit(cmp);
    WE.render.renderAll();
    WE.app.refreshProps();
  }

  // 프리셋이 바뀌면 (관리 모달에서) 드롭다운/목록 갱신
  function refreshPresets() {
    if (!opened) return;
    fillPlacePreset();
    buildList();
  }

  return { open: open, refreshPresets: refreshPresets, isOpen: function () { return opened; } };
})();

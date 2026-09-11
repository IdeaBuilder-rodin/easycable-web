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
  var ghostG = null;      // 배치 모드 호버 미리보기(고스트 단자)
  var SNAP_PX = 6;        // 스냅 임계(화면 px)
  var termQuery = "";     // 우측 단자 목록 검색어
  var termFilter = "all"; // all | visible | hidden
  var listAnchorTid = null; // Shift+클릭 연속 선택의 기준
  var hoverTid = null;      // 목록과 캔버스 위치를 연결하는 호버 강조
  var listDrag = null;      // 우측 목록 사각 드래그 선택
  var suppressListClick = false;
  var placementIndex = -1;  // 빠른 배치에서 현재 선택한 프리셋 순번
  var placementComplete = false;
  var placementRepeat = false;
  var placementDragId = null;
  var middleClickAt = 0, middleClickX = 0, middleClickY = 0;
  // 지역 undo(모달 열려 있으면 전역 히스토리가 커밋 안 되므로 별도 스택)
  var teUndo = [], teRedo = [], teLast = "";
  var openedDefinition = ""; // 공용 부품을 실제로 고쳤는지 닫을 때 판정

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
    var a = document.getElementById("teAlign");
    if (a) {
      a.hidden = false;
      a.querySelectorAll("button,input").forEach(function (control) { control.disabled = false; });
    }
    var ls = document.getElementById("teLabelSide");
    if (ls) {
      ls.hidden = false;
      ls.querySelectorAll("button").forEach(function (control) { control.disabled = false; });
    }
    var bulk = document.querySelector(".te-terminal-selection-actions"); if (bulk) bulk.hidden = selTids.length < 1;
    var bulkCount = document.getElementById("teBulkCount");
    if (bulkCount) bulkCount.textContent = selTids.length ? selTids.length + WE.i18n.t("개 선택") : "";
    var on = document.getElementById("teShowSelected"), off = document.getElementById("teHideSelected");
    if (on) on.disabled = selTids.length < 1;
    if (off) off.disabled = selTids.length < 1;
  }
  function selectedTerms() {
    return selTids.map(function (id) { return WE.model.getTerminal(cmp, id); }).filter(Boolean);
  }
  // 선택된 단자(1개 또는 여러 개)의 도면 라벨 방향을 한 번에 강제 지정/해제
  function setLabelSide(side) {
    var ts = selectedTerms(); if (!ts.length) return;
    ts.forEach(function (t) {
      if (side === "auto") delete t.labelSide; else t.labelSide = side;
      delete t.labelPos;   // 이전에 드래그로 옮긴 위치가 있으면 방향 지정이 묻히므로 초기화
    });
    renderTerminals(); teCommit();
  }
  function alignTerms(mode) {
    var ts = selectedTerms(); if (ts.length < 2) return;
    function avg(k) { return ts.reduce(function (s, t) { return s + t[k]; }, 0) / ts.length; }
    // 균등 배치는 '지금 놓인 처음과 끝' 사이를 고르게 나눈다. 그 결과로 생긴 간격을 픽셀로 돌려준다 —
    // 임의로 찍어 둔 단자를 균등하게 편 다음 '지금 몇 px 인가'를 알아야, 15.4 → 15 처럼 깔끔한 값으로
    // 다시 맞출 수 있다. 그 값을 알 길이 없으면 균등 배치가 한 번 쓰고 마는 기능이 된다.
    function distrib(k, size) {
      if (ts.length < 3) return null;
      var s = ts.slice().sort(function (a, b) { return a[k] - b[k]; });
      var first = s[0][k], step = (s[s.length - 1][k] - first) / (s.length - 1);
      s.forEach(function (t, i) { t[k] = first + step * i; });
      return size ? step * size : null;   // 비율 → 부품 이미지 픽셀
    }
    // 정렬 간격(px). 단자 좌표는 비율(0~1)로 저장하지만, 입력은 부품 이미지의 픽셀로 받는다 —
    // 사진을 보며 잰 실제 단자 간격을 그대로 넣을 수 있어야 쓸모가 있다.
    var gapEl = document.getElementById("teGap");
    var gapPx = gapEl ? parseFloat(gapEl.value) : 0;
    if (isNaN(gapPx) || gapPx < 0) gapPx = 0;
    // 한 줄로 모은 뒤 그 줄을 따라 일정 간격으로 벌린다. 간격 0이면 모으기만 한다(예전 동작).
    // 순서는 지금 놓인 순서를 그대로 지킨다 — 사용자가 잡아 둔 위아래 배치가 뒤집히면 곤란하다.
    function spread(k, size) {
      if (gapPx <= 0 || !size) return;
      var step = gapPx / size;
      var s = ts.slice().sort(function (a, b) { return a[k] - b[k]; });
      var first = s[0][k];
      s.forEach(function (t, i) { t[k] = Math.max(0, Math.min(1, first + step * i)); });
    }
    // 균등 배치로 생긴 간격을 간격 칸에 적어 준다. 이러면 그 값을 보고 다듬어
    // 곧바로 '정렬'로 깔끔한 간격에 다시 맞출 수 있다.
    function showGap(px) {
      if (!(px > 0) || !gapEl) return;
      var v = Math.round(px * 10) / 10;
      gapEl.value = String(v);
      if (WE.app && WE.app.setHint) {
        WE.app.setHint(WE.i18n.t("지금 간격 ") + v + WE.i18n.t("px"),
          WE.i18n.t("균등 배치로 만들어진 간격입니다. 값을 다듬어 '정렬'을 누르면 그 간격으로 다시 맞춥니다."));
      }
    }
    if (mode === "x") { var ax = avg("rx"); ts.forEach(function (t) { t.rx = ax; }); spread("ry", baseH); }
    else if (mode === "y") { var ay = avg("ry"); ts.forEach(function (t) { t.ry = ay; }); spread("rx", baseW); }
    else if (mode === "distX") showGap(distrib("rx", baseW));
    else if (mode === "distY") showGap(distrib("ry", baseH));
    renderTerminals(); buildList(); teCommit();
  }

  // 편집기를 여는 순간의 배선 모양 (닫을 때 단자 이동만큼 따라오게 하는 데 쓴다)
  var _배선따라오기 = null;

  // ---- 지역 undo/redo ----
  function teSnap() {
    // 부품 명칭 위치(nameLabelPos)는 여기서 빠져 있다 — 이 편집기가 그 값을 바꾸지 않기 때문이다.
    // 넣어 두면 되돌리기가 **작업창에서 옮긴 위치까지 되돌려 버린다.**
    return JSON.stringify({ terminals: cmp.terminals });
  }
  function definitionSnap() {
    return JSON.stringify({
      terminals: cmp.terminals || [],
      terminalPlacementQueue: cmp.terminalPlacementQueue || [],
      terminalPlacementQueueVersion: cmp.terminalPlacementQueueVersion
    });
  }
  function teResetHistory() { teUndo = []; teRedo = []; teLast = teSnap(); }
  function teCommit() {
    var s = teSnap();
    if (s !== teLast) { teUndo.push(teLast); if (teUndo.length > 100) teUndo.shift(); teLast = s; teRedo = []; }
  }
  function teApply(json) {
    var state = JSON.parse(json);
    cmp.terminals = state.terminals;
    selTids = selTids.filter(function (id) { return WE.model.getTerminal(cmp, id); });
    selTid = selTids[selTids.length - 1] || null;
    renderTerminals(); buildList(); updateAlignVis();
  }
  function teDoUndo() { if (!teUndo.length) return; teRedo.push(teLast); var j = teUndo.pop(); teLast = j; teApply(j); }
  function teDoRedo() { if (!teRedo.length) return; teUndo.push(teLast); var j = teRedo.pop(); teLast = j; teApply(j); }

  // ---- 모드 ----
  function setTeMode(m) {
    teMode = m;
    if (m !== "place") removeGhost();
    document.getElementById("teModePlace").classList.toggle("active", m === "place");
    document.getElementById("teModeSelect").classList.toggle("active", m === "select");
    if (svg) svg.style.cursor = (m === "select") ? "crosshair" : "";
    renderPlacementPanel();
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
  // 좌표(px)가 다른 단자의 x/y와 tol 이내면 스냅될 rx/ry를 반환 (없으면 null)
  function snapXY(x, y, excludeId) {
    var tol = SNAP_PX / zoom;
    var bestX = null, bxd = tol, bestY = null, byd = tol;
    cmp.terminals.forEach(function (o) {
      if (o.id === excludeId) return;
      var dx = Math.abs(o.rx * baseW - x); if (dx < bxd) { bxd = dx; bestX = o.rx; }
      var dy = Math.abs(o.ry * baseH - y); if (dy < byd) { byd = dy; bestY = o.ry; }
    });
    return { rx: bestX, ry: bestY };
  }
  function applySnap(t) {
    var s = snapXY(t.rx * baseW, t.ry * baseH, t.id);
    var gx = null, gy = null;
    if (s.rx !== null) { t.rx = s.rx; gx = s.rx * baseW; }
    if (s.ry !== null) { t.ry = s.ry; gy = s.ry * baseH; }
    drawGuides(gx, gy);
  }
  function drawGuides(gx, gy) {
    if (!guidesG) { guidesG = el("g", { "class": "te-guides" }); content.appendChild(guidesG); }
    guidesG.innerHTML = "";
    if (gx !== null) guidesG.appendChild(el("line", { x1: gx, y1: 0, x2: gx, y2: baseH, "class": "te-guide", "stroke-width": 1 / zoom }));
    if (gy !== null) guidesG.appendChild(el("line", { x1: 0, y1: gy, x2: baseW, y2: gy, "class": "te-guide", "stroke-width": 1 / zoom }));
  }
  function removeGuides() { if (guidesG && guidesG.parentNode) guidesG.parentNode.removeChild(guidesG); guidesG = null; }

  // ---- 배치 모드 호버 미리보기 ----
  // 커서 위치에 반투명 고스트 단자를 띄우고, 다른 단자와 정렬되면 스냅 위치 + 점선 가이드 표시
  function updateGhost(e) {
    if (placementComplete) { removeGhost(); return; }
    // 기존 단자 위 = 클릭해도 추가가 아니라 선택/드래그이므로 미리보기 없음
    if (e.target.closest && e.target.closest("[data-tid]")) { removeGhost(); return; }
    var l = clientToLocal(e.clientX, e.clientY);
    if (l.x < 0 || l.x > baseW || l.y < 0 || l.y > baseH) { removeGhost(); return; }
    var s = snapXY(l.x, l.y, null);
    var x = s.rx !== null ? s.rx * baseW : l.x;
    var y = s.ry !== null ? s.ry * baseH : l.y;
    drawGuides(s.rx !== null ? x : null, s.ry !== null ? y : null);
    if (!ghostG) { ghostG = el("g", { "pointer-events": "none" }); content.appendChild(ghostG); }
    ghostG.innerHTML = "";
    var p = placePreset();
    var color = (p && p.color) || WE.model.DEFAULT_TERMINAL_COLOR;
    ghostG.appendChild(el("circle", {
      cx: x, cy: y, r: 7 / zoom, fill: color, "fill-opacity": 0.5,
      stroke: "#fff", "stroke-width": 2 / zoom, "stroke-opacity": 0.7
    }));
  }
  function removeGhost() {
    if (ghostG && ghostG.parentNode) ghostG.parentNode.removeChild(ghostG);
    ghostG = null;
    removeGuides();
  }

  function open(component) {
    cmp = component;
    /* 지금 배선이 어떤 모양인지 찍어 둔다 — 닫을 때 단자가 움직인 만큼 따라오게 한다.
       ⚠ 이게 없으면 단자를 옮겨도 꺾임점·분기 접점은 제자리에 남아,
          배선이 옛 자리까지 내려갔다 되돌아오는 경로가 된다(2026-09-08 고원빈 신고). */
    _배선따라오기 = (WE.interactions && WE.interactions.termFollowBegin)
      ? WE.interactions.termFollowBegin([cmp.id]) : null;
    selTid = null; selTids = []; listAnchorTid = null; hoverTid = null;
    middleClickAt = 0;
    ensurePlacementQueue();
    openedDefinition = definitionSnap();
    ensureDom();
    termQuery = ""; termFilter = "all";
    document.getElementById("teTermSearch").value = "";
    document.getElementById("teTermFilter").value = "all";
    // 부품 크기를 절대 건드리지 않음 — 캔버스·모달 모두 이미지를 박스에 꽉 채워(stretch)
    // 그리므로 박스 비율이 어떻든 단자 좌표가 동일하게 보임 (예전 fitBoxToImage가
    // 모달 열 때마다 height를 이미지 비율로 덮어써서 부품 비율이 멋대로 바뀌던 버그 제거)
    baseW = cmp.width; baseH = cmp.height;
    buildStatic();
    fillPlacePreset(true);
    setTeMode("place");
    setSidePanel("layout");
    teResetHistory();
    modal.hidden = false;
    opened = true;
    // 레이아웃 확정 후 맞춤
    requestAnimationFrame(function () { fit(); buildList(); updateAlignVis(); });
  }

  function ensureDom() {
    if (bound) return;
    modal = document.getElementById("termModal");
    svg = document.getElementById("teSvg");
    content = document.getElementById("teContent");
    viewport = document.getElementById("teViewport");

    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("dblclick", onDoubleClick);
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
    list.addEventListener("change", onListChange);
    list.addEventListener("click", onListClick);
    list.addEventListener("pointerdown", onListDragDown);
    list.addEventListener("pointermove", onListDragMove);
    list.addEventListener("pointerup", onListDragEnd);
    list.addEventListener("pointercancel", onListDragEnd);
    list.addEventListener("pointerover", onListHover);
    list.addEventListener("pointerout", onListHoverOut);

    document.getElementById("teAlign").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-talign]");
      if (b) alignTerms(b.dataset.talign);
    });
    document.getElementById("teLabelSide").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-tside]");
      if (b) setLabelSide(b.dataset.tside);
    });
    document.getElementById("teModePlace").addEventListener("click", function () { setTeMode("place"); });
    document.getElementById("teModeSelect").addEventListener("click", function () { setTeMode("select"); });
    document.getElementById("tePlacePreset").addEventListener("change", function () {
      selectPlacePreset(this.value);
    });
    document.getElementById("tePlacementQueue").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-queue-id]"); if (!b) return;
      selectPlacePreset(b.dataset.queueId);
      setTeMode("place");
    });
    document.getElementById("tePlacementQueue").addEventListener("dragstart", function (e) {
      var b = e.target.closest("button[data-queue-id]"); if (!b || !b.dataset.queueId) return;
      placementDragId = b.dataset.queueId;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/x-easycable-queue", placementDragId);
      b.classList.add("dragging");
    });
    document.getElementById("tePlacementQueue").addEventListener("dragover", function (e) {
      if (e.dataTransfer.types.indexOf("text/x-easycable-queue") < 0) return;
      var id = placementDragId;
      var list = placementItems();
      var source = list.filter(function (p) { return p.id === id; })[0];
      var target = e.target.closest("button[data-queue-id]");
      var targetItem = target && list.filter(function (p) { return p.id === target.dataset.queueId; })[0];
      document.querySelectorAll(".te-placement-chip.drop-before,.te-placement-chip.drop-after").forEach(function (el) { el.classList.remove("drop-before", "drop-after"); });
      if (!source || (targetItem && source.source !== targetItem.source)) { e.dataTransfer.dropEffect = "none"; return; }
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      if (target && target.dataset.queueId !== id) {
        var after = e.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
        target.classList.add(after ? "drop-after" : "drop-before");
      }
    });
    document.getElementById("tePlacementQueue").addEventListener("drop", function (e) {
      var id = e.dataTransfer.getData("text/x-easycable-queue"); if (!id) return;
      var list = placementItems();
      var source = list.filter(function (p) { return p.id === id; })[0];
      var target = e.target.closest("button[data-queue-id]");
      var targetItem = target && list.filter(function (p) { return p.id === target.dataset.queueId; })[0];
      if (!source || (targetItem && source.source !== targetItem.source)) return;
      e.preventDefault();
      var beforeId = target ? target.dataset.queueId : null;
      if (target && e.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2) {
        var next = target.nextElementSibling; beforeId = next && next.dataset.queueId || null;
      }
      reorderPlacementItem(id, beforeId);
    });
    document.getElementById("tePlacementQueue").addEventListener("dragend", function () {
      placementDragId = null;
      document.querySelectorAll(".te-placement-chip.dragging,.te-placement-chip.drop-before,.te-placement-chip.drop-after").forEach(function (el) {
        el.classList.remove("dragging", "drop-before", "drop-after");
      });
    });
    document.getElementById("tePlacePrev").addEventListener("click", function () {
      var list = placementItems(); if (!list.length) return;
      var prev = placementComplete ? list.length - 1 : Math.max(0, placementIndex - 1);
      selectPlacePreset(list[prev].id);
    });
    document.getElementById("tePlaceSkip").addEventListener("click", function () { advancePlacePreset(true); });
    document.getElementById("tePlaceRepeat").addEventListener("click", function () {
      if (placementComplete || placementIndex < 0) return;
      placementRepeat = !placementRepeat;
      renderPlacementPanel();
    });
    document.getElementById("tePanelLayout").addEventListener("click", function () { setSidePanel("layout"); });
    document.getElementById("tePanelManager").addEventListener("click", function () { setSidePanel("manager"); });
    document.getElementById("teTermSearch").addEventListener("input", function () {
      termQuery = this.value.trim().toUpperCase(); buildList();
    });
    document.getElementById("teTermFilter").addEventListener("change", function () {
      termFilter = this.value; buildList();
    });
    document.getElementById("teShowAll").addEventListener("click", function () { setTermsVisible(cmp.terminals, true); });
    document.getElementById("teHideAll").addEventListener("click", function () { setTermsVisible(cmp.terminals, false); });
    document.getElementById("teShowSelected").addEventListener("click", function () { setTermsVisible(selectedTerms(), true); });
    document.getElementById("teHideSelected").addEventListener("click", function () { setTermsVisible(selectedTerms(), false); });
    bound = true;
  }

  function setSidePanel(panel) {
    var body = document.querySelector("#termModal .te-body"); if (body) body.dataset.panel = panel;
    ["Layout", "Manager"].forEach(function (name) {
      var b = document.getElementById("tePanel" + name), active = name.toLowerCase() === panel;
      if (b) { b.classList.toggle("active", active); b.setAttribute("aria-selected", active ? "true" : "false"); }
    });
  }
  // 이미지/테두리/단자 그룹 뼈대
  function buildStatic() {
    content.innerHTML = "";
    if (cmp.image) {
      var img = el("image", { x: 0, y: 0, width: baseW, height: baseH, preserveAspectRatio: "none" });   // 캔버스와 같은 stretch 방식
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

  // 배선도 캔버스(render.js)와 동일한 충돌회피 라벨 배치(geometry.layoutTermLabels)를 공유해서
  // 두 화면이 항상 같은 결과를 보여줌(핀 촘촘한 부품에서 글자가 겹쳐 뭉개지는 문제 해결)
  function renderTerminals() {
    if (!termsG) return;
    termsG.innerHTML = "";
    var r = 7 / zoom, hit = 13 / zoom, fs = 13 / zoom;
    // ⚠ 캔버스(geometry 기본값)와 **같은 값**이어야 두 화면이 같은 결과를 낸다
    var offset = 10 / zoom, gapLR = 13 / zoom, gapTB = 26 / zoom;
    var box = { x: 0, y: 0, x2: baseW, y2: baseH };
    function dotOf(t) { return { x: t.rx * baseW, y: t.ry * baseH }; }

    var autoTerms = [], laid = [];
    cmp.terminals.forEach(function (t) {
      if (t.labelPos) {
        var dot = dotOf(t);
        laid.push({ t: t, dot: dot, lx: t.labelPos.x, ly: t.labelPos.y, anchor: t.labelPos.x < dot.x ? "end" : "start" });
      } else autoTerms.push(t);
    });
    laid = laid.concat(WE.geometry.layoutTermLabels(autoTerms, baseW, baseH, box, dotOf,
      { offset: offset, minGapLR: gapLR, minGapTB: gapTB, charW: 7.5 / zoom, minGapV: 14 / zoom,
        sideOf: function (t) { return WE.geometry.termSideOf(cmp.terminals, baseW, baseH, t); } }));

    laid.forEach(function (o) {
      var t = o.t, dot = o.dot, color = t.color || WE.model.DEFAULT_TERMINAL_COLOR;
      var g = el("g", { "class": t.visible === false ? "te-term-off" : "" });
      g.appendChild(el("circle", {
        cx: dot.x, cy: dot.y, r: hit, fill: "#000", "fill-opacity": 0,
        "data-tid": t.id, style: "pointer-events:all;cursor:pointer"
      }));
      if (isSel(t.id)) {
        g.appendChild(el("circle", { cx: dot.x, cy: dot.y, r: r + 3 / zoom, fill: "none", stroke: "#1e88e5", "stroke-width": 2 / zoom, "pointer-events": "none" }));
      } else if (hoverTid === t.id) {
        g.appendChild(el("circle", { cx: dot.x, cy: dot.y, r: r + 3 / zoom, fill: "none", stroke: "#6f9bd3", "stroke-width": 2 / zoom, "stroke-dasharray": (3 / zoom) + " " + (2 / zoom), "pointer-events": "none" }));
      }
      g.appendChild(el("circle", { cx: dot.x, cy: dot.y, r: r, fill: color, stroke: "#fff", "stroke-width": 2 / zoom, "pointer-events": "none" }));
      g.appendChild(el("line", {
        x1: dot.x, y1: dot.y, x2: o.lx, y2: o.ly,
        stroke: color, "stroke-width": 1 / zoom, "stroke-opacity": 0.6, "pointer-events": "none"
      }));
      var txAttrs = {
        "text-anchor": o.anchor, "dominant-baseline": "middle", "data-te-tlabel": t.id,
        style: "font:" + fs + "px 'Malgun Gothic',sans-serif;fill:#222;paint-order:stroke;stroke:#fff;stroke-width:" + (3 / zoom) + "px;user-select:none;cursor:move"
      };
      if (o.vertical) {   // 촘촘한 핀헤더: 캔버스와 동일하게 90° 세로쓰기
        txAttrs.transform = "translate(" + o.lx + "," + o.ly + ") rotate(-90)";
        txAttrs.x = 0; txAttrs.y = 0;
      } else {
        txAttrs.x = o.lx + (o.anchor === "end" ? -2 / zoom : (o.anchor === "start" ? 2 / zoom : 0));
        txAttrs.y = o.ly;
      }
      var tx = el("text", txAttrs);
      tx.textContent = t.name;
      g.appendChild(tx);
      termsG.appendChild(g);
    });
    // 부품 명칭은 단자 편집기에서 **그리지 않는다.**
    // 이미지 아래에 늘 떠 있어 단자 작업을 방해했고, 명칭 위치를 옮기는 일은
    // 스냅·정렬선·Alt+클릭 초기화가 있는 **작업창 쪽이 낫다**(고원빈, 2026-08-30).
    // ⚠ cmp.nameLabelPos 데이터 자체는 건드리지 않는다 — 작업창에서 옮겨 둔 위치가 살아 있어야 한다.
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
    removeGhost();   // 드래그(팬/이동/마퀴) 시작 시 미리보기 숨김
    // 가운데 버튼 드래그는 팬, 같은 위치에서 빠르게 두 번 누르면 이미지 맞춤.
    if (e.button === 1) {
      var now = Date.now();
      var isDouble = now - middleClickAt <= 350 &&
        Math.abs(e.clientX - middleClickX) <= 8 && Math.abs(e.clientY - middleClickY) <= 8;
      middleClickAt = isDouble ? 0 : now;
      middleClickX = e.clientX; middleClickY = e.clientY;
      if (isDouble) {
        drag = null; svg.classList.remove("panning"); fit();
        e.preventDefault();
        return;
      }
      drag = { type: "pan", sx: e.clientX, sy: e.clientY, panX0: panX, panY0: panY };
      svg.classList.add("panning");
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    var termLabelEl = e.target.closest("[data-te-tlabel]");
    if (termLabelEl) {
      var labelTid = termLabelEl.getAttribute("data-te-tlabel");
      setSingleSel(labelTid);
      renderTerminals(); buildList(); updateAlignVis();
      drag = { type: "termLabel", tid: labelTid };
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
    if (!drag) {
      // 배치 모드: 커서를 따라 고스트 단자 + 정렬 가이드 미리보기
      if (opened && teMode === "place" && svg && e.target && svg.contains(e.target)) updateGhost(e);
      else removeGhost();
      return;
    }
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
    if (drag.type === "termLabel") {
      var tl = WE.model.getTerminal(cmp, drag.tid); if (!tl) return;
      var tlp = clientToLocal(e.clientX, e.clientY);
      tl.labelPos = { x: tlp.x, y: tlp.y };
      renderTerminals();
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
      if (!placementComplete && l.x >= 0 && l.x <= baseW && l.y >= 0 && l.y <= baseH) {
        var t = WE.model.addTerminal(cmp, l.x / baseW, l.y / baseH, placePreset());
        applySnap(t); removeGuides();   // 추가 위치도 정렬되면 스냅
        setSingleSel(t.id);
        advancePlacePreset(false);
        renderTerminals(); buildList(); updateAlignVis(); teCommit();
      }
    } else if (drag.type === "term" || drag.type === "termLabel" || drag.type === "nameLabel") {
      removeGuides();
      teCommit();
    }
    removeGuides();
    svg.classList.remove("panning");
    try { svg.releasePointerCapture(e.pointerId); } catch (err) {}
    drag = null;
  }

  function onDoubleClick(e) {
    var termLabelEl = e.target.closest("[data-te-tlabel]");
    if (!termLabelEl) return;
    var t = WE.model.getTerminal(cmp, termLabelEl.getAttribute("data-te-tlabel"));
    if (!t) return;
    delete t.labelPos;
    renderTerminals();
    teCommit();
    e.preventDefault();
  }

  function onKey(e) {
    if (!opened) return;
    var k = e.key.toLowerCase();
    var active = document.activeElement;
    var tag = active && active.tagName || "";
    var inInput = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || !!(active && active.isContentEditable);
    // ⚠ 프리셋 모달은 이 편집기가 실리는 화면에 없을 수도 있다(관리자 페이지가 그렇다).
    //    예전엔 없으면 여기서 TypeError 가 나 **키 처리 전체가 죽었다** —
    //    Delete 로 단자를 못 지우고 V/W·Ctrl+Z 도 통째로 먹통이 됐다(2026-08-30).
    var presetEl = document.getElementById("presetModal");
    var presetOpen = !!presetEl && !presetEl.hidden;
    if (!presetOpen && !inInput && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (k === "v") { e.preventDefault(); setTeMode("select"); return; }
      if (k === "w") { e.preventDefault(); setTeMode("place"); return; }
    }
    if ((e.ctrlKey || e.metaKey) && k === "z" && !inInput) { e.preventDefault(); if (e.shiftKey) teDoRedo(); else teDoUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === "y" && !inInput) { e.preventDefault(); teDoRedo(); return; }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (tag === "INPUT" || tag === "SELECT") return;
      if (selTids.length) {
        selTids.forEach(function (id) { WE.model.removeTerminal(cmp, id); });
        selTids = []; selTid = null;
        renderTerminals(); buildList(); updateAlignVis(); teCommit();
        e.preventDefault();
      }
    } else if (e.key === "Escape") {
      // Esc 는 "맨 위에 뜬 것 한 겹"만 닫는다. 위에 프리셋 관리 창(또는 그 위의 색상 팝오버)이
      // 떠 있으면 그쪽이 먼저 가져간다 — 여기까지 왔더라도 뒤에 있는 이 창을 닫으면 안 된다.
      // 바로 위 v/w 단축키가 쓰는 presetOpen 과 같은 가드다. Escape 만 이게 빠져 있었다.
      if (presetOpen) return;
      close();
    }
  }

  // ---- 배치 프리셋 ----
  var PLACEMENT_QUEUE_VERSION = 3;
  function reconcilePlacementQueue(queue) {
    if (!cmp) return queue;
    var oldVersion = Number(cmp.terminalPlacementQueueVersion || 0);
    var terminals = (cmp.terminals || []).slice();
    if (!terminals.length) {
      cmp.terminalPlacementQueueVersion = PLACEMENT_QUEUE_VERSION;
      return queue;
    }

    // Version 1 could contain unrelated global presets. Discard those once,
    // then rebuild from the real terminals. Version 2+ may contain planned,
    // not-yet-placed part terminals, so unmatched queue items are preserved.
    var sourceQueue = oldVersion < 2 ? [] : queue.slice();
    var unmatched = terminals.slice();
    var rebuilt = [];

    function takeTerminal(item) {
      var index = unmatched.findIndex(function (terminal) {
        return (item.terminalId && terminal.id === item.terminalId) ||
          (terminal.presetSource === "part" && terminal.presetId === item.id);
      });
      if (index < 0) index = unmatched.findIndex(function (terminal) {
        return terminal.name === item.label &&
          (terminal.color || WE.model.DEFAULT_TERMINAL_COLOR) === (item.color || WE.model.DEFAULT_TERMINAL_COLOR);
      });
      if (index < 0) index = unmatched.findIndex(function (terminal) { return terminal.name === item.label; });
      return index < 0 ? null : unmatched.splice(index, 1)[0];
    }

    sourceQueue.forEach(function (item) {
      var terminal = takeTerminal(item);
      if (terminal) {
        item.terminalId = terminal.id;
        terminal.name = String(item.label);
        terminal.color = item.color || WE.model.DEFAULT_TERMINAL_COLOR;
        terminal.presetSource = "part";
        terminal.presetId = item.id;
      }
      rebuilt.push(item);
    });

    unmatched.forEach(function (terminal) {
      var item = {
        id: WE.model.nextId("pq"),
        label: String(terminal.name == null ? WE.i18n.t("새 단자") : terminal.name),
        color: terminal.color || WE.model.DEFAULT_TERMINAL_COLOR,
        terminalId: terminal.id
      };
      terminal.presetSource = "part";
      terminal.presetId = item.id;
      rebuilt.push(item);
    });

    cmp.terminalPlacementQueue = rebuilt;
    cmp.terminalPlacementQueueVersion = PLACEMENT_QUEUE_VERSION;
    return rebuilt;
  }
  function ensurePlacementQueue() {
    if (!cmp) return [];
    if (!Array.isArray(cmp.terminalPlacementQueue)) cmp.terminalPlacementQueue = [];
    cmp.terminalPlacementQueue.forEach(function (item) {
      if (!item.id) item.id = WE.model.nextId("pq");
      if (!item.color) item.color = WE.model.DEFAULT_TERMINAL_COLOR;
      if (item.label == null) item.label = WE.i18n.t("새 단자");
    });
    cmp.terminalPlacementQueue = reconcilePlacementQueue(cmp.terminalPlacementQueue);
    return cmp.terminalPlacementQueue;
  }
  // 빠른 배치에 세울 프리셋 목록.
  //
  // **부품 단자만 넣는다.** 예전에는 공용 단자(프리셋 관리에 등록한 것)까지 앞에 붙였는데,
  // 공용 단자는 어느 부품에나 해당하는 일반 항목이라 지금 다루는 부품과 상관없는 것이
  // 줄줄이 먼저 나왔다. 빠른 배치는 '이 부품의 단자를 순서대로 찍어 나가는' 도구이므로
  // 이 부품에 등록한 단자만 나오는 게 맞다. (2026-09-02 고원빈 지시)
  //
  // 공용 단자를 없앤 것이 아니다 — 프리셋 관리에서 그대로 쓰고, 이미 그것으로 놓아 둔 단자도
  // 공용 프리셋을 고치면 계속 따라간다(presetmodal → syncPlacedPreset("common", …)).
  // 빠른 배치 패널에만 안 나온다.
  function placementItems() {
    return ensurePlacementQueue().map(function (p) {
      return { id: p.id, label: p.label, color: p.color, terminalId: p.terminalId, source: "part" };
    });
  }
  function queueItemWasPlaced(item, index, list) {
    if (!cmp || !item) return false;
    if (item.source === "part" && item.terminalId && WE.model.getTerminal(cmp, item.terminalId)) return true;
    if (item.source === "part" && cmp.terminals.some(function (t) {
      return t.presetSource === "part" && t.presetId === item.id;
    })) return true;
    var needed = 0;
    for (var i = 0; i <= index; i++) if (list[i].label === item.label && list[i].color === item.color) needed++;
    var placed = cmp.terminals.filter(function (t) { return t.name === item.label && t.color === item.color; }).length;
    return placed >= needed;
  }
  function selectPlacePreset(id) {
    var sel = document.getElementById("tePlacePreset");
    var list = placementItems();
    var idx = list.findIndex(function (p) { return p.id === id; });
    placementIndex = idx;
    placementComplete = false;
    sel.value = idx >= 0 ? id : "";
    removeGhost();
    renderPlacementPanel();
  }
  function advancePlacePreset(force) {
    if (placementRepeat && !force) { renderPlacementPanel(); return; }
    var list = placementItems();
    if (placementIndex < 0 || !list.length) return;
    var next = placementIndex + 1;
    while (next < list.length && queueItemWasPlaced(list[next], next, list)) next++;
    if (next >= list.length) {
      placementComplete = true;
      placementRepeat = false;
      removeGhost();
      renderPlacementPanel();
      return;
    }
    selectPlacePreset(list[next].id);
  }
  function renderPlacementPanel() {
    var current = document.getElementById("tePlacementCurrent");
    var queue = document.getElementById("tePlacementQueue");
    if (!current || !queue) return;
    var list = placementItems();
    var selected = placementIndex >= 0 ? list[placementIndex] : null;
    var placedCount = list.filter(function (p, i) { return queueItemWasPlaced(p, i, list); }).length;
    var status = document.getElementById("tePlacementStatus");
    var prev = document.getElementById("tePlacePrev");
    var skip = document.getElementById("tePlaceSkip");
    var repeat = document.getElementById("tePlaceRepeat");

    current.innerHTML = "";
    current.classList.toggle("complete", placementComplete);
    if (placementComplete) {
      var done = document.createElement("strong"); done.textContent = WE.i18n.t("배치 완료"); current.appendChild(done);
    } else if (selected) {
      var dot = document.createElement("span"); dot.className = "te-preset-dot"; dot.style.backgroundColor = selected.color;
      var label = document.createElement("strong"); label.textContent = selected.label;
      current.appendChild(dot); current.appendChild(label);
    } else {
      var basic = document.createElement("strong"); basic.textContent = WE.i18n.t("기본 단자 (T#)"); current.appendChild(basic);
    }
    if (status) status.textContent = list.length ? placedCount + " / " + list.length + WE.i18n.t(" 배치됨") : WE.i18n.t("프리셋 없음");
    if (prev) prev.disabled = !list.length || (!placementComplete && placementIndex <= 0);
    if (skip) skip.disabled = placementComplete || placementIndex < 0;
    if (repeat) {
      repeat.disabled = placementComplete || placementIndex < 0;
      repeat.setAttribute("aria-pressed", placementRepeat ? "true" : "false");
    }

    queue.innerHTML = "";
    list.forEach(function (p, i) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "te-placement-chip";
      if (!placementComplete && i === placementIndex) b.classList.add("current");
      if (queueItemWasPlaced(p, i, list)) b.classList.add("placed");
      b.dataset.queueId = p.id; b.dataset.queueSource = p.source;
      b.title = (p.source === "common" ? WE.i18n.t("공용 단자") : WE.i18n.t("부품 단자")) + ": " + p.label;
      b.draggable = true; b.classList.add(p.source === "common" ? "common" : "part");
      var handle = document.createElement("span"); handle.className = "te-queue-drag-handle"; handle.textContent = "⋮";
      var d = document.createElement("span"); d.className = "te-preset-dot"; d.style.backgroundColor = p.color;
      var n = document.createElement("span"); n.textContent = p.label;
      b.appendChild(handle); b.appendChild(d); b.appendChild(n); queue.appendChild(b);
    });
    var defaultButton = document.createElement("button");
    defaultButton.type = "button"; defaultButton.className = "te-placement-chip te-placement-basic";
    if (!placementComplete && placementIndex < 0) defaultButton.classList.add("current");
    defaultButton.dataset.queueId = ""; defaultButton.textContent = WE.i18n.t("기본 단자 T#");
    queue.appendChild(defaultButton);
  }
  function fillPlacePreset(resetSequence) {
    var sel = document.getElementById("tePlacePreset");
    var prev = sel.value;
    sel.innerHTML = "";
    var gen = document.createElement("option");
    gen.value = ""; gen.textContent = WE.i18n.t("(기본 T#)");
    sel.appendChild(gen);
    var list = placementItems();
    list.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.id; o.textContent = p.label;
      sel.appendChild(o);
    });
    var prevIndex = list.findIndex(function (p) { return p.id === prev; });
    if (resetSequence) {
      placementRepeat = false;
      placementIndex = list.findIndex(function (p, i) { return !queueItemWasPlaced(p, i, list); });
      placementComplete = !!list.length && placementIndex < 0;
      if (placementComplete) placementIndex = list.length - 1;
    } else if (prevIndex >= 0) {
      placementIndex = prevIndex;
    } else {
      placementIndex = list.findIndex(function (p, i) { return !queueItemWasPlaced(p, i, list); });
      if (placementIndex < 0 && list.length) placementIndex = 0;
      placementComplete = false;
    }
    sel.value = placementIndex >= 0 && list[placementIndex] ? list[placementIndex].id : "";
    renderPlacementPanel();
  }
  function placePreset() {
    if (placementComplete) return null;
    var sel = document.getElementById("tePlacePreset");
    if (!sel.value) return null;
    var p = placementItems().filter(function (item) { return item.id === sel.value; })[0];
    return p ? { name: p.label, color: p.color, presetSource: p.source, presetId: p.id } : null;
  }
  function addPlacementQueueItem(label, color) {
    if (!cmp || !String(label || "").trim()) return null;
    var item = { id: WE.model.nextId("pq"), label: String(label).trim(), color: color || WE.model.DEFAULT_TERMINAL_COLOR };
    ensurePlacementQueue().push(item);
    placementComplete = false;
    fillPlacePreset();
    selectPlacePreset(item.id);
    return item;
  }
  function addCommonToQueue(presetId) {
    var p = WE.presets.get(presetId);
    return p ? addPlacementQueueItem(p.label, p.color) : null;
  }
  function updatePlacementQueueItem(id, fields) {
    updatePlacementQueueItems([id], fields);
  }
  function syncPlacedPreset(source, id, before, fields) {
    if (!cmp || !before) return false;
    var changed = false;
    (cmp.terminals || []).forEach(function (terminal) {
      var linked = terminal.presetSource === source && terminal.presetId === id;
      // Older projects have no preset reference. Matching the values before
      // the edit links them once so later edits can use the exact preset ID.
      var legacyMatch = terminal.name === before.label &&
        (terminal.color || WE.model.DEFAULT_TERMINAL_COLOR) === (before.color || WE.model.DEFAULT_TERMINAL_COLOR);
      if (!linked && !legacyMatch) return;
      if (fields.label != null) terminal.name = String(fields.label);
      if (fields.color != null) terminal.color = fields.color;
      terminal.presetSource = source;
      terminal.presetId = id;
      changed = true;
    });
    return changed;
  }
  function syncPlacedPresetAndRender(source, id, before, fields) {
    if (!syncPlacedPreset(source, id, before, fields)) return false;
    renderTerminals();
    buildList();
    fillPlacePreset();
    teCommit();
    return true;
  }
  function updatePlacementQueueItems(ids, fields) {
    var wanted = {};
    (ids || []).forEach(function (id) { wanted[id] = true; });
    var changed = false, terminalsChanged = false;
    ensurePlacementQueue().forEach(function (item) {
      if (!wanted[item.id]) return;
      var before = { label: item.label, color: item.color };
      if (fields.label != null) item.label = String(fields.label);
      if (fields.color != null) item.color = fields.color;
      if (syncPlacedPreset("part", item.id, before, fields)) terminalsChanged = true;
      changed = true;
    });
    if (changed) {
      fillPlacePreset(); buildList();
      if (terminalsChanged) { renderTerminals(); teCommit(); }
    }
  }
  function removePlacementQueueItem(id) {
    if (!cmp) return;
    var queue = ensurePlacementQueue();
    var item = queue.filter(function (p) { return p.id === id; })[0];
    if (item) {
      var terminal = item.terminalId && WE.model.getTerminal(cmp, item.terminalId);
      if (!terminal) terminal = cmp.terminals.filter(function (t) {
        return t.presetSource === "part" && t.presetId === id;
      })[0];
      if (terminal) WE.model.removeTerminal(cmp, terminal.id);
    }
    cmp.terminalPlacementQueue = queue.filter(function (p) { return p.id !== id; });
    placementComplete = false;
    fillPlacePreset(); renderTerminals(); buildList(); teCommit();
  }
  function reorderPlacementQueue(id, beforeId) {
    reorderPlacementQueueItems([id], beforeId);
  }
  function reorderPlacementQueueItems(ids, beforeId) {
    var list = ensurePlacementQueue();
    var wanted = {};
    (ids || []).forEach(function (id) { wanted[id] = true; });
    if (!Object.keys(wanted).length || wanted[beforeId]) return;
    var moving = list.filter(function (p) { return wanted[p.id]; });
    if (!moving.length) return;
    cmp.terminalPlacementQueue = list = list.filter(function (p) { return !wanted[p.id]; });
    var to = beforeId ? list.findIndex(function (p) { return p.id === beforeId; }) : -1;
    if (to < 0) Array.prototype.push.apply(list, moving);
    else Array.prototype.splice.apply(list, [to, 0].concat(moving));
    placementComplete = false;
    fillPlacePreset(); buildList();
  }
  function reorderPlacementItem(id, beforeId) {
    var list = placementItems();
    var source = list.filter(function (p) { return p.id === id; })[0];
    if (!source) return;
    var before = beforeId && list.filter(function (p) { return p.id === beforeId; })[0];
    if (before && before.source !== source.source) beforeId = null;
    if (source.source === "common") {
      WE.presets.reorderBefore(id, beforeId);
      placementComplete = false;
      fillPlacePreset(); buildList();
    } else reorderPlacementQueue(id, beforeId);
  }

  // 표시 끄기는 삭제와 다르다. 단자 정보는 그대로 두고 메인 도면의 점·라벨·배선 후보에서만 뺀다.
  // 이미 배선된 단자는 model이 거부하므로 연결을 눈에 안 보이게 만드는 상태가 생기지 않는다.
  function setTermsVisible(terms, visible) {
    var changed = 0, blocked = 0;
    (terms || []).forEach(function (t) {
      if ((t.visible !== false) === visible) return;
      if (WE.model.setTerminalVisible(cmp, t.id, visible)) changed++; else blocked++;
    });
    if (!changed && !blocked) return;
    renderTerminals(); buildList(); updateAlignVis(); teCommit();
    if (blocked && WE.app && WE.app.setHint) {
      WE.app.setHint(WE.i18n.t("배선이 연결된 단자는 끌 수 없습니다."),
        WE.i18n.t("연결된 단자 ") + blocked + WE.i18n.t("개는 켜진 상태로 유지했습니다."));
    }
  }

  function updateTerminalSummary() {
    var total = cmp ? cmp.terminals.length : 0;
    var visible = cmp ? cmp.terminals.filter(function (t) { return t.visible !== false; }).length : 0;
    document.getElementById("teVisibleCount").textContent = WE.i18n.t("전체 ") + total + WE.i18n.t(" · 사용 ") + visible;
    document.getElementById("teShowAll").disabled = !total || visible === total;
    document.getElementById("teHideAll").disabled = !total || visible === 0;
  }

  function terminalMatchesList(t) {
    if (termQuery && String(t.name || "").toUpperCase().indexOf(termQuery) < 0) return false;
    if (termFilter === "visible" && t.visible === false) return false;
    if (termFilter === "hidden" && t.visible !== false) return false;
    return true;
  }

  // ---- 단자 관리 목록 ----
  function buildList() {
    var list = document.getElementById("teList");
    list.innerHTML = "";
    updateTerminalSummary(); updateAlignVis(); renderPlacementPanel();
    if (cmp.terminals.length === 0) {
      var p = document.createElement("p");
      p.className = "muted"; p.textContent = WE.i18n.t("단자 없음. 이미지를 클릭해 추가하세요.");
      list.appendChild(p); return;
    }
    var shown = cmp.terminals.filter(terminalMatchesList);
    if (!shown.length) {
      var empty = document.createElement("p"); empty.className = "muted";
      empty.textContent = WE.i18n.t("조건에 맞는 단자가 없습니다."); list.appendChild(empty); return;
    }
    shown.forEach(function (t) {
      var row = document.createElement("div");
      row.className = "term-row" + (isSel(t.id) ? " sel" : "") + (t.visible === false ? " off" : "");
      row.dataset.tid = t.id;
      row.title = t.name || "";

      var visible = document.createElement("input");
      visible.className = "tvisible"; visible.type = "checkbox"; visible.checked = t.visible !== false;
      visible.disabled = WE.model.terminalConnected(cmp, t.id);
      visible.title = visible.disabled ? WE.i18n.t("배선이 연결된 단자는 끌 수 없습니다.") : WE.i18n.t("배선도에서 단자 사용");

      var color = document.createElement("span");
      color.className = "tcolor-dot"; color.style.backgroundColor = t.color || WE.model.DEFAULT_TERMINAL_COLOR;
      var name = document.createElement("span");
      name.className = "tname-label"; name.textContent = t.name;

      row.appendChild(visible); row.appendChild(color); row.appendChild(name);
      if (visible.disabled) {
        var connected = document.createElement("span"); connected.className = "tconnected";
        connected.textContent = "↗"; connected.title = WE.i18n.t("배선 연결됨"); row.appendChild(connected);
      }
      list.appendChild(row);
    });
    revealSelectedListItem();
  }

  function updateListTile(t) {
    var row = document.querySelector('#teList .term-row[data-tid="' + t.id + '"]'); if (!row) return;
    var name = row.querySelector(".tname-label"), dot = row.querySelector(".tcolor-dot");
    if (name) name.textContent = t.name;
    if (dot) dot.style.backgroundColor = t.color || WE.model.DEFAULT_TERMINAL_COLOR;
  }
  function revealSelectedListItem() {
    if (!selTid) return;
    requestAnimationFrame(function () {
      var list = document.getElementById("teList");
      var row = list && list.querySelector('.term-row[data-tid="' + selTid + '"]');
      if (!list || !row) return;
      if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
      else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
      }
    });
  }
  function onListChange(e) {
    if (e.target.classList.contains("tvisible")) {
      var visRow = e.target.closest(".term-row");
      var visTerm = WE.model.getTerminal(cmp, visRow.dataset.tid);
      if (visTerm) setTermsVisible([visTerm], e.target.checked);
    }
  }
  function onListClick(e) {
    if (suppressListClick) return;
    var row = e.target.closest(".term-row"); if (!row) return;
    if (e.target.matches("input,select,button")) return;
    var tid = row.dataset.tid;
    if (e.shiftKey && listAnchorTid) {
      var rows = [].slice.call(document.querySelectorAll("#teList .term-row"));
      var a = rows.findIndex(function (r) { return r.dataset.tid === listAnchorTid; });
      var b = rows.findIndex(function (r) { return r.dataset.tid === tid; });
      if (a >= 0 && b >= 0) {
        selTids = rows.slice(Math.min(a, b), Math.max(a, b) + 1).map(function (r) { return r.dataset.tid; });
        selTid = tid;
      } else setSingleSel(tid);
    } else if (e.ctrlKey || e.metaKey) toggleSel(tid);
    else setSingleSel(tid);
    listAnchorTid = tid;
    renderTerminals(); buildList(); updateAlignVis();
  }
  function listContentPoint(e, list) {
    var r = list.getBoundingClientRect();
    return { x: e.clientX - r.left + list.scrollLeft, y: e.clientY - r.top + list.scrollTop };
  }
  function onListDragDown(e) {
    if (e.button !== 0 || e.target.matches("input,button,select")) return;
    var list = document.getElementById("teList"), p = listContentPoint(e, list);
    listDrag = {
      pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY,
      x: p.x, y: p.y, active: false,
      base: (e.ctrlKey || e.metaKey) ? selTids.slice() : []
    };
    try { list.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function onListDragMove(e) {
    if (!listDrag || e.pointerId !== listDrag.pointerId) return;
    var list = document.getElementById("teList");
    if (!listDrag.active) {
      if (Math.abs(e.clientX - listDrag.clientX) + Math.abs(e.clientY - listDrag.clientY) < DRAG_THRESH) return;
      listDrag.active = true;
    }
    e.preventDefault();
    var bounds = list.getBoundingClientRect();
    if (e.clientY < bounds.top + 26) list.scrollTop = Math.max(0, list.scrollTop - 14);
    else if (e.clientY > bounds.bottom - 26) list.scrollTop += 14;
    var p = listContentPoint(e, list);
    var rect = { x: Math.min(listDrag.x, p.x), y: Math.min(listDrag.y, p.y), w: Math.abs(p.x - listDrag.x), h: Math.abs(p.y - listDrag.y) };
    var marquee = list.querySelector(".te-list-marquee");
    if (!marquee) { marquee = document.createElement("div"); marquee.className = "te-list-marquee"; list.appendChild(marquee); }
    marquee.style.left = rect.x + "px"; marquee.style.top = rect.y + "px";
    marquee.style.width = rect.w + "px"; marquee.style.height = rect.h + "px";

    var hits = [].slice.call(list.querySelectorAll(".term-row")).filter(function (row) {
      return row.offsetLeft < rect.x + rect.w && row.offsetLeft + row.offsetWidth > rect.x &&
        row.offsetTop < rect.y + rect.h && row.offsetTop + row.offsetHeight > rect.y;
    }).map(function (row) { return row.dataset.tid; });
    selTids = listDrag.base.concat(hits.filter(function (id) { return listDrag.base.indexOf(id) < 0; }));
    selTid = selTids[selTids.length - 1] || null;
    list.querySelectorAll(".term-row").forEach(function (row) { row.classList.toggle("sel", isSel(row.dataset.tid)); });
    renderTerminals(); updateAlignVis();
  }
  function onListDragEnd(e) {
    if (!listDrag || e.pointerId !== listDrag.pointerId) return;
    var list = document.getElementById("teList"), dragged = listDrag.active;
    try { list.releasePointerCapture(e.pointerId); } catch (err) {}
    var marquee = list.querySelector(".te-list-marquee"); if (marquee) marquee.remove();
    listDrag = null;
    if (!dragged) return;
    listAnchorTid = selTid;
    suppressListClick = true;
    setTimeout(function () { suppressListClick = false; }, 0);
    buildList(); updateAlignVis();
  }
  function onListHover(e) {
    var row = e.target.closest(".term-row"); if (!row || row.contains(e.relatedTarget)) return;
    hoverTid = row.dataset.tid; renderTerminals();
  }
  function onListHoverOut(e) {
    var row = e.target.closest(".term-row"); if (!row || row.contains(e.relatedTarget)) return;
    if (hoverTid === row.dataset.tid) { hoverTid = null; renderTerminals(); }
  }
  function close() {
    modal.hidden = true;
    opened = false;
    removeGhost();
    /* 단자가 움직인 만큼 배선을 따라오게 한다 — 부품을 드래그할 때와 같은 규칙이다.
       ⚠ 정리(afterTerminalEdit)보다 **먼저** 한다. 정리는 못 쓰게 된 배선을 지우는 일이라
          순서가 뒤바뀌면 지워진 배선을 따라오게 하려다 헛돈다.
          (없어진 단자는 applyTermFollow 가 알아서 건너뛴다 — endpoint 가 null 이면 안 만진다) */
    if (WE.interactions && WE.interactions.termFollowEnd) {
      WE.interactions.termFollowEnd(_배선따라오기);
    }
    _배선따라오기 = null;
    // 열었다 닫기만 한 경우에는 공용 연결을 유지한다. 실제 단자 내용이 달라졌을 때만 분리한다.
    if (openedDefinition && openedDefinition !== definitionSnap() && WE.app.makeComponentIndependent) {
      WE.app.makeComponentIndependent(cmp, true);
    }
    openedDefinition = "";
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

  return {
    open: open, refreshPresets: refreshPresets, isOpen: function () { return opened; },
    getPlacementQueue: function () { return opened ? ensurePlacementQueue() : []; },
    addPlacementQueueItem: addPlacementQueueItem,
    addCommonToQueue: addCommonToQueue,
    updatePlacementQueueItem: updatePlacementQueueItem,
    updatePlacementQueueItems: updatePlacementQueueItems,
    syncPlacedPreset: syncPlacedPresetAndRender,
    removePlacementQueueItem: removePlacementQueueItem,
    reorderPlacementQueue: reorderPlacementQueue,
    reorderPlacementQueueItems: reorderPlacementQueueItems
  };
})();

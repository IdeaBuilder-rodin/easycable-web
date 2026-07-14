// model.js — 데이터 모델 / 앱 상태 / (Phase 4에서) 직렬화
var WE = window.WE || {};
window.WE = WE;

WE.model = (function () {
  var DEFAULT_PALETTE = [   // 색상 + 의미(범례에 사용)
    { color: "#e53935", label: "+ (전원)" },
    { color: "#111111", label: "GND" },
    { color: "#ffffff", label: "중성" },
    { color: "#fbc02d", label: "신호" },
    { color: "#0000ff", label: "통신 (I2C 등)" }
  ];
  function defaultMeta() {
    var defName = (WE.i18n ? WE.i18n.t("이지케이블 배선도") : "이지케이블 배선도");
    return { name: defName, version: 1, canvas: { width: 1600, height: 900, grid: 10, snap: true } };
  }

  // 전체 프로젝트 상태
  var project = {
    meta: defaultMeta(),
    components: [],   // 배치된 부품 인스턴스
    wires: [],        // 배선
    annotations: [],  // Phase 5
    palette: DEFAULT_PALETTE.map(function (p) { return { color: p.color, label: p.label }; }),
    manualBom: [],    // BOM 표에 수동 추가한 품목 [{id, name, spec, qty, price, link}]
    bomPrice: {},     // BOM 단가 프로젝트별 덮어쓰기 { <key>: 숫자 } (라이브러리 기본단가보다 우선)
    bomOrder: [],     // BOM 행 표시 순서 (rowId 배열: "auto:<key>" | "man:<id>")
    bomColShow: { spec: true, price: true, sum: true, link: true },  // 기본 열 표시/숨김
    bomExtraCols: [], // 사용자 지정 열 [{id, name}]
    bomCustom: {},    // 사용자 지정 열 값 { <rowId>: { <colId>: value } }
    bomRowH: 6,       // 행 간격(셀 상하 padding, px)
    bomColW: {},      // 열 너비 { <colKey>: px } (colKey: 기본열 id 또는 "c:"+colId)
    bomColOrder: []   // 열 표시 순서 (colKey 배열)
  };
  function defaultBomColShow() { return { spec: true, price: true, sum: true, link: true }; }

  // 선택 상태 (단일 선택)
  var selection = { type: null, id: null }; // type: 'component' | 'wire' | 'annotation' | null
  var multi = [];       // 다중 선택된 부품 id
  var multiAnno = [];   // 다중 선택된 주석 id
  var multiWire = [];   // 다중 선택된 배선 id
  var wireClickPt = {}; // 배선별 마지막 클릭 지점(캔버스 좌표) — 정렬 시 어느 구간인지 판별용

  // UI 상태 (비직렬화)
  var ui = {
    lockAspect: false,
    mode: "select",            // 'select' | 'wire'
    selectedTerminalId: null,
    wireColor: "#e53935",      // 새 배선에 적용할 색
    wireWidth: 2,
    wireRouting: "ortho",      // 'ortho'(직각) | 'straight'(직선)
    selectedWp: null,          // 선택된 꺾임점 인덱스
    showWireNums: true         // 배선 번호(W1, W2…) 도면 표시
  };

  var DEFAULT_TERMINAL_COLOR = "#1e88e5";

  var _idCounter = 1;
  function nextId(prefix) {
    return prefix + "_" + (_idCounter++) + "_" + Math.floor(Math.random() * 1000);
  }

  // 부품 인스턴스 생성
  function addComponent(opts) {
    var cmp = {
      id: nextId("cmp"),
      libraryId: opts.libraryId || null,
      name: opts.name || "부품",
      x: opts.x != null ? opts.x : 100,
      y: opts.y != null ? opts.y : 100,
      rotation: 0,
      scale: 1,
      width: opts.width || 160,
      height: opts.height || 120,
      z: project.components.length + 1,
      image: opts.image || null,   // data:image/... base64
      terminals: opts.terminals || []  // Phase 2
    };
    project.components.push(cmp);
    return cmp;
  }

  function getComponent(id) {
    for (var i = 0; i < project.components.length; i++) {
      if (project.components[i].id === id) return project.components[i];
    }
    return null;
  }

  function removeComponent(id) {
    project.components = project.components.filter(function (c) { return c.id !== id; });
    // 이 부품에 연결된 배선도 제거
    project.wires = project.wires.filter(function (w) {
      return w.from.componentId !== id && w.to.componentId !== id;
    });
    if (selection.type === "component" && selection.id === id) clearSelection();
  }

  function duplicateComponent(id) {
    var src = getComponent(id);
    if (!src) return null;
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = nextId("cmp");
    copy.x += 20; copy.y += 20;
    copy.z = project.components.length + 1;
    project.components.push(copy);
    return copy;
  }

  // ---- 단자 ----
  // opts: { name, color } (프리셋에서 복사되거나 기본값)
  function addTerminal(cmp, rx, ry, opts) {
    opts = opts || {};
    var t = {
      id: nextId("t"),
      name: opts.name != null ? opts.name : "T" + (cmp.terminals.length + 1),
      color: opts.color || DEFAULT_TERMINAL_COLOR,
      rx: Math.max(0, Math.min(1, rx)),
      ry: Math.max(0, Math.min(1, ry))
    };
    cmp.terminals.push(t);
    return t;
  }
  function getTerminal(cmp, termId) {
    for (var i = 0; i < cmp.terminals.length; i++) {
      if (cmp.terminals[i].id === termId) return cmp.terminals[i];
    }
    return null;
  }
  function removeTerminal(cmp, termId) {
    cmp.terminals = cmp.terminals.filter(function (t) { return t.id !== termId; });
    // 이 단자에 연결된 배선 제거
    project.wires = project.wires.filter(function (w) {
      return !(w.from.componentId === cmp.id && w.from.terminalId === termId) &&
             !(w.to.componentId === cmp.id && w.to.terminalId === termId);
    });
    if (ui.selectedTerminalId === termId) ui.selectedTerminalId = null;
  }

  // ---- 배선 ----
  function addWire(fromCmpId, fromTid, toCmpId, toTid, color, width) {
    var w = {
      id: nextId("w"),
      from: { componentId: fromCmpId, terminalId: fromTid },
      to: { componentId: toCmpId, terminalId: toTid },
      color: color || ui.wireColor,
      width: width || ui.wireWidth,
      waypoints: []
    };
    project.wires.push(w);
    return w;
  }
  function getWire(id) {
    for (var i = 0; i < project.wires.length; i++) {
      if (project.wires[i].id === id) return project.wires[i];
    }
    return null;
  }
  function removeWire(id) {
    project.wires = project.wires.filter(function (w) { return w.id !== id; });
    if (selection.type === "wire" && selection.id === id) clearSelection();
  }

  // ---- 직렬화 ----
  function newProject() {
    project.meta = defaultMeta();
    project.components = [];
    project.wires = [];
    project.annotations = [];
    project.palette = DEFAULT_PALETTE.map(function (p) { return { color: p.color, label: p.label }; });
    project.manualBom = [];
    project.bomPrice = {};
    project.bomOrder = [];
    project.bomColShow = defaultBomColShow();
    project.bomExtraCols = [];
    project.bomCustom = {};
    project.bomRowH = 6;
    project.bomColW = {};
    project.bomColOrder = [];
    clearSelection();
    ui.selectedTerminalId = null;
    _idCounter = 1;
  }

  function loadProject(data) {
    if (!data) return;
    project.meta = data.meta || project.meta;
    project.components = data.components || [];
    project.wires = data.wires || [];
    project.annotations = data.annotations || [];
    project.palette = data.palette || project.palette;
    project.manualBom = data.manualBom || [];
    // 예전 파일: 수동품목에 id 없으면 부여
    project.manualBom.forEach(function (m) { if (!m.id) m.id = nextId("bm"); });
    project.bomPrice = data.bomPrice || {};
    project.bomOrder = data.bomOrder || [];
    project.bomColShow = data.bomColShow || defaultBomColShow();
    project.bomExtraCols = data.bomExtraCols || [];
    project.bomCustom = data.bomCustom || {};
    project.bomRowH = (typeof data.bomRowH === "number") ? data.bomRowH : 6;
    project.bomColW = data.bomColW || {};
    project.bomColOrder = data.bomColOrder || [];
    clearSelection();
    ui.selectedTerminalId = null;
    // id 카운터를 기존 최대값 뒤로 보정 (충돌 방지)
    var maxN = 0;
    function scan(id) { var m = /_(\d+)_/.exec(id || ""); if (m) maxN = Math.max(maxN, +m[1]); }
    project.components.forEach(function (c) {
      scan(c.id); (c.terminals || []).forEach(function (t) { scan(t.id); });
    });
    project.wires.forEach(function (w) { scan(w.id); });
    _idCounter = maxN + 1;
  }

  // ---- 주석(자유 텍스트) ----
  function addAnnotation(opts) {
    opts = opts || {};
    var a = {
      id: nextId("a"),
      text: opts.text != null ? opts.text : "텍스트",
      x: opts.x != null ? opts.x : 100,
      y: opts.y != null ? opts.y : 100,
      color: opts.color || "#e53935",
      fontSize: opts.fontSize || 18,
      bold: !!opts.bold
    };
    project.annotations.push(a);
    return a;
  }
  function getAnnotation(id) {
    for (var i = 0; i < project.annotations.length; i++) {
      if (project.annotations[i].id === id) return project.annotations[i];
    }
    return null;
  }
  function removeAnnotation(id) {
    project.annotations = project.annotations.filter(function (a) { return a.id !== id; });
    if (selection.type === "annotation" && selection.id === id) clearSelection();
  }

  function select(type, id) {
    selection.type = type; selection.id = id;
    multi = (type === "component") ? [id] : [];
    multiAnno = (type === "annotation") ? [id] : [];
    multiWire = (type === "wire") ? [id] : [];
    wireClickPt = {};
  }
  function clearSelection() { selection.type = null; selection.id = null; multi = []; multiAnno = []; multiWire = []; wireClickPt = {}; }
  function getSelection() { return selection; }
  // 다중 선택
  function setPrimary(id) { selection.type = "component"; selection.id = id; }
  function getMulti() { return multi; }
  function getMultiAnno() { return multiAnno; }
  function getMultiWire() { return multiWire; }
  // 배선 클릭 지점(정렬용)
  function setWireClickPt(id, pt) { if (pt) wireClickPt[id] = { x: pt.x, y: pt.y }; else delete wireClickPt[id]; }
  function getWireClickPt(id) { return wireClickPt[id] || null; }
  function setMulti(ids) { multi = ids.slice(); }
  function toggleMulti(id) {
    var i = multi.indexOf(id);
    if (i >= 0) multi.splice(i, 1); else multi.push(id);
  }
  function toggleMultiWire(id) {
    var i = multiWire.indexOf(id);
    if (i >= 0) multiWire.splice(i, 1); else multiWire.push(id);
    if (multiWire.length) { selection.type = "wire"; selection.id = multiWire[multiWire.length - 1]; }
    else { selection.type = null; selection.id = null; }
  }
  // 마퀴 선택 결과 지정
  function setMultiSelection(comps, annos, wires) {
    multi = comps.slice(); multiAnno = annos.slice(); multiWire = (wires || []).slice();
    if (comps.length) { selection.type = "component"; selection.id = comps[comps.length - 1]; }
    else if (annos.length) { selection.type = "annotation"; selection.id = annos[annos.length - 1]; }
    else if (multiWire.length) { selection.type = "wire"; selection.id = multiWire[multiWire.length - 1]; }
    else { selection.type = null; selection.id = null; }
  }
  function getSelectedComponent() {
    return selection.type === "component" ? getComponent(selection.id) : null;
  }
  function getSelectedWire() {
    return selection.type === "wire" ? getWire(selection.id) : null;
  }
  function getSelectedAnnotation() {
    return selection.type === "annotation" ? getAnnotation(selection.id) : null;
  }

  return {
    project: project,
    ui: ui,
    DEFAULT_TERMINAL_COLOR: DEFAULT_TERMINAL_COLOR,
    addTerminal: addTerminal,
    getTerminal: getTerminal,
    removeTerminal: removeTerminal,
    nextId: nextId,
    addComponent: addComponent,
    getComponent: getComponent,
    removeComponent: removeComponent,
    duplicateComponent: duplicateComponent,
    addWire: addWire,
    getWire: getWire,
    removeWire: removeWire,
    loadProject: loadProject,
    newProject: newProject,
    select: select,
    clearSelection: clearSelection,
    getSelection: getSelection,
    setPrimary: setPrimary,
    getMulti: getMulti,
    getMultiAnno: getMultiAnno,
    getMultiWire: getMultiWire,
    setWireClickPt: setWireClickPt,
    getWireClickPt: getWireClickPt,
    setMulti: setMulti,
    toggleMulti: toggleMulti,
    toggleMultiWire: toggleMultiWire,
    setMultiSelection: setMultiSelection,
    addAnnotation: addAnnotation,
    getAnnotation: getAnnotation,
    removeAnnotation: removeAnnotation,
    getSelectedComponent: getSelectedComponent,
    getSelectedWire: getSelectedWire,
    getSelectedAnnotation: getSelectedAnnotation
  };
})();

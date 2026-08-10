// model.js — 데이터 모델 / 앱 상태 / (Phase 4에서) 직렬화
var WE = window.WE || {};
window.WE = WE;

WE.model = (function () {
  var DEFAULT_PALETTE = [   // 색상 + 의미(범례에 사용)
    { color: "#e53935", label: WE.i18n.t("+ (전원)") },
    { color: "#111111", label: "GND" },
    { color: "#ffffff", label: WE.i18n.t("중성") },
    { color: "#fbc02d", label: WE.i18n.t("신호") },
    { color: "#0000ff", label: WE.i18n.t("통신 (I2C 등)") }
  ];
  // 문서 고유 id — 자동저장 슬롯을 문서별로 나누는 열쇠.
  // 예전엔 슬롯이 주소(pathname)당 1개뿐이라 탭 두 개로 서로 다른 도면을 그리면 3초마다 서로 덮어썼다.
  function newDocId() {
    return "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function defaultMeta() {
    return {
      id: newDocId(),
      name: WE.i18n.t("이지케이블 배선도"), version: 1,
      canvas: { width: 1600, height: 900, grid: 10, snap: true }
    };
  }

  // ---- 시트(배선도 한 장) ----
  // 한 프로젝트에 배선도가 여러 장 들어간다. **부품·배선·주석은 시트가 하나씩 갖는다.**
  // 캔버스 크기·팔레트·BOM은 프로젝트가 공유한다(사용자 확정, 2026-08-08).
  var _sheetSeq = 0;
  function makeSheet(name) {
    _sheetSeq++;
    return {
      id: "sh" + Date.now().toString(36) + "_" + _sheetSeq,
      name: name || WE.i18n.t("배선도"),
      note: "",                     // 도면 비고 — 인쇄물 하단 좌측. 도면마다 다르므로 시트가 갖는다
      components: [], wires: [], annotations: []
    };
  }
  // 새 배선도 이름 — 지금 보고 있는 도면 이름 뒤에 _01, _02 … 를 붙인다.
  // "퍼미어스 미니 V1" 로 이름을 지어 두면 다음 장이 "퍼미어스 미니 V1_01" 이 되어
  // 같은 프로젝트의 장들이 한눈에 묶여 보인다.
  // 이미 _NN 이 붙은 이름에서 추가하면 그 꼬리를 떼고 번호를 잇는다(_01 에서 추가 → _02).
  // 이름에 든 숫자는 건드리지 않는다 — "V1" 의 1까지 떼면 "퍼미어스 미니 V" 가 되어 버린다.
  function nextSheetName(baseName) {
    var base = String(baseName || "").replace(/_\d+\s*$/, "").trim();
    if (!base) base = WE.i18n.t("배선도");
    var esc = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");   // 이름에 든 정규식 기호를 그대로 글자로
    var re = new RegExp("^" + esc + "_(\\d+)$");
    var used = {}, max = 0;
    project.sheets.forEach(function (sh) {
      var nm = String(sh.name || "");
      used[nm] = 1;
      var m = re.exec(nm);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    var n = max + 1, name;
    do {
      name = base + "_" + (n < 10 ? "0" + n : String(n));
      n++;
    } while (used[name]);
    return name;
  }

  // 전체 프로젝트 상태
  var project = {
    meta: defaultMeta(),
    sheets: [makeSheet()],
    // components / wires / annotations 는 아래에서 '현재 시트' 별칭으로 정의한다.
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

  // ---- 현재 시트 별칭 ----
  // `project.components` / `.wires` / `.annotations` 는 **현재 시트를 가리키는 창**이다.
  // 이렇게 둔 이유: 이 셋을 참조하는 코드가 66곳이라 전부 고치면 그 자체가 큰 위험이다.
  // 별칭으로 두면 그리기·선택·드래그·라우팅 같은 '보고 있는 도면'을 다루는 코드가 한 줄도 안 바뀐다.
  //
  // ※ 게터만 두면 안 된다. `project.wires = project.wires.filter(...)` 처럼 **대입하는 곳이 10군데**라
  //    세터가 없으면 그 대입이 에러 없이 조용히 무시된다(부품을 지워도 안 지워지는데 콘솔은 조용함).
  // ※ enumerable:false 인 이유 — `JSON.stringify(project)`(저장·자동저장·실행취소)와
  //    `assets.pack`의 for…in 이 이 별칭을 건너뛰어야 sheets만 한 번 저장된다.
  //
  // ★ 새 기능이 **프로젝트 전체**를 다뤄야 하면 이 별칭이 아니라 allComponents()/allWires()를 쓸 것.
  //   (BOM 집계·전력 요약·팔레트 색 일괄 변경·라벨 번호·id 검사 등)
  var _activeSheetId = project.sheets[0].id;
  function activeSheet() {
    for (var i = 0; i < project.sheets.length; i++) {
      if (project.sheets[i].id === _activeSheetId) return project.sheets[i];
    }
    // 가리키던 시트가 사라졌으면 첫 장으로 되돌린다(빈 배열을 돌려주면 그리기가 통째로 멈춘다)
    if (!project.sheets.length) project.sheets.push(makeSheet());
    _activeSheetId = project.sheets[0].id;
    return project.sheets[0];
  }
  ["components", "wires", "annotations"].forEach(function (k) {
    Object.defineProperty(project, k, {
      get: function () { return activeSheet()[k]; },
      set: function (v) { activeSheet()[k] = v; },
      enumerable: false, configurable: true
    });
  });
  function getActiveSheetId() { return activeSheet().id; }
  function setActiveSheet(id) {
    for (var i = 0; i < project.sheets.length; i++) {
      if (project.sheets[i].id === id) { _activeSheetId = id; return true; }
    }
    return false;
  }
  // 프로젝트 전체를 훑어야 하는 기능용. 시트 경계를 넘는 집계는 반드시 이걸 쓴다.
  function allOf(k) {
    var out = [];
    project.sheets.forEach(function (s) { out = out.concat(s[k] || []); });
    return out;
  }
  function allComponents() { return allOf("components"); }
  function allWires() { return allOf("wires"); }
  function allAnnotations() { return allOf("annotations"); }

  // ---- 시트 편집 ----
  function sheetIndex(id) {
    for (var i = 0; i < project.sheets.length; i++) if (project.sheets[i].id === id) return i;
    return -1;
  }
  function addSheet(name) {
    var s = makeSheet(name || nextSheetName(activeSheet().name));
    project.sheets.push(s);
    return s;
  }
  function getSheetNote() { return activeSheet().note || ""; }
  function setSheetNote(v) { activeSheet().note = String(v == null ? "" : v); }
  function renameSheet(id, name) {
    var i = sheetIndex(id); if (i < 0) return false;
    name = (name || "").trim();
    if (!name) return false;
    project.sheets[i].name = name;
    return true;
  }
  function removeSheet(id) {
    if (project.sheets.length <= 1) return false;   // 마지막 한 장은 남긴다
    var i = sheetIndex(id); if (i < 0) return false;
    project.sheets.splice(i, 1);
    if (_activeSheetId === id) _activeSheetId = project.sheets[Math.min(i, project.sheets.length - 1)].id;
    clearSelection();
    return true;
  }
  function moveSheet(id, dir) {
    var i = sheetIndex(id); if (i < 0) return false;
    var j = i + dir;
    if (j < 0 || j >= project.sheets.length) return false;
    var t = project.sheets[i]; project.sheets[i] = project.sheets[j]; project.sheets[j] = t;
    return true;
  }
  // ---- id 재발급 ----
  // 부품·배선·주석 덩어리의 id를 전부 새로 발급하고 **내부 참조까지 함께 갈아 끼운다.**
  // 이걸 빠뜨리면 복제본의 배선이 원본 부품에 붙는다(에러 없이 조용히 틀리는 유형).
  // 갈아야 할 참조: 배선의 from/to(단자 또는 분기), 다발(bundleId).
  // 시트 복제와 붙여넣기가 이 함수를 함께 쓴다 — 규칙이 갈라지면 한쪽만 틀린다.
  // b = { components, wires, annotations } 를 제자리에서 고친다.
  function remapBundle(b) {
    var cmpMap = {}, termMap = {}, wireMap = {}, bidMap = {};
    (b.components || []).forEach(function (c) {
      var oldC = c.id;
      c.id = nextId("cmp"); cmpMap[oldC] = c.id;
      (c.terminals || []).forEach(function (t) {
        var oldT = t.id;
        t.id = nextId("t");
        termMap[oldC + "|" + oldT] = t.id;   // 단자 id는 부품 안에서만 유일하므로 부품과 묶어 기억
      });
    });
    (b.wires || []).forEach(function (w) { var oldW = w.id; w.id = nextId("w"); wireMap[oldW] = w.id; });
    (b.annotations || []).forEach(function (a) { a.id = nextId("a"); });

    (b.wires || []).forEach(function (w) {
      ["from", "to"].forEach(function (k) {
        var r = w[k]; if (!r) return;
        if (r.wireId) { r.wireId = wireMap[r.wireId] || r.wireId; return; }   // 분기 → 호스트 배선
        if (!r.componentId) return;
        var oldC = r.componentId;                                            // 단자 id를 먼저 찾고
        var nt = termMap[oldC + "|" + r.terminalId];                         // 그 다음에 부품 id를 바꾼다
        if (nt) r.terminalId = nt;
        if (cmpMap[oldC]) r.componentId = cmpMap[oldC];
      });
      if (w.bundleId) {   // 다발도 새로 — 원본의 다발과 한 묶음이 되면 안 된다
        if (!bidMap[w.bundleId]) bidMap[w.bundleId] = "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        w.bundleId = bidMap[w.bundleId];
      }
    });
    return b;
  }

  // 시트 복제
  function duplicateSheet(id) {
    var i = sheetIndex(id); if (i < 0) return null;
    var copy = JSON.parse(JSON.stringify(project.sheets[i]));
    copy.id = makeSheet().id;
    copy.name = project.sheets[i].name + WE.i18n.t(" 복사본");
    remapBundle(copy);
    project.sheets.splice(i + 1, 0, copy);
    return copy;
  }

  // ---- 복사 / 붙여넣기 ----
  // 선택한 것들을 한 덩어리로 떠낸다(현재 시트에서).
  // 배선 규칙: **양 끝이 모두 덩어리 안에 있는 배선만** 담는다.
  //   한쪽 끝만 담으면 붙여넣는 순간 상대 단자가 없어 깨진다.
  //   분기 배선은 호스트 배선도 함께 담겨야 하므로, 더 담을 게 없을 때까지 반복해서 끌어온다.
  function extractSelection(cmpIds, annoIds, wireIds) {
    var cset = {}, aset = {}, wset = {}, picked = {};
    (cmpIds || []).forEach(function (id) { cset[id] = 1; });
    (annoIds || []).forEach(function (id) { aset[id] = 1; });
    (wireIds || []).forEach(function (id) { wset[id] = 1; });
    function endOk(r) {
      if (!r) return false;
      if (r.wireId) return !!picked[r.wireId];     // 분기 → 호스트가 이미 담겼는가
      return !!cset[r.componentId];
    }
    var changed = true;
    while (changed) {
      changed = false;
      project.wires.forEach(function (w) {
        if (picked[w.id]) return;
        // 직접 고른 배선이거나, 선택한 부품끼리 잇는 배선
        if (!wset[w.id] && !(endOk(w.from) && endOk(w.to))) return;
        if (!endOk(w.from) || !endOk(w.to)) return;   // 직접 골랐어도 끝점이 없으면 제외
        picked[w.id] = 1; changed = true;
      });
    }
    return {
      components: project.components.filter(function (c) { return cset[c.id]; })
        .map(function (c) { return JSON.parse(JSON.stringify(c)); }),
      wires: project.wires.filter(function (w) { return picked[w.id]; })
        .map(function (w) { return JSON.parse(JSON.stringify(w)); }),
      annotations: project.annotations.filter(function (a) { return aset[a.id]; })
        .map(function (a) { return JSON.parse(JSON.stringify(a)); })
    };
  }
  // 덩어리를 현재 시트에 붙인다. dx·dy 만큼 밀어서 놓는다(0이면 원래 자리 그대로).
  // 원본은 건드리지 않는다 — 클립보드에 남겨 두고 여러 번 붙일 수 있어야 한다.
  function pasteBundle(bundle, dx, dy) {
    if (!bundle) return null;
    var b = JSON.parse(JSON.stringify(bundle));
    b.components = b.components || []; b.wires = b.wires || []; b.annotations = b.annotations || [];
    remapBundle(b);
    dx = dx || 0; dy = dy || 0;
    if (dx || dy) {
      b.components.forEach(function (c) { c.x += dx; c.y += dy; });
      b.annotations.forEach(function (a) { a.x += dx; a.y += dy; });
      b.wires.forEach(function (w) {
        (w.waypoints || []).forEach(function (p) { p.x += dx; p.y += dy; });
        ["from", "to"].forEach(function (k) {
          var r = w[k];
          if (r && r.wireId) { r.x += dx; r.y += dy; if (r.seg) r.seg.coord += (r.seg.axis === "v" ? dx : dy); }
        });
        if (w.labelPos) { w.labelPos.x += dx; w.labelPos.y += dy; }
      });
    }
    var base = project.components.length;
    b.components.forEach(function (c, i) { c.z = base + i + 1; project.components.push(c); });
    b.wires.forEach(function (w) { project.wires.push(w); });
    b.annotations.forEach(function (a) { project.annotations.push(a); });
    return b;
  }

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
    selectedWireLabel: null    // 라벨(수축튜브)을 직접 클릭해 선택한 배선 id — Delete 시 라벨만 삭제
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
      name: opts.name || WE.i18n.t("부품"),
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
    // 이 부품에 연결된 배선 제거 — 그 배선에 물린 분기선까지 연쇄로 없애야 하므로
    // removeWire를 거친다(여기서 직접 걸러내면 분기선이 허공에 남는다)
    project.wires.filter(function (w) {
      return w.from.componentId === id || w.to.componentId === id;
    }).map(function (w) { return w.id; }).forEach(function (wid) { removeWire(wid); });
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
    // 이 단자에 연결된 배선 제거 — removeWire를 거쳐야 그 배선에 물린 분기선까지 연쇄로 없어진다.
    // 직접 걸러내면 분기선이 호스트를 잃은 채 남아, 화면엔 안 그려지는데 저장 파일에는 실려 다닌다.
    project.wires.filter(function (w) {
      return (w.from.componentId === cmp.id && w.from.terminalId === termId) ||
             (w.to.componentId === cmp.id && w.to.terminalId === termId);
    }).map(function (w) { return w.id; }).forEach(function (wid) { removeWire(wid); });
    if (ui.selectedTerminalId === termId) ui.selectedTerminalId = null;
  }

  // ---- 배선 ----
  function addWire(fromCmpId, fromTid, toCmpId, toTid, color, width) {
    return addWireRef({ componentId: fromCmpId, terminalId: fromTid },
                      { componentId: toCmpId, terminalId: toTid }, color, width);
  }
  // 끝점을 직접 준다. 단자는 { componentId, terminalId }, 분기는 { wireId, x, y }.
  function addWireRef(fromRef, toRef, color, width) {
    var w = {
      id: nextId("w"),
      from: fromRef,
      to: toRef,
      color: color || ui.wireColor,
      width: width || ui.wireWidth,
      // 새 배선은 '겹침 허용'이 기본. 그린 자리에 그대로 있는 편이 낫다는 판단 —
      // 자동 회피가 켜져 있으면 옆 선을 피해 멋대로 옮겨 가서, 매번 다시 잡아 줘야 했다.
      // 겹치는 건 눈에 보이니 필요할 때 속성 패널에서 끄고 정렬로 정리하면 된다.
      allowOverlap: true,
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
  // 배선 삭제. 이 배선에 물려 있던 분기선은 붙을 데가 없어지므로 함께 지운다
  // (분기의 분기까지 있으면 연쇄로). 몇 개가 같이 지워졌는지 돌려준다.
  function removeWire(id) {
    var doomed = {}; doomed[id] = 1;
    var changed = true;
    while (changed) {
      changed = false;
      project.wires.forEach(function (w) {
        if (doomed[w.id]) return;
        if ((w.from && doomed[w.from.wireId]) || (w.to && doomed[w.to.wireId])) {
          doomed[w.id] = 1; changed = true;
        }
      });
    }
    project.wires = project.wires.filter(function (w) { return !doomed[w.id]; });
    if (selection.type === "wire" && doomed[selection.id]) clearSelection();
    return Object.keys(doomed).length - 1;   // 함께 지워진 분기선 수
  }

  // ---- 직렬화 ----
  function newProject() {
    project.meta = defaultMeta();
    // 시트는 통째로 갈아끼운다. `project.components = []` 로는 **현재 시트만** 비워져
    // 이전 도면의 나머지 시트가 그대로 살아남는다(별칭이므로).
    _sheetSeq = 0;
    project.sheets = [makeSheet()];
    _activeSheetId = project.sheets[0].id;
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
    // 예전 파일에는 문서 id가 없다 → 지금 발급해 자기 슬롯을 갖게 한다
    if (!project.meta.id) project.meta.id = newDocId();
    // ---- 시트 복원 / 옛 파일 마이그레이션 ----
    // 옛 파일에는 sheets가 없고 components·wires·annotations가 최상위에 있다 → 시트 한 장으로 감싼다.
    // 사용자가 할 일은 없고, 다시 저장하면 새 형식으로 나간다.
    _sheetSeq = 0;
    if (data.sheets && data.sheets.length) {
      project.sheets = data.sheets.map(function (s, i) {
        _sheetSeq = Math.max(_sheetSeq, i + 1);
        return {
          id: s.id || ("sh" + Date.now().toString(36) + "_" + (i + 1)),
          name: s.name || (WE.i18n.t("배선도") + " " + (i + 1)),
          note: s.note || "",
          components: s.components || [], wires: s.wires || [], annotations: s.annotations || []
        };
      });
    } else {
      var one = makeSheet(project.meta.name || undefined);
      // 옛 파일은 비고가 프로젝트(meta.note)에 있었다 → 그 한 장의 비고로 옮긴다
      one.note = (project.meta && project.meta.note) || "";
      one.components = data.components || [];
      one.wires = data.wires || [];
      one.annotations = data.annotations || [];
      project.sheets = [one];
    }
    _activeSheetId = project.sheets[0].id;
    if (data.activeSheetId) setActiveSheet(data.activeSheetId);
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
    // id 카운터를 기존 최대값 뒤로 보정 (충돌 방지).
    // ★ 반드시 **모든 시트**를 훑어야 한다. 현재 시트만 보면 새로 만든 부품이 다른 시트의
    //   기존 부품과 같은 id를 갖고, 배선의 from/to·분기의 wireId가 엉뚱한 걸 가리킨다.
    //   에러가 안 나고 조용히 틀리는 유형이라 특히 위험하다.
    var maxN = 0;
    function scan(id) { var m = /_(\d+)_/.exec(id || ""); if (m) maxN = Math.max(maxN, +m[1]); }
    project.sheets.forEach(function (s) {
      (s.components || []).forEach(function (c) {
        scan(c.id); (c.terminals || []).forEach(function (t) { scan(t.id); });
      });
      (s.wires || []).forEach(function (w) { scan(w.id); });
      (s.annotations || []).forEach(function (a) { scan(a.id); });
    });
    _idCounter = maxN + 1;
  }

  // ---- 주석(자유 텍스트) ----
  function addAnnotation(opts) {
    opts = opts || {};
    var a = {
      id: nextId("a"),
      text: opts.text != null ? opts.text : WE.i18n.t("텍스트"),
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
    wireClickPt = {};   // 이전 선택의 배선 클릭 지점은 무효 — 마퀴가 필요하면 직후에 다시 기록
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
    // ---- 시트 ----
    activeSheet: activeSheet,
    getActiveSheetId: getActiveSheetId,
    setActiveSheet: setActiveSheet,
    makeSheet: makeSheet,
    addSheet: addSheet,
    nextSheetName: nextSheetName,
    renameSheet: renameSheet,
    getSheetNote: getSheetNote,
    setSheetNote: setSheetNote,
    removeSheet: removeSheet,
    moveSheet: moveSheet,
    duplicateSheet: duplicateSheet,
    extractSelection: extractSelection,
    pasteBundle: pasteBundle,
    // 프로젝트 전체 집계용 — 시트 경계를 넘는 기능은 반드시 이걸 쓴다
    allComponents: allComponents,
    allWires: allWires,
    allAnnotations: allAnnotations,
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
    addWireRef: addWireRef,
    getWire: getWire,
    removeWire: removeWire,
    loadProject: loadProject,
    newProject: newProject,
    newDocId: newDocId,
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

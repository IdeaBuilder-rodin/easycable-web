// model.js — 데이터 모델 / 앱 상태 / (Phase 4에서) 직렬화
var WE = window.WE || {};
window.WE = WE;

WE.model = (function () {
  // 기본 배선 팔레트 — 검정·빨강·파랑·초록·노랑.
  // label 은 인쇄물 범례에 쓰인다. 라벨이 빈 색은 범례에서 자동으로 빠지므로(app.legendItems),
  // 전기적 의미를 함부로 정하기 어려운 색은 비워 두고 사용자가 팔레트 관리에서 붙이게 한다.
  var DEFAULT_PALETTE = [   // 색상 + 의미(범례에 사용)
    { color: "#111111", label: "GND" },
    { color: "#e53935", label: WE.i18n.t("+ (전원)") },
    { color: "#0000ff", label: WE.i18n.t("통신 (I2C 등)") },
    { color: "#43a047", label: WE.i18n.t("신호") },
    { color: "#fbc02d", label: "" }
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
      // 기본 이름은 **쪽 번호**다 — 01, 02 … (2026-09-09 고원빈).
      // 예전에는 "배선도" 로 두고 다음 장을 "배선도_01" 로 이었는데, 쪽 번호가 이름 뒤에
      // 숨어 몇 째 장인지 한눈에 안 들어왔다. 이름을 붙이고 싶으면 고쳐 쓰면 된다.
      name: name || "01",
      note: "",                     // 도면 비고 — 인쇄물 하단 좌측. 도면마다 다르므로 시트가 갖는다
      components: [], wires: [], annotations: []
    };
  }
  /* 새 페이지 이름 — 두 자리 쪽 번호(01, 02 …). (2026-09-09 고원빈)

     ⚠ baseName 은 더 쓰지 않는다. 예전에는 보고 있는 장 이름 뒤에 _01 을 붙였는데
        ("퍼미어스 미니 V1_01"), 쪽 번호가 이름 뒤에 숨어 몇 째 장인지 한눈에 안 보였다.
        부르는 쪽을 건드리지 않으려고 인자는 남겨 두되 무시한다.
     ⚠ 이름을 손으로 고쳐 둔 장이 있어도(예: "전원부") 번호는 이어진다 —
        **장 수보다는 큰 번호**에서 시작해, 이미 쓰는 이름은 건너뛴다. */
  // 이름에 든 숫자는 건드리지 않는다 — "V1" 의 1까지 떼면 "퍼미어스 미니 V" 가 되어 버린다.
  function nextSheetName() {
    var used = {}, max = project.sheets.length;
    project.sheets.forEach(function (sh) {
      var nm = String(sh.name || "");
      used[nm] = 1;
      if (/^\d+$/.test(nm)) max = Math.max(max, parseInt(nm, 10));
    });
    var n = max + 1, name;
    do {
      name = (n < 10 ? "0" : "") + n;
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
    /* 결선표 비고 { "<부품id>|<단자id>": "글" } — 케이블 길이 같은 현장 메모 (2026-09-09).
       ⚠ 단자 **이름**이 아니라 id 로 키를 잡는다. 이름은 사용자가 바꾼다 —
          이름을 키로 쓰면 단자 이름을 고치는 순간 적어 둔 메모가 사라진다. */
    wireNote: {},
    // BOM 이름·스펙·링크의 프로젝트별 덮어쓰기 { <key>: {name, spec, link} }
    // BOM 은 사용자의 작업물이라, 표에서 고친 값이 부품 기본값보다 항상 우선한다.
    // 부품 정보(라이브러리)는 BOM 편집으로 절대 바뀌지 않는다 — 우리가 기본값을 갱신해도
    // 사용자가 넣은 구매처·품명이 되돌아가지 않게 하려는 것이다. 단가(bomPrice)와 같은 방식.
    bomEdit: {},
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

  /* ---- 부품 번호(#1, #2 …) ----
     종이를 보며 결선할 때 부품을 가리킬 이름이다. 이름만으로는 안 된다 —
     스텝다운모듈이 둘이면 "스텝다운모듈 IN+" 가 어느 쪽인지 종이에서 가릴 수가 없다.
     (2026-09-03 고원빈: 실제 결선 중에 이 문제로 막혔다)

     ⚠ 여기 `no` 는 **화면에 보이는 번호가 아니다.** 놓은 순서를 기록해 두는 내부 값이고,
        시트를 넘어 프로젝트 전체에서 하나씩 매긴다. 한 번 주면 안 바꾸고 지운 자리도 안 채운다.
        사람이 보는 번호는 아래 cmpSeq/cmpLabel 이 이 순서를 근거로 따로 만든다 —
        **같은 품목이 둘 이상일 때만** 1, 2, 3 … 으로 붙는다.
        (하나뿐인 부품에까지 번호를 달면 종이에 글자만 는다. 2026-09-03 고원빈 확정)

     · BOM 에는 안 쓴다. 발주는 "스텝다운모듈 2개"면 되고 낱개 번호는 의미가 없다. */
  /* 부품 겹침 순서(z) 의 다음 값 — **배열 길이가 아니라 실제 최댓값 + 1** 이어야 한다.
     길이로 매기면 삭제 후에 새로 놓은 부품이 기존 부품과 z 가 겹친다
     (부품 3개 중 가운데(z=2)를 지우면 length=2, 다음에 놓는 부품이 z=3 을 받아
      맨 위(z=3)와 겹친다 — 어느 게 위인지 안 정해진다). (2026-09-03) */
  function _maxZ() {
    var m = 0;
    project.components.forEach(function (c) { if ((c.z || 0) > m) m = c.z; });
    return m;
  }

  function maxCmpNo() {
    var m = 0;
    allComponents().forEach(function (c) { var n = Number(c.no) || 0; if (n > m) m = n; });
    return m;
  }
  // 번호가 없는 부품에만 새 번호를 준다(이미 있는 번호는 절대 안 건드린다).
  // 예전 파일을 열었을 때의 이관도 이 함수 하나로 끝난다.
  function ensureCmpNos() {
    var next = maxCmpNo() + 1, 준것 = 0;
    allComponents().forEach(function (c) { if (!(Number(c.no) > 0)) { c.no = next++; 준것++; } });
    return 준것;
  }
  /* '같은 품목인가' 판정 키 — BOM 이 수량을 세는 기준과 **반드시 같아야 한다.**
     BOM 은 "스텝다운모듈 2개"라 하는데 도면에는 번호가 하나만 붙는 식으로 어긋나면 안 된다.
     (app.js 의 buildBOM·bomRowKey 가 쓰던 식을 여기로 모았다 — 사본이 셋이 되면 언젠가 갈라진다) */
  function cmpGroupKey(c) {
    return c.libraryId || c.publicId || ("name:" + c.name);
  }

  /* 도면·결선표에 쓰는 표기.
       같은 품목이 하나뿐  → "배터리 12.6V 10Ah"      (번호 없음)
       같은 품목이 여럿    → "#1 스텝다운모듈 DC-DC"  (번호로 가린다)

     번호는 **구분이 필요할 때만** 붙인다. 하나뿐인 부품에 번호를 달면 종이에 글자만 늘고
     읽기 어려워진다(2026-09-03 고원빈 확정).
     번호를 앞에 두는 이유 — 종이에서 눈으로 번호를 훑어 찾는 게 실제 동작이다.

     ⚠ 보이는 번호는 **같은 품목 안에서의 순번**이다(1, 2, 3 …). 그 순서는 저장된 no 로 정한다 —
        no 는 놓은 순서대로 한 번만 주고 안 바뀌므로, 부품을 옮기거나 다른 부품을 지워도
        이 순번이 흔들리지 않는다. 같은 품목을 더 놓거나 지울 때만 바뀐다(그때는 도면 자체가
        바뀐 것이라 어차피 다시 뽑는다).
     ⚠ 표기 규칙은 여기 한 곳에만 둔다. 도면과 결선표가 다르게 적으면 종이에서 대조가 안 된다. */
  function cmpSeq(cmp) {
    if (!cmp) return 0;
    var key = cmpGroupKey(cmp);
    var 무리 = allComponents().filter(function (c) { return cmpGroupKey(c) === key; });
    if (무리.length < 2) return 0;                 // 하나뿐이면 번호를 안 붙인다
    무리.sort(function (a, b) { return (Number(a.no) || 0) - (Number(b.no) || 0); });
    for (var i = 0; i < 무리.length; i++) if (무리[i].id === cmp.id) return i + 1;
    return 0;
  }
  function cmpLabel(cmp) {
    if (!cmp) return "";
    /* 이름표를 감춘 부품은 빈 문자열을 준다 (2026-09-08).
       ⚠ 이름 자체(cmp.name)는 그대로 둔다 — BOM·결선표·라이브러리 연결이 다 그 이름을 쓴다.
          감추는 것은 **도면에 그리는 이름표**뿐이다. 지우는 것이 아니다. */
    if (cmp.hideName) return "";
    var s = cmpSeq(cmp);
    return (s > 0 ? "#" + s + " " : "") + (cmp.name || "");
  }
  function allWires() { return allOf("wires"); }
  function allAnnotations() { return allOf("annotations"); }


  /* 도면에 내용이 있는가 — 저장본(JSON)에도 쓸 수 있는 판정.
     ⚠ 살아있는 project 에는 components/wires 가 '현재 시트'를 가리키는 별칭으로 있지만,
        JSON 으로 저장했다 읽으면 그 별칭이 사라지고 sheets 안에만 남는다.
        그래서 최상위와 시트를 모두 봐야 한다.
        이 판정이 app.js 와 store.js 두 곳에 복사돼 있었고 둘 다 최상위만 보는 바람에
        자동저장 복원이 통째로 안 됐다 (2026-08-18 발견, 배포본도 같은 상태였다).
        다시 흩어지지 않게 여기 한 곳에만 둔다. */
  function hasContent(p) {
    if (!p) return false;
    function 있나(o) {
      return !!o && !!((o.components && o.components.length) ||
                       (o.wires && o.wires.length) ||
                       (o.annotations && o.annotations.length));
    }
    if (있나(p)) return true;
    var sh = p.sheets || [];
    for (var i = 0; i < sh.length; i++) if (있나(sh[i])) return true;
    return false;
  }

  /* 저장본의 부품·배선 개수 — 목록에 "무슨 도면인지" 보여주는 데 쓴다.
     시트가 여러 장이면 합산한다. */
  function countOf(p, 무엇) {
    if (!p) return 0;
    var n = (p[무엇] || []).length;
    var sh = p.sheets || [];
    for (var i = 0; i < sh.length; i++) n += ((sh[i] && sh[i][무엇]) || []).length;
    return n;
  }

  // ---- 시트 편집 ----
  function sheetIndex(id) {
    for (var i = 0; i < project.sheets.length; i++) if (project.sheets[i].id === id) return i;
    return -1;
  }
  function addSheet(name) {
    // 무료 도면 페이지 한도 (2026-09-06). 시트 복제는 아래 duplicateSheet 가 따로 본다 —
    // 그쪽은 배선·부품도 같이 늘어나서 확인할 것이 하나 더 있다.
    if (WE.pro && !WE.pro.canAddSheet(1)) { WE.pro.deny("sheet"); return null; }
    var s = makeSheet(name || nextSheetName());
    project.sheets.push(s);
    return s;
  }
  /* ── 페이지 용지 크기 (2026-09-08) ────────────────────────────────
     시트에 size 가 있으면 그것, 없으면 프로젝트 기본값(meta.canvas).
     ⚠ 예전 파일에는 size 가 없다 — 그래서 아무것도 안 바뀐다. */
  function sheetSize(sh) {
    var s = sh || activeSheet();
    if (s && s.size && s.size.width > 0 && s.size.height > 0) {
      return { width: s.size.width, height: s.size.height };
    }
    var m = project.meta && project.meta.canvas;
    return { width: (m && m.width) || 1600, height: (m && m.height) || 900 };
  }

  /* 용지 크기를 바꾼다. **부품은 옮기지 않는다** (고원빈 확정 2026-09-08) —
     좌측 상단을 기준으로 그대로 두고, 새 용지 밖으로 나가는 것만 가장자리로 밀어 넣는다.

     ⚠ 밖으로 나간 것을 그냥 두면 화면에서 사라진다(#canvas 는 overflow:hidden).
        데이터에는 남아 BOM 에 잡히는데 눈에는 없는 '잃어버린 부품' 이 된다.
        그래서 지우지도, 통째로 옮기지도 않고 **가장자리까지만** 당긴다.

     ⚠ 되돌리기(Ctrl+Z)는 history 가 프로젝트 전체를 스냅샷하므로 그냥 된다.
        다만 한 번의 동작이 한 단계가 되도록 부르는 쪽에서 commit 을 감싼다. */
  function setSheetSize(w, h, sh) {
    var s = sh || activeSheet(); if (!s) return false;
    w = Math.round(w); h = Math.round(h);
    if (!(w > 0 && h > 0)) return false;
    var 지금 = sheetSize(s);
    if (지금.width === w && 지금.height === h) return false;
    s.size = { width: w, height: h };
    밀어넣기(s, w, h);
    return true;
  }

  /* 새 용지 밖으로 나간 것들을 가장자리 안쪽으로 당긴다. */
  function 밀어넣기(s, w, h) {
    var M = 4;   // 가장자리에 딱 붙지 않게 아주 조금 띄운다
    (s.components || []).forEach(function (c) {
      // 부품이 용지보다 크면 좌측 상단에 맞춘다 — 어디로도 다 넣을 수 없다
      c.x = Math.max(M, Math.min(c.x, Math.max(M, w - (c.width || 0) - M)));
      c.y = Math.max(M, Math.min(c.y, Math.max(M, h - (c.height || 0) - M)));
    });
    (s.annotations || []).forEach(function (a) {
      a.x = Math.max(M, Math.min(a.x, w - M));
      a.y = Math.max(M, Math.min(a.y, h - M));
    });
    (s.wires || []).forEach(function (wr) {
      (wr.waypoints || []).forEach(function (p) {
        p.x = Math.max(M, Math.min(p.x, w - M));
        p.y = Math.max(M, Math.min(p.y, h - M));
      });
      [wr.from, wr.to].forEach(function (r) {          // 배선 끝점이 좌표인 경우(분기)
        if (r && r.x != null) {
          r.x = Math.max(M, Math.min(r.x, w - M));
          r.y = Math.max(M, Math.min(r.y, h - M));
        }
      });
    });
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
    // 무료 한도 — 과금 단위가 '프로젝트 전체'이므로 시트를 복제해도 합산된다.
    // 이 경로를 막지 않으면 시트를 늘려 우회할 수 있다.
    // ⚠ 붙여넣기와 같은 이유로 부품도 센다 (부품만 있는 시트를 복제하면 통과했다)
    var _w = (project.sheets[i].wires || []).length;
    var _c = (project.sheets[i].components || []).length;
    if ((_w || _c) && WE.pro && !WE.pro.canAddBundle(_w, _c)) {
      WE.pro.deny("dupSheet", _w, _c); return null;
    }
    // 페이지 수도 늘어난다 — 배선·부품이 0 개인 빈 시트를 복제하는 경우
    // 위 검사는 통과하므로(0 개짜리 요청은 안 막는다) 여기서 따로 본다. (2026-09-06)
    if (WE.pro && !WE.pro.canAddSheet(1)) { WE.pro.deny("sheet"); return null; }
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
    // 무료 한도 — 붙여넣을 배선을 더해 넘치면 통째로 거부한다.
    // 일부만 붙이면 배선이 끊긴 채 들어와 도면이 망가진다.
    // (이 경로를 막지 않으면 Ctrl+V 를 반복해 무제한으로 늘릴 수 있다)
    // ⚠ 예전에는 배선 수만 봤다. 배선 없이 부품만 복사하면 _n 이 0 이라
    //    검사를 통째로 건너뛰었다 — 부품 한도가 생기면서 우회로가 됐을 자리다.
    var _w = (bundle.wires || []).length;
    var _c = (bundle.components || []).length;
    if ((_w || _c) && WE.pro && !WE.pro.canAddBundle(_w, _c)) {
      WE.pro.deny("paste", _w, _c); return null;
    }
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
    var base = _maxZ();   // 배열 길이가 아니라 실제 최댓값 — 삭제 후 z 충돌 방지
    // 붙여넣기·시트복제로 들어온 부품은 **새 번호**를 받는다 —
    // 원본의 번호를 그대로 들고 오면 도면에 같은 번호가 둘이 된다.
    var 새번호 = maxCmpNo() + 1;
    b.components.forEach(function (c, i) { c.z = base + i + 1; c.no = 새번호++; project.components.push(c); });
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
    // 비율 고정은 기본으로 켜 둔다 — 부품 사진은 비율이 틀어지면 그 순간 못 쓰는 그림이 된다.
    // 일부러 찌그러뜨릴 일은 드물어서, 필요한 사람만 끄는 편이 사고가 적다.
    lockAspect: true,
    mode: "select",            // 'select' | 'wire'
    selectedTerminalId: null,
    wireColor: "#e53935",      // 새 배선에 적용할 색
    wireWidth: 2,
    wireAwg: "",               // 새 배선에 적용할 규격(AWG). 빈 값은 미지정. 팔레트 색이 정한다.
    wireRouting: "ortho",      // 'ortho'(직각) | 'straight'(직선)
    selectedWp: null,          // 선택된 꺾임점 인덱스
    selectedWireLabel: null,   // 라벨(수축튜브)을 직접 클릭해 선택한 배선 id — Delete 시 라벨만 삭제
    selectedWireLabelEnd: null // 그중 어느 끝("from"|"to") — 라벨은 배선당 둘이라 끝까지 구분해야 한다
  };

  var DEFAULT_TERMINAL_COLOR = "#1e88e5";

  var _idCounter = 1;
  function nextId(prefix) {
    return prefix + "_" + (_idCounter++) + "_" + Math.floor(Math.random() * 1000);
  }

  // 부품 인스턴스 생성
  function addComponent(opts) {
    // 무료 한도 — 도면에 놓는 부품만 센다.
    // ⚠ 내 부품 라이브러리(WE.library.addPart)에는 한도를 걸지 않는다.
    //    pricing.html 이 "내 부품 라이브러리 무제한" 을 약속하고 있다.
    if (WE.pro && !WE.pro.canAddComp(1)) { WE.pro.deny("place", 0, 1); return null; }
    var cmp = {
      id: nextId("cmp"),
      libraryId: opts.libraryId || null,
      // 공용 부품을 내 라이브러리에 복사하지 않고 바로 배치할 때의 원본 식별자.
      // publicSnapshot은 BOM에 필요한 읽기 전용 정보만 담아 프로젝트 파일이 자립하게 한다.
      publicId: opts.publicId || null,
      publicVersion: opts.publicVersion || null,
      publicSnapshot: opts.publicSnapshot ? JSON.parse(JSON.stringify(opts.publicSnapshot)) : null,
      name: opts.name || WE.i18n.t("부품"),
      x: opts.x != null ? opts.x : 100,
      y: opts.y != null ? opts.y : 100,
      rotation: 0,
      scale: 1,
      width: opts.width || 160,
      height: opts.height || 120,
      z: _maxZ() + 1,
      image: opts.image || null,   // data:image/... base64
      terminals: opts.terminals || [],  // Phase 2
      nameLabelPos: opts.nameLabelPos ? { x: opts.nameLabelPos.x, y: opts.nameLabelPos.y } : undefined,
      terminalPlacementQueue: Array.isArray(opts.terminalPlacementQueue) ? opts.terminalPlacementQueue : undefined,
      terminalPlacementQueueVersion: opts.terminalPlacementQueueVersion
    };
    cmp.no = maxCmpNo() + 1;   // 프로젝트 통번호 (위 ensureCmpNos 주석 참고)
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
    /* ⚠ 네 번째 입구다. 배치·붙여넣기·시트복제만 막으면
          "하나 놓고 Ctrl+D 를 계속 누르기" 로 무제한이 된다. */
    if (WE.pro && !WE.pro.canAddComp(1)) { WE.pro.deny("dupComp", 0, 1); return null; }
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = nextId("cmp");
    copy.no = maxCmpNo() + 1;   // 복제본은 새 번호 — 원본 번호를 물려받으면 도면에 같은 번호가 둘이 된다
    copy.x += 20; copy.y += 20;
    copy.z = _maxZ() + 1;
    project.components.push(copy);
    return copy;
  }

  /* ---- 겹침 순서(z) 바꾸기 ----
     같은 시트 안에서만 의미가 있다 — render.js 가 project.components(현재 시트)를
     z 로 정렬해 그린다. 캔바 등에서 흔히 쓰는 네 동작을 그대로 둔다.
     (2026-09-03, 부품이 서로 겹칠 때 위아래를 바꿀 방법이 없다는 제보) */
  /* 겹침 순서(z) 겹침 정리 — 예전엔 z 를 '배열 길이+1' 로 매겨 삭제 후 값이 겹쳤다
     (위 _maxZ 주석 참고). 이미 저장된 파일에 그 흔적이 남아 있어(실측: 실사용 파일에서
     3건 발견, 2026-09-03), 열 때 시트마다 한 번씩 중복 없는 값으로 다시 매긴다.
     지금 보이는 순서(=지금 z로 정렬했을 때 순서, 동점이면 원래 배열 순서)는 그대로 두고
     번호만 1,2,3… 으로 깨끗하게 다시 붙인다 — 화면에 아무 변화도 없어야 하는 조용한 이관이다. */
  function ensureUniqueZ() {
    project.sheets.forEach(function (sh) {
      var cs = (sh.components || []).map(function (c, i) { return { c: c, i: i }; })
        .sort(function (a, b) { return (a.c.z || 0) - (b.c.z || 0) || a.i - b.i; });
      cs.forEach(function (o, idx) { o.c.z = idx + 1; });
    });
  }

  function _byZ() {
    return project.components.slice().sort(function (a, b) { return (a.z || 0) - (b.z || 0); });
  }
  /* 겹침 순서는 **배선층까지 넘나든다.** (2026-09-08)

     예전에는 부품끼리만 순서를 바꿨다. 그런데 화면 층 순서가 고정이라
     (부품 → 배선) 부품은 무조건 배선 아래였고, "배선에 가려서 안 보인다" 를
     겹침 순서로 풀 수 없었다.

     그래서 배선층을 **부품 하나처럼** 취급한다. 위에서부터:
         [aboveWires 인 부품들] · 배선 · [나머지 부품들]
     앞으로 가져오기를 누르면 자기 무리 안에서 한 칸 오르고, 무리 꼭대기에 닿으면
     배선을 넘어 반대 무리의 바닥으로 간다. 뒤로 보내기는 그 반대다.

     ⚠ aboveWires 는 새 항목이라 예전 파일에는 없다. 없으면 '배선 아래'로 읽히므로
        기존 도면의 모습이 하나도 안 바뀐다. */
  function _무리(위인가) {
    return _byZ().filter(function (x) { return !!x.aboveWires === !!위인가; });
  }
  function bringToFront(id) {
    var c = getComponent(id); if (!c) return false;
    var 위 = _무리(true);
    // 이미 맨 위(배선 위 무리의 꼭대기)면 할 일이 없다
    if (c.aboveWires && 위.length && 위[위.length - 1].id === id) return false;
    c.aboveWires = true;
    c.z = _maxZ() + 1;
    return true;
  }
  function sendToBack(id) {
    var c = getComponent(id); if (!c) return false;
    var 아래 = _무리(false);
    if (!c.aboveWires && 아래.length && 아래[0].id === id) return false;   // 이미 맨 뒤
    var list = _byZ();
    delete c.aboveWires;
    c.z = (list.length ? list[0].z : 0) - 1;
    return true;
  }
  function bringForward(id) {
    var c = getComponent(id); if (!c) return false;
    var 내무리 = _무리(c.aboveWires);
    var i = 내무리.findIndex(function (x) { return x.id === id; });
    if (i < 0) return false;
    if (i < 내무리.length - 1) {                 // 무리 안에서 한 칸 위로
      var za = 내무리[i].z, zb = 내무리[i + 1].z;
      내무리[i].z = zb; 내무리[i + 1].z = za;
      return true;
    }
    if (c.aboveWires) return false;              // 이미 맨 위
    // 무리 꼭대기 → 배선을 넘어 위 무리의 **바닥**으로
    var 위 = _무리(true);
    c.aboveWires = true;
    c.z = 위.length ? 위[0].z - 1 : _maxZ() + 1;
    return true;
  }
  function sendBackward(id) {
    var c = getComponent(id); if (!c) return false;
    var 내무리 = _무리(c.aboveWires);
    var i = 내무리.findIndex(function (x) { return x.id === id; });
    if (i < 0) return false;
    if (i > 0) {                                  // 무리 안에서 한 칸 아래로
      var za = 내무리[i].z, zb = 내무리[i - 1].z;
      내무리[i].z = zb; 내무리[i - 1].z = za;
      return true;
    }
    if (!c.aboveWires) return false;              // 이미 맨 뒤
    // 위 무리의 바닥 → 배선을 넘어 아래 무리의 **꼭대기**로
    var 아래 = _무리(false);
    delete c.aboveWires;
    c.z = 아래.length ? 아래[아래.length - 1].z + 1 : _maxZ() + 1;
    return true;
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
    // visible은 꺼진 단자에만 false로 저장한다. 값이 없는 기존 파일은 모두 켜진 상태라
    // 데이터 이관 없이 그대로 열린다.
    if (opts.visible === false) t.visible = false;
    if (opts.presetSource) t.presetSource = opts.presetSource;
    if (opts.presetId) t.presetId = opts.presetId;
    cmp.terminals.push(t);
    return t;
  }
  function getTerminal(cmp, termId) {
    for (var i = 0; i < cmp.terminals.length; i++) {
      if (cmp.terminals[i].id === termId) return cmp.terminals[i];
    }
    return null;
  }
  function terminalConnected(cmp, termId) {
    if (!cmp) return false;
    return project.wires.some(function (w) {
      return (w.from && w.from.componentId === cmp.id && w.from.terminalId === termId) ||
             (w.to && w.to.componentId === cmp.id && w.to.terminalId === termId);
    });
  }
  // 끄기는 단자를 삭제하지 않는다. 좌표·이름·프리셋은 보존되고 도면 노출만 멈춘다.
  // 연결된 끝점을 숨기면 배선이 허공에서 끝난 것처럼 보이므로 그 경우에는 거부한다.
  function setTerminalVisible(cmp, termId, visible) {
    var t = getTerminal(cmp, termId); if (!t) return false;
    if (!visible && terminalConnected(cmp, termId)) return false;
    if (visible) { delete t.visible; delete t.autoHidden; } else { t.visible = false; }
    /* ⚠ 다시 켤 때 autoHidden 표시도 반드시 지운다.
       안 지우면 "툴바가 숨긴 것" 이라는 표시가 남아, 나중에 토글을 눌렀을 때
       사용자가 손으로 켜 둔 단자를 이 버튼이 제 것인 줄 알고 도로 숨긴다. (2026-09-08) */
    return true;
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
    // 무료 한도 — 프로젝트 전체 배선 수로 센다(현재 시트가 아니라).
    // id 를 뽑기 '전에' 막는다. 뒤에서 막으면 거부할 때마다 번호가 하나씩 샌다.
    // 출시 전에는 canAdd 가 항상 true 라 동작이 지금과 똑같다.
    if (WE.pro && !WE.pro.canAdd(1)) { WE.pro.deny("draw"); return null; }
    var w = {
      id: nextId("w"),
      from: fromRef,
      to: toRef,
      color: color || ui.wireColor,
      width: width || ui.wireWidth,
      // 규격(AWG) — 팔레트 색이 정한 값이 ui.wireAwg 로 와 여기 박힌다. 결선표 규격 열이 이걸 읽는다.
      awg: ui.wireAwg || "",
      // 배선 모양(직각/직선)은 '그릴 때' 정해져 배선에 남는다.
      // 예전에는 화면 설정 하나를 렌더할 때마다 읽어서, 스위치를 넘기면 이미 그려 둔 배선까지
      // 전부 다시 계산됐다. 도면이 '보는 사람의 설정'에 따라 달라지는 문제도 같이 있었다.
      routing: ui.wireRouting,
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
    project.wireNote = {};
    project.bomEdit = {};
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
    // 도면이 바뀌면 한도 안내 상태를 초기화한다 —
    // 안 하면 이전 도면에서 한 번 본 안내가 새 도면에서 영영 안 뜬다.
    if (WE.pro) WE.pro.projectChanged();
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
          components: s.components || [], wires: s.wires || [], annotations: s.annotations || [],
          // 페이지마다 다른 용지 크기(2026-09-08). 없으면 undefined 로 두어
          // sheetSize() 가 예전처럼 project.meta.canvas 를 쓰게 한다.
          size: (s.size && s.size.width > 0 && s.size.height > 0)
                  ? { width: s.size.width, height: s.size.height } : undefined
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
    project.wireNote = data.wireNote || {};
    project.bomEdit = data.bomEdit || {};
    project.bomOrder = data.bomOrder || [];
    project.bomColShow = data.bomColShow || defaultBomColShow();
    project.bomExtraCols = data.bomExtraCols || [];
    project.bomCustom = data.bomCustom || {};
    project.bomRowH = (typeof data.bomRowH === "number") ? data.bomRowH : 6;
    project.bomColW = data.bomColW || {};
    project.bomColOrder = data.bomColOrder || [];
    clearSelection();
    ui.selectedTerminalId = null;
    /* 부품 번호 이관 — 번호가 생기기 전에 만든 파일에는 no 가 없다.
       여기서 한 번 채워 주면 그 뒤로는 저장본에 남는다. 이미 번호가 있으면 안 건드린다. */
    ensureCmpNos();
    ensureUniqueZ();
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
      (s.wires || []).forEach(function (w) {
        scan(w.id);
        // 예전 파일에는 배선 모양이 없다. 지금 화면에 보이던 모양(= 현재 기본 설정)을 그대로 찍어 둔다.
        // 이렇게 해야 '옛 파일을 열었더니 그림이 바뀐다'는 일이 없다 — 여는 순간의 모양은 그대로고,
        // 그 뒤로만 배선마다 자기 모양을 지킨다.
        if (w.routing !== "ortho" && w.routing !== "straight") w.routing = ui.wireRouting;
      });
      (s.annotations || []).forEach(function (a) { scan(a.id); });
    });
    _idCounter = maxN + 1;

    /* ── 캔버스 밖에 있는 부품을 안으로 당긴다 (2026-09-02 고원빈 결정) ──
       캔버스는 viewBox 가 고정이고 overflow:hidden 이라, 밖에 있는 부품은
       **화면에 아예 안 보인다.** 데이터에는 남아 BOM 에는 잡히는데 클릭도 PDF 도 안 된다.
       그래서 여는 시점에 가장 가까운 안쪽 자리로 당긴다.

       ⚠ 이건 **파일을 열면 그림이 달라질 수 있다**는 뜻이다.
          바로 위 배선 모양 처리에 "옛 파일을 열었더니 그림이 바뀐다는 일이 없다"고
          적어 둔 원칙과 정면으로 다르다. 알고 그렇게 정했다 —
          안 보이는 부품을 그대로 두는 것보다 자리를 조금 옮기는 편이 낫다는 판단이다.
       ⚠ 조금만 삐져나온 부품도 당겨진다. 전부 안 또는 전부 밖, 둘 중 하나여야
          "가두기"가 규칙으로 성립한다.
       ⚠ 캔버스보다 큰 부품은 건드리지 않는다(pullInside 가 그 축을 그냥 넘긴다).
          어디에 둬도 안 들어가므로 옮겨 봐야 의미가 없다. */
    if (WE.geometry && WE.geometry.pullInside) {
      project.sheets.forEach(function (s) {
        /* ⚠ **그 페이지의** 용지 크기로 가둔다. 예전엔 인자 없이 불렀는데,
           그건 '지금 보고 있는 페이지' 크기라서 페이지마다 용지가 달라진 뒤로는
           틀린 값이었다. 열 때 활성 시트는 늘 1장이라, 세로로 만든 2장이 1장 높이(900)로
           눌려 부품이 통째로 위쪽에 뭉쳤다 (2026-09-08 고원빈 신고). */
        var cv = sheetSize(s);
        (s.components || []).forEach(function (c) { WE.geometry.pullInside(c, cv); });
      });
    }

    // 파일열기 · 자동저장 복원 · 최근작업 · 샘플 · 되돌리기가 모두 이 함수를 지난다.
    // 여기 한 곳에 걸면 모든 경로가 덮인다.
    if (WE.pro) WE.pro.projectChanged();
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
  /* 주석(텍스트) 다중 선택 토글.
     ⚠ 배선의 toggleMultiWire 와 **같은 규칙**이다 — 다른 종류의 선택(multi)을 건드리지 않는다.
        예전에는 주석만 이 길이 없어서 select("annotation") 을 탔고, 그 함수가 multi 를 비워서
        Ctrl+클릭으로 부품과 텍스트를 함께 고를 수 없었다(2026-09-08 실측: 부품 3개가 날아갔다). */
  function toggleMultiAnno(id) {
    var i = multiAnno.indexOf(id);
    if (i >= 0) multiAnno.splice(i, 1); else multiAnno.push(id);
    if (multiAnno.length) { selection.type = "annotation"; selection.id = multiAnno[multiAnno.length - 1]; }
    else if (multi.length) { selection.type = "component"; selection.id = multi[multi.length - 1]; }
    else if (multiWire.length) { selection.type = "wire"; selection.id = multiWire[multiWire.length - 1]; }
    else { selection.type = null; selection.id = null; }
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
    sheetSize: sheetSize,
    setSheetSize: setSheetSize,
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
    ensureCmpNos: ensureCmpNos,
    cmpLabel: cmpLabel,
    cmpSeq: cmpSeq,
    cmpGroupKey: cmpGroupKey,
    maxCmpNo: maxCmpNo,
    allWires: allWires,
    hasContent: hasContent,
    countOf: countOf,
    allAnnotations: allAnnotations,
    DEFAULT_TERMINAL_COLOR: DEFAULT_TERMINAL_COLOR,
    addTerminal: addTerminal,
    getTerminal: getTerminal,
    terminalConnected: terminalConnected,
    setTerminalVisible: setTerminalVisible,
    removeTerminal: removeTerminal,
    nextId: nextId,
    addComponent: addComponent,
    getComponent: getComponent,
    removeComponent: removeComponent,
    duplicateComponent: duplicateComponent,
    ensureUniqueZ: ensureUniqueZ,
    bringToFront: bringToFront,
    sendToBack: sendToBack,
    bringForward: bringForward,
    sendBackward: sendBackward,
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
    toggleMultiAnno: toggleMultiAnno,
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

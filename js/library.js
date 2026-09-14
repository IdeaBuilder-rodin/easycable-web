// library.js — 부품 라이브러리 (IndexedDB 상주, 재사용)
var WE = window.WE || {};
window.WE = WE;

WE.library = (function () {
  var KEY = "library";       // 구 형식(이미지·PDF가 base64로 박힌 통짜) — 마이그레이션 검증 전까지 보존
  var KEY2 = "library2";     // 신 형식(첨부물은 자산 풀 참조). WE.assets.pack/unpack 경유
  var parts = [];    // { id, name, spec, image, defaultWidth, defaultHeight, folderId, terminals:[{name,color,rx,ry}] }
  var folders = [];  // { id, name, parentId(null=대분류), collapsed } — 2단계까지만 (UI에서 강제)

  // 저장본(구/신 공통) → { parts, folders }
  function toModel(d) {
    // 구버전 저장본은 부품 배열만 있음 → 폴더 없이 그대로 (전부 미분류 취급)
    if (Object.prototype.toString.call(d) === "[object Array]") return { parts: d, folders: [] };
    return { parts: d.parts || [], folders: d.folders || [] };
  }

  // 신 형식이 있으면 그걸 쓰고, 없으면 구 형식을 읽어 한 번만 옮긴다.
  // 옮기기 전 pack→unpack 왕복이 원본과 완전히 같은지 확인하고, 다르면 구 형식을 그대로 쓴다.
  function load(cb) {
    WE.store.getRaw(KEY2, function (json2) {
      if (json2) {
        try {
          var m = toModel(WE.assets.unpack(JSON.parse(json2)));
          parts = m.parts; folders = m.folders;
        } catch (e) { parts = []; folders = []; }
        cb && cb();
        return;
      }
      WE.store.getRaw(KEY, function (json) {
        if (!json) { cb && cb(); return; }
        var d;
        try { d = JSON.parse(json); } catch (e) { parts = []; folders = []; cb && cb(); return; }
        var m = toModel(d);
        parts = m.parts; folders = m.folders;

        var packed = WE.assets.pack(d);
        if (JSON.stringify(WE.assets.unpack(packed)) !== JSON.stringify(d)) {
          console.warn("[assets] 무손실 검증 실패 — 구 형식을 그대로 사용합니다.");
          cb && cb();
          return;
        }
        WE.assets.flush(function (n) {
          WE.store.putRaw(KEY2, JSON.stringify(packed));
          console.log("[assets] 라이브러리 이전 완료 — 첨부물 " + n + "개를 자산 풀로 분리했습니다. (구 형식은 보존됨)");
          cb && cb();
        });
      });
    });
  }

  /* ── 묶음 작업 중에는 저장을 미룬다 ──────────────────────────────────
     ⚠ 왜 필요한가 (2026-08-27 측정) —
        addPart / updatePart 가 각각 save() 를 부른다. importJson 은 부품을
        하나씩 addPart 하므로 **부품 수만큼 전체 저장**이 일어났다.
        save() 한 번이 라이브러리 전체를 pack + 직렬화하므로 O(n²) 이 된다.

          부품  50개 →   0.3초
          부품 300개 →  28.6초      ← 브라우저가 '응답 없음' 을 띄운다
          부품 500개 →  86.9초

        공용 부품 팩(수백 개)을 불러오는 순간 앱이 멈춘다.
        그래서 묶음 동안에는 '나중에 저장할 것' 만 표시하고, 끝에 한 번만 쓴다.

     ⚠ save() 를 부르는 곳이 13군데다. 호출부를 모두 고치는 대신 여기서 막는다 —
        새로 생기는 호출부도 자동으로 안전해진다. */
  var _묶음 = 0, _밀린저장 = false;

  function 묶음시작() { _묶음++; }
  function 묶음끝() {
    if (--_묶음 > 0) return;            // 중첩되면 가장 바깥에서만 쓴다
    if (!_밀린저장) return;
    _밀린저장 = false;
    save();
  }

  function save() {
    if (_묶음 > 0) { _밀린저장 = true; return; }
    var packed = WE.assets.pack({ folders: folders, parts: parts });
    WE.assets.flush();
    WE.store.putRaw(KEY2, JSON.stringify(packed));
    /* 서버 수집(js/libsync.js) — 저장이 **끝난 뒤** 타이머만 건다. 저장 자체는 위에서 이미 끝났고,
       libsync 가 없거나 무슨 오류를 내도 여기서 삼킨다. 에디터가 이 줄 때문에 달라지면 안 된다(2026-09-14). */
    try { if (WE.libsync && WE.libsync.touch) WE.libsync.touch(); } catch (e) { /* 무시 */ }
  }

  // ---- 폴더 ----
  // 폴더 id는 로컬 순번 대신 UUID형 발급 — 나중에 여러 사용자의 라이브러리를
  // 서버 DB 한 곳에 모을 때 id 충돌·재매핑 없이 그대로 옮기기 위함
  function uid() { return "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function getFolders() { return folders; }
  function getFolder(id) {
    for (var i = 0; i < folders.length; i++) if (folders[i].id === id) return folders[i];
    return null;
  }
  // 대분류 안에만 하위 폴더 허용 (2단계 제한)
  function addFolder(name, parentId) {
    if (parentId) {
      var pf = getFolder(parentId);
      if (!pf || pf.parentId) return null;
    }
    var f = { id: uid(), name: name || WE.i18n.t("새 폴더"), parentId: parentId || null, collapsed: false };
    folders.push(f); save(); return f;
  }
  function renameFolder(id, name) {
    var f = getFolder(id); if (!f || !name) return;
    f.name = name; save();
  }
  // 폴더 삭제: 부품은 지우지 않고 상위 폴더(대분류면 미분류)로, 하위 폴더는 대분류로 승격
  function removeFolder(id) {
    var f = getFolder(id); if (!f) return;
    var dest = f.parentId || null;
    parts.forEach(function (p) { if (p.folderId === id) p.folderId = dest; });
    folders.forEach(function (c) { if (c.parentId === id) c.parentId = null; });
    folders = folders.filter(function (c) { return c.id !== id; });
    save();
  }
  function toggleFolder(id) {
    var f = getFolder(id); if (!f) return;
    f.collapsed = !f.collapsed; save();
  }
  // 전체 접기/펼치기 — 폴더가 많아지면 하나씩 누르기 힘들다 (Shift+C)
  function setAllCollapsed(v) {
    folders.forEach(function (f) { f.collapsed = !!v; });
    save();
  }
  function allCollapsed() {
    for (var i = 0; i < folders.length; i++) if (!folders[i].collapsed) return false;
    return true;
  }
  // 폴더를 beforeId 폴더 앞으로 이동(beforeId 없으면 맨 끝) — 렌더는 부모별로 걸러 그리므로
  // 전역 배열 순서만 바꾸면 같은 계층 안에서의 표시 순서가 바뀐다
  function reorderFolderBefore(id, beforeId) {
    var idx = -1, i;
    for (i = 0; i < folders.length; i++) if (folders[i].id === id) { idx = i; break; }
    if (idx < 0 || id === beforeId) return;
    var f = folders.splice(idx, 1)[0];
    if (beforeId == null) { folders.push(f); }
    else {
      var bi = -1;
      for (i = 0; i < folders.length; i++) if (folders[i].id === beforeId) { bi = i; break; }
      if (bi < 0) folders.push(f); else folders.splice(bi, 0, f);
    }
    save();
  }

  function movePart(partId, folderId) {
    var p = get(partId); if (!p) return;
    p.folderId = (folderId && getFolder(folderId)) ? folderId : null;
    save();
  }

  function getAll() { return parts; }
  function get(id) {
    for (var i = 0; i < parts.length; i++) if (parts[i].id === id) return parts[i];
    return null;
  }
  function findByName(name) {
    for (var i = 0; i < parts.length; i++) if (parts[i].name === name) return parts[i];
    return null;
  }

  /* ---- '같은 부품인가' 판정 (2026-09-03 고원빈 확정) ----
     예전에는 **이름만** 같으면 같은 부품으로 봤다. 그런데 이름이 같아도 스펙이 다른 부품을
     같이 쓰는 일이 흔하다(스텝다운모듈 SZH-PWSD-045 / HAM2728). 그 상태에서 공유 파일을 열면
     파일 속 부품이 내 다른 부품에 붙어, 도면에 엉뚱한 스펙·이미지가 앉았다.

     규칙 — 위에서부터 먼저 맞는 것을 쓴다:
       1) 같은 부품 id      : 같은 레코드다. 같은 파일을 두 번 열어도 복사본이 안 생긴다
       2) 같은 publicId     : 공용 카탈로그에서 온 것은 이게 진짜 신원이다
       3) 이름 + 모델명(spec) 이 **둘 다 채워져 있고** 완전히 같을 때만 같은 부품
     그 밖은 전부 다른 부품이다. **모델명이 비어 있으면 같은 부품으로 보지 않는다** —
     비었다는 것은 구분할 근거가 없다는 뜻이라, 합쳐서 틀리느니 따로 두는 편이 낫다. */
  function sameSpec(a, b) {
    var x = String(a == null ? "" : a).trim(), y = String(b == null ? "" : b).trim();
    return !!x && !!y && x === y;
  }
  function findSame(p) {
    if (!p) return null;
    var i;
    if (p.id) { for (i = 0; i < parts.length; i++) if (parts[i].id === p.id) return parts[i]; }
    if (p.publicId) { for (i = 0; i < parts.length; i++) if (parts[i].publicId === p.publicId) return parts[i]; }
    for (i = 0; i < parts.length; i++) {
      if (parts[i].name === p.name && sameSpec(parts[i].spec, p.spec)) return parts[i];
    }
    return null;
  }

  /* 공용 부품에서 가져온 개인 항목은 내용을 고치는 순간 별도 부품이 된다.
     publicId를 남겨 두면 공용 부품을 다시 가져올 때 같은 항목으로 오인하고,
     관리자가 게시할 때도 원본을 갱신할 대상으로 잘못 판단할 수 있다. */
  var PART_CONTENT_FIELDS = [
    "name", "spec", "link", "linkKr", "linkPref", "image", "defaultWidth", "defaultHeight",
    "terminals", "nameLabelPos", "terminalPlacementQueue", "terminalPlacementQueueVersion",
    "role", "volt", "current", "power", "capacityAh", "dod", "minPerHour", "efficiency",
    "price", "priceKr", "datasheets"
  ];
  function comparableField(key, value) {
    if (key === "terminals" && Array.isArray(value)) return value.map(function (t) {
      var out = { name: t.name, color: t.color, rx: t.rx, ry: t.ry };
      if (t.visible === false) out.visible = false;
      if (t.labelSide) out.labelSide = t.labelSide;
      if (t.labelPos) out.labelPos = { x: t.labelPos.x, y: t.labelPos.y };
      return out;
    });
    if (key === "terminalPlacementQueue" && Array.isArray(value)) return value.map(function (item) {
      return { label: item.label, color: item.color };
    });
    if (key === "datasheets" && Array.isArray(value)) return value.map(function (d) {
      return { id: d.id, name: d.name, type: d.type, data: d.data };
    });
    return value;
  }
  function contentChanged(part, patch) {
    return PART_CONTENT_FIELDS.some(function (key) {
      if (patch[key] === undefined) return false;
      return JSON.stringify(comparableField(key, part[key])) !== JSON.stringify(comparableField(key, patch[key]));
    });
  }
  function detachPublicLink(part) {
    if (!part || !part.publicId) return false;
    part.publicId = null;
    part.publicVersion = null;
    // 같은 개인 라이브러리 항목을 쓰는 배치 부품도 공용 원본 신원을 들고 있으면
    // 게시·BOM 판정에서 다시 원본과 묶인다. 라이브러리 연결은 유지하고 공용 신원만 지운다.
    if (WE.model && WE.model.allComponents) WE.model.allComponents().forEach(function (c) {
      if (c.libraryId !== part.id) return;
      c.publicId = null;
      c.publicVersion = null;
      c.publicSnapshot = null;
    });
    return true;
  }

  // 기존 부품 덮어쓰기 (id 유지). 파일 가져오기처럼 원본 신원을 복원하는 경로만 preservePublicLink를 쓴다.
  function updatePart(id, p, opts) {
    var part = get(id); if (!part) return null;
    if (!(opts && opts.preservePublicLink) && contentChanged(part, p)) detachPublicLink(part);
    if (p.name != null) part.name = p.name;
    if (p.spec != null) part.spec = p.spec;
    if (p.link != null) part.link = p.link;
    if (p.linkKr != null) part.linkKr = p.linkKr;
    if (p.linkPref != null) part.linkPref = p.linkPref === "kr" ? "kr" : "global";
    if (p.image !== undefined) part.image = p.image;
    if (p.defaultWidth) part.defaultWidth = p.defaultWidth;
    if (p.defaultHeight) part.defaultHeight = p.defaultHeight;
    if (p.terminals) part.terminals = p.terminals.map(function (t) {
      var s = { name: t.name, color: t.color, rx: t.rx, ry: t.ry };
      if (t.visible === false) s.visible = false;
      if (t.labelSide) s.labelSide = t.labelSide;
      if (t.labelPos) s.labelPos = { x: t.labelPos.x, y: t.labelPos.y };
      return s;
    });
    if (p.nameLabelPos !== undefined) {
      if (p.nameLabelPos) part.nameLabelPos = { x: p.nameLabelPos.x, y: p.nameLabelPos.y };
      else delete part.nameLabelPos;
    }
    if (Array.isArray(p.terminalPlacementQueue)) part.terminalPlacementQueue = p.terminalPlacementQueue.map(function (item) {
      return { label: item.label, color: item.color };
    });
    if (p.terminalPlacementQueueVersion != null) part.terminalPlacementQueueVersion = p.terminalPlacementQueueVersion;
    if (p.folderId !== undefined) part.folderId = p.folderId || null;
    if (p.publicId !== undefined) part.publicId = p.publicId || null;
    if (p.publicVersion !== undefined) part.publicVersion = p.publicVersion || null;
    ["role", "volt", "current", "power", "capacityAh", "dod", "minPerHour", "efficiency", "price", "priceKr"].forEach(function (k) {
      if (p[k] != null) part[k] = p[k];
    });
    if (p.datasheets) part.datasheets = p.datasheets.map(function (d) {
      return { id: d.id, name: d.name, type: d.type, data: d.data };
    });
    save(); return part;
  }

  /* 배치된 공용 부품 한 개만 편집할 때는 공용 원본 항목을 그대로 남기고 개인 사본을 만든다.
     그러면 공용 부품을 다시 가져와도 원본과 수정본이 서로 다른 libraryId를 가진다. */
  function copyAsIndependent(id) {
    var source = get(id); if (!source) return null;
    if (!source.publicId) return source;
    var data = JSON.parse(JSON.stringify(source));
    delete data.id;
    data.publicId = null;
    data.publicVersion = null;
    return addPart(data);
  }

  function addPart(p) {
    var part = {
      id: WE.model.nextId("lib"),
      name: p.name || WE.i18n.t("부품"),
      spec: p.spec || "",
      // 구매 링크는 국내·해외 두 개. link 는 예전부터 쓰던 필드라 이름을 바꾸지 않고
      // 그대로 '해외'로 쓴다 — 이미 저장된 사용자 부품의 링크가 사라지면 안 된다.
      // 어느 쪽을 BOM 에 낼지는 linkPref 가 정한다(기본 해외). 실제 결정은 WE.library.bomLink().
      link: p.link || "",
      linkKr: p.linkKr || "",
      linkPref: p.linkPref === "kr" ? "kr" : "global",
      folderId: (p.folderId && getFolder(p.folderId)) ? p.folderId : null,
      // 공용 카탈로그 원본과의 연결. 사용자가 수정한 로컬 부품을 자동으로 덮어쓰는 데 쓰지 않는다.
      publicId: p.publicId || null,
      publicVersion: p.publicVersion || null,
      image: p.image || null,
      defaultWidth: p.defaultWidth || 160,
      defaultHeight: p.defaultHeight || 120,
      // 전력/배터리 계산용 (문자열 그대로; 계산 시 숫자 변환)
      role: p.role || "load",           // 'battery' | 'load' | 'converter'
      volt: p.volt || "",
      current: p.current || "",
      power: p.power || "",
      capacityAh: p.capacityAh || "",
      dod: p.dod != null ? p.dod : "",
      minPerHour: p.minPerHour != null ? p.minPerHour : "",
      efficiency: p.efficiency != null ? p.efficiency : "",
      // 단가도 국내·해외 두 개. price 는 예전부터 쓰던 필드라 이름을 그대로 두고 '해외'로 쓴다
      // (이미 넣어 둔 단가가 사라지면 안 된다). 어느 쪽을 BOM 에 낼지는 linkPref 가 정한다 —
      // **구매링크와 똑같은 규칙**이다. 실제 결정은 WE.library.bomPrice().
      price: p.price != null ? p.price : "",
      priceKr: p.priceKr != null ? p.priceKr : "",
      datasheets: (p.datasheets || []).map(function (d) {
        return { id: d.id, name: d.name, type: d.type, data: d.data };
      }),
      terminals: (p.terminals || []).map(function (t) {
        var s = { name: t.name, color: t.color, rx: t.rx, ry: t.ry };
        if (t.visible === false) s.visible = false;
        if (t.labelSide) s.labelSide = t.labelSide;
        if (t.labelPos) s.labelPos = { x: t.labelPos.x, y: t.labelPos.y };
        return s;
      }),
      nameLabelPos: p.nameLabelPos ? { x: p.nameLabelPos.x, y: p.nameLabelPos.y } : undefined,
      terminalPlacementQueue: Array.isArray(p.terminalPlacementQueue) ? p.terminalPlacementQueue.map(function (item) {
        return { label: item.label, color: item.color };
      }) : undefined,
      terminalPlacementQueueVersion: p.terminalPlacementQueueVersion
    };
    parts.push(part); save(); return part;
  }

  // 캔버스 부품 인스턴스로부터 라이브러리 부품 생성
  function addFromComponent(cmp) {
    return addPart({
      name: cmp.name, spec: "", image: cmp.image,
      defaultWidth: cmp.width, defaultHeight: cmp.height,
      terminals: cmp.terminals,
      nameLabelPos: cmp.nameLabelPos,
      terminalPlacementQueue: cmp.terminalPlacementQueue,
      terminalPlacementQueueVersion: cmp.terminalPlacementQueueVersion
    });
  }

  function remove(id) {
    parts = parts.filter(function (p) { return p.id !== id; });
    save();
  }

  // 즐겨찾기 토글 (부품에 저장 → 백업에도 포함)
  function toggleFav(id) {
    var p = get(id); if (!p) return false;
    p.fav = !p.fav; save(); return p.fav;
  }

  // id 부품을 beforeId 앞으로 이동(beforeId 없으면 맨 끝)
  function reorderBefore(id, beforeId) {
    var idx = -1, i;
    for (i = 0; i < parts.length; i++) if (parts[i].id === id) { idx = i; break; }
    if (idx < 0) return;
    var part = parts.splice(idx, 1)[0];
    if (beforeId == null) { parts.push(part); }
    else {
      var bi = -1;
      for (i = 0; i < parts.length; i++) if (parts[i].id === beforeId) { bi = i; break; }
      if (bi < 0) parts.push(part); else parts.splice(bi, 0, part);
    }
    save();
  }

  // 라이브러리 부품 → 캔버스 인스턴스 데이터 (단자에 새 id 부여)
  function instanceOpts(part, x, y) {
    return {
      libraryId: part.id, name: part.name, image: part.image,
      publicId: part.publicId || null,
      publicVersion: part.publicVersion || null,
      width: part.defaultWidth, height: part.defaultHeight, x: x, y: y,
      terminals: part.terminals.map(function (t) {
        var nt = { id: WE.model.nextId("t"), name: t.name, color: t.color, rx: t.rx, ry: t.ry };
        if (t.visible === false) nt.visible = false;
        if (t.labelSide) nt.labelSide = t.labelSide;
        if (t.labelPos) nt.labelPos = { x: t.labelPos.x, y: t.labelPos.y };
        return nt;
      }),
      nameLabelPos: part.nameLabelPos ? { x: part.nameLabelPos.x, y: part.nameLabelPos.y } : undefined,
      terminalPlacementQueue: Array.isArray(part.terminalPlacementQueue) ? part.terminalPlacementQueue.map(function (item) {
        return { id: WE.model.nextId("pq"), label: item.label, color: item.color };
      }) : undefined,
      terminalPlacementQueueVersion: part.terminalPlacementQueueVersion
    };
  }

  function exportJson() { return JSON.stringify({ folders: folders, parts: parts }, null, 2); }

  // 라이브러리 가져오기
  // - 같은 이름의 부품이 이미 있으면 새로 만들지 않고 기존 부품을 갱신 → 중복 등록 방지
  // - 부품 id는 최대한 원본 그대로 유지 → 이미 배치된 부품의 libraryId 연결이 끊기지 않음
  //   (예전엔 무조건 id를 재발급해서, 불러오기 후 BOM의 스펙·가격·데이터시트가 전부 비어 보였음)
  // - 폴더는 "이름+상위폴더" 기준 병합: 같은 폴더가 있으면 재사용, 없으면 새로 만들고
  //   들어온 부품의 folderId를 로컬 폴더 id로 바꿔 연결
  // 즐겨찾기(fav) 규칙: 내가 표시한 별만 남기고, 남이 보낸 별은 무시한다.
  //  - 이미 있는 부품은 updatePart가 fav를 건드리지 않으므로 내 표시가 그대로 산다.
  //  - 새로 들어오는 부품은 addPart가 fav를 옮기지 않으므로 남의 표시가 붙지 않는다.
  //  - 예외: 라이브러리가 비어 있을 때의 가져오기는 대개 '새 PC에 내 백업 복원'이라
  //    이때만 파일의 fav를 살린다. (남의 라이브러리를 빈 상태에서 받으면 별이 딸려오지만 지우면 그만)
  function importJson(data, replace) {
    묶음시작();
    try { return _importJson(data, replace); }
    finally { 묶음끝(); }          // 도중에 실패해도 여기까지 반영된 것은 저장한다
  }

  function _importJson(data, replace) {
    var incoming = (data && data.parts) || [];
    var inFolders = (data && data.folders) || [];
    var adoptFav = parts.length === 0;   // replace 여부와 무관하게 '가져오기 직전' 기준
    if (replace) { parts = []; folders = []; }

    function mergeFolder(name, parentId) {
      for (var i = 0; i < folders.length; i++) {
        if (folders[i].name === name && (folders[i].parentId || null) === (parentId || null)) return folders[i].id;
      }
      var nf = { id: uid(), name: name, parentId: parentId || null, collapsed: false };
      folders.push(nf); return nf.id;
    }
    var fmap = {};   // 들어온 폴더 id → 로컬 폴더 id
    inFolders.forEach(function (f) { if (f && f.name && !f.parentId) fmap[f.id] = mergeFolder(f.name, null); });
    inFolders.forEach(function (f) { if (f && f.name && f.parentId) fmap[f.id] = mergeFolder(f.name, fmap[f.parentId] || null); });

    var added = 0, updated = 0;
    incoming.forEach(function (p) {
      if (!p || !p.name) return;
      if (p.folderId !== undefined) p.folderId = fmap[p.folderId] || null;
      // 이름만 같은 부품은 건드리지 않는다 — 모델명까지 같아야 같은 부품이다(findSame)
      var existing = findSame(p);
      if (existing) {
        updatePart(existing.id, p, { preservePublicLink: true });   // id 유지 → 배치된 부품과의 연결 보존
        updated++;
      } else {
        var np = addPart(p);                       // 기본값 정규화(새 id 발급됨)
        if (p.id && !get(p.id)) np.id = p.id;      // 쓰이지 않는 원본 id면 되살려 연결 유지
        if (adoptFav && p.fav) np.fav = true;      // 빈 라이브러리에 복원할 때만 별을 함께 살림
        added++;
      }
    });
    save();
    return { added: added, updated: updated };
  }

  // BOM 에 실제로 나갈 구매 링크 하나를 고른다.
  //
  // ⚠ 여기서 한 번 틀렸다(2026-08-29). "고른 쪽이 비면 반대쪽으로 폴백"을 무조건 걸었더니,
  //    국내를 체크했는데 국내칸이 비면 해외 링크가 BOM 에 나갔다 —
  //    사용자가 명시적으로 고른 선택을 코드가 덮어쓴 것이다.
  //
  // 그래서 두 경우를 가른다:
  //   linkPref 없음 = 고른 적 없는 예전 부품 → 있는 링크를 쓴다(폴백). 기존 BOM 이 안 깨진다.
  //   linkPref 있음 = 사용자가 직접 골랐다   → 그 쪽만 쓴다. 비었으면 빈칸.
  //                                          (빈칸이 보여야 "국내 링크를 아직 안 넣었구나"를 안다)
  //
  // BOM 에서 사용자가 직접 고친 링크는 이것보다 우선한다 — app.js 의 c.bomLink 덮어쓰기.
  // 단가도 **구매링크와 같은 규칙**으로 고른다(고원빈 확정, 2026-08-30).
  // 링크는 해외인데 단가는 국내 것이 나가면 BOM 이 앞뒤가 안 맞는다.
  // 통화는 원화 하나로 통일한다 — 알리익스프레스도 한국 계정에는 원화로 보여준다.
  // 환율·통화를 들이면 부품마다 고른 쪽이 달라서 **합계를 낼 수 없게 된다.**
  //
  // BOM 에서 사용자가 직접 고친 단가(project.bomPrice)는 이것보다 우선한다.
  function bomPrice(p) {
    if (!p) return "";
    var kr = p.priceKr, global = p.price;
    function has(v) { return v != null && String(v).trim() !== ""; }
    // 예전 부품(고른 적 없음) → 넣어 둔 값을 쓴다. 기존 BOM 단가가 안 깨진다
    if (p.linkPref !== "kr" && p.linkPref !== "global") return has(global) ? global : (has(kr) ? kr : "");
    // 고른 쪽만. 비었으면 빈칸 — 반대쪽으로 넘어가면 사용자가 고른 선택을 코드가 덮는 것이다
    var v = p.linkPref === "kr" ? kr : global;
    return has(v) ? v : "";
  }

  // 예전 부품(체크한 적 없는 것)을 어느 쪽으로 볼 것인가.
  // **국내로 본다**(고원빈 확정, 2026-08-31). 베타 사용자들이 지금까지 넣어 둔 링크·단가는
  // 국내 쇼핑몰 기준이다. 해외로 두면 그분들이 넣은 국내 링크가 '해외' 칸에 앉아 있게 되고,
  // 우리가 어필리에이트로 쓰려던 해외 칸도 그 값에 막힌다.
  // ⚠ 저장된 데이터를 여기서 바꾸지는 않는다 — 부품을 열어 저장할 때 자연스럽게 국내로 옮겨간다.
  //
  // ⚠⚠ 이걸 bomLink/bomPrice 안에서 쓰면 **안 된다.**
  //     예전 부품은 값이 link/price(해외 칸 이름)에 들어 있다. 여기서 "kr" 이라고 답하면
  //     bomLink 가 비어 있는 linkKr 을 보고 **BOM 링크·단가가 통째로 사라진다.**
  //     이건 "화면에 어느 칸으로 보여줄까"만 정하는 함수다.
  function legacyPref(p) { return (p && (p.linkPref === "kr" || p.linkPref === "global")) ? p.linkPref : "kr"; }

  function bomLink(p) {
    if (!p) return "";
    var kr = (p.linkKr || "").trim(), global = (p.link || "").trim();
    if (p.linkPref !== "kr" && p.linkPref !== "global") return global || kr || "";   // 예전 부품
    return p.linkPref === "kr" ? kr : global;                                        // 고른 쪽만
  }

  return {
    load: load, getAll: getAll, get: get, findByName: findByName, findSame: findSame,
    bomLink: bomLink, bomPrice: bomPrice, legacyPref: legacyPref,
    addPart: addPart, updatePart: updatePart, copyAsIndependent: copyAsIndependent,
    addFromComponent: addFromComponent, remove: remove, toggleFav: toggleFav, reorderBefore: reorderBefore,
    getFolders: getFolders, getFolder: getFolder, addFolder: addFolder, renameFolder: renameFolder,
    removeFolder: removeFolder, toggleFolder: toggleFolder, movePart: movePart, reorderFolderBefore: reorderFolderBefore,
    setAllCollapsed: setAllCollapsed, allCollapsed: allCollapsed,
    instanceOpts: instanceOpts, exportJson: exportJson, importJson: importJson
  };
})();

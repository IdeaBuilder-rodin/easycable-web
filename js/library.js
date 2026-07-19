// library.js — 부품 라이브러리 (IndexedDB 상주, 재사용)
var WE = window.WE || {};
window.WE = WE;

WE.library = (function () {
  var KEY = "library";
  var parts = [];    // { id, name, spec, image, defaultWidth, defaultHeight, folderId, terminals:[{name,color,rx,ry}] }
  var folders = [];  // { id, name, parentId(null=대분류), collapsed } — 2단계까지만 (UI에서 강제)

  function load(cb) {
    WE.store.getRaw(KEY, function (json) {
      if (json) {
        try {
          var d = JSON.parse(json);
          // 구버전 저장본은 부품 배열만 있음 → 폴더 없이 그대로 (전부 미분류 취급)
          if (Object.prototype.toString.call(d) === "[object Array]") { parts = d; folders = []; }
          else { parts = d.parts || []; folders = d.folders || []; }
        } catch (e) { parts = []; folders = []; }
      }
      cb && cb();
    });
  }
  function save() { WE.store.putRaw(KEY, JSON.stringify({ folders: folders, parts: parts })); }

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

  // 기존 부품 덮어쓰기 (id 유지)
  function updatePart(id, p) {
    var part = get(id); if (!part) return null;
    if (p.name != null) part.name = p.name;
    if (p.spec != null) part.spec = p.spec;
    if (p.link != null) part.link = p.link;
    if (p.image !== undefined) part.image = p.image;
    if (p.defaultWidth) part.defaultWidth = p.defaultWidth;
    if (p.defaultHeight) part.defaultHeight = p.defaultHeight;
    if (p.terminals) part.terminals = p.terminals.map(function (t) {
      var s = { name: t.name, color: t.color, rx: t.rx, ry: t.ry };
      if (t.labelSide) s.labelSide = t.labelSide;
      if (t.labelPos) s.labelPos = { x: t.labelPos.x, y: t.labelPos.y };
      return s;
    });
    if (p.folderId !== undefined) part.folderId = p.folderId || null;
    ["role", "volt", "current", "power", "capacityAh", "dod", "minPerHour", "efficiency", "price"].forEach(function (k) {
      if (p[k] != null) part[k] = p[k];
    });
    if (p.datasheets) part.datasheets = p.datasheets.map(function (d) {
      return { id: d.id, name: d.name, type: d.type, data: d.data };
    });
    save(); return part;
  }

  function addPart(p) {
    var part = {
      id: WE.model.nextId("lib"),
      name: p.name || WE.i18n.t("부품"),
      spec: p.spec || "",
      link: p.link || "",
      folderId: (p.folderId && getFolder(p.folderId)) ? p.folderId : null,
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
      price: p.price != null ? p.price : "",
      datasheets: (p.datasheets || []).map(function (d) {
        return { id: d.id, name: d.name, type: d.type, data: d.data };
      }),
      terminals: (p.terminals || []).map(function (t) {
        var s = { name: t.name, color: t.color, rx: t.rx, ry: t.ry };
        if (t.labelSide) s.labelSide = t.labelSide;
        if (t.labelPos) s.labelPos = { x: t.labelPos.x, y: t.labelPos.y };
        return s;
      })
    };
    parts.push(part); save(); return part;
  }

  // 캔버스 부품 인스턴스로부터 라이브러리 부품 생성
  function addFromComponent(cmp) {
    return addPart({
      name: cmp.name, spec: "", image: cmp.image,
      defaultWidth: cmp.width, defaultHeight: cmp.height,
      terminals: cmp.terminals
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
      width: part.defaultWidth, height: part.defaultHeight, x: x, y: y,
      terminals: part.terminals.map(function (t) {
        var nt = { id: WE.model.nextId("t"), name: t.name, color: t.color, rx: t.rx, ry: t.ry };
        if (t.labelSide) nt.labelSide = t.labelSide;
        if (t.labelPos) nt.labelPos = { x: t.labelPos.x, y: t.labelPos.y };
        return nt;
      })
    };
  }

  function exportJson() { return JSON.stringify({ folders: folders, parts: parts }, null, 2); }

  // 라이브러리 가져오기
  // - 같은 이름의 부품이 이미 있으면 새로 만들지 않고 기존 부품을 갱신 → 중복 등록 방지
  // - 부품 id는 최대한 원본 그대로 유지 → 이미 배치된 부품의 libraryId 연결이 끊기지 않음
  //   (예전엔 무조건 id를 재발급해서, 불러오기 후 BOM의 스펙·가격·데이터시트가 전부 비어 보였음)
  // - 폴더는 "이름+상위폴더" 기준 병합: 같은 폴더가 있으면 재사용, 없으면 새로 만들고
  //   들어온 부품의 folderId를 로컬 폴더 id로 바꿔 연결
  function importJson(data, replace) {
    var incoming = (data && data.parts) || [];
    var inFolders = (data && data.folders) || [];
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
      var existing = findByName(p.name);
      if (existing) {
        updatePart(existing.id, p);   // id 유지 → 배치된 부품과의 연결 보존
        updated++;
      } else {
        var np = addPart(p);                       // 기본값 정규화(새 id 발급됨)
        if (p.id && !get(p.id)) np.id = p.id;      // 쓰이지 않는 원본 id면 되살려 연결 유지
        added++;
      }
    });
    save();
    return { added: added, updated: updated };
  }

  return {
    load: load, getAll: getAll, get: get, findByName: findByName,
    addPart: addPart, updatePart: updatePart, addFromComponent: addFromComponent, remove: remove, toggleFav: toggleFav, reorderBefore: reorderBefore,
    getFolders: getFolders, getFolder: getFolder, addFolder: addFolder, renameFolder: renameFolder,
    removeFolder: removeFolder, toggleFolder: toggleFolder, movePart: movePart,
    instanceOpts: instanceOpts, exportJson: exportJson, importJson: importJson
  };
})();

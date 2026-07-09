// library.js — 부품 라이브러리 (IndexedDB 상주, 재사용)
var WE = window.WE || {};
window.WE = WE;

WE.library = (function () {
  var KEY = "library";
  var parts = [];  // { id, name, spec, image, defaultWidth, defaultHeight, terminals:[{name,color,rx,ry}] }

  function load(cb) {
    WE.store.getRaw(KEY, function (json) {
      if (json) { try { parts = JSON.parse(json); } catch (e) { parts = []; } }
      cb && cb();
    });
  }
  function save() { WE.store.putRaw(KEY, JSON.stringify(parts)); }

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
      name: p.name || "부품",
      spec: p.spec || "",
      link: p.link || "",
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

  function exportJson() { return JSON.stringify({ parts: parts }, null, 2); }
  function importJson(data, replace) {
    var incoming = (data && data.parts) || [];
    incoming.forEach(function (p) {
      p.id = WE.model.nextId("lib"); // id 재발급(충돌 방지)
    });
    parts = replace ? incoming : parts.concat(incoming);
    save();
  }

  return {
    load: load, getAll: getAll, get: get, findByName: findByName,
    addPart: addPart, updatePart: updatePart, addFromComponent: addFromComponent, remove: remove, toggleFav: toggleFav, reorderBefore: reorderBefore,
    instanceOpts: instanceOpts, exportJson: exportJson, importJson: importJson
  };
})();

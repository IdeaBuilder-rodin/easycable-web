// presetsets.js — 단자 세트. "부품 단자 목록"에 이름을 붙여 저장했다가 다른 부품에 그대로 붙인다.
//
// 왜: 아두이노 보드들은 단자 구성이 거의 같은데, 부품을 새로 만들 때마다
//     32개를 처음부터 입력해야 했다. 한 번 저장해 두고 골라 쓰면 된다.
//
// 담는 것은 라벨과 색뿐이다 — 좌표(rx/ry)는 부품마다 다르므로 담지 않는다.
// **순서를 보존한다.** 배치 순서가 곧 작업 순서다.
// **중복을 지우지 않는다.** GND 가 여러 개인 것이 정상이다.
//
// 저장은 localStorage. 공용 단자(WE.presets)와 같은 방식이라 일관되고,
// 로그인 없이도 바로 쓸 수 있다.
var WE = window.WE || {};
window.WE = WE;

WE.presetSets = (function () {
  "use strict";
  var KEY = "we_terminal_preset_sets_v1";
  var MAX_ITEMS = 300;   // 한 세트에 담을 수 있는 단자 수 — 사고로 거대한 값이 들어가는 것만 막는다

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw.filter(function (s) {
        return s && typeof s.name === "string" && Array.isArray(s.items);
      });
    } catch (e) { return []; }   // file:// 등에서 접근 실패 시 빈 목록
  }
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; }
    catch (e) { return false; }
  }

  function getAll() { return load(); }
  function get(id) { return load().filter(function (s) { return s.id === id; })[0] || null; }
  function byName(name) {
    name = String(name || "").trim();
    return load().filter(function (s) { return s.name === name; })[0] || null;
  }

  // 세트를 만들거나 덮어쓴다. 같은 이름이 있으면 그 자리를 갱신한다 —
  // 이름을 다시 쓰는 것이 곧 "이 세트를 지금 목록으로 갱신"이라는 뜻이라 자연스럽다.
  function put(name, items) {
    name = String(name || "").trim();
    if (!name) throw new Error(WE.i18n.t("세트 이름을 입력하세요"));
    var clean = (items || []).slice(0, MAX_ITEMS).map(function (t) {
      return { label: String(t.label || "").trim(), color: t.color || "#1e88e5" };
    }).filter(function (t) { return t.label; });
    if (!clean.length) throw new Error(WE.i18n.t("저장할 단자가 없습니다"));

    var list = load();
    var found = list.filter(function (s) { return s.name === name; })[0];
    if (found) { found.items = clean; found.updatedAt = Date.now(); }
    else {
      list.push({
        id: "set_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
        name: name, items: clean, updatedAt: Date.now()
      });
    }
    if (!save(list)) throw new Error(WE.i18n.t("저장 공간을 쓸 수 없습니다"));
    return { name: name, count: clean.length, replaced: !!found };
  }

  function remove(id) {
    save(load().filter(function (s) { return s.id !== id; }));
  }

  return { getAll: getAll, get: get, byName: byName, put: put, remove: remove };
})();

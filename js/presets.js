// presets.js — 사용자 정의 단자 프리셋 (라벨 + 색상), localStorage 영구 저장
var WE = window.WE || {};
window.WE = WE;

WE.presets = (function () {
  var KEY = "we_terminal_presets_v1";
  var CORE_MIGRATION_KEY = "we_terminal_presets_core_v1";
  var list = [];

  var DEFAULTS = [
    { label: "VCC", color: "#e53935" },
    { label: "GND", color: "#757575" },
    { label: "5V",  color: "#e53935" },
    { label: "3V3", color: "#fb8c00" }
  ];
  var OLD_EXTRA_DEFAULTS = [
    { label: "IN", color: "#1e88e5" }, { label: "OUT", color: "#43a047" },
    { label: "MISO", color: "#8e24aa" }, { label: "MOSI", color: "#3949ab" },
    { label: "SCK", color: "#00897b" }, { label: "CS", color: "#6d4c41" },
    { label: "TX", color: "#1e88e5" }, { label: "RX", color: "#43a047" },
    { label: "SDA", color: "#f4511e" }, { label: "SCL", color: "#039be5" }
  ];

  var _id = 1;
  function nextId() { return "ps_" + (_id++) + "_" + Math.floor(Math.random() * 1000); }

  function init() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        list = JSON.parse(raw);
        if (!localStorage.getItem(CORE_MIGRATION_KEY)) {
          list = list.filter(function (p) {
            return !OLD_EXTRA_DEFAULTS.some(function (d) { return p.label === d.label && p.color === d.color; });
          });
          restoreDefaults();
          localStorage.setItem(CORE_MIGRATION_KEY, "1");
        }
        return;
      }
    } catch (e) { /* file:// 등에서 접근 실패 시 메모리로만 동작 */ }
    // 최초 실행: 기본 프리셋 시드
    list = DEFAULTS.map(function (d) { return { id: nextId(), label: d.label, color: d.color }; });
    save();
    try { localStorage.setItem(CORE_MIGRATION_KEY, "1"); } catch (e) {}
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(list)); }
    catch (e) { /* 저장 실패 무시 (세션 내 유지) */ }
  }

  function getAll() { return list; }
  function get(id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function add(label, color) {
    var p = { id: nextId(), label: label || WE.i18n.t("새 단자"), color: color || "#1e88e5" };
    list.push(p); save(); return p;
  }
  function addUnique(label, color) {
    var found = list.filter(function (p) { return p.label === label && p.color === color; })[0];
    return found || add(label, color);
  }
  function update(id, fields) {
    updateMany([id], fields);
  }
  function updateMany(ids, fields) {
    var wanted = {};
    (ids || []).forEach(function (id) { wanted[id] = true; });
    var changed = false;
    list.forEach(function (p) {
      if (!wanted[p.id]) return;
      if (fields.label != null) p.label = fields.label;
      if (fields.color != null) p.color = fields.color;
      changed = true;
    });
    if (changed) save();
  }
  function remove(id) {
    list = list.filter(function (p) { return p.id !== id; });
    save();
  }
  function reorderBefore(id, beforeId) {
    reorderManyBefore([id], beforeId);
  }
  function reorderManyBefore(ids, beforeId) {
    var wanted = {};
    (ids || []).forEach(function (id) { wanted[id] = true; });
    if (!Object.keys(wanted).length || wanted[beforeId]) return;
    var moving = list.filter(function (p) { return wanted[p.id]; });
    if (!moving.length) return;
    list = list.filter(function (p) { return !wanted[p.id]; });
    var to = beforeId ? list.findIndex(function (p) { return p.id === beforeId; }) : -1;
    if (to < 0) Array.prototype.push.apply(list, moving);
    else Array.prototype.splice.apply(list, [to, 0].concat(moving));
    save();
  }
  function restoreDefaults() {
    DEFAULTS.forEach(function (d) { addUnique(d.label, d.color); });
    save();
  }

  return {
    init: init, getAll: getAll, get: get,
    add: add, addUnique: addUnique, update: update, updateMany: updateMany, remove: remove,
    reorderBefore: reorderBefore, reorderManyBefore: reorderManyBefore, restoreDefaults: restoreDefaults
  };
})();

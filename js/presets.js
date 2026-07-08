// presets.js — 사용자 정의 단자 프리셋 (라벨 + 색상), localStorage 영구 저장
var WE = window.WE || {};
window.WE = WE;

WE.presets = (function () {
  var KEY = "we_terminal_presets_v1";
  var list = [];

  var DEFAULTS = [
    { label: "VCC", color: "#e53935" },
    { label: "GND", color: "#757575" },
    { label: "5V",  color: "#e53935" },
    { label: "3V3", color: "#fb8c00" },
    { label: "IN",  color: "#1e88e5" },
    { label: "OUT", color: "#43a047" },
    { label: "MISO", color: "#8e24aa" },
    { label: "MOSI", color: "#3949ab" },
    { label: "SCK", color: "#00897b" },
    { label: "CS",  color: "#6d4c41" },
    { label: "TX",  color: "#1e88e5" },
    { label: "RX",  color: "#43a047" },
    { label: "SDA", color: "#f4511e" },
    { label: "SCL", color: "#039be5" }
  ];

  var _id = 1;
  function nextId() { return "ps_" + (_id++) + "_" + Math.floor(Math.random() * 1000); }

  function init() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        list = JSON.parse(raw);
        return;
      }
    } catch (e) { /* file:// 등에서 접근 실패 시 메모리로만 동작 */ }
    // 최초 실행: 기본 프리셋 시드
    list = DEFAULTS.map(function (d) { return { id: nextId(), label: d.label, color: d.color }; });
    save();
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
    var p = { id: nextId(), label: label || "새 단자", color: color || "#1e88e5" };
    list.push(p); save(); return p;
  }
  function update(id, fields) {
    var p = get(id); if (!p) return;
    if (fields.label != null) p.label = fields.label;
    if (fields.color != null) p.color = fields.color;
    save();
  }
  function remove(id) {
    list = list.filter(function (p) { return p.id !== id; });
    save();
  }

  return {
    init: init, getAll: getAll, get: get,
    add: add, update: update, remove: remove
  };
})();

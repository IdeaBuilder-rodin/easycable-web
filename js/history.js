// history.js — Undo/Redo (프로젝트 스냅샷 스택)
var WE = window.WE || {};
window.WE = WE;

WE.history = (function () {
  var present = "";      // 현재 커밋된 상태(JSON)
  var undo = [], redo = [];
  var LIMIT = 80;
  var timer = null;

  function snap() { return JSON.stringify(WE.model.project); }

  // 드래그·모달 편집 중이면 커밋 보류 (한 동작=한 단계)
  function busy() {
    if (WE.interactions && WE.interactions.isBusy && WE.interactions.isBusy()) return true;
    if (document.querySelector(".modal:not([hidden])")) return true;
    return false;
  }

  // 변경이 있으면 undo 스택에 push
  function commit() {
    if (busy()) return false;
    var s = snap();
    if (s === present) return false;
    undo.push(present);
    if (undo.length > LIMIT) undo.shift();
    present = s;
    redo = [];
    return true;
  }

  function start() { if (!timer) timer = setInterval(commit, 700); }

  // 새 프로젝트/열기 후: 히스토리 초기화
  function reset() { undo = []; redo = []; present = snap(); }

  function apply(json) {
    try { WE.model.loadProject(JSON.parse(json)); WE.app.reloadUI(); }
    catch (e) { /* 무시 */ }
  }

  function doUndo() {
    commit();                 // 대기 중 변경 먼저 반영
    if (!undo.length) return;
    redo.push(present);
    present = undo.pop();
    apply(present);
  }
  function doRedo() {
    if (!redo.length) return;
    undo.push(present);
    present = redo.pop();
    apply(present);
  }

  function canUndo() { return undo.length > 0; }
  function canRedo() { return redo.length > 0; }

  return {
    start: start, reset: reset, commit: commit,
    doUndo: doUndo, doRedo: doRedo, canUndo: canUndo, canRedo: canRedo
  };
})();

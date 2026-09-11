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

  /* 스냅샷을 되돌린다.

     ⚠ 되돌리기는 '무엇을' 되돌리는 것이지 '어디를 보고 있는지' 를 바꾸는 게 아니다.
        스냅샷(project)에는 activeSheetId 가 없고 — 있으면 탭을 누르는 것만으로
        되돌리기 단계가 쌓인다 — loadProject 는 그게 없으면 첫 장으로 되돌린다.
        그래서 2페이지에서 Ctrl+Z 를 누르면 1페이지로 튀었다(2026-09-08 신고).
        스냅샷에 넣지 말고, 여기서 보던 장을 기억했다 되돌려 준다. */
  function apply(json) {
    try {
      var 보던장 = WE.model.getActiveSheetId ? WE.model.getActiveSheetId() : null;
      WE.model.loadProject(JSON.parse(json));
      // 그 장을 만들기 전으로 돌아간 경우엔 없을 수 있다 → 그때는 loadProject 가 정한 첫 장
      if (보던장) {
        var 있나 = (WE.model.project.sheets || []).some(function (s) { return s.id === 보던장; });
        if (있나) WE.model.setActiveSheet(보던장);
      }
      WE.app.reloadUI();
    } catch (e) { /* 무시 */ }
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

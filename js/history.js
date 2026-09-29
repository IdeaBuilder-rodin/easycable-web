// history.js — Undo/Redo (프로젝트 스냅샷 스택)
var WE = window.WE || {};
window.WE = WE;

WE.history = (function () {
  var present = "";      // 현재 커밋된 상태(JSON)
  var undo = [], redo = [];
  var LIMIT = 80;
  var timer = null;

  /* ── 그림은 스냅샷마다 복사하지 않고 한 번만 둔다 (2026-09-28) ───────────
     ⚠ 왜 — 스냅샷은 도면 전체를 JSON 으로 뜬 것이라 부품 그림(base64)이 통째로 들어간다.
        예제 도면(부품 13개)이 한 부에 2.3MB 이고, 되돌리기는 최대 80부를 쥔다.
        실측: 부품 하나를 80번 옮기기만 해도 메모리 91MB → 418MB(가비지 정리 후).
        그림이 많은 판넬 도면이면 탭이 통째로 죽을 수 있는 크기다.
     그래서 뜰 때 큰 data: 문자열을 짧은 표(키)로 바꾸고 원문은 _그림 에 한 번만 둔다.
     되돌릴 때 표를 원문으로 되돌리므로 **불러오는 내용은 예전과 한 글자도 같다.**
     같은 그림은 늘 같은 표가 되므로 "바뀐 게 있나" 비교(s === present)도 그대로 맞는다.
     ⚠ 자동저장의 첨부물 풀(WE.assets)을 쓰지 않는 이유 — 그 풀은 앱 시작 4초 뒤 '안 쓰는 첨부물'을
        지운다(sweepIfDue). 되돌리기 안에만 남은 그림이 그때 지워지면 되돌렸을 때 그림이 빈다.
        이 보관함은 되돌리기 전용이라 아무도 지우지 않는다. 새 도면을 열 때(reset)만 비운다. */
  var 표머리 = "@@we-hist-img@@:";
  var _그림 = new Map();      // 원문 → 표
  var _원문 = {};             // 표 → 원문
  var _그림번호 = 0;
  function 접기(k, v) {
    if (typeof v === "string" && v.length > 1024 && v.lastIndexOf("data:", 0) === 0) {
      var t = _그림.get(v);
      if (!t) { t = 표머리 + (++_그림번호); _그림.set(v, t); _원문[t] = v; }
      return t;
    }
    return v;
  }
  function 펴기(k, v) {
    if (typeof v === "string" && v.lastIndexOf(표머리, 0) === 0 && _원문[v] != null) return _원문[v];
    return v;
  }
  function snap() { return JSON.stringify(WE.model.project, 접기); }

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
  function reset() {
    undo = []; redo = [];
    _그림 = new Map(); _원문 = {};   // 이전 도면의 그림은 더 되돌릴 일이 없다
    present = snap();
  }

  /* 스냅샷을 되돌린다.

     ⚠ 되돌리기는 '무엇을' 되돌리는 것이지 '어디를 보고 있는지' 를 바꾸는 게 아니다.
        스냅샷(project)에는 activeSheetId 가 없고 — 있으면 탭을 누르는 것만으로
        되돌리기 단계가 쌓인다 — loadProject 는 그게 없으면 첫 장으로 되돌린다.
        그래서 2페이지에서 Ctrl+Z 를 누르면 1페이지로 튀었다(2026-09-08 신고).
        스냅샷에 넣지 말고, 여기서 보던 장을 기억했다 되돌려 준다. */
  function apply(json) {
    try {
      var 보던장 = WE.model.getActiveSheetId ? WE.model.getActiveSheetId() : null;
      WE.model.loadProject(JSON.parse(json, 펴기));
      // 그 장을 만들기 전으로 돌아간 경우엔 없을 수 있다 → 그때는 loadProject 가 정한 첫 장
      if (보던장) {
        var 있나 = (WE.model.project.sheets || []).some(function (s) { return s.id === 보던장; });
        if (있나) WE.model.setActiveSheet(보던장);
      }
      WE.app.reloadUI();
      /* ⚠ 불러온 **뒤의** 모습을 현재로 삼는다 (2026-09-28 수정).
         loadProject 는 불러오면서 조용히 정리를 한다 — 겹침 순서(z)의 빈 번호를 1,2,3… 으로
         다시 매기는 것(model.ensureUniqueZ, 2026-09-03~)이 대표적이다. 부품을 지우면 z 에
         빈 번호가 생기므로, 지운 뒤의 상태로 되돌리면 불러온 모습이 스냅샷과 1글자씩 달라진다.
         present 를 스냅샷 그대로 두면 다음 commit() 이 그 차이를 "새 편집" 으로 보고
         ① 가짜 단계를 쌓고 ② redo 를 비웠다. 되돌리기를 누를 때마다 그 가짜 단계로 돌아가
         **같은 자리를 맴돌아서, 부품을 한 번이라도 지웠으면 Ctrl+Z 가 한 단계밖에 안 됐다**
         (실측: 삭제 3번 → 되돌리기 3번 → 13개 중 11개에서 멈춤).
         정리는 보이는 것을 바꾸지 않으므로(z 는 순서만 같으면 된다) 단계로 셀 이유가 없다. */
      present = snap();
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

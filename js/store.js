// store.js — IndexedDB 자동 임시저장 / 새로고침 복구
var WE = window.WE || {};
window.WE = WE;

WE.store = (function () {
  var DB = "wiringEditor", STORE = "state";
  // 자동저장 슬롯을 이 파일 경로 전용으로 분리 (다른 폴더/파일과 섞이지 않게)
  var KEY = "current::" + (location.pathname || "");
  var db = null;
  var lastJson = "";
  var timer = null;

  function init(cb) {
    try {
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function (e) {
        e.target.result.createObjectStore(STORE);
      };
      req.onsuccess = function (e) { db = e.target.result; cb && cb(); };
      req.onerror = function () { db = null; cb && cb(); };
    } catch (e) { db = null; cb && cb(); }
  }

  // 저장된 스냅샷(JSON 문자열) 불러오기 (없으면 구 키에서 물려받기)
  function load(cb) {
    getRaw(KEY, function (v) {
      if (v) { cb(v); return; }
      getRaw("current", function (v2) { cb(v2 || null); }); // 이전 버전 저장본 마이그레이션
    });
  }

  function write(json) {
    if (!db) return;
    try { db.transaction(STORE, "readwrite").objectStore(STORE).put(json, KEY); }
    catch (e) { /* 무시 */ }
  }

  // ---- 범용 키-값 (라이브러리 등) ----
  function putRaw(key, val) {
    if (!db) return;
    try { db.transaction(STORE, "readwrite").objectStore(STORE).put(val, key); }
    catch (e) { /* 무시 */ }
  }
  function getRaw(key, cb) {
    if (!db) { cb(null); return; }
    try {
      var rq = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      rq.onsuccess = function () { cb(rq.result || null); };
      rq.onerror = function () { cb(null); };
    } catch (e) { cb(null); }
  }

  // 변경 있을 때만 저장
  function saveNow() {
    var json = JSON.stringify(WE.model.project);
    if (json === lastJson) return;
    lastJson = json;
    write(json);
  }

  // 방금 로드한 상태를 기준선으로 삼아 즉시 재저장 방지
  function syncBaseline() { lastJson = JSON.stringify(WE.model.project); }

  // 저장된 스냅샷 삭제 (새 프로젝트 시)
  function clear() {
    lastJson = "";
    if (!db) return;
    try { db.transaction(STORE, "readwrite").objectStore(STORE).delete(KEY); }
    catch (e) { /* 무시 */ }
  }

  var autosaveEnabled = true;
  var autosaveInterval = 3000;
  var started = false;

  function applyTimer() {
    if (timer) { clearInterval(timer); timer = null; }
    if (autosaveEnabled) timer = setInterval(saveNow, autosaveInterval);
  }

  // 자동저장 켜기/끄기 + 주기(ms) 설정
  function setAutosave(enabled, intervalMs) {
    autosaveEnabled = !!enabled;
    if (intervalMs && intervalMs >= 500) autosaveInterval = intervalMs;
    applyTimer();
  }

  // 주기 자동저장 + 종료 직전 저장 시작
  function start() {
    if (started) return;
    started = true;
    applyTimer();
    // 마지막 작업이 항상 복구되도록, 닫기/숨김 직전엔 자동저장 설정과 무관하게 저장
    window.addEventListener("beforeunload", function () { saveNow(); });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) saveNow();
    });
  }

  return {
    init: init, load: load, saveNow: saveNow, syncBaseline: syncBaseline,
    clear: clear, start: start, setAutosave: setAutosave, putRaw: putRaw, getRaw: getRaw
  };
})();

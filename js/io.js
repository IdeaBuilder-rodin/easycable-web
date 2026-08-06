// io.js — 프로젝트 저장/열기
// Chrome/Edge: File System Access API로 "같은 파일에 진짜 덮어쓰기"(Ctrl+S가 워드/한글처럼 조용히 저장)
// 그 외 브라우저(Safari/Firefox 등): 기존 방식(매번 새 파일 다운로드)으로 자동 대체
//
// 저장 형식(v2): 도면 + 그 도면에 쓰인 부품 정보(스펙·단가·전기정보·데이터시트)를 한 파일에 담는다.
// 예전엔 [저장]은 도면만, [공유]는 부품까지 담아서 둘을 구분해야 했는데,
// 저장한 파일을 다른 PC에서 열면 BOM만 조용히 비는 사고가 났다 → [저장] 하나로 합쳤다.
// 첨부물은 내용 해시로 중복을 없앤 뒤 gzip으로 묶는다(실측 9.91MB → 6.43MB).
// 예전에 만든 파일(통짜 JSON / 공유 번들)도 그대로 열린다 — 앞부분을 보고 형식을 가린다.
var WE = window.WE || {};
window.WE = WE;

WE.io = (function () {
  var _supportsFS = "showSaveFilePicker" in window && "showOpenFilePicker" in window;
  var _supportsGzip = typeof CompressionStream === "function" && typeof DecompressionStream === "function";
  var _fileHandle = null;   // 현재 연결된 파일(FileSystemFileHandle) — 있으면 Ctrl+S가 여기로 조용히 저장됨
  var FILE_TYPES = [{ description: WE.i18n.t("이지케이블 프로젝트"), accept: { "application/octet-stream": [".ezc"], "application/json": [".json"] } }];
  var FORMAT = "easycable", FORMAT_VERSION = 2;

  // ---- gzip (브라우저 내장, 외부 라이브러리 없음) ----
  function gzip(str) {
    if (!_supportsGzip) return Promise.resolve(null);
    var s = new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Response(s).arrayBuffer().catch(function () { return null; });
  }
  function gunzip(buf) {
    var s = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(s).text();
  }
  function isGzip(buf) {
    var b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
    return b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;   // gzip 매직바이트
  }

  // ---- 미저장 변경 감지 ----
  // 마지막으로 파일에 저장/공유/열기한 시점의 프로젝트 스냅샷.
  // 자동저장(IndexedDB)과 별개로 "파일로 안전하게 보관됐는가" 기준 —
  // 브라우저 데이터 삭제 등으로 자동저장이 사라질 수 있어, 파일 미보관 변경이 있으면 닫기 전에 확인창을 띄움
  var _cleanJson = "";
  function markClean() { _cleanJson = JSON.stringify(WE.model.project); }
  function isDirty() {
    var p = WE.model.project;
    var empty = !(p.components && p.components.length) &&
                !(p.wires && p.wires.length) &&
                !(p.annotations && p.annotations.length);
    if (empty) return false;   // 빈 도면은 잃을 게 없음 → 조용히 닫힘
    return JSON.stringify(p) !== _cleanJson;
  }

  function init() {
    document.getElementById("btnSave").addEventListener("click", save);
    syncSaveTitle();
    document.getElementById("btnOpen").addEventListener("click", openFile);
    document.getElementById("fileOpen").addEventListener("change", onOpenFileInput);
    // 파일로 저장 안 한 변경이 있을 때만 닫기 확인 (문구는 브라우저 고정 문구가 뜸 — 커스텀 불가)
    window.addEventListener("beforeunload", function (e) {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = "";   // 구형 Chrome 호환
    });
  }

  function safeName(s) {
    return (s || WE.i18n.t("배선도")).replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  }

  // 이 도면이 쓰는 부품과 첨부물까지 한 덩어리로 묶는다.
  // 부품 정보(스펙·단가·전기정보·데이터시트)가 함께 있어야 다른 PC에서 열어도 BOM이 온전하다.
  function buildBundle() {
    var proj = WE.model.project;
    var seen = {}, parts = [];
    (proj.components || []).forEach(function (c) {
      if (!c.libraryId || seen[c.libraryId]) return;
      var p = WE.library.get(c.libraryId);
      if (p) { seen[c.libraryId] = 1; parts.push(p); }
    });
    // 첨부물은 참조로 빼고 실제 데이터는 assets에 한 벌만 담는다(같은 이미지가 여러 번 들어가지 않게)
    var packed = WE.assets.pack({ project: proj, parts: parts });
    var used = WE.assets.collectRefs(packed);
    var assets = {};
    for (var k in used) { var v = WE.assets.get(k); if (v != null) assets[k] = v; }
    return JSON.stringify({
      format: FORMAT, version: FORMAT_VERSION,
      project: packed.project, parts: packed.parts, assets: assets
    });
  }

  // 저장할 바이트 만들기 — 가능하면 gzip, 안 되는 브라우저는 그냥 JSON(그래도 열린다)
  function buildPayload() {
    var json = buildBundle();
    return gzip(json).then(function (buf) { return buf || json; });
  }

  function download(dataStr, filename) {
    var blob = new Blob([dataStr], { type: "application/octet-stream" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // 새 프로젝트 시작 시 호출 — 이전 파일과의 연결을 끊음(다음 저장은 "다른 이름으로" 새로 지정)
  function clearFileHandle() { _fileHandle = null; syncSaveTitle(); }

  // 툴바 [저장]이 '어느 파일'을 덮어쓸지 툴팁에 밝혀 둔다.
  // 이게 없으면 연결된 파일이 화면 어디에도 안 보여서, 누르고 나서야 덮어쓴 걸 알게 된다.
  function currentFileName() { return _fileHandle ? _fileHandle.name : ""; }
  function syncSaveTitle() {
    var btn = document.getElementById("btnSave");
    if (!btn) return;
    var base = WE.i18n.t("프로젝트를 파일로 저장 (Ctrl+S)");
    btn.title = _fileHandle ? base + WE.i18n.t(" · 현재 파일: ") + _fileHandle.name
                            : base + WE.i18n.t(" · 아직 파일 없음 (위치를 묻습니다)");
  }

  async function writeToHandle(handle, dataStr) {
    var writable = await handle.createWritable();
    await writable.write(dataStr);
    await writable.close();
  }

  // 저장: 이미 연결된 파일이 있으면 그 파일에 조용히 덮어쓰기, 없으면 "다른 이름으로 저장" 새로 지정
  function save() {
    if (WE.app && WE.app.track) WE.app.track("save_project");
    var fn = safeName(WE.model.project.meta.name) + ".ezc";

    buildPayload().then(function (data) {
      if (!_supportsFS) { download(data, fn); markClean(); WE.app.setHint(WE.i18n.t("저장됨: ") + fn); return; }

      if (_fileHandle) {
        writeToHandle(_fileHandle, data).then(function () {
          markClean(); syncSaveTitle();
          WE.app.setHint(WE.i18n.t("저장됨: ") + _fileHandle.name);
        }).catch(function () {
          _fileHandle = null;   // 파일이 삭제/이동된 경우 등 → 새로 지정하도록 폴백
          saveAsNewHandle(data, fn);
        });
        return;
      }
      saveAsNewHandle(data, fn);
    });
  }

  // 다른 이름으로 저장: 연결된 파일이 있어도 항상 위치·이름을 새로 묻는다.
  // 저장에 성공하면 연결을 '새 파일로 옮긴다' — 워드·VS Code와 같은 방식이라,
  // 이후 Ctrl+S는 방금 저장한 쪽으로 간다(사본을 만들고 그쪽에서 계속 작업하는 흐름).
  function saveAs() {
    if (WE.app && WE.app.track) WE.app.track("save_project_as");
    var fn = safeName(WE.model.project.meta.name) + ".ezc";
    buildPayload().then(function (data) {
      // File System Access API가 없는 브라우저(Safari·Firefox 등)는 저장이 원래 매번 다운로드라
      // 이미 '다른 이름으로 저장'과 같다 → 그대로 내려받게 둔다.
      if (!_supportsFS) { download(data, fn); markClean(); WE.app.setHint(WE.i18n.t("저장됨: ") + fn); return; }
      saveAsNewHandle(data, fn);
    });
  }

  function saveAsNewHandle(data, fn) {
    window.showSaveFilePicker({ suggestedName: fn, types: FILE_TYPES }).then(function (handle) {
      _fileHandle = handle;
      return writeToHandle(handle, data);
    }).then(function () {
      markClean(); syncSaveTitle();
      WE.app.setHint(WE.i18n.t("저장됨: ") + _fileHandle.name);
    }).catch(function (err) {
      if (err && err.name === "AbortError") return;   // 사용자가 저장창 취소
      download(data, fn);                              // 그 외 실패 시 구식 다운로드로 폴백
      markClean();
      WE.app.setHint(WE.i18n.t("저장됨: ") + fn);
    });
  }

  // 열기: 지원 브라우저는 File System Access API로 파일을 "연결"(이후 Ctrl+S가 이 파일로 저장됨),
  // 미지원 브라우저는 기존 input[type=file] 방식으로 폴백
  function openFile() {
    if (!_supportsFS) { document.getElementById("fileOpen").click(); return; }
    window.showOpenFilePicker({ types: FILE_TYPES }).then(function (handles) {
      var handle = handles[0];
      return handle.getFile().then(function (file) {
        return file.arrayBuffer().then(function (buf) {
          return loadProjectBuffer(buf, file.name).then(function (ok) { if (ok) { _fileHandle = handle; syncSaveTitle(); } });
        });
      });
    }).catch(function (err) {
      if (err && err.name === "AbortError") return;   // 사용자가 열기창 취소
      document.getElementById("fileOpen").click();     // 실패 시 구식 방식으로 폴백
    });
  }

  function onOpenFileInput(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      _fileHandle = null; syncSaveTitle();   // input 방식으로 연 파일은 핸들이 없어 Ctrl+S 시 "다른 이름으로 저장"부터 다시 시작
      loadProjectBuffer(ev.target.result, file.name);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = ""; // 같은 파일 재선택 허용
  }

  // 바이트로 받아 형식을 가린다: gzip이면 풀고, 아니면 텍스트 그대로 → loadProjectText로 넘긴다
  function loadProjectBuffer(buf, displayName) {
    if (typeof buf === "string") return Promise.resolve(loadProjectText(buf, displayName));
    var p = isGzip(buf) ? gunzip(buf) : Promise.resolve(new TextDecoder().decode(buf));
    return p.then(function (text) {
      return loadProjectText(text, displayName);
    }).catch(function (err) {
      alert(WE.i18n.t("파일을 읽을 수 없습니다: ") + (err && err.message ? err.message : err));
      return false;
    });
  }

  // 텍스트(JSON) 파싱 후 프로젝트 로드.
  // 세 가지 형식을 모두 받는다:
  //   v2 통합본(format:"easycable")  — 도면 + 부품 + 첨부물(assets)
  //   구 공유본(easycable-share)     — 도면 + 부품(첨부물이 부품 안에 통째로)
  //   구 저장본(도면만)              — 부품 정보 없음(BOM은 로컬 라이브러리에 의존)
  function loadProjectText(text, displayName) {
    try {
      var data = JSON.parse(text);
      var added = 0, project = data, incomingParts = null;

      if (data && data.format === FORMAT) {
        // 첨부물을 자산 풀에 먼저 들여야 참조를 되돌릴 수 있다(이미 있는 것은 자동으로 합쳐진다)
        WE.assets.adopt(data.assets || {});
        project = WE.assets.unpack(data.project);
        incomingParts = WE.assets.unpack(data.parts || []);
      } else if (data && data.format === "easycable-share") {
        project = data.project;
        incomingParts = data.libraryParts || [];
      }

      if (incomingParts) {
        var res = mergeLibraryParts(incomingParts);
        added = res.added;
        // 프로젝트 부품의 libraryId를 받는 쪽 실제 부품 id로 재연결(전기정보·재배치 연동 유지)
        (project.components || []).forEach(function (c) {
          if (c.libraryId && res.idMap[c.libraryId]) c.libraryId = res.idMap[c.libraryId];
        });
      }

      WE.model.loadProject(project);
      WE.app.reloadUI();
      if (WE.history) WE.history.reset();
      if (WE.store) WE.store.saveNow(); // 연 내용을 즉시 임시저장에 반영
      markClean();   // 방금 연 파일 내용 그대로 = 미저장 변경 없음
      WE.app.setHint(WE.i18n.t("열기 완료: ") + displayName + (added ? (WE.i18n.t(" · 새 부품 ") + added + WE.i18n.t("개를 라이브러리에 추가")) : ""));
      return true;
    } catch (err) {
      alert(WE.i18n.t("파일을 읽을 수 없습니다: ") + err.message);
      return false;
    }
  }

  // 공유 파일의 부품을 라이브러리에 병합: 같은 이름이 이미 있으면 건너뜀(내 서랍 보존).
  // 반환: { added, idMap } — idMap은 원본 libraryId → 받는 쪽 실제 부품 id (프로젝트 재연결용)
  function mergeLibraryParts(list) {
    var idMap = {}, added = 0, filled = 0;
    list.forEach(function (p) {
      if (!p || !p.name) return;
      var existing = WE.library.findByName(p.name);
      if (existing) {
        idMap[p.id] = existing.id;                 // 이름 중복 → 기존 부품에 연결
        // 같은 이름이 있어도, 기존 부품에 '비어 있는' 항목(스펙·가격·링크·데이터시트·전기정보)은
        // 공유파일 데이터로 채움 → 받는 쪽에 껍데기 부품만 있어도 BOM/데이터시트가 살아남.
        // (받는 쪽이 직접 입력해 둔 값은 덮지 않음)
        if (fillMissingFields(existing, p)) filled++;
      } else {
        var np = WE.library.addPart(p);            // 새로 추가(새 id 발급)
        idMap[p.id] = np.id;
        added++;
      }
    });
    if (added || filled) WE.app.renderLibrary();
    return { added: added, idMap: idMap };
  }

  // 기존 부품의 빈 항목만 공유본(src)에서 보충. 하나라도 채웠으면 true.
  function fillMissingFields(existing, src) {
    function empty(v) { return v === undefined || v === null || v === ""; }
    var patch = {}, changed = false;
    ["spec", "link", "price", "image", "role", "volt", "current", "power",
     "capacityAh", "dod", "minPerHour", "efficiency"].forEach(function (k) {
      if (empty(existing[k]) && !empty(src[k])) { patch[k] = src[k]; changed = true; }
    });
    // 데이터시트: 기존에 하나도 없고 공유본엔 있으면 통째로 가져옴
    if ((!existing.datasheets || !existing.datasheets.length) && src.datasheets && src.datasheets.length) {
      patch.datasheets = src.datasheets; changed = true;
    }
    if (changed) WE.library.updatePart(existing.id, patch);
    return changed;
  }

  return {
    init: init, save: save, saveAs: saveAs, clearFileHandle: clearFileHandle,
    currentFileName: currentFileName,
    loadProjectText: loadProjectText, loadProjectBuffer: loadProjectBuffer,
    buildBundle: buildBundle   // 테스트·진단용
  };
})();

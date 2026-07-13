// io.js — 프로젝트 저장/열기
// Chrome/Edge: File System Access API로 "같은 파일에 진짜 덮어쓰기"(Ctrl+S가 워드/한글처럼 조용히 저장)
// 그 외 브라우저(Safari/Firefox 등): 기존 방식(매번 새 파일 다운로드)으로 자동 대체
var WE = window.WE || {};
window.WE = WE;

WE.io = (function () {
  var _supportsFS = "showSaveFilePicker" in window && "showOpenFilePicker" in window;
  var _fileHandle = null;   // 현재 연결된 파일(FileSystemFileHandle) — 있으면 Ctrl+S가 여기로 조용히 저장됨
  var FILE_TYPES = [{ description: "이지케이블 프로젝트", accept: { "application/json": [".ezc", ".json"] } }];

  function init() {
    document.getElementById("btnSave").addEventListener("click", save);
    document.getElementById("btnShare").addEventListener("click", share);
    document.getElementById("btnOpen").addEventListener("click", openFile);
    document.getElementById("fileOpen").addEventListener("change", onOpenFileInput);
  }

  function safeName(s) {
    return (s || "배선도").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  }

  function download(dataStr, filename) {
    var blob = new Blob([dataStr], { type: "application/json" });
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
  function clearFileHandle() { _fileHandle = null; }

  async function writeToHandle(handle, dataStr) {
    var writable = await handle.createWritable();
    await writable.write(dataStr);
    await writable.close();
  }

  // 저장: 이미 연결된 파일이 있으면 그 파일에 조용히 덮어쓰기, 없으면 "다른 이름으로 저장" 새로 지정
  function save() {
    if (WE.app && WE.app.track) WE.app.track("save_project");
    var data = JSON.stringify(WE.model.project);
    var fn = safeName(WE.model.project.meta.name) + ".ezc";

    if (!_supportsFS) { download(data, fn); WE.app.setHint("저장됨: " + fn); return; }

    if (_fileHandle) {
      writeToHandle(_fileHandle, data).then(function () {
        WE.app.setHint("저장됨: " + _fileHandle.name);
      }).catch(function () {
        _fileHandle = null;   // 파일이 삭제/이동된 경우 등 → 새로 지정하도록 폴백
        saveAsNewHandle(data, fn);
      });
      return;
    }
    saveAsNewHandle(data, fn);
  }

  function saveAsNewHandle(data, fn) {
    window.showSaveFilePicker({ suggestedName: fn, types: FILE_TYPES }).then(function (handle) {
      _fileHandle = handle;
      return writeToHandle(handle, data);
    }).then(function () {
      WE.app.setHint("저장됨: " + _fileHandle.name);
    }).catch(function (err) {
      if (err && err.name === "AbortError") return;   // 사용자가 저장창 취소
      download(data, fn);                              // 그 외 실패 시 구식 다운로드로 폴백
      WE.app.setHint("저장됨: " + fn);
    });
  }

  // 공유: 배선도 + 이 프로젝트에 실제 쓰인 라이브러리 부품을 한 파일로 (받는 사람은 파일 하나로 열림)
  // 항상 새 파일로 내보내는 별도 산출물이라 파일 핸들과 무관하게 다운로드 방식 유지
  function share() {
    if (WE.app && WE.app.track) WE.app.track("share_project");
    var proj = WE.model.project;
    var usedIds = {}, usedParts = [];
    (proj.components || []).forEach(function (c) {
      if (c.libraryId && !usedIds[c.libraryId]) {
        var p = WE.library.get(c.libraryId);
        if (p) { usedIds[c.libraryId] = 1; usedParts.push(p); }
      }
    });
    var bundle = { format: "easycable-share", version: 1, project: proj, libraryParts: usedParts };
    var fn = safeName(proj.meta.name) + "_공유.ezc";
    download(JSON.stringify(bundle), fn);
    WE.app.setHint("공유 파일 저장: " + fn + " (부품 " + usedParts.length + "개 포함)");
  }

  // 열기: 지원 브라우저는 File System Access API로 파일을 "연결"(이후 Ctrl+S가 이 파일로 저장됨),
  // 미지원 브라우저는 기존 input[type=file] 방식으로 폴백
  function openFile() {
    if (!_supportsFS) { document.getElementById("fileOpen").click(); return; }
    window.showOpenFilePicker({ types: FILE_TYPES }).then(function (handles) {
      var handle = handles[0];
      return handle.getFile().then(function (file) {
        return file.text().then(function (text) { loadProjectText(text, file.name); _fileHandle = handle; });
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
      _fileHandle = null;   // input 방식으로 연 파일은 핸들이 없어 Ctrl+S 시 "다른 이름으로 저장"부터 다시 시작
      loadProjectText(ev.target.result, file.name);
    };
    reader.readAsText(file);
    e.target.value = ""; // 같은 파일 재선택 허용
  }

  // 텍스트(JSON) 파싱 후 프로젝트 로드 — 일반 파일/공유 파일(bundle) 공용
  function loadProjectText(text, displayName) {
    try {
      var data = JSON.parse(text);
      var added = 0;
      // 공유 파일(bundle)이면: 안에 든 부품을 내 라이브러리에 병합(이름 같으면 건너뜀) 후 프로젝트 로드
      if (data && data.format === "easycable-share") {
        var res = mergeLibraryParts(data.libraryParts || []);
        added = res.added;
        // 프로젝트 부품의 libraryId를 받는 쪽 실제 부품 id로 재연결(전기정보·재배치 연동 유지)
        (data.project.components || []).forEach(function (c) {
          if (c.libraryId && res.idMap[c.libraryId]) c.libraryId = res.idMap[c.libraryId];
        });
        WE.model.loadProject(data.project);
        _fileHandle = null;   // 공유 파일은 "저장 대상"이 아님 — 다음 저장은 새로 지정
      } else {
        WE.model.loadProject(data);
      }
      WE.app.reloadUI();
      if (WE.history) WE.history.reset();
      if (WE.store) WE.store.saveNow(); // 연 내용을 즉시 임시저장에 반영
      WE.app.setHint("열기 완료: " + displayName + (added ? (" · 새 부품 " + added + "개를 라이브러리에 추가") : ""));
    } catch (err) {
      alert("파일을 읽을 수 없습니다: " + err.message);
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

  return { init: init, save: save, share: share, clearFileHandle: clearFileHandle, loadProjectText: loadProjectText };
})();

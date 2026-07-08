// io.js — 프로젝트 저장(JSON 다운로드) / 열기(파일 업로드)
var WE = window.WE || {};
window.WE = WE;

WE.io = (function () {
  function init() {
    document.getElementById("btnSave").addEventListener("click", save);
    document.getElementById("btnShare").addEventListener("click", share);
    document.getElementById("btnOpen").addEventListener("click", function () {
      document.getElementById("fileOpen").click();
    });
    document.getElementById("fileOpen").addEventListener("change", onOpenFile);
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

  // 저장: 배선도만 (가벼움 — 내 보관·다시 열기용). 확장자 .ezc (내용은 JSON)
  function save() {
    var fn = safeName(WE.model.project.meta.name) + ".ezc";
    download(JSON.stringify(WE.model.project), fn);
    WE.app.setHint("저장됨: " + fn);
  }

  // 공유: 배선도 + 이 프로젝트에 실제 쓰인 라이브러리 부품을 한 파일로 (받는 사람은 파일 하나로 열림)
  function share() {
    var proj = WE.model.project;
    // 배치된 부품이 참조하는 libraryId만 모아 해당 라이브러리 부품을 첨부(중복 제거)
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

  function onOpenFile(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var data = JSON.parse(ev.target.result);
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
        } else {
          WE.model.loadProject(data);
        }
        WE.app.reloadUI();
        if (WE.history) WE.history.reset();
        if (WE.store) WE.store.saveNow(); // 연 내용을 즉시 임시저장에 반영
        WE.app.setHint("열기 완료: " + file.name + (added ? (" · 새 부품 " + added + "개를 라이브러리에 추가") : ""));
      } catch (err) {
        alert("파일을 읽을 수 없습니다: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // 같은 파일 재선택 허용
  }

  // 공유 파일의 부품을 라이브러리에 병합: 같은 이름이 이미 있으면 건너뜀(내 서랍 보존).
  // 반환: { added, idMap } — idMap은 원본 libraryId → 받는 쪽 실제 부품 id (프로젝트 재연결용)
  function mergeLibraryParts(list) {
    var idMap = {}, added = 0;
    list.forEach(function (p) {
      if (!p || !p.name) return;
      var existing = WE.library.findByName(p.name);
      if (existing) {
        idMap[p.id] = existing.id;                 // 이름 중복 → 기존 부품에 연결
      } else {
        var np = WE.library.addPart(p);            // 새로 추가(새 id 발급)
        idMap[p.id] = np.id;
        added++;
      }
    });
    if (added) WE.app.renderLibrary();
    return { added: added, idMap: idMap };
  }

  return { init: init, save: save, share: share };
})();

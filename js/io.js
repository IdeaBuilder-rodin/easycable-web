// io.js — 프로젝트 저장(JSON 다운로드) / 열기(파일 업로드)
var WE = window.WE || {};
window.WE = WE;

WE.io = (function () {
  function init() {
    document.getElementById("btnSave").addEventListener("click", save);
    document.getElementById("btnOpen").addEventListener("click", function () {
      document.getElementById("fileOpen").click();
    });
    document.getElementById("fileOpen").addEventListener("change", onOpenFile);
  }

  function safeName(s) {
    return (s || "배선도").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  }

  function save() {
    var data = JSON.stringify(WE.model.project);
    var blob = new Blob([data], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = safeName(WE.model.project.meta.name) + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    WE.app.setHint("저장됨: " + a.download);
  }

  function onOpenFile(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var data = JSON.parse(ev.target.result);
        WE.model.loadProject(data);
        WE.app.reloadUI();
        if (WE.history) WE.history.reset();
        if (WE.store) WE.store.saveNow(); // 연 내용을 즉시 임시저장에 반영
        WE.app.setHint("열기 완료: " + file.name);
      } catch (err) {
        alert("파일을 읽을 수 없습니다: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // 같은 파일 재선택 허용
  }

  return { init: init, save: save };
})();

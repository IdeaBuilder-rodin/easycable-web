// app.js — 부트스트랩 / 툴바 / 속성 패널 바인딩
var WE = window.WE || {};
window.WE = WE;

WE.app = (function () {
  // ---- GA4 이벤트 추적 (수요 검증용) ----
  // 방문자 수·세션은 기본 스니펫이 자동 추적하고, 여기선 '실제로 배선도를 그렸는가'를 봄.
  // gtag가 차단/미로드여도 안전(try). 퍼널 이벤트는 세션당 1회만 보내 이탈 분석을 깔끔하게 함.
  var _trackedOnce = {};
  function track(name, params) {
    try { if (window.gtag) window.gtag("event", name, params || {}); } catch (e) { /* 무시 */ }
  }
  function trackOnce(name, params) {
    if (_trackedOnce[name]) return;
    _trackedOnce[name] = 1;
    track(name, params);
  }

  function init() {
    WE.presets.init();
    WE.render.init();
    WE.interactions.init();
    WE.bgremove.init();
    WE.io.init();
    WE.pdf.init();
    // 저장된 단축키를 bindSettings()(단축키 입력칸을 채움)보다 먼저 불러와야
    // 설정창에 기본값이 아니라 실제 저장된 키가 표시됨
    loadShortcuts();
    bindToolbar();
    bindModes();
    bindPalette();
    bindProps();
    bindWireProps();
    bindAnnoProps();
    bindMenu();
    bindTerminals();
    bindPresetModal();
    bindFileButtons();
    bindLibrary();
    bindLibEdit();
    bindDatasheetViewer();
    bindResizers();
    bindZoom();
    bindAlign();
    bindSettings();
    bindModalBackdrops();
    bindWelcome();
    bindFeedback();
    bindQuickColorPicker();
    bindHelp();
    bindAppMenu();
    bindBOMView();
    loadSettings();
    loadWireSettings();
    document.getElementById("wireWidthSel").value = String(WE.model.ui.wireWidth);
    document.getElementById("wireRoutingSel").value = WE.model.ui.wireRouting;
    renderPalette();
    WE.render.renderAll();
    refreshProps();

    // 라이브러리 로드 (프로젝트는 항상 새 화면으로 시작 — 이전 작업 자동 복원 안 함)
    WE.store.init(function () {
      function finish() {
        WE.store.syncBaseline();
        WE.store.start();
        applySettings();
        WE.history.reset();
        WE.history.start();
        updateHistoryButtons();
        requestAnimationFrame(fitZoom);   // 최초 화면은 현재 크기에 '맞춤'으로 시작
      }
      // 첫 방문(샘플 로드 안 한 브라우저)이면 sample.json이 있을 때만 예시로 보여줌
      tryLoadSample(function (loaded) {
        if (!loaded) {
          applyDefaultLayoutToProject();
          applyDefaultPaletteToProject();  // 저장해둔 배선색 팔레트로 시작(새로고침해도 유지)
          renderPalette();
        }
        finish();
      });
      WE.library.load(renderLibrary);
    });
  }

  function updateHistoryButtons() {
    document.getElementById("btnUndo").disabled = !WE.history.canUndo();
    document.getElementById("btnRedo").disabled = !WE.history.canRedo();
  }

  // 라이브러리 저장 (이름 중복 시 덮어쓰기/새로 추가 확인). 저장된 부품 반환
  function saveToLibrary(name, buildData) {
    var existing = WE.library.findByName(name);
    var part;
    if (existing) {
      var overwrite = confirm(
        "이미 '" + name + "' 부품이 라이브러리에 있습니다.\n\n" +
        "[확인] 기존 부품 덮어쓰기\n[취소] 새 부품으로 추가");
      if (overwrite) { part = WE.library.updatePart(existing.id, buildData()); setHint("덮어썼습니다: " + name); }
      else { part = WE.library.addPart(buildData()); setHint("새 부품으로 추가: " + name); }
    } else {
      part = WE.library.addPart(buildData());
      setHint("라이브러리에 저장: " + name);
    }
    renderLibrary();
    return part;
  }

  // ---- 라이브러리 부품 정보(BOM) 편집 ----
  var _editLibId = null;
  function gv(id) { return document.getElementById(id).value; }
  function sv(id, v) { document.getElementById(id).value = v == null ? "" : v; }

  var _editDatasheets = [];   // 라이브러리 모달 편집 중인 데이터시트 작업본
  function openLibEdit(id) {
    var p = WE.library.get(id); if (!p) return;
    _editLibId = id;
    sv("libName", p.name); sv("libSpec", p.spec); sv("libLink", p.link); sv("libPrice", p.price);
    document.getElementById("libRole").value = p.role || "load";
    sv("libVolt", p.volt); sv("libCurrent", p.current); sv("libPower", p.power);
    sv("libAh", p.capacityAh); sv("libDod", p.dod); sv("libMin", p.minPerHour); sv("libEff", p.efficiency);
    _editDatasheets = (p.datasheets || []).map(function (d) { return { id: d.id, name: d.name, type: d.type, data: d.data }; });
    renderDsList();
    updateLibRoleRows();
    document.getElementById("libEditModal").hidden = false;
  }
  // 데이터시트 편집 목록 렌더
  function renderDsList() {
    var box = document.getElementById("libDsList");
    if (!_editDatasheets.length) { box.innerHTML = "<span class='muted'>첨부된 파일 없음</span>"; return; }
    box.innerHTML = _editDatasheets.map(function (d, i) {
      var icon = d.type === "application/pdf" ? "📄" : "🖼️";
      return "<div class='ds-item'><span class='ds-name' title='" + esc(d.name) + "'>" + icon + " " + esc(d.name) + "</span>" +
        "<button type='button' class='ds-item-view' data-i='" + i + "'>보기</button>" +
        "<button type='button' class='ds-item-del' data-i='" + i + "' title='삭제'>×</button></div>";
    }).join("");
  }
  function updateLibRoleRows() {
    var role = document.getElementById("libRole").value;
    function show(id, on) { document.getElementById(id).hidden = !on; }
    // 배터리: 전압 + 용량 + DoD  /  부하: V·A·W + 하루가동시간  /  변환기: 효율
    show("libVoltWrap", role === "battery" || role === "load");
    show("libCurrentWrap", role === "load");
    show("libPowerWrap", role === "load");
    show("libVipHint", role === "load");
    show("libElecGrid", role !== "converter");   // 변환기는 V/A/W 칸 숨김
    show("libBattRow", role === "battery");
    show("libDutyRow", role === "load");
    show("libEffRow", role === "converter");
  }
  // V·I·P 중 2개 → 나머지 자동
  function vipAuto(changed) {
    var v = parseFloat(gv("libVolt")), i = parseFloat(gv("libCurrent")), p = parseFloat(gv("libPower"));
    if (changed === "power") { if (v > 0 && p >= 0) sv("libCurrent", round(p / v)); else if (i > 0 && p >= 0) sv("libVolt", round(p / i)); }
    else { if (v > 0 && i > 0) sv("libPower", round(v * i)); }
  }
  function round(x) { return Math.round(x * 1000) / 1000; }

  function bindLibEdit() {
    document.getElementById("libRole").addEventListener("change", updateLibRoleRows);
    document.getElementById("libVolt").addEventListener("input", function () { vipAuto("volt"); });
    document.getElementById("libCurrent").addEventListener("input", function () { vipAuto("current"); });
    document.getElementById("libPower").addEventListener("input", function () { vipAuto("power"); });

    // 데이터시트: 파일 추가 / 보기 / 삭제
    document.getElementById("libDsAdd").addEventListener("click", function () {
      document.getElementById("libDsInput").click();
    });
    document.getElementById("libDsInput").addEventListener("change", function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      files.forEach(function (f) {
        if (f.size > 20 * 1024 * 1024) { alert("파일이 너무 큽니다(20MB 초과): " + f.name); return; }
        var reader = new FileReader();
        reader.onload = function () {
          _editDatasheets.push({ id: WE.model.nextId("ds"), name: f.name, type: f.type || "application/octet-stream", data: reader.result });
          renderDsList();
        };
        reader.readAsDataURL(f);
      });
      e.target.value = "";   // 같은 파일 다시 선택 가능하게
    });
    document.getElementById("libDsList").addEventListener("click", function (e) {
      var v = e.target.closest(".ds-item-view");
      if (v) { openDatasheetViewer(_editDatasheets, gv("libName") || "데이터시트", +v.dataset.i); return; }
      var d = e.target.closest(".ds-item-del");
      if (d) { _editDatasheets.splice(+d.dataset.i, 1); renderDsList(); }
    });

    document.getElementById("libEditCancel").addEventListener("click", function () {
      document.getElementById("libEditModal").hidden = true; _editLibId = null;
    });
    document.getElementById("libEditSave").addEventListener("click", function () {
      if (_editLibId) {
        var newName = gv("libName").trim() || "부품";
        WE.library.updatePart(_editLibId, {
          name: newName,
          spec: gv("libSpec").trim(), link: gv("libLink").trim(), price: gv("libPrice"),
          role: gv("libRole"),
          volt: gv("libVolt"), current: gv("libCurrent"), power: gv("libPower"),
          capacityAh: gv("libAh"), dod: gv("libDod"), minPerHour: gv("libMin"), efficiency: gv("libEff"),
          datasheets: _editDatasheets
        });
        // 이미 배치된 부품의 이름표(캔버스 라벨)도 같이 갱신 (전기정보·BOM은 라이브러리를 실시간 참조라 자동 반영됨)
        var placed = WE.model.project.components.filter(function (x) { return x.libraryId === _editLibId; });
        if (placed.length) {
          placed.forEach(function (x) { x.name = newName; });
          WE.render.renderAll();
          refreshProps();
        }
        renderLibrary();
        renderPowerSummary();
        if (_view === "bom") renderBOMView();   // BOM 열려 있으면 갱신
      }
      document.getElementById("libEditModal").hidden = true; _editLibId = null;
    });
  }

  // ---- 데이터시트 미리보기 모달 ----
  var _dsList = [], _dsIdx = 0, _dsUrl = null;
  // MIME은 데이터 내용이 아니라 검증된 타입(d.type)만 허용 — 공유 파일에 심어진
  // "PDF라고 주장하지만 실제론 text/html"인 데이터가 같은 origin에서 실행되는 것(XSS) 차단
  // SVG 제외: <img>엔 안전하지만 새 탭(blob URL)에서 열면 스크립트가 실행될 수 있음
  var DS_SAFE_MIMES = /^(application\/pdf|image\/(png|jpe?g|gif|webp|bmp))$/;
  function dataURLtoBlob(dataURL, declaredType) {
    var parts = dataURL.split(",");
    var mime = DS_SAFE_MIMES.test(declaredType || "") ? declaredType : "application/octet-stream";
    var bin = atob(parts[1]), len = bin.length, arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  function openDatasheetViewer(list, title, startIdx) {
    if (!list || !list.length) return;
    _dsList = list; _dsIdx = startIdx || 0;
    document.getElementById("dsViewerTitle").textContent = title || "데이터시트";
    document.getElementById("dsViewerModal").hidden = false;
    document.getElementById("dsViewerTabs").innerHTML = _dsList.map(function (d, i) {
      return "<button class='ds-tab" + (i === _dsIdx ? " active" : "") + "' data-i='" + i + "'>" + esc(d.name) + "</button>";
    }).join("");
    showDatasheet(_dsIdx);
  }
  var _dsZoom = 1, _dsPanX = 0, _dsPanY = 0;
  function applyDsTransform() {
    var img = document.querySelector("#dsViewerPreview .ds-img");
    if (img) img.style.transform = "translate(" + _dsPanX + "px," + _dsPanY + "px) scale(" + _dsZoom + ")";
  }
  function showDatasheet(i) {
    _dsIdx = i;
    var d = _dsList[i]; if (!d) return;
    var tabs = document.querySelectorAll("#dsViewerTabs .ds-tab");
    for (var k = 0; k < tabs.length; k++) tabs[k].classList.toggle("active", +tabs[k].dataset.i === i);
    if (_dsUrl) { URL.revokeObjectURL(_dsUrl); _dsUrl = null; }
    _dsUrl = URL.createObjectURL(dataURLtoBlob(d.data, d.type));
    _dsZoom = 1; _dsPanX = 0; _dsPanY = 0;
    var box = document.getElementById("dsViewerPreview");
    var isImg = /^image\/(png|jpe?g|gif|webp|bmp)$/.test(d.type);
    document.getElementById("dsZoomBtns").style.display = isImg ? "" : "none";  // 이미지일 때만 확대버튼
    box.classList.toggle("img-mode", isImg);
    if (d.type === "application/pdf") box.innerHTML = "<iframe src='" + _dsUrl + "' title='" + esc(d.name) + "'></iframe>";
    else if (isImg) { box.innerHTML = "<img class='ds-img' src='" + _dsUrl + "' alt='" + esc(d.name) + "' />"; applyDsTransform(); }
    else box.innerHTML = "<p class='muted'>미리보기를 지원하지 않는 형식입니다. 다운로드해서 확인하세요.</p>";
  }
  function closeDatasheetViewer() {
    document.getElementById("dsViewerModal").hidden = true;
    if (_dsUrl) { URL.revokeObjectURL(_dsUrl); _dsUrl = null; }
    document.getElementById("dsViewerPreview").innerHTML = "";
  }
  function bindDatasheetViewer() {
    document.getElementById("dsViewerClose").addEventListener("click", closeDatasheetViewer);
    document.getElementById("dsViewerTabs").addEventListener("click", function (e) {
      var t = e.target.closest(".ds-tab"); if (t) showDatasheet(+t.dataset.i);
    });
    document.getElementById("dsDownload").addEventListener("click", function () {
      var d = _dsList[_dsIdx]; if (!d) return;
      var a = document.createElement("a"); a.href = d.data; a.download = d.name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });
    document.getElementById("dsOpenTab").addEventListener("click", function () {
      var d = _dsList[_dsIdx]; if (!d) return;
      var url = URL.createObjectURL(dataURLtoBlob(d.data, d.type));
      window.open(url, "_blank", "noopener");
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    });
    document.getElementById("dsMax").addEventListener("click", function () {
      var mbox = document.querySelector("#dsViewerModal .ds-viewer-box");
      var on = mbox.classList.toggle("maximized");
      this.textContent = on ? "🗗 축소" : "⛶ 최대화";
    });

    // ---- 이미지 확대/축소·이동(뷰어 안에서만, 페이지 확대 방지) ----
    var box = document.getElementById("dsViewerPreview");
    function zoomBy(f) { _dsZoom = Math.max(0.2, Math.min(12, _dsZoom * f)); applyDsTransform(); }
    document.getElementById("dsZoomIn").addEventListener("click", function () { zoomBy(1.25); });
    document.getElementById("dsZoomOut").addEventListener("click", function () { zoomBy(1 / 1.25); });
    document.getElementById("dsZoomFit").addEventListener("click", function () { _dsZoom = 1; _dsPanX = 0; _dsPanY = 0; applyDsTransform(); });
    box.addEventListener("wheel", function (e) {
      if (!box.classList.contains("img-mode")) return;   // 이미지일 때만
      e.preventDefault();                                  // 페이지 확대/스크롤 차단
      zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
    var dsDrag = null;
    box.addEventListener("pointerdown", function (e) {
      if (!box.classList.contains("img-mode")) return;
      dsDrag = { x: e.clientX, y: e.clientY, px: _dsPanX, py: _dsPanY };
      box.setPointerCapture(e.pointerId); box.style.cursor = "grabbing";
    });
    box.addEventListener("pointermove", function (e) {
      if (!dsDrag) return;
      _dsPanX = dsDrag.px + (e.clientX - dsDrag.x);
      _dsPanY = dsDrag.py + (e.clientY - dsDrag.y);
      applyDsTransform();
    });
    box.addEventListener("pointerup", function (e) {
      dsDrag = null; box.style.cursor = ""; try { box.releasePointerCapture(e.pointerId); } catch (_) { }
    });
  }

  // 단자 편집 후 처리 — 편집은 '이 부품(인스턴스)'에만 적용(Ctrl+Z로 복구 가능).
  // 라이브러리 반영은 실수 방지를 위해 분리: 부품 우클릭 → '라이브러리에 저장'을 눌러야 반영됨.
  function afterTerminalEdit(c) {
    // 편집으로 사라진 단자를 참조하던 배선만 정리
    WE.model.project.wires = WE.model.project.wires.filter(function (w) {
      return WE.geometry.wireEndpoint(w.from) && WE.geometry.wireEndpoint(w.to);
    });
  }

  // 배경제거 편집에서 회전/크롭했을 때 단자 좌표(rx·ry)를 이미지와 똑같이 변환
  // (안 하면 이미지만 돌아가고 단자는 옛 방향 그대로라 배치가 완전히 깨짐)
  var LABEL_SIDE_CW = { L: "T", T: "R", R: "B", B: "L" };
  function transformTerminal(t, tf) {
    if (!tf || (!tf.rotation && !tf.crop)) return;
    var rx = t.rx, ry = t.ry, nrx = rx, nry = ry;
    if (tf.rotation === 90) { nrx = 1 - ry; nry = rx; }
    else if (tf.rotation === 180) { nrx = 1 - rx; nry = 1 - ry; }
    else if (tf.rotation === 270) { nrx = ry; nry = 1 - rx; }
    if (tf.crop) { nrx = (nrx - tf.crop.x) / tf.crop.w; nry = (nry - tf.crop.y) / tf.crop.h; }
    t.rx = Math.max(0, Math.min(1, nrx));
    t.ry = Math.max(0, Math.min(1, nry));
    delete t.labelPos;                       // 수동 라벨 위치는 옛 좌표계 기준이라 초기화
    if (t.labelSide && tf.rotation) {        // 수동 라벨 방향은 회전만큼 같이 돌림
      for (var i = 0; i < tf.rotation / 90; i++) t.labelSide = LABEL_SIDE_CW[t.labelSide];
    }
  }

  // 인스턴스 이미지 편집(배경제거/회전/크롭) 결과를 '이 부품'에만 적용 — 새 이미지 비율로 박스 보정 + 단자 좌표 변환.
  // 라이브러리 반영은 분리(부품 우클릭 → '라이브러리에 저장'). 실수해도 Ctrl+Z로 복구 가능.
  function applyInstanceImage(c, url, tf) {
    var probe = new Image();
    probe.onload = function () {
      var aspect = probe.width > 0 ? probe.height / probe.width : (c.height / c.width);
      var swap = tf && (tf.rotation === 90 || tf.rotation === 270);   // 90/270°는 가로세로가 실제로 뒤바뀜
      c.image = url;
      if (swap) c.width = Math.max(10, c.height);
      c.height = Math.max(10, Math.round(c.width * aspect));
      (c.terminals || []).forEach(function (t) { transformTerminal(t, tf); });
      WE.render.renderAll();
    };
    probe.src = url;
  }

  // ---- 부품 라이브러리 ----
  var _placeN = 0;
  // 이미지 파일 → 배경제거 모달 → 라이브러리 저장 → 편집 모달 오픈 (버튼 클릭/드래그앤드롭 공용)
  function addImageFileToLibrary(file) {
    if (!file || file.type.indexOf("image/") !== 0) return;
    var name = file.name.replace(/\.[^.]+$/, "");
    var reader = new FileReader();
    reader.onload = function (ev) {
      WE.bgremove.open(ev.target.result, function (url) {
        var probe = new Image();
        probe.onload = function () {
          var maxSide = 160, w = probe.width, h = probe.height, r = w / h;
          if (w >= h) { w = maxSide; h = Math.round(maxSide / r); } else { h = maxSide; w = Math.round(maxSide * r); }
          var np = saveToLibrary(name, function () {
            return { name: name, image: url, defaultWidth: w, defaultHeight: h, terminals: [] };
          });
          if (np) { trackOnce("add_component"); openLibEdit(np.id); }   // 바로 스펙/구매링크 입력
        };
        probe.src = url;
      });
    };
    reader.readAsDataURL(file);
  }
  function bindLibrary() {
    document.getElementById("btnLibAdd").addEventListener("click", function () {
      document.getElementById("fileLibAdd").click();
    });
    document.getElementById("fileLibAdd").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0]; if (!file) return;
      addImageFileToLibrary(file);
      e.target.value = "";
    });

    // 좌측 라이브러리 패널 전체에 이미지 파일을 드래그해서 놓으면 부품 추가(버튼 클릭과 동일 동작)
    var leftPanel = document.getElementById("leftPanel");
    leftPanel.addEventListener("dragover", function (e) {
      if (!(e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf("Files") >= 0)) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "copy";
      leftPanel.classList.add("lib-dragover");
    });
    leftPanel.addEventListener("dragleave", function (e) {
      if (e.target === leftPanel) leftPanel.classList.remove("lib-dragover");
    });
    leftPanel.addEventListener("drop", function (e) {
      leftPanel.classList.remove("lib-dragover");
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      var img = null;
      for (var i = 0; i < files.length; i++) { if (files[i].type.indexOf("image/") === 0) { img = files[i]; break; } }
      if (!img) return;
      e.preventDefault();
      addImageFileToLibrary(img);
    });

    document.getElementById("btnLibExport").addEventListener("click", function () {
      var blob = new Blob([WE.library.exportJson()], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "부품라이브러리.ezclib";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
    document.getElementById("btnLibImport").addEventListener("click", function () {
      document.getElementById("fileLibImport").click();
    });
    document.getElementById("fileLibImport").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var r = WE.library.importJson(JSON.parse(ev.target.result), false);
          var relinked = relinkOrphanComponents();   // 연결 끊겼던 배치 부품을 이름으로 복구
          renderLibrary();
          WE.render.renderAll();   // BOM·도면 다시 그림
          setHint("라이브러리 불러오기: 새 부품 " + r.added + "개" +
            (r.updated ? (" · 기존 부품 " + r.updated + "개 갱신") : "") +
            (relinked ? (" · 배치 부품 " + relinked + "개 재연결") : ""));
        } catch (err) { alert("가져오기 실패: " + err.message); }
      };
      reader.readAsText(file); e.target.value = "";
    });

    bindLibraryDnD();

    document.getElementById("libList").addEventListener("click", function (e) {
      var item = e.target.closest(".lib-item"); if (!item) return;
      var part = WE.library.get(item.dataset.id); if (!part) return;
      if (e.target.closest(".lib-del")) {
        if (confirm("‘" + part.name + "’ 부품을 라이브러리에서 삭제할까요?")) {
          WE.library.remove(part.id); renderLibrary();
        }
        return;
      }
      if (e.target.closest(".lib-fav")) { WE.library.toggleFav(part.id); renderLibrary(); return; }
      if (e.target.closest(".lib-edit")) { openLibEdit(part.id); return; }
      // 클릭 → 캔버스에 배치
      _placeN = (_placeN + 1) % 8;
      var opts = WE.library.instanceOpts(part, 180 + _placeN * 24, 150 + _placeN * 24);
      var cmp = WE.model.addComponent(opts);
      trackOnce("place_component");
      WE.model.select("component", cmp.id);
      touchLibRecent(part.id);   // 최근 사용 → 목록 상단으로
      renderLibrary();
      WE.render.renderAll(); refreshProps();
    });
    // 검색: 입력 즉시 필터링
    document.getElementById("libSearch").addEventListener("input", function (e) {
      _libQuery = e.target.value.trim().toLowerCase();
      renderLibrary();
    });
  }

  // 라이브러리 드래그 순서 변경 (드롭 위치 표시)
  function bindLibraryDnD() {
    var list = document.getElementById("libList");
    var dragId = null;
    var indicator = document.createElement("div");
    indicator.className = "lib-drop-line";

    function afterElement(y) {
      var items = [].slice.call(list.querySelectorAll(".lib-item:not(.dragging)"));
      var closest = { offset: -Infinity, el: null };
      items.forEach(function (child) {
        var box = child.getBoundingClientRect();
        var offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) closest = { offset: offset, el: child };
      });
      return closest.el;
    }
    function clearInd() { if (indicator.parentNode) indicator.parentNode.removeChild(indicator); }

    list.addEventListener("dragstart", function (e) {
      var item = e.target.closest(".lib-item"); if (!item) return;
      dragId = item.dataset.id;
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", dragId); } catch (_) {}
      setTimeout(function () { item.classList.add("dragging"); }, 0);
    });
    list.addEventListener("dragover", function (e) {
      if (dragId == null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      var after = afterElement(e.clientY);
      if (after) list.insertBefore(indicator, after); else list.appendChild(indicator);
    });
    list.addEventListener("drop", function (e) {
      if (dragId == null) return;
      e.preventDefault();
      var after = afterElement(e.clientY);
      WE.library.reorderBefore(dragId, after ? after.dataset.id : null);
      clearInd(); dragId = null;
      renderLibrary();
    });
    list.addEventListener("dragend", function () {
      clearInd(); dragId = null;
      var d = list.querySelector(".dragging"); if (d) d.classList.remove("dragging");
    });
  }

  // ---- 라이브러리 검색/최근 사용 ----
  var _libQuery = "";
  function libRecentMap() {
    try { return JSON.parse(localStorage.getItem("we_libRecent") || "{}"); } catch (e) { return {}; }
  }
  function touchLibRecent(id) {
    try {
      var m = libRecentMap(); m[id] = Date.now();
      // 오래된 항목 정리(최근 50개만 유지)
      var keys = Object.keys(m).sort(function (a, b) { return m[b] - m[a]; });
      keys.slice(50).forEach(function (k) { delete m[k]; });
      localStorage.setItem("we_libRecent", JSON.stringify(m));
    } catch (e) { /* 무시 */ }
  }
  // 검색어 매칭 부분을 <mark>로 감싼 HTML (esc 처리 포함)
  function hlHtml(text, q) {
    text = String(text == null ? "" : text);
    if (!q) return esc(text);
    var lower = text.toLowerCase(), out = "", i = 0;
    while (true) {
      var hit = lower.indexOf(q, i);
      if (hit < 0) { out += esc(text.slice(i)); break; }
      out += esc(text.slice(i, hit)) + "<mark>" + esc(text.slice(hit, hit + q.length)) + "</mark>";
      i = hit + q.length;
    }
    return out;
  }

  function renderLibrary() {
    var list = document.getElementById("libList");
    list.innerHTML = "";
    var parts = WE.library.getAll();
    if (!parts.length) {
      var p = document.createElement("p");
      p.className = "muted"; p.textContent = "등록된 부품이 없습니다.";
      list.appendChild(p); return;
    }
    var q = _libQuery;
    // 검색 필터(이름+스펙)
    var shown = !q ? parts.slice() : parts.filter(function (part) {
      return (part.name || "").toLowerCase().indexOf(q) >= 0 ||
             (part.spec || "").toLowerCase().indexOf(q) >= 0;
    });
    if (!shown.length) {
      var np = document.createElement("p");
      np.className = "muted"; np.textContent = "'" + q + "' 검색 결과가 없습니다.";
      list.appendChild(np); return;
    }
    // 정렬: ★즐겨찾기 최상단 → 최근 사용 순 → 기존(수동) 순서
    var recent = libRecentMap();
    shown.sort(function (a, b) {
      var f = (b.fav ? 1 : 0) - (a.fav ? 1 : 0);
      if (f) return f;
      return (recent[b.id] || 0) - (recent[a.id] || 0);
    });

    shown.forEach(function (part) {
      var item = document.createElement("div");
      item.className = "lib-item" + (part.fav ? " fav" : ""); item.dataset.id = part.id;
      item.setAttribute("draggable", "true");
      item.title = "클릭: 캔버스에 배치 · 드래그: 순서 변경";
      var fav = document.createElement("button");
      fav.className = "lib-fav" + (part.fav ? " on" : "");
      fav.textContent = part.fav ? "★" : "☆";
      fav.title = part.fav ? "즐겨찾기 해제" : "즐겨찾기";
      item.appendChild(fav);
      var thumbWrap = document.createElement("div"); thumbWrap.className = "lib-thumb-wrap";
      var thumb = document.createElement(part.image ? "img" : "div");
      thumb.className = "lib-thumb";
      if (part.image) thumb.src = part.image;
      thumbWrap.appendChild(thumb);
      if (part.link) {
        var lk = document.createElement("span"); lk.className = "lib-haslink"; lk.textContent = "🔗"; lk.title = "구매 링크 있음";
        thumbWrap.appendChild(lk);
      }
      var info = document.createElement("div"); info.className = "lib-info";
      var nm = document.createElement("div"); nm.className = "lib-name";
      nm.innerHTML = hlHtml(part.name, q);
      info.appendChild(nm);
      if (part.spec) {
        var meta = document.createElement("div"); meta.className = "lib-meta";
        meta.innerHTML = hlHtml(part.spec, q);
        info.appendChild(meta);
      }
      var edit = document.createElement("button"); edit.className = "lib-edit"; edit.textContent = "✎"; edit.title = "정보/구매링크 편집";
      var del = document.createElement("button"); del.className = "lib-del"; del.textContent = "×"; del.title = "삭제";
      item.appendChild(thumbWrap); item.appendChild(info); item.appendChild(edit); item.appendChild(del);
      list.appendChild(item);
    });
  }

  // ---- 다중 선택 정렬 ----
  function bindAlign() {
    document.getElementById("alignProps").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-align]");
      if (btn) alignComponents(btn.getAttribute("data-align"));
    });
  }

  function alignComponents(mode) {
    var comps = WE.model.getMulti().map(WE.model.getComponent).filter(Boolean);
    if (comps.length < 2) return;
    function W(c) { return c.width * c.scale; }
    function H(c) { return c.height * c.scale; }
    var minL = Math.min.apply(null, comps.map(function (c) { return c.x; }));
    var maxR = Math.max.apply(null, comps.map(function (c) { return c.x + W(c); }));
    var minT = Math.min.apply(null, comps.map(function (c) { return c.y; }));
    var maxB = Math.max.apply(null, comps.map(function (c) { return c.y + H(c); }));
    var cx = (minL + maxR) / 2, cy = (minT + maxB) / 2;

    if (mode === "distH" || mode === "distV") {
      if (comps.length < 3) return;
      var horiz = mode === "distH";
      var arr = comps.slice().sort(function (a, b) {
        return horiz ? (a.x + W(a) / 2) - (b.x + W(b) / 2) : (a.y + H(a) / 2) - (b.y + H(b) / 2);
      });
      var firstC = horiz ? arr[0].x + W(arr[0]) / 2 : arr[0].y + H(arr[0]) / 2;
      var last = arr[arr.length - 1];
      var lastC = horiz ? last.x + W(last) / 2 : last.y + H(last) / 2;
      var step = (lastC - firstC) / (arr.length - 1);
      arr.forEach(function (c, i) {
        if (i === 0 || i === arr.length - 1) return;
        var target = firstC + step * i;
        if (horiz) c.x = Math.round(target - W(c) / 2);
        else c.y = Math.round(target - H(c) / 2);
      });
    } else {
      comps.forEach(function (c) {
        if (mode === "left") c.x = minL;
        else if (mode === "right") c.x = maxR - W(c);
        else if (mode === "centerX") c.x = Math.round(cx - W(c) / 2);
        else if (mode === "top") c.y = minT;
        else if (mode === "bottom") c.y = maxB - H(c);
        else if (mode === "centerY") c.y = Math.round(cy - H(c) / 2);
      });
    }
    WE.render.renderAll();
    refreshProps();
  }

  // ---- BOM(자재명세서) ----
  // 집계: 캔버스 부품을 라이브러리/이름 기준으로 묶고 수량 합산
  function buildBOM() {
    var map = {}, order = [];
    WE.model.project.components.forEach(function (c) {
      var lib = c.libraryId ? WE.library.get(c.libraryId) : null;
      var key = c.libraryId || ("name:" + c.name);
      if (!map[key]) {
        var basePrice = lib ? (lib.price || "") : (c.bomPrice || "");
        var ov = WE.model.project.bomPrice ? WE.model.project.bomPrice[key] : undefined;
        map[key] = {
          key: key, libraryId: c.libraryId || null, name: lib ? lib.name : c.name, qty: 0,
          spec: lib ? (lib.spec || "") : (c.bomSpec || ""),
          link: lib ? (lib.link || "") : (c.bomLink || ""),
          basePrice: basePrice,
          price: (ov != null && ov !== "") ? ov : basePrice,   // 프로젝트 덮어쓰기 우선
          overridden: (ov != null && ov !== ""),
          elec: lib ? elecStr(lib) : "",
          dsNames: (lib && lib.datasheets) ? lib.datasheets.map(function (d) { return d.name; }) : []
        };
        order.push(key);
      }
      map[key].qty++;
    });
    return order.map(function (k) { return map[k]; });
  }

  function elecStr(lib) {
    var a = [];
    if (n(lib.volt)) a.push(n(lib.volt) + "V");
    if (n(lib.current)) a.push(n(lib.current) + "A");
    if (partPower(lib)) a.push(round(partPower(lib)) + "W");
    if ((lib.role || "load") === "load" && n(lib.minPerHour) && n(lib.minPerHour) !== 60) a.push("가동 " + n(lib.minPerHour) + "분/시간");
    if (lib.role === "battery" && n(lib.capacityAh)) a.push(n(lib.capacityAh) + "Ah");
    return a.join(" · ");
  }

  // ---- BOM 표 뷰(하단 탭) ----
  var _view = "wiring";
  function setActiveTab(view) {
    var tabs = document.querySelectorAll(".view-tab");
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("active", tabs[i].dataset.view === view);
  }
  // 배선도는 항상 표시. BOM/배선 리스트 탭 = 배선도 아래에 해당 창을 추가 표시(스크롤 이동), 배선도 탭 = 둘 다 숨김.
  function switchView(view) {
    _view = view; setActiveTab(view);
    var wrap = document.getElementById("canvasWrap");
    var bom = document.getElementById("bomView");
    var wl = document.getElementById("wireListView");
    bom.hidden = view !== "bom";
    wl.hidden = view !== "wirelist";
    if (view === "bom") { renderBOMView(); wrap.scrollTo({ top: bom.offsetTop - 8, behavior: "smooth" }); }
    else if (view === "wirelist") { renderWireListView(); wrap.scrollTo({ top: wl.offsetTop - 8, behavior: "smooth" }); }
    else { wrap.scrollTo({ top: 0, behavior: "smooth" }); }   // 배선도만
  }
  // 모델 변경 시 BOM/배선 리스트가 열려 있으면 갱신
  function afterModelRender() {
    if (_view === "bom") renderBOMView();
    else if (_view === "wirelist") renderWireListView();
  }
  function renderWireListView() {
    var rows = wireListData();
    var t = document.getElementById("wireListTable");
    if (!rows.length) { t.innerHTML = "<tr><td class='muted' style='border:none'>배선이 없습니다.</td></tr>"; return; }
    var html = "<thead><tr><th>번호</th><th>색</th><th>AWG</th><th>전류(A)</th><th>출발</th><th>도착</th></tr></thead><tbody>";
    rows.forEach(function (r) {
      html += "<tr><td>" + esc(r.no) + "</td>" +
        "<td><span style='display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:middle;background:" + esc(r.colorHex) + "'></span>" + esc(r.color) + "</td>" +
        "<td>" + (r.awg ? esc("AWG " + r.awg) : "") + "</td>" +
        "<td>" + esc(r.current) + "</td>" +
        "<td>" + esc(r.fromCmp) + " · " + esc(r.fromTerm) + "</td>" +
        "<td>" + esc(r.toCmp) + " · " + esc(r.toTerm) + "</td></tr>";
    });
    html += "</tbody>";
    t.innerHTML = html;
  }

  function won(v) { return n(v) ? "₩" + Math.round(n(v)).toLocaleString() : ""; }

  // ---- BOM 행/열 유틸 ----
  function getManual(id) {
    var a = WE.model.project.manualBom;
    for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  }
  // 모든 열의 colKey를 기본순서로 (사용자 순서 bomColOrder 적용)
  function orderedColKeys() {
    var base = ["name", "spec", "qty", "price", "sum", "link", "ds"];
    (WE.model.project.bomExtraCols || []).forEach(function (c) { base.push("c:" + c.id); });
    var order = WE.model.project.bomColOrder || [], pos = {};
    order.forEach(function (k, i) { pos[k] = i; });
    base.sort(function (a, b) {
      var pa = pos[a], pb = pos[b];
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pa - pb;
    });
    return base;
  }
  function colDescriptor(key) {
    switch (key) {
      case "name": return { id: "name", label: "부품명", kind: "text" };
      case "spec": return { id: "spec", label: "스펙", kind: "text" };
      case "qty": return { id: "qty", label: "수량", kind: "num" };
      case "price": return { id: "price", label: "단가", kind: "num" };
      case "sum": return { id: "sum", label: "합계", kind: "num" };
      case "link": return { id: "link", label: "구매링크", kind: "link" };
      case "ds": return { id: "ds", label: "데이터시트", kind: "ds" };
      default:
        var cid = key.slice(2), c = (WE.model.project.bomExtraCols || []).filter(function (x) { return x.id === cid; })[0];
        return c ? { id: "custom", colId: cid, label: c.name, kind: "custom" } : null;
    }
  }
  // 표시할 열(순서 반영 + 기본열 표시/숨김)
  function visibleCols() {
    var show = WE.model.project.bomColShow || {};
    return orderedColKeys().map(colDescriptor).filter(function (col) {
      if (!col) return false;
      if (col.id === "spec") return !!show.spec;
      if (col.id === "price") return !!show.price;
      if (col.id === "sum") return !!show.sum;
      if (col.id === "link") return !!show.link;
      if (col.id === "ds") return show.ds !== false;   // 기본 표시(기존 프로젝트 호환)
      return true;   // name, qty, custom은 항상 표시
    });
  }

  // 화면·PDF 공용 BOM 데이터 (자동집계 + 수동품목, 순서 적용, 합계)
  function bomData() {
    var proj = WE.model.project, rows = [];
    buildBOM().forEach(function (r) {
      var rowId = "auto:" + r.key;
      rows.push({
        kind: "auto", rowId: rowId, key: r.key, libraryId: r.libraryId,
        name: r.name, spec: r.spec, qty: r.qty, price: r.price,
        basePrice: r.basePrice, overridden: r.overridden, sum: n(r.price) * r.qty,
        link: r.link, dsNames: r.dsNames || [], custom: proj.bomCustom[rowId] || {}
      });
    });
    (proj.manualBom || []).forEach(function (m) {
      var rowId = "man:" + m.id, qty = n(m.qty) || 1;
      rows.push({
        kind: "manual", rowId: rowId, manId: m.id, name: m.name || "", spec: m.spec || "",
        qty: qty, price: m.price, sum: n(m.price) * qty, link: m.link || "",
        custom: proj.bomCustom[rowId] || {}
      });
    });
    // 저장된 순서 적용(모르는 행은 자연순 뒤에)
    var order = proj.bomOrder || [], pos = {};
    order.forEach(function (id, i) { pos[id] = i; });
    rows.sort(function (a, b) {
      var pa = pos[a.rowId], pb = pos[b.rowId];
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pa - pb;
    });
    var total = 0, totalQty = 0;
    rows.forEach(function (r, i) { r.no = i + 1; total += r.sum; totalQty += r.qty; });
    return { rows: rows, total: total, totalQty: totalQty };
  }

  // 긴 URL을 사이트 이름 정도로 짧게 (표가 무거워지지 않게)
  function linkLabel(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); }
    catch (e) { return url.length > 30 ? url.slice(0, 30) + "…" : url; }
  }
  function linkCell(link) {
    var url = (link || "").trim();
    if (/^https?:\/\//i.test(url)) {
      return "<a class='bom-link' data-url='" + esc(url) + "' title='" + esc(url) + " (더블클릭: 수정)'>" + esc(linkLabel(url)) + "</a>";
    }
    if (url) return "<span class='bom-link-plain' title='더블클릭: 수정'>" + esc(url) + "</span>";
    return "<span class='bom-link-empty' title='더블클릭: 링크 입력'>—</span>";
  }

  // 한 행의 한 열 셀 HTML
  function bomCellHtml(col, r) {
    if (col.kind === "custom") {
      var v = (r.custom && r.custom[col.colId]) || "";
      return "<td class='editable' data-col='" + esc(col.colId) + "'>" + esc(v) + "</td>";
    }
    var priceTxt;
    switch (col.id) {
      case "name": return "<td class='editable' data-f='name'>" + esc(r.name) + "</td>";
      case "spec": return "<td class='editable' data-f='spec'>" + esc(r.spec) + "</td>";
      case "qty":
        if (r.kind === "manual") return "<td class='num editable' data-f='qty'>" + r.qty + "</td>";
        return "<td class='num'>" + r.qty + "</td>";
      case "price":
        priceTxt = n(r.price) ? Math.round(n(r.price)).toLocaleString() : "";
        if (r.kind === "manual") return "<td class='num editable' data-f='price'>" + priceTxt + "</td>";
        var pCls = "num editable" + (r.overridden ? " overridden" : "");
        var pTitle = (r.overridden && n(r.basePrice)) ?
          " title='라이브러리 기본단가 ₩" + Math.round(n(r.basePrice)).toLocaleString() + " → 이 배선도에서 수정됨 (비우면 기본값 복귀)'" : "";
        return "<td class='" + pCls + "' data-f='price'" + pTitle + ">" + priceTxt + "</td>";
      case "sum": return "<td class='num'>" + won(r.sum) + "</td>";
      case "link": return "<td class='bom-link-cell' data-f='link'>" + linkCell(r.link) + "</td>";
      case "ds":
        var nn = (r.dsNames || []).length;
        if (nn) return "<td class='ds-cell'><button class='ds-view' data-lib='" + esc(r.libraryId || "") + "' title='데이터시트 보기'>📎 " + nn + "</button></td>";
        if (r.libraryId) return "<td class='ds-cell'><button class='ds-add' data-lib='" + esc(r.libraryId) + "' title='데이터시트 첨부'>＋</button></td>";
        return "<td class='ds-cell'></td>";
    }
    return "<td></td>";
  }

  function renderBOMView() {
    var data = bomData(), cols = visibleCols(), proj = WE.model.project;
    syncBomControls();
    var t = document.getElementById("bomTable");
    var px = Number(proj.bomRowH); if (!isFinite(px)) px = 6;
    t.style.setProperty("--bom-rh", px + "px");

    // 열 너비(colgroup): 거터·# 고정, 나머지는 저장된 너비 적용
    function colKey(col) { return col.kind === "custom" ? "c:" + col.colId : col.id; }
    var cg = "<colgroup><col style='width:30px' /><col style='width:38px' />";
    cols.forEach(function (col) {
      var w = proj.bomColW[colKey(col)];
      cg += "<col" + (w ? " style='width:" + w + "px'" : "") + " />";
    });
    cg += "</colgroup>";

    var resize = "<span class='col-resize' title='드래그로 너비 조절'></span>";
    var html = cg + "<thead><tr><th class='bom-gutter-h'></th><th class='num'>#</th>";
    cols.forEach(function (col) {
      var key = esc(colKey(col));
      if (col.kind === "custom") {
        html += "<th class='custom-col reorder' draggable='true' data-colkey='" + key + "'><span class='col-name' data-col='" + esc(col.colId) + "' title='더블클릭: 열 이름 변경'>" + esc(col.label) + "</span>" +
          "<button class='col-del' data-col='" + esc(col.colId) + "' title='열 삭제'>×</button>" + resize + "</th>";
      } else {
        html += "<th class='reorder" + (col.kind === "num" ? " num" : "") + "' draggable='true' data-colkey='" + key + "'>" + esc(col.label) + resize + "</th>";
      }
    });
    html += "</tr></thead><tbody>";

    data.rows.forEach(function (r) {
      var attrs = "data-rowid='" + esc(r.rowId) + "' data-kind='" + r.kind + "'";
      if (r.kind === "auto") attrs += " data-key='" + esc(r.key) + "' data-lib='" + esc(r.libraryId || "") + "'";
      else attrs += " data-manid='" + esc(r.manId) + "'";
      html += "<tr class='" + (r.kind === "manual" ? "manual" : "") + "' " + attrs + ">";
      html += "<td class='bom-gutter'><span class='row-grip' draggable='true' title='드래그로 행 이동'>⠿</span>" +
        (r.kind === "manual" ? "<button class='row-del' title='행 삭제'>×</button>" : "") + "</td>";
      html += "<td class='num'>" + r.no + "</td>";
      cols.forEach(function (col) { html += bomCellHtml(col, r); });
      html += "</tr>";
    });

    // 합계 행
    html += "<tr class='total-row'><td class='bom-gutter'></td><td></td>";
    cols.forEach(function (col) {
      if (col.id === "name") html += "<td>합계</td>";
      else if (col.id === "qty") html += "<td class='num'>" + data.totalQty + "</td>";
      else if (col.id === "sum") html += "<td class='num'>" + won(data.total) + "</td>";
      else html += "<td" + (col.kind === "num" ? " class='num'" : "") + "></td>";
    });
    html += "</tr></tbody>";
    t.innerHTML = html;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function commitBomCell(td) {
    var tr = td.closest("tr");
    var text = td.textContent.trim();
    var val = text.replace(/,/g, "");   // 숫자의 천단위 콤마 제거
    // 사용자 지정 열
    if (td.dataset.col != null) {
      var bc = WE.model.project.bomCustom, rid = tr.dataset.rowid;
      if (!bc[rid]) bc[rid] = {};
      if (text === "") delete bc[rid][td.dataset.col]; else bc[rid][td.dataset.col] = text;
      renderBOMView(); return;
    }
    var f = td.dataset.f;
    if (tr.dataset.kind === "manual") {
      var item = getManual(tr.dataset.manid); if (!item) return;
      if (f === "qty" || f === "price") item[f] = n(val); else item[f] = text;
    } else if (f === "price") {
      // 단가는 라이브러리를 건드리지 않고 '이 배선도'에만 덮어쓰기. 비우면 기본단가 복귀
      var pkey = tr.dataset.key;
      if (!WE.model.project.bomPrice) WE.model.project.bomPrice = {};
      if (val === "") delete WE.model.project.bomPrice[pkey];
      else WE.model.project.bomPrice[pkey] = n(val);
    } else {
      var libId = tr.dataset.lib;
      if (libId) {
        var patch = {}; patch[f] = text;   // 이름·스펙·링크는 라이브러리에 저장
        WE.library.updatePart(libId, patch);
      } else {
        var key = tr.dataset.key;
        WE.model.project.components.forEach(function (c) {
          if ((c.libraryId ? c.libraryId : "name:" + c.name) !== key) return;
          if (f === "name") c.name = text;
          else if (f === "spec") c.bomSpec = text;
          else if (f === "link") c.bomLink = text;
        });
        if (f === "name") WE.render.renderAll();
      }
    }
    renderBOMView();
  }

  // 현재 표시 순서(정규화된 전체 rowId 목록)
  function currentBomOrder() { return bomData().rows.map(function (r) { return r.rowId; }); }
  function reorderBomRow(dragId, targetId) {
    if (!dragId || dragId === targetId) return;
    var order = currentBomOrder(), from = order.indexOf(dragId);
    if (from < 0) return;
    order.splice(from, 1);
    var to = order.indexOf(targetId);
    if (to < 0) order.push(dragId); else order.splice(to, 0, dragId);
    WE.model.project.bomOrder = order; renderBOMView();
  }
  function addRowEnd() {
    var item = { id: WE.model.nextId("bm"), name: "", spec: "", qty: 1, price: "", link: "" };
    WE.model.project.manualBom.push(item);
    WE.model.project.bomOrder = currentBomOrder();   // 새 행이 맨 끝
    renderBOMView();
  }
  function addBomColumn() {
    var cols = WE.model.project.bomExtraCols;
    cols.push({ id: WE.model.nextId("col"), name: "열 " + (cols.length + 1) });
    renderBOMView();
  }
  function renameBomColumn(colId) {
    var col = WE.model.project.bomExtraCols.filter(function (c) { return c.id === colId; })[0];
    if (!col) return;
    var name = prompt("열 이름", col.name);
    if (name == null) return; name = name.trim(); if (!name) return;
    col.name = name; renderBOMView();
  }
  function removeBomColumn(colId) {
    var p = WE.model.project;
    p.bomExtraCols = p.bomExtraCols.filter(function (c) { return c.id !== colId; });
    Object.keys(p.bomCustom).forEach(function (rid) { if (p.bomCustom[rid]) delete p.bomCustom[rid][colId]; });
    renderBOMView();
  }
  // 열 순서 재배치(헤더 드래그)
  function reorderBomCol(dragKey, targetKey) {
    if (!dragKey || dragKey === targetKey) return;
    var order = orderedColKeys(), from = order.indexOf(dragKey);
    if (from < 0) return;
    order.splice(from, 1);
    var to = order.indexOf(targetKey);
    if (to < 0) order.push(dragKey); else order.splice(to, 0, dragKey);
    WE.model.project.bomColOrder = order; saveDefaultLayout(); renderBOMView();
  }
  // 열 경계 더블클릭 → 가장 긴 내용에 맞춰 너비 자동조정
  function autoFitColumn(th) {
    var key = th.dataset.colkey; if (!key) return;
    var table = document.getElementById("bomTable"), ci = th.cellIndex;
    var ctx = (autoFitColumn._c || (autoFitColumn._c = document.createElement("canvas"))).getContext("2d");
    function measure(el, text) { ctx.font = getComputedStyle(el).font || "13px sans-serif"; return ctx.measureText(text || "").width; }
    var lbl = th.querySelector(".col-name") ? th.querySelector(".col-name").textContent : th.textContent.replace(/[×＋]/g, "").trim();
    var maxW = measure(th, lbl);
    var cells = table.querySelectorAll("tbody tr:not(.total-row) td:nth-child(" + (ci + 1) + ")");
    Array.prototype.forEach.call(cells, function (td) { var w = measure(td, td.textContent.trim()); if (w > maxW) maxW = w; });
    var extra = 18 + (th.classList.contains("custom-col") ? 30 : 16);   // 셀 좌우 패딩 + 핸들/삭제버튼
    WE.model.project.bomColW[key] = Math.max(40, Math.ceil(maxW) + extra);
    saveDefaultLayout(); renderBOMView();
  }
  // CSV 내보내기
  function exportBomCSV() {
    var data = bomData(), cols = visibleCols();
    function cell(v) { v = (v == null ? "" : String(v)); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var lines = [["No"].concat(cols.map(function (c) { return c.label; })).map(cell).join(",")];
    data.rows.forEach(function (r) {
      var row = [r.no];
      cols.forEach(function (c) {
        if (c.kind === "custom") row.push((r.custom && r.custom[c.colId]) || "");
        else if (c.id === "qty") row.push(r.qty);
        else if (c.id === "price") row.push(n(r.price) || "");
        else if (c.id === "sum") row.push(r.sum || "");
        else if (c.id === "link") row.push(r.link || "");
        else if (c.id === "ds") row.push((r.dsNames || []).join(" | "));
        else if (c.id === "name") row.push(r.name);
        else if (c.id === "spec") row.push(r.spec);
        else row.push("");
      });
      lines.push(row.map(cell).join(","));
    });
    var tot = [""];
    cols.forEach(function (c) {
      if (c.id === "name") tot.push("합계");
      else if (c.id === "qty") tot.push(data.totalQty);
      else if (c.id === "sum") tot.push(data.total);
      else tot.push("");
    });
    lines.push(tot.map(cell).join(","));
    var csv = "﻿" + lines.join("\r\n");   // BOM: 엑셀 한글 깨짐 방지
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = (WE.model.project.meta.name || "BOM") + "_BOM.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function syncBomControls() {
    var p = WE.model.project;
    var cbs = document.querySelectorAll("#bomColCfg input[data-col]");
    for (var i = 0; i < cbs.length; i++) {
      var key = cbs[i].dataset.col;
      cbs[i].checked = (key === "ds") ? (p.bomColShow.ds !== false) : !!(p.bomColShow && p.bomColShow[key]);
    }
  }

  // ---- BOM 레이아웃(열 너비·순서·표시·행높이) 저장 ----
  var BOM_LAYOUT_KEY = "we_bomLayout", BOM_LAYOUTS_KEY = "we_bomLayouts";
  function getBomLayout() {
    var p = WE.model.project;
    return {
      colW: JSON.parse(JSON.stringify(p.bomColW || {})),
      colOrder: (p.bomColOrder || []).slice(),
      colShow: JSON.parse(JSON.stringify(p.bomColShow || {})),
      rowH: p.bomRowH
    };
  }
  function applyBomLayout(layout) {
    if (!layout) return;
    var p = WE.model.project;
    if (layout.colW) p.bomColW = JSON.parse(JSON.stringify(layout.colW));
    if (layout.colOrder) p.bomColOrder = layout.colOrder.slice();
    if (layout.colShow) p.bomColShow = JSON.parse(JSON.stringify(layout.colShow));
    if (typeof layout.rowH === "number") p.bomRowH = layout.rowH;
  }
  // 레이아웃을 바꿀 때마다 '마지막 = 기본값'으로 전역 저장
  function saveDefaultLayout() {
    try { localStorage.setItem(BOM_LAYOUT_KEY, JSON.stringify(getBomLayout())); } catch (e) { /* 무시 */ }
  }
  function loadDefaultLayout() {
    try { var r = localStorage.getItem(BOM_LAYOUT_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; }
  }
  function getSavedLayouts() {
    try { var r = localStorage.getItem(BOM_LAYOUTS_KEY); return r ? JSON.parse(r) : []; } catch (e) { return []; }
  }
  function setSavedLayouts(arr) { try { localStorage.setItem(BOM_LAYOUTS_KEY, JSON.stringify(arr)); } catch (e) { /* 무시 */ } }
  function refreshLayoutSel() {
    var sel = document.getElementById("bomLayoutSel"); if (!sel) return;
    var arr = getSavedLayouts(), cur = sel.value;
    sel.innerHTML = "<option value=''>레이아웃…</option>" +
      arr.map(function (l, i) { return "<option value='" + i + "'>" + esc(l.name) + "</option>"; }).join("");
    if (cur && +cur < arr.length) sel.value = cur;
  }
  // 새 배선도가 마지막 레이아웃에서 시작하도록 적용(+화면 갱신)
  function applyDefaultLayoutToProject() { applyBomLayout(loadDefaultLayout()); }

  function bindBOMView() {
    var table = document.getElementById("bomTable");
    function caretEnd(el) {
      var r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }
    table.addEventListener("focusout", function (e) {
      if (e.target.classList && e.target.classList.contains("editable")) commitBomCell(e.target);
    });
    // 셀 위치(행 rowid + 열 인덱스)로 다시 찾기 — commit 후 재렌더된 표에서 이동
    function cellPos(td) { var tr = td.closest("tr"); return { rowId: tr.dataset.rowid, ci: td.cellIndex }; }
    function findCell(pos) {
      if (!pos) return null;
      var tr = table.querySelector('tbody tr[data-rowid="' + pos.rowId + '"]');
      return tr ? tr.cells[pos.ci] : null;
    }
    function editableCells() {
      return Array.prototype.slice.call(table.querySelectorAll("tbody tr:not(.total-row) td.editable"));
    }
    function focusCell(td) { if (td) { td.contentEditable = "true"; td.focus(); caretEnd(td); } }
    // Tab=오른쪽 / Enter=아래칸 이동, 연속 입력
    table.addEventListener("keydown", function (e) {
      var cur = e.target.closest("td.editable");
      if (!cur || !cur.isContentEditable) return;
      if (e.key === "Escape") { cur.blur(); return; }
      if (e.key === "Tab") {
        e.preventDefault();
        var list = editableCells(), i = list.indexOf(cur);
        var nxt = e.shiftKey ? list[i - 1] : list[i + 1];
        var pos = nxt ? cellPos(nxt) : null;
        commitBomCell(cur); focusCell(findCell(pos));
      } else if (e.key === "Enter") {
        e.preventDefault();
        var ci = cur.cellIndex, curTr = cur.closest("tr");
        var trs = Array.prototype.slice.call(table.querySelectorAll("tbody tr:not(.total-row)"));
        var ti = trs.indexOf(curTr), pos2 = null;
        for (var k = ti + 1; k < trs.length; k++) {
          var c = trs[k].cells[ci];
          if (c && c.classList.contains("editable")) { pos2 = cellPos(c); break; }
        }
        commitBomCell(cur); focusCell(findCell(pos2));
      }
    });
    table.addEventListener("click", function (e) {
      var lk = e.target.closest(".bom-link");
      if (lk) { window.open(lk.dataset.url, "_blank", "noopener"); return; }
      var dsv = e.target.closest(".ds-view");
      if (dsv) {
        var lp = WE.library.get(dsv.dataset.lib);
        if (lp && lp.datasheets && lp.datasheets.length) openDatasheetViewer(lp.datasheets, lp.name, 0);
        return;
      }
      var dsa = e.target.closest(".ds-add");
      if (dsa) { openLibEdit(dsa.dataset.lib); return; }
      var cdel = e.target.closest(".col-del");
      if (cdel) { removeBomColumn(cdel.dataset.col); return; }
      var del = e.target.closest(".row-del");
      if (del) {
        var mid = del.closest("tr").dataset.manid;
        WE.model.project.manualBom = WE.model.project.manualBom.filter(function (m) { return m.id !== mid; });
        WE.model.project.bomOrder = (WE.model.project.bomOrder || []).filter(function (id) { return id !== "man:" + mid; });
        renderBOMView(); return;
      }
      var td = e.target.closest("td.editable");
      if (td && !td.isContentEditable) { td.contentEditable = "true"; td.focus(); caretEnd(td); }
    });
    // 더블클릭: 열 경계=너비 자동맞춤 / 사용자 열 이름 변경 / 구매링크 전체 URL 편집
    table.addEventListener("dblclick", function (e) {
      var rz = e.target.closest(".col-resize");
      if (rz) { autoFitColumn(rz.closest("th")); return; }
      var cn = e.target.closest(".col-name");
      if (cn) { renameBomColumn(cn.dataset.col); return; }
      var lc = e.target.closest(".bom-link-cell");
      if (!lc || lc.isContentEditable) return;
      var a = lc.querySelector(".bom-link");
      var full = a ? a.dataset.url : lc.textContent.trim();
      if (full === "—") full = "";
      lc.textContent = full;
      lc.classList.add("editable");
      lc.contentEditable = "true"; lc.focus(); caretEnd(lc);
    });

    // ---- 드래그: 행 재배치(⠿) + 열 재배치(헤더) ----
    var dragRowId = null, dragColKey = null;
    function clearDrop() {
      var m = table.querySelectorAll(".drop-target, .col-drop-target");
      for (var i = 0; i < m.length; i++) m[i].classList.remove("drop-target", "col-drop-target");
    }
    table.addEventListener("dragstart", function (e) {
      var grip = e.target.closest(".row-grip");
      if (grip) {
        var tr = grip.closest("tr"); dragRowId = tr.dataset.rowid; tr.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", dragRowId); } catch (_) { }
        return;
      }
      var th = e.target.closest("th[data-colkey]");
      if (th) {
        if (e.target.closest(".col-resize") || e.target.closest(".col-del")) { e.preventDefault(); return; }
        dragColKey = th.dataset.colkey; th.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", dragColKey); } catch (_) { }
        return;
      }
      e.preventDefault();
    });
    table.addEventListener("dragover", function (e) {
      clearDrop();
      if (dragColKey) {
        e.preventDefault(); e.dataTransfer.dropEffect = "move";
        var th = e.target.closest("th[data-colkey]");
        if (th && th.dataset.colkey !== dragColKey) th.classList.add("col-drop-target");
      } else if (dragRowId) {
        e.preventDefault(); e.dataTransfer.dropEffect = "move";
        var tr = e.target.closest("tr[data-rowid]");
        if (tr && tr.dataset.rowid !== dragRowId) tr.classList.add("drop-target");
      }
    });
    table.addEventListener("drop", function (e) {
      e.preventDefault();
      if (dragColKey) {
        var th = e.target.closest("th[data-colkey]");
        clearDrop();
        if (th && th.dataset.colkey) reorderBomCol(dragColKey, th.dataset.colkey);
      } else if (dragRowId) {
        var tr = e.target.closest("tr[data-rowid]");
        clearDrop();
        if (tr && tr.dataset.rowid) reorderBomRow(dragRowId, tr.dataset.rowid);
      }
      dragRowId = null; dragColKey = null;
    });
    table.addEventListener("dragend", function () {
      dragRowId = null; dragColKey = null; clearDrop();
      var d = table.querySelector(".dragging"); if (d) d.classList.remove("dragging");
    });

    // ---- 열 너비 드래그 조절 ----
    table.addEventListener("pointerdown", function (e) {
      var h = e.target.closest(".col-resize"); if (!h) return;
      e.preventDefault(); e.stopPropagation();
      var th = h.closest("th"), key = th.dataset.colkey; if (!key) return;
      var col = table.querySelectorAll("colgroup col")[th.cellIndex];
      var startX = e.clientX, startW = th.offsetWidth, curW = startW, moved = false;
      document.body.classList.add("col-resizing");
      function move(ev) {
        if (Math.abs(ev.clientX - startX) > 2) moved = true;
        curW = Math.max(40, startW + (ev.clientX - startX));
        if (col) col.style.width = curW + "px";
      }
      function up() {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.body.classList.remove("col-resizing");
        // 실제로 드래그했을 때만 반영·재렌더 (클릭만 했으면 그대로 둬야 더블클릭이 성립)
        if (moved) { WE.model.project.bomColW[key] = Math.round(curW); saveDefaultLayout(); renderBOMView(); }
      }
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    });

    // 노션식: 오른쪽 끝=열 추가, 아래쪽 끝=행 추가
    document.getElementById("bomAddColZone").addEventListener("click", addBomColumn);
    document.getElementById("bomAddRowZone").addEventListener("click", addRowEnd);

    // 툴바
    document.getElementById("bomExportCsv").addEventListener("click", exportBomCSV);
    document.getElementById("bomExportWires").addEventListener("click", exportWireListCSV);
    document.getElementById("wlExportCsv").addEventListener("click", exportWireListCSV);
    var cbs = document.querySelectorAll("#bomColCfg input[data-col]");
    for (var j = 0; j < cbs.length; j++) {
      cbs[j].addEventListener("change", function (e) {
        WE.model.project.bomColShow[e.target.dataset.col] = e.target.checked; saveDefaultLayout(); renderBOMView();
      });
    }

    // 레이아웃 저장/불러오기
    refreshLayoutSel();
    document.getElementById("bomLayoutSel").addEventListener("change", function (e) {
      if (e.target.value === "") return;
      var l = getSavedLayouts()[+e.target.value];
      if (l) { applyBomLayout(l.layout); saveDefaultLayout(); renderBOMView(); }
    });
    document.getElementById("bomLayoutSave").addEventListener("click", function () {
      var name = prompt("이 레이아웃을 저장할 이름"); if (name == null) return;
      name = name.trim(); if (!name) return;
      var arr = getSavedLayouts(), ex = arr.filter(function (l) { return l.name === name; })[0];
      if (ex) ex.layout = getBomLayout(); else arr.push({ name: name, layout: getBomLayout() });
      setSavedLayouts(arr); refreshLayoutSel(); setHint("레이아웃 저장: " + name);
    });
    document.getElementById("bomLayoutDel").addEventListener("click", function () {
      var sel = document.getElementById("bomLayoutSel");
      if (sel.value === "") { alert("삭제할 레이아웃을 목록에서 먼저 고르세요."); return; }
      var arr = getSavedLayouts(); arr.splice(+sel.value, 1);
      setSavedLayouts(arr); sel.value = ""; refreshLayoutSel();
    });

    var tabs = document.querySelectorAll(".view-tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function () { switchView(this.dataset.view); });
    }
  }

  // ---- 전력 / 배터리 요약 ----
  function n(x) { var v = parseFloat(x); return isNaN(v) ? 0 : v; }
  function partPower(lib) {              // W (없으면 V×A)
    var p = n(lib.power);
    if (p > 0) return p;
    return n(lib.volt) * n(lib.current);
  }
  function buildPowerSummary() {
    var loadW = 0, effs = [], battWh = 0, battV = 0, hasBatt = false, hasLoad = false;
    WE.model.project.components.forEach(function (c) {
      var lib = c.libraryId ? WE.library.get(c.libraryId) : null;
      if (!lib) return;
      var role = lib.role || "load";
      if (role === "battery") {
        hasBatt = true;
        var dod = n(lib.dod) > 0 ? n(lib.dod) : 100;
        battWh += n(lib.volt) * n(lib.capacityAh) * (dod / 100);
        if (!battV) battV = n(lib.volt);
      } else if (role === "converter") {
        var e = n(lib.efficiency); if (e > 0) effs.push(e);
      } else {
        var m = n(lib.minPerHour);
        var frac = m > 0 ? Math.min(m, 60) / 60 : 1;   // 미입력 = 60분/시간(상시)
        var pw = partPower(lib) * frac;
        if (partPower(lib) > 0) hasLoad = true;
        loadW += pw;
      }
    });
    var effPct = effs.length ? effs.reduce(function (a, b) { return a + b; }, 0) / effs.length : 100;
    var inW = effPct > 0 ? loadW / (effPct / 100) : loadW;   // 배터리에서 뽑는 전력
    var battA = battV > 0 ? inW / battV : 0;
    var hours = inW > 0 ? battWh / inW : 0;
    return { loadW: loadW, effPct: effPct, inW: inW, battWh: battWh, battV: battV, battA: battA, hours: hours, hasBatt: hasBatt, hasLoad: hasLoad, hasConv: effs.length > 0 };
  }
  function fmt(x, d) { return (Math.round(x * Math.pow(10, d)) / Math.pow(10, d)).toLocaleString(); }
  // 지속시간을 "며칠 (몇시간)" 형태로
  function fmtRuntime(h) {
    if (h <= 0) return "-";
    if (h < 1) return Math.round(h * 60) + "분";
    var days = h / 24;
    if (days >= 1) return fmt(days, 1) + "일 (" + fmt(h, 0) + "시간)";
    return fmt(h, 1) + "시간 (" + fmt(days, 2) + "일)";
  }
  // PDF용: 요약을 [라벨, 값] 배열로
  function powerSummaryRows() {
    var s = buildPowerSummary();
    if (!s.hasLoad && !s.hasBatt) return [];
    var rows = [["총 소비전력(평균)", fmt(s.loadW, 2) + " W"]];
    if (s.hasConv) rows.push(["변환효율(평균)", fmt(s.effPct, 0) + "%"]);
    if (s.hasBatt) {
      rows.push(["배터리 소비", fmt(s.inW, 2) + " W" + (s.battV > 0 ? " / " + fmt(s.battA, 2) + " A" : "")]);
      rows.push(["하루 소비 에너지", fmt(s.inW * 24, 1) + " Wh/일"]);
      rows.push(["배터리 가용용량", fmt(s.battWh, 1) + " Wh"]);
      rows.push(["배터리 지속", fmtRuntime(s.hours)]);
    }
    return rows;
  }
  function renderPowerSummary() {
    var box = document.getElementById("powerSummary");
    var s = buildPowerSummary();
    if (!s.hasLoad && !s.hasBatt) {
      box.innerHTML = '<p class="muted">부품 정보(✎)에 역할·전압·전류(부하는 하루 가동시간)를 입력하면 소비전력과 배터리 지속시간이 계산됩니다.</p>';
      return;
    }
    var html = "";
    html += '<div class="pw-row"><span>총 소비전력(평균)</span><b class="pw-big">' + fmt(s.loadW, 2) + " W</b></div>";
    if (s.hasConv) html += '<div class="pw-row"><span>변환효율(평균)</span><b>' + fmt(s.effPct, 0) + "%</b></div>";
    if (s.hasBatt) {
      html += '<div class="pw-row"><span>배터리 소비</span><b>' + fmt(s.inW, 2) + " W" + (s.battV > 0 ? " / " + fmt(s.battA, 2) + " A" : "") + "</b></div>";
      html += '<div class="pw-row"><span>하루 소비</span><b>' + fmt(s.inW * 24, 1) + " Wh/일</b></div>";
      html += '<div class="pw-row"><span>배터리 가용용량</span><b>' + fmt(s.battWh, 1) + " Wh</b></div>";
      html += '<div class="pw-runtime"><span>배터리 지속</span><br><b class="pw-big">' + fmtRuntime(s.hours) + "</b></div>";
    } else {
      html += '<p class="muted" style="margin-top:6px">배터리 역할 부품을 넣으면 지속시간이 계산됩니다.</p>';
    }
    box.innerHTML = html;
  }

  function bindFileButtons() {
    document.getElementById("btnNew").addEventListener("click", function () {
      if (!confirm("현재 작업을 비우고 새 프로젝트를 시작할까요?\n(저장 안 한 내용은 사라집니다)")) return;
      WE.model.newProject();
      applyDefaultLayoutToProject();   // 새 배선도도 마지막 BOM 레이아웃 유지
      applyDefaultPaletteToProject();  // 새 배선도도 마지막 배선색 팔레트 유지
      WE.io.clearFileHandle();         // 이전 파일과의 연결 해제 → 다음 저장은 "다른 이름으로" 새로 지정
      WE.store.clear();
      reloadUI();
      WE.store.syncBaseline();
      WE.history.reset();
    });
    document.getElementById("btnUndo").addEventListener("click", function () { WE.history.doUndo(); });
    document.getElementById("btnRedo").addEventListener("click", function () { WE.history.doRedo(); });
  }

  // ---- 모드 (선택 / 배선 / 텍스트) ----
  function bindModes() {
    document.getElementById("modeSelect").addEventListener("click", function () { setMode("select"); });
    document.getElementById("modeWire").addEventListener("click", function () { setMode("wire"); });
    document.getElementById("modeText").addEventListener("click", function () { setMode("text"); });
  }
  function setMode(mode) {
    WE.model.ui.mode = mode;
    if (WE.interactions.resetWire) WE.interactions.resetWire();
    document.getElementById("modeSelect").classList.toggle("active", mode === "select");
    document.getElementById("modeWire").classList.toggle("active", mode === "wire");
    document.getElementById("modeText").classList.toggle("active", mode === "text");
    document.body.classList.toggle("wire-mode", mode === "wire");
    document.body.classList.toggle("text-mode", mode === "text");
    if (mode !== "select") { WE.model.clearSelection(); WE.render.renderOverlay(); refreshProps(); }
    setHint(
      mode === "wire" ? "단자를 클릭하고 다른 단자를 클릭하면 배선이 이어집니다." :
      mode === "text" ? "캔버스를 클릭해 텍스트를 추가하세요. (더블클릭으로 편집)" : ""
    );
  }

  // ---- 팬/줌 ----
  // SVG 요소 크기만 바꾸고 viewBox는 그대로 → 좌표 계산(getScreenCTM)이 자동 보정됨
  var _zoom = 1;
  function bindZoom() {
    document.getElementById("btnZoomIn").addEventListener("click", function () { zoomBy(1.2); });
    document.getElementById("btnZoomOut").addEventListener("click", function () { zoomBy(1 / 1.2); });
    document.getElementById("btnZoomLevel").addEventListener("click", fitZoom);   // 배율 숫자 클릭 = 화면 맞춤
    var wrap = document.getElementById("canvasWrap");
    wrap.addEventListener("wheel", function (e) {
      if (e.ctrlKey || e.metaKey) {   // Ctrl/⌘ + 휠 = 확대/축소 (그냥 휠은 스크롤 유지)
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
      }
    }, { passive: false });
    updateZoomLabel();
  }
  function setZoom(z, clientX, clientY) {
    var canvas = document.getElementById("canvas"), wrap = document.getElementById("canvasWrap");
    var before = canvas.getBoundingClientRect();
    var scaleOld = before.width / 1600;
    if (clientX == null) { var wr = wrap.getBoundingClientRect(); clientX = wr.left + wr.width / 2; clientY = wr.top + wr.height / 2; }
    var px = (clientX - before.left) / scaleOld, py = (clientY - before.top) / scaleOld;
    _zoom = Math.max(0.15, Math.min(7, z));
    canvas.style.width = (1600 * _zoom) + "px";
    canvas.style.height = (900 * _zoom) + "px";
    var after = canvas.getBoundingClientRect();
    wrap.scrollLeft += (after.left + px * _zoom) - clientX;   // 커서 지점 고정
    wrap.scrollTop += (after.top + py * _zoom) - clientY;
    if (WE.render.setViewZoom) WE.render.setViewZoom(_zoom);   // 단자 점 크기를 화면상 일정하게 유지
    updateZoomLabel();
  }
  function zoomBy(f, x, y) { setZoom(_zoom * f, x, y); }
  function fitZoom() {
    var wrap = document.getElementById("canvasWrap");
    var z = Math.min((wrap.clientWidth - 60) / 1600, (wrap.clientHeight - 60) / 900);
    setZoom(z);
  }
  function updateZoomLabel() {
    document.getElementById("btnZoomLevel").textContent = Math.round(_zoom * 100) + "%";
  }

  // ---- 좌/우 패널 크기 조절 ----
  function bindResizers() {
    setupResizer("resizerLeft", "leftPanel", 1);
    setupResizer("resizerRight", "rightPanel", -1);
    // 저장된 너비 복원
    ["leftPanel", "rightPanel"].forEach(function (id) {
      try {
        var w = localStorage.getItem("we_" + id + "W");
        if (w) document.getElementById(id).style.width = w;
      } catch (e) { /* 무시 */ }
    });
  }
  function setupResizer(resId, panelId, dir) {
    var res = document.getElementById(resId), panel = document.getElementById(panelId);
    var startX = 0, startW = 0, dragging = false;
    res.addEventListener("pointerdown", function (e) {
      dragging = true; startX = e.clientX; startW = panel.getBoundingClientRect().width;
      try { res.setPointerCapture(e.pointerId); } catch (_) {}
      document.body.style.cursor = "col-resize"; e.preventDefault();
    });
    window.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var w = Math.max(140, Math.min(640, startW + (e.clientX - startX) * dir));
      panel.style.width = w + "px";
    });
    window.addEventListener("pointerup", function (e) {
      if (!dragging) return;
      dragging = false; document.body.style.cursor = "";
      try { res.releasePointerCapture(e.pointerId); } catch (_) {}
      try { localStorage.setItem("we_" + panelId + "W", panel.style.width); } catch (_) {}
    });
  }

  // ---- 설정 (자동저장 등) ----
  var _settings = {
    autosaveEnabled: true, autosaveSec: 3,
    labelFontSize: 12, labelBold: true, labelBox: true   // 부품명: 굵게 + 배경 사각블럭이 기본
  };
  function loadSettings() {
    try {
      var raw = localStorage.getItem("we_settings");
      if (raw) {
        var s = JSON.parse(raw);
        if (typeof s.autosaveEnabled === "boolean") _settings.autosaveEnabled = s.autosaveEnabled;
        if (s.autosaveSec > 0) _settings.autosaveSec = s.autosaveSec;
        if (s.labelFontSize > 0) _settings.labelFontSize = s.labelFontSize;
        if (typeof s.labelBold === "boolean") _settings.labelBold = s.labelBold;
        if (typeof s.labelBox === "boolean") _settings.labelBox = s.labelBox;
      }
    } catch (e) { /* 무시 */ }
  }
  function persistSettings() {
    try { localStorage.setItem("we_settings", JSON.stringify(_settings)); } catch (e) { /* 무시 */ }
  }
  function applySettings() {
    WE.store.setAutosave(_settings.autosaveEnabled, Math.max(1, _settings.autosaveSec) * 1000);
    var root = document.documentElement.style;
    root.setProperty("--cmp-label-size", _settings.labelFontSize + "px");
    root.setProperty("--cmp-label-weight", _settings.labelBold ? "700" : "400");
    root.setProperty("--cmp-label-box-display", _settings.labelBox ? "inline" : "none");
  }
  // 첫 방문 시 샘플 프로젝트(sample.json) 자동 로드 (한 번만). 없거나 file://면 그냥 빈 화면.
  // 첫 방문자에게 샘플 프로젝트 자동 표시.
  // sample.ezc는 "공유(🔗)" 버튼으로 내보낸 번들 파일을 그대로 사이트에 올린 것 —
  // 프로젝트+사용 부품(스펙·가격·데이터시트 포함)이 한 파일이라 DB 없이도 완전한 샘플이 되고,
  // 열면서 부품들이 방문자의 라이브러리(IndexedDB)에 병합되어 바로 재사용 가능.
  function tryLoadSample(cb) {
    var seen;
    try { seen = localStorage.getItem("we_sampleShown"); } catch (e) { /* 무시 */ }
    if (seen || !window.fetch) { cb(false); return; }
    fetch("sample.ezc").then(function (r) {
      if (!r.ok) throw 0;
      return r.text();
    }).then(function (text) {
      JSON.parse(text);   // 손상된 파일이면 여기서 throw → 조용히 빈 화면으로 시작(알림창 없이)
      WE.io.loadProjectText(text, "샘플 프로젝트");
      try { localStorage.setItem("we_sampleShown", "1"); } catch (e) { /* 무시 */ }
      cb(true);
    }).catch(function () { cb(false); });
  }

  // ---- 방문 안내 모달: 베타 기간이라 접속할 때마다 항상 표시(1회성 아님, 저장 안 함) ----
  function bindWelcome() {
    var modal = document.getElementById("welcomeModal");
    modal.hidden = false;
    document.getElementById("welcomeStart").addEventListener("click", function () {
      modal.hidden = true;
      track("welcome_start");   // 안내 모달에서 '시작하기' = 실제 진입
    });
  }

  // ---- 피드백 모달 (Web3Forms로 전송 — 앱 안에서 바로, 메일앱 안 열림) ----
  var WEB3FORMS_KEY = "0ee9df7c-fd3e-44a6-9411-b107885b62ee";
  function bindFeedback() {
    var modal = document.getElementById("feedbackModal");
    document.getElementById("btnFeedback").addEventListener("click", function () {
      document.getElementById("feedbackText").value = "";
      document.getElementById("feedbackStatus").textContent = "";
      document.getElementById("feedbackBotcheck").checked = false;   // 허니팟 초기화
      modal.hidden = false;
      document.getElementById("feedbackText").focus();
    });
    document.getElementById("feedbackClose").addEventListener("click", function () {
      modal.hidden = true;
    });
    document.getElementById("feedbackSend").addEventListener("click", sendFeedback);
  }
  var FEEDBACK_EMAIL = "qksekftkd@gmail.com";
  var FB_COOLDOWN_MS = 60 * 1000;   // 연타 방지: 1분에 1건
  var FB_DAILY_MAX = 5;             // 실수/장난 유입으로 무료 한도가 타는 것 방지

  // 전송 가능 여부 확인(로컬 기준). 막혔으면 사용자에게 보여줄 사유 문자열 반환, 통과면 null
  function feedbackBlockReason() {
    try {
      var now = Date.now();
      var last = Number(localStorage.getItem("we_fb_last") || 0);
      if (now - last < FB_COOLDOWN_MS) {
        var sec = Math.ceil((FB_COOLDOWN_MS - (now - last)) / 1000);
        return "잠시 후 다시 보내주세요. (" + sec + "초)";
      }
      var today = new Date().toDateString();
      if (localStorage.getItem("we_fb_day") === today &&
          Number(localStorage.getItem("we_fb_count") || 0) >= FB_DAILY_MAX) {
        return "오늘은 더 보낼 수 없습니다. 급하시면 " + FEEDBACK_EMAIL + " 으로 보내주세요.";
      }
    } catch (e) { /* localStorage 불가 브라우저는 그냥 통과 */ }
    return null;
  }
  function feedbackMarkSent() {
    try {
      var today = new Date().toDateString();
      var n = (localStorage.getItem("we_fb_day") === today) ? Number(localStorage.getItem("we_fb_count") || 0) : 0;
      localStorage.setItem("we_fb_last", String(Date.now()));
      localStorage.setItem("we_fb_day", today);
      localStorage.setItem("we_fb_count", String(n + 1));
    } catch (e) { /* 무시 */ }
  }
  // 전송 실패(한도 초과·네트워크 오류 등) 시 메일로 직접 보낼 수 있게 안내
  function showMailFallback(statusEl, text) {
    var href = "mailto:" + FEEDBACK_EMAIL +
      "?subject=" + encodeURIComponent("[이지케이블] 피드백") +
      "&body=" + encodeURIComponent(text);
    statusEl.innerHTML += ' <a href="' + href + '">메일로 보내기</a>';
  }

  function sendFeedback() {
    var text = document.getElementById("feedbackText").value.trim();
    var statusEl = document.getElementById("feedbackStatus");
    if (!text) { statusEl.textContent = "내용을 입력해주세요."; return; }
    // 허니팟: 사람은 절대 체크할 수 없는 숨은 필드 → 채워져 있으면 봇으로 보고 조용히 무시
    if (document.getElementById("feedbackBotcheck").checked) {
      statusEl.textContent = "전달됐습니다. 감사합니다!";
      return;
    }
    var blocked = feedbackBlockReason();
    if (blocked) {
      statusEl.textContent = blocked;
      showMailFallback(statusEl, text);
      return;
    }
    var btn = document.getElementById("feedbackSend");
    btn.disabled = true;
    statusEl.textContent = "보내는 중…";
    fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        access_key: WEB3FORMS_KEY,
        subject: "[이지케이블] 피드백",
        from_name: "이지케이블 피드백",
        message: text,
        botcheck: false,
        브라우저: navigator.userAgent
      })
    }).then(function (r) { return r.json(); }).then(function (res) {
      btn.disabled = false;
      if (res.success) {
        feedbackMarkSent();
        track("feedback_sent");
        statusEl.textContent = "전달됐습니다. 감사합니다!";
        setTimeout(function () { document.getElementById("feedbackModal").hidden = true; }, 900);
      } else {
        // 무료 한도 초과 등으로 실패해도 의견이 유실되지 않도록 메일 경로 안내
        statusEl.textContent = "전송 실패: " + (res.message || "다시 시도해주세요.");
        showMailFallback(statusEl, text);
      }
    }).catch(function () {
      btn.disabled = false;
      statusEl.textContent = "네트워크 오류로 전송하지 못했습니다.";
      showMailFallback(statusEl, text);
    });
  }

  // ---- 모달 바깥(어두운 배경) 클릭 시 닫기 ----
  // 각 모달의 기존 닫기 버튼을 대신 눌러줌: 보기/설정류=닫기, 편집류=취소, 단자배치=완료(라이브 반영이라 완료가 안전)
  var MODAL_CLOSE_MAP = {
    settingsModal: "setClose",
    paletteModal: "palClose",
    presetModal: "presetClose",
    dsViewerModal: "dsViewerClose",
    termModal: "teDone",
    libEditModal: "libEditCancel",
    bgModal: "bgCancel",
    welcomeModal: "welcomeStart",
    helpModal: "helpClose",
    feedbackModal: "feedbackClose",
    historyModal: "historyClose"
  };
  function bindModalBackdrops() {
    Object.keys(MODAL_CLOSE_MAP).forEach(function (mid) {
      var modal = document.getElementById(mid);
      if (!modal) return;
      modal.addEventListener("pointerdown", function (e) {
        if (e.target !== modal) return;   // 박스 안 클릭/박스에서 시작한 드래그는 무시
        var btn = document.getElementById(MODAL_CLOSE_MAP[mid]);
        if (btn) btn.click();
      });
    });
  }

  function bindSettings() {
    document.querySelectorAll(".set-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll(".set-tab").forEach(function (t) { t.classList.toggle("active", t === tab); });
        var name = tab.dataset.settab;
        document.querySelectorAll(".set-pane").forEach(function (p) {
          p.hidden = p.dataset.setpane !== name;
        });
      });
    });
    document.getElementById("btnSettings").addEventListener("click", function () {
      document.getElementById("setAutosave").checked = _settings.autosaveEnabled;
      document.getElementById("setAutosaveSec").value = _settings.autosaveSec;
      document.getElementById("setLabelSize").value = _settings.labelFontSize;
      document.getElementById("setLabelBold").checked = _settings.labelBold;
      document.getElementById("setLabelBox").checked = _settings.labelBox;
      document.getElementById("settingsModal").hidden = false;
    });
    document.getElementById("setClose").addEventListener("click", function () {
      document.getElementById("settingsModal").hidden = true;
    });
    document.getElementById("setAutosave").addEventListener("change", function (e) {
      _settings.autosaveEnabled = e.target.checked;
      persistSettings(); applySettings();
    });
    document.getElementById("setAutosaveSec").addEventListener("input", function (e) {
      var v = parseInt(e.target.value, 10);
      if (isNaN(v) || v < 1) return;
      _settings.autosaveSec = v;
      persistSettings(); applySettings();
    });
    document.getElementById("setLabelSize").addEventListener("input", function (e) {
      var v = parseInt(e.target.value, 10);
      if (isNaN(v) || v < 8) return;
      _settings.labelFontSize = v;
      persistSettings(); applySettings();
    });
    document.getElementById("setLabelBold").addEventListener("change", function (e) {
      _settings.labelBold = e.target.checked;
      persistSettings(); applySettings();
    });
    document.getElementById("setLabelBox").addEventListener("change", function (e) {
      _settings.labelBox = e.target.checked;
      persistSettings(); applySettings();
    });
    bindShortcuts();
  }

  // ---- 단축키 ----
  var _shortcuts = { "mode-select": "v", "mode-wire": "w", "mode-text": "t" };
  function loadShortcuts() {
    try { var r = localStorage.getItem("we_shortcuts"); if (r) { var s = JSON.parse(r); for (var k in _shortcuts) if (s[k] !== undefined) _shortcuts[k] = s[k]; } }
    catch (e) { /* 무시 */ }
  }
  function saveShortcuts() { try { localStorage.setItem("we_shortcuts", JSON.stringify(_shortcuts)); } catch (e) {} }
  function scLabel(k) { return k ? (k.length === 1 ? k.toUpperCase() : k) : "(없음)"; }
  function bindShortcuts() {
    var inputs = document.querySelectorAll(".sc-input");
    for (var i = 0; i < inputs.length; i++) {
      (function (inp) {
        inp.value = scLabel(_shortcuts[inp.dataset.action]);
        inp.addEventListener("keydown", function (e) {
          e.preventDefault();
          if (e.key === "Escape") { inp.blur(); return; }
          if (e.key === "Backspace" || e.key === "Delete") { _shortcuts[inp.dataset.action] = ""; inp.value = scLabel(""); saveShortcuts(); return; }
          if (e.ctrlKey || e.metaKey || e.altKey) return;   // 조합키 제외(단일키만)
          _shortcuts[inp.dataset.action] = e.key.toLowerCase();
          inp.value = scLabel(e.key.toLowerCase());
          saveShortcuts(); inp.blur();
        });
      })(inputs[i]);
    }
  }
  // 인터랙션에서 호출: 단축키 처리(모드 전환). 처리하면 true
  function handleShortcut(key) {
    key = (key || "").toLowerCase();
    if (!key) return false;
    for (var action in _shortcuts) {
      if (_shortcuts[action] && _shortcuts[action] === key) {
        if (action === "mode-select") { setMode("select"); closeQuickColorPicker(); }
        else if (action === "mode-wire") { setMode("wire"); openQuickColorPicker(); }
        else if (action === "mode-text") { setMode("text"); closeQuickColorPicker(); }
        return true;
      }
    }
    return false;
  }

  // ---- 빠른 배선색 선택 팝업 (단축키로 마우스 위치 근처에 표시) ----
  function openQuickColorPicker() {
    var pop = document.getElementById("quickColorPicker");
    if (!pop.hidden) { closeQuickColorPicker(); return; }   // 토글: 다시 누르면 닫기
    var pt = WE.interactions.getLastPointer ? WE.interactions.getLastPointer() : { x: innerWidth / 2, y: innerHeight / 2 };
    var wrap = document.getElementById("qcpSwatches");
    wrap.innerHTML = "";
    WE.model.project.palette.forEach(function (p) {
      var sw = document.createElement("div");
      sw.className = "swatch" + (p.color === WE.model.ui.wireColor ? " active" : "");
      sw.style.background = p.color;
      sw.title = p.label;
      sw.addEventListener("click", function () { pickQuickColor(p.color); });
      wrap.appendChild(sw);
    });
    pop.hidden = false;
    pop.style.left = Math.max(4, pt.x + 12) + "px";
    pop.style.top = Math.max(4, pt.y + 12) + "px";
    requestAnimationFrame(function () {
      var r = pop.getBoundingClientRect();
      var left = Math.min(pt.x + 12, window.innerWidth - r.width - 8);
      var top = Math.min(pt.y + 12, window.innerHeight - r.height - 8);
      pop.style.left = Math.max(4, left) + "px";
      pop.style.top = Math.max(4, top) + "px";
    });
  }
  function closeQuickColorPicker() {
    document.getElementById("quickColorPicker").hidden = true;
  }
  function pickQuickColor(color) {
    WE.model.ui.wireColor = color;
    saveWireSettings();
    var mW = WE.model.getMultiWire();
    if (mW.length) {
      mW.forEach(function (id) { var w = WE.model.getWire(id); if (w) w.color = color; });
      WE.render.renderWires(); WE.render.renderOverlay();
    } else {
      var sw2 = WE.model.getSelectedWire();
      if (sw2) { sw2.color = color; WE.render.renderWires(); WE.render.renderOverlay(); }
    }
    renderPalette();
    refreshProps();
    closeQuickColorPicker();
  }
  function bindQuickColorPicker() {
    document.addEventListener("pointerdown", function (e) {
      var pop = document.getElementById("quickColorPicker");
      if (!pop.hidden && !e.target.closest("#quickColorPicker")) closeQuickColorPicker();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeQuickColorPicker();
    });
  }

  // ---- PNG 이미지 내보내기 ----
  // SVG를 복제해 문서 CSS를 인라인 스타일로 구운 뒤(직렬화하면 외부 CSS가 안 먹으므로),
  // 내용 영역만 잘라 2배 해상도 캔버스에 그려 PNG로 저장. 워터마크 레이어는 내보낼 때만 켬.
  function exportPng() {
    WE.model.clearSelection();
    WE.render.clearWirePreview();
    WE.render.renderOverlay();

    var svg = document.getElementById("canvas");
    // 내용(부품·배선·라벨·주석) 전체를 감싸는 영역 계산
    var ids = ["layerComponents", "layerLabels", "layerWires", "layerWireLabels", "layerTermLabels", "layerAnnotations"];
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    ids.forEach(function (id) {
      try {
        var b = document.getElementById(id).getBBox();
        if (b.width || b.height) {
          x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
          x2 = Math.max(x2, b.x + b.width); y2 = Math.max(y2, b.y + b.height);
        }
      } catch (e) { /* 빈 레이어 무시 */ }
    });
    if (x1 === Infinity) { setHint("내보낼 내용이 없습니다. 부품을 먼저 배치하세요."); return; }
    var PAD = 30;
    x1 -= PAD; y1 -= PAD; x2 += PAD; y2 += PAD;

    // 복제본에 계산된 스타일 인라인 (원본/복제본은 같은 구조라 인덱스로 1:1 대응)
    var clone = svg.cloneNode(true);
    var srcEls = svg.querySelectorAll("*"), dstEls = clone.querySelectorAll("*");
    var PROPS = ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin",
                 "stroke-opacity", "fill-opacity", "opacity", "font-family", "font-size", "font-weight",
                 "font-style", "text-anchor", "dominant-baseline", "paint-order", "letter-spacing", "visibility"];
    for (var i = 0; i < srcEls.length; i++) {
      var cs = getComputedStyle(srcEls[i]), st = "";
      for (var k = 0; k < PROPS.length; k++) {
        var v = cs.getPropertyValue(PROPS[k]);
        if (v) st += PROPS[k] + ":" + v + ";";
      }
      dstEls[i].setAttribute("style", st);
    }
    var grid = clone.querySelector("#gridBg");
    if (grid) grid.setAttribute("fill", "#ffffff");   // 격자 대신 흰 배경
    var wm = clone.querySelector("#layerWatermark");
    if (wm) wm.setAttribute("style", "display:block"); // 화면에선 숨긴 워터마크를 이미지엔 표시

    var W = x2 - x1, H = y2 - y1, SCALE = 2;
    clone.setAttribute("viewBox", x1 + " " + y1 + " " + W + " " + H);
    clone.setAttribute("width", Math.round(W * SCALE));
    clone.setAttribute("height", Math.round(H * SCALE));

    var svgUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],
      { type: "image/svg+xml;charset=utf-8" }));
    var img = new Image();
    img.onload = function () {
      var cv = document.createElement("canvas");
      cv.width = Math.round(W * SCALE); cv.height = Math.round(H * SCALE);
      var ctx = cv.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(svgUrl);
      cv.toBlob(function (blob) {
        if (!blob) { setHint("이미지 생성에 실패했습니다."); return; }
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = ((WE.model.project.meta.name || "배선도").replace(/[\\/:*?"<>|]/g, "_")) + ".png";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        track("export", { method: "png" });
        setHint("이미지 저장 완료 (PNG)");
      }, "image/png");
    };
    img.onerror = function () { URL.revokeObjectURL(svgUrl); setHint("이미지 생성에 실패했습니다."); };
    img.src = svgUrl;
  }

  // ---- 이전 버전 복구 모달 ----
  var _snapList = [];   // 마지막으로 조회한 스냅샷(최신순) — 복구 시 재조회 없이 사용
  function fmtSnapTime(t) {
    var d = new Date(t);
    function p2(n) { return (n < 10 ? "0" : "") + n; }
    return (d.getMonth() + 1) + "/" + d.getDate() + " " + p2(d.getHours()) + ":" + p2(d.getMinutes());
  }
  function bindHistoryModal() {
    var modal = document.getElementById("historyModal");
    document.getElementById("btnHistory").addEventListener("click", function () {
      WE.store.getSnapshots(function (list) {
        _snapList = list;
        var box = document.getElementById("historyList");
        if (!list.length) {
          box.innerHTML = "<p class='muted'>아직 보관된 스냅샷이 없습니다. 작업을 시작하면 5분 간격으로 자동 보관됩니다.</p>";
        } else {
          box.innerHTML = list.map(function (s, i) {
            return "<div class='history-row'>" +
              "<div class='history-info'><b>" + fmtSnapTime(s.t) + "</b>" +
              "<span class='muted'> — " + esc(s.name || "이름없는 배선도") +
              " (부품 " + s.comps + " · 배선 " + s.wires + ")</span></div>" +
              "<button class='history-restore' data-i='" + i + "'>복구</button></div>";
          }).join("");
        }
        modal.hidden = false;
      });
    });
    document.getElementById("historyClose").addEventListener("click", function () { modal.hidden = true; });
    document.getElementById("historyList").addEventListener("click", function (e) {
      var btn = e.target.closest(".history-restore"); if (!btn) return;
      var s = _snapList[+btn.dataset.i]; if (!s) return;
      if (!confirm(fmtSnapTime(s.t) + " 시점으로 되돌릴까요?\n(지금 화면의 작업은 사라집니다)")) return;
      try {
        WE.model.loadProject(JSON.parse(s.json));
      } catch (err) { alert("스냅샷을 읽을 수 없습니다: " + err.message); return; }
      WE.io.clearFileHandle();   // 옛 버전이 연결된 파일을 조용히 덮어쓰지 않도록 연결 해제
      reloadUI();
      if (WE.history) WE.history.reset();
      WE.store.saveNow();
      modal.hidden = true;
      setHint("복구 완료: " + fmtSnapTime(s.t) + " 시점");
    });
  }

  // ---- 단축키 도움말 (우하단 ? 버튼 + ☰ 메뉴) ----
  function openHelpModal() {
    renderHelpShortcuts();
    document.getElementById("helpModal").hidden = false;
  }
  function bindHelp() {
    document.getElementById("btnHelp").addEventListener("click", openHelpModal);
    document.getElementById("btnHelpMenu").addEventListener("click", openHelpModal);
    document.getElementById("helpClose").addEventListener("click", function () {
      document.getElementById("helpModal").hidden = true;
    });
    // '?' 키로 도움말 열기 (Excalidraw와 동일한 관례)
    document.addEventListener("keydown", function (e) {
      if (e.key !== "?") return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (document.querySelector(".modal:not([hidden])")) return;
      openHelpModal();
    });
  }

  // ---- ☰ 앱 메뉴 드로어 ----
  function bindAppMenu() {
    var menu = document.getElementById("appMenu");
    var btn = document.getElementById("btnAppMenu");
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      if (!menu.hidden) closeExportSub();   // 메뉴를 새로 열면 하위 옵션은 접힌 상태로
    });
    // 내보내기 = 하위 옵션(PDF/PNG) 펼침 토글 — 드로어를 닫지 않음
    var exportSub = document.getElementById("exportSub");
    function closeExportSub() { exportSub.hidden = true; document.getElementById("exportArrow").textContent = "▸"; }
    document.getElementById("btnExport").addEventListener("click", function () {
      exportSub.hidden = !exportSub.hidden;
      document.getElementById("exportArrow").textContent = exportSub.hidden ? "▸" : "▾";
    });
    // 항목 클릭(각자의 핸들러 실행 후) / 바깥 클릭 / Esc → 닫기 (내보내기 토글 제외)
    menu.addEventListener("click", function (e) {
      if (e.target.closest("#btnExport")) return;
      if (e.target.closest(".menu-item")) menu.hidden = true;
    });
    document.addEventListener("pointerdown", function (e) {
      if (!menu.hidden && !e.target.closest("#appMenu") && !e.target.closest("#btnAppMenu")) menu.hidden = true;
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !menu.hidden) menu.hidden = true;
    });

    // 메뉴의 저장·공유 = 툴바 버튼과 같은 동작 (메뉴에서도 찾을 수 있게 중복 배치)
    document.getElementById("btnSaveMenu").addEventListener("click", function () { WE.io.save(); });
    document.getElementById("btnShareMenu").addEventListener("click", function () { WE.io.share(); });
    document.getElementById("btnPng").addEventListener("click", exportPng);

    bindHistoryModal();

    // 샘플 프로젝트 열기 (사이트에 올려둔 sample.ezc — 공유 번들이라 부품·스펙까지 온전)
    document.getElementById("btnSample").addEventListener("click", function () {
      if (!confirm("현재 작업을 비우고 샘플 프로젝트를 열까요?\n(저장 안 한 내용은 사라집니다)")) return;
      fetch("sample.ezc").then(function (r) {
        if (!r.ok) throw 0;
        return r.text();
      }).then(function (text) {
        JSON.parse(text);
        track("open_sample");
        WE.io.loadProjectText(text, "샘플 프로젝트");
      }).catch(function () {
        setHint("샘플 프로젝트가 아직 준비되지 않았습니다.");
      });
    });
  }
  function renderHelpShortcuts() {
    var rows = [
      ["선택 모드", scLabel(_shortcuts["mode-select"])],
      ["배선 모드 (진입 시 배선색 팝업 자동 표시)", scLabel(_shortcuts["mode-wire"])],
      ["텍스트 모드", scLabel(_shortcuts["mode-text"])],
      ["실행 취소 / 다시 실행", "Ctrl+Z / Ctrl+Shift+Z"],
      ["부품 복제", "Ctrl+D"],
      ["화면 이동(팬)", "Space 드래그 · 휠클릭 드래그"],
      ["확대 / 축소", "Ctrl+휠"],
      ["선택 항목 삭제", "Delete / Backspace"],
      ["즉시 저장", "Ctrl+S"],
      ["파일 열기", "Ctrl+O"],
      ["이 도움말", "?"]
    ];
    document.getElementById("helpShortcutList").innerHTML = rows.map(function (r) {
      return "<div class='sc-row'><span>" + esc(r[0]) + "</span><b>" + esc(r[1]) + "</b></div>";
    }).join("");
  }

  // 배선 기본값(색·두께) 마지막 설정 기억
  function loadWireSettings() {
    try {
      var w = localStorage.getItem("we_wireWidth");
      if (w) WE.model.ui.wireWidth = parseInt(w, 10);
      var c = localStorage.getItem("we_wireColor");
      if (c) WE.model.ui.wireColor = c;
      var r = localStorage.getItem("we_wireRouting");
      if (r === "ortho" || r === "straight") WE.model.ui.wireRouting = r;
      var nn = localStorage.getItem("we_showWireNums");
      if (nn != null) WE.model.ui.showWireNums = (nn === "1");
      var cb = document.getElementById("chkWireNums");
      if (cb) cb.checked = WE.model.ui.showWireNums;
    } catch (e) { /* 무시 */ }
  }
  function saveWireSettings() {
    try {
      localStorage.setItem("we_wireWidth", String(WE.model.ui.wireWidth));
      localStorage.setItem("we_wireColor", WE.model.ui.wireColor);
      localStorage.setItem("we_wireRouting", WE.model.ui.wireRouting);
      localStorage.setItem("we_showWireNums", WE.model.ui.showWireNums ? "1" : "0");
    } catch (e) { /* 무시 */ }
  }

  // ---- 색상 팔레트 ----
  function bindPalette() {
    document.getElementById("wireWidthSel").addEventListener("input", function (e) {
      var v = parseInt(e.target.value, 10);
      if (isNaN(v) || v < 1) return;
      WE.model.ui.wireWidth = v;
      saveWireSettings();
    });
    document.getElementById("wireRoutingSel").addEventListener("change", function (e) {
      WE.model.ui.wireRouting = e.target.value;
      saveWireSettings();
      WE.render.renderWires(); WE.render.renderOverlay();
    });
    document.getElementById("btnPaletteManage").addEventListener("click", openPaletteModal);

    var pm = document.getElementById("paletteModal");
    document.getElementById("palClose").addEventListener("click", function () { pm.hidden = true; });
    document.getElementById("btnAddPal").addEventListener("click", function () {
      var label = document.getElementById("newPalLabel").value.trim() || "색";
      var color = document.getElementById("newPalColor").value;
      WE.model.project.palette.push({ color: color, label: label });
      document.getElementById("newPalLabel").value = "";
      renderPaletteList(); renderPalette(); saveDefaultPalette();
    });
    var pl = document.getElementById("paletteList");
    pl.addEventListener("input", function (e) {
      var row = e.target.closest(".preset-row"); if (!row) return;
      var p = WE.model.project.palette[+row.dataset.idx]; if (!p) return;
      if (e.target.classList.contains("pcolor")) {
        var oldC = p.color, newC = e.target.value;
        p.color = newC;
        // 이 색으로 그려진 기존 배선도 함께 갱신
        WE.model.project.wires.forEach(function (w) { if (w.color === oldC) w.color = newC; });
        if (WE.model.ui.wireColor === oldC) WE.model.ui.wireColor = newC;
        WE.render.renderWires(); WE.render.renderOverlay();
      } else if (e.target.classList.contains("plabel")) p.label = e.target.value;
      renderPalette(); saveDefaultPalette();
    });
    pl.addEventListener("click", function (e) {
      if (!e.target.classList.contains("pdel")) return;
      var row = e.target.closest(".preset-row");
      WE.model.project.palette.splice(+row.dataset.idx, 1);
      renderPaletteList(); renderPalette(); saveDefaultPalette();
    });
  }

  // 배선색 팔레트를 '마지막 = 전역 기본값'으로 저장(BOM 레이아웃과 같은 패턴).
  // 프로젝트 자체는 새로고침 시 자동 복원 안 하도록 되어 있어서, 팔레트만 이렇게 별도로
  // 영구 저장해두지 않으면 사용자가 추가한 프리셋이 새로고침/새 작업마다 기본값으로 되돌아감.
  var PALETTE_KEY = "we_palette";
  function saveDefaultPalette() {
    try { localStorage.setItem(PALETTE_KEY, JSON.stringify(WE.model.project.palette)); } catch (e) { /* 무시 */ }
  }
  function loadDefaultPalette() {
    try { var r = localStorage.getItem(PALETTE_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; }
  }
  // 새 배선도가 마지막으로 저장해둔 팔레트에서 시작하도록 적용
  function applyDefaultPaletteToProject() {
    var saved = loadDefaultPalette();
    if (saved && saved.length) WE.model.project.palette = saved;
  }

  function renderPalette() {
    var wrap = document.getElementById("paletteSwatches");
    wrap.innerHTML = "";
    var pal = WE.model.project.palette;
    // 활성 색이 팔레트에 없으면 첫 색으로 보정
    if (pal.length && !pal.some(function (p) { return p.color === WE.model.ui.wireColor; })) {
      WE.model.ui.wireColor = pal[0].color;
    }
    pal.forEach(function (p) {
      var sw = document.createElement("div");
      sw.className = "swatch" + (p.color === WE.model.ui.wireColor ? " active" : "");
      sw.style.background = p.color;
      sw.title = p.label;
      sw.addEventListener("click", function () {
        WE.model.ui.wireColor = p.color;
        saveWireSettings();
        // 선택된 배선(들) 색도 즉시 변경
        var mW = WE.model.getMultiWire();
        if (mW.length) {
          mW.forEach(function (id) { var w = WE.model.getWire(id); if (w) w.color = p.color; });
          WE.render.renderWires(); WE.render.renderOverlay();
        } else {
          var sw2 = WE.model.getSelectedWire();
          if (sw2) { sw2.color = p.color; WE.render.renderWires(); WE.render.renderOverlay(); }
        }
        renderPalette();
        refreshProps();
      });
      wrap.appendChild(sw);
    });
  }

  function openPaletteModal() { renderPaletteList(); document.getElementById("paletteModal").hidden = false; }
  function renderPaletteList() {
    var pl = document.getElementById("paletteList");
    pl.innerHTML = "";
    WE.model.project.palette.forEach(function (p, i) {
      var row = document.createElement("div");
      row.className = "preset-row"; row.dataset.idx = i;
      var color = document.createElement("input");
      color.type = "color"; color.className = "pcolor"; color.value = p.color;
      var label = document.createElement("input");
      label.type = "text"; label.className = "plabel"; label.value = p.label;
      var del = document.createElement("button");
      del.className = "pdel"; del.textContent = "삭제";
      row.appendChild(color); row.appendChild(label); row.appendChild(del);
      pl.appendChild(row);
    });
  }

  // ---- 주석 속성 ----
  function bindAnnoProps() {
    document.getElementById("annoText").addEventListener("input", function (e) {
      var a = WE.model.getSelectedAnnotation(); if (!a) return;
      a.text = e.target.value; WE.render.renderAnnotations(); WE.render.renderOverlay();
    });
    // 텍스트 입력 중 Esc → 입력 종료 + 선택 모드로 복귀 (텍스트 작업 마무리 동선)
    document.getElementById("annoText").addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      e.target.blur();
      setMode("select");
    });
    document.getElementById("annoColor").addEventListener("input", function (e) {
      var a = WE.model.getSelectedAnnotation(); if (!a) return;
      a.color = e.target.value; WE.render.renderAnnotations(); WE.render.renderOverlay();
    });
    document.getElementById("annoSize").addEventListener("input", function (e) {
      var a = WE.model.getSelectedAnnotation(); if (!a) return;
      var v = parseInt(e.target.value, 10); if (isNaN(v)) return;
      a.fontSize = Math.max(8, v); WE.render.renderAnnotations(); WE.render.renderOverlay();
    });
    document.getElementById("annoBold").addEventListener("change", function (e) {
      var a = WE.model.getSelectedAnnotation(); if (!a) return;
      a.bold = e.target.checked; WE.render.renderAnnotations(); WE.render.renderOverlay();
    });
    document.getElementById("annoDelete").addEventListener("click", function () {
      var a = WE.model.getSelectedAnnotation(); if (!a) return;
      WE.model.removeAnnotation(a.id); WE.render.renderAll(); refreshProps();
    });
  }
  function focusAnnoText() {
    var ta = document.getElementById("annoText");
    ta.focus(); ta.select();
  }

  // ---- 배선 속성 ----
  function bindWireProps() {
    // 선택된 배선들(다중선택 포함)을 반환
    function selectedWires() {
      var ids = WE.model.getMultiWire();
      if (ids && ids.length) {
        return ids.map(function (id) { return WE.model.getWire(id); }).filter(Boolean);
      }
      var w = WE.model.getSelectedWire();
      return w ? [w] : [];
    }
    document.getElementById("wireColor").addEventListener("input", function (e) {
      var ws = selectedWires(); if (!ws.length) return;
      ws.forEach(function (w) { w.color = e.target.value; });
      WE.render.renderWires(); WE.render.renderOverlay();
    });
    document.getElementById("wireWidth").addEventListener("input", function (e) {
      var v = parseInt(e.target.value, 10); if (isNaN(v)) return;
      var ws = selectedWires(); if (!ws.length) return;
      ws.forEach(function (w) { w.width = Math.max(1, v); });
      WE.render.renderWires(); WE.render.renderOverlay();
    });
    document.getElementById("wireAllowOverlap").addEventListener("change", function (e) {
      var ws = selectedWires(); if (!ws.length) return;
      ws.forEach(function (w) { w.allowOverlap = e.target.checked; });
    });
    document.getElementById("wireLabelText").addEventListener("input", function (e) {
      var w = WE.model.getSelectedWire(); if (!w) return;
      w.labelText = e.target.value;
      WE.render.renderWires();
    });
    document.getElementById("wireLabelReset").addEventListener("click", function () {
      var ws = selectedWires(); if (!ws.length) return;
      ws.forEach(function (w) { delete w.labelPos; });
      WE.render.renderWires();
      WE.history.commit();
    });
    document.getElementById("wireCurrent").addEventListener("input", function (e) {
      var w = WE.model.getSelectedWire(); if (!w) return;
      var v = parseFloat(e.target.value);
      applyWireGauge(w, isNaN(v) ? 0 : v);
      updateWireAwgOut(w);
    });
    document.getElementById("wireCalcApply").addEventListener("click", function () {
      var w = WE.model.getSelectedWire(); if (!w) return;
      var V = parseFloat(document.getElementById("wireCalcV").value);
      var checked = document.querySelectorAll("#wireLoadList input:checked");
      var totalP = 0, cnt = 0;
      Array.prototype.forEach.call(checked, function (cb) { totalP += parseFloat(cb.dataset.p) || 0; cnt++; });
      if (!cnt) { setHint("합산할 부하를 선택하세요."); return; }
      if (!(V > 0)) { setHint("구간 전압(V)을 입력하세요."); return; }
      var I = totalP / V;
      document.getElementById("wireCurrent").value = Math.round(I * 1000) / 1000;
      applyWireGauge(w, I); updateWireAwgOut(w);
      document.getElementById("wireCalcOut").textContent =
        "부하 " + cnt + "개 = " + round(totalP) + "W ÷ " + V + "V = " + (Math.round(I * 100) / 100) + "A";
    });
    document.getElementById("wireDelete").addEventListener("click", function () {
      var ws = selectedWires(); if (!ws.length) return;
      ws.forEach(function (w) { WE.model.removeWire(w.id); });
      WE.model.clearSelection(); WE.render.renderAll(); refreshProps();
    });
    document.getElementById("wireAlign").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-walign]"); if (!b) return;
      var m = b.dataset.walign;
      if (m === "align") alignSelectedWires();
      else if (m === "distH") distributeSelectedWires(true);    // 가로 균등(세로선들의 x 간격)
      else if (m === "distV") distributeSelectedWires(false);   // 세로 균등(가로선들의 y 간격)
    });
  }

  // ---- 배선 규격(AWG) ----
  function applyWireGauge(w, currentA) {
    if (currentA > 0) {
      w.current = currentA;
      var e = WE.awg.recommend(currentA);
      w.awg = e ? e.awg : null;
      w.width = WE.awg.widthPx(e);
    } else {
      delete w.current; delete w.awg;
      w.width = WE.model.ui.wireWidth || 2;   // 신호선 기본 두께
    }
    WE.render.renderWires(); WE.render.renderOverlay();
  }
  function updateWireAwgOut(w) {
    var out = document.getElementById("wireAwgOut");
    if (w && w.current > 0 && w.awg) {
      var e = WE.awg.get(w.awg);
      out.textContent = "권장 AWG " + w.awg + " · Ø" + e.dia + "mm · 허용 " + e.ampEff + "A (여유 ×" + WE.awg.MARGIN + ")";
    } else out.textContent = "신호선(기본 두께). 전류를 입력하면 규격을 자동 계산합니다.";
  }
  // 부하 부품(전력 있는 load) 체크박스 목록
  function renderWireLoadList() {
    var box = document.getElementById("wireLoadList"); if (!box) return;
    var seen = {}, html = "";
    WE.model.project.components.forEach(function (c) {
      var lib = c.libraryId ? WE.library.get(c.libraryId) : null;
      var role = lib ? (lib.role || "load") : "load";
      if (role !== "load") return;
      var P = lib ? partPower(lib) : 0;
      if (!(P > 0)) return;   // 전력 있는 부하만
      var key = c.libraryId || ("name:" + c.name);
      if (seen[key]) return; seen[key] = 1;
      var name = lib ? lib.name : c.name;
      html += "<label class='wg-load'><input type='checkbox' data-p='" + P + "' /> " + esc(name) + " (" + round(P) + "W)</label>";
    });
    box.innerHTML = html || "<span class='muted'>전력이 입력된 부하 부품이 없습니다.</span>";
  }

  // 배선의 가장 긴 세로(vertical=true)/가로 구간 → {i, coord}
  function wireMainSeg(pts, vertical) {
    var best = null, bestLen = -1;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      if (vertical && Math.abs(a.x - b.x) < 0.5) {
        var L = Math.abs(a.y - b.y); if (L > bestLen) { bestLen = L; best = { i: i, coord: a.x }; }
      } else if (!vertical && Math.abs(a.y - b.y) < 0.5) {
        var L2 = Math.abs(a.x - b.x); if (L2 > bestLen) { bestLen = L2; best = { i: i, coord: a.y }; }
      }
    }
    return best;
  }
  function segIsVertical(pts, i) { return Math.abs(pts[i].x - pts[i + 1].x) < 0.5; }
  // 이 배선에서 정렬 대상 구간 인덱스: 클릭한 구간 우선, 없으면 원하는 방향의 가장 긴 구간
  function wireTargetSeg(wire, pts, wantVertical) {
    var pt = WE.model.getWireClickPt(wire.id);
    if (pt) {
      var idx = WE.geometry.nearestSegmentIndex(pts, pt);
      if (idx >= 0 && (wantVertical == null || segIsVertical(pts, idx) === wantVertical)) return idx;
    }
    var seg = wireMainSeg(pts, wantVertical == null ? true : wantVertical);
    if (seg) return seg.i;
    if (wantVertical == null) { var sh = wireMainSeg(pts, false); if (sh) return sh.i; }
    return -1;
  }
  function setWireSeg(w, pts, idx, vertical, coord) {
    var np = pts.map(function (p) { return { x: p.x, y: p.y }; });
    if (vertical) { np[idx].x = coord; np[idx + 1].x = coord; }
    else { np[idx].y = coord; np[idx + 1].y = coord; }
    np = WE.geometry.simplify(np);   // 일직선상 중간점 제거(불필요한 꺾임점 방지)
    w.waypoints = np.slice(1, np.length - 1);
  }
  // 처음 클릭한 배선(anchor)의 클릭한 구간에 나머지 선택 배선을 맞춤(세로/가로 자동)
  // 간격(px)>0이면 기준선에서 그 간격씩 벌려 평행 배치(방향은 현재 위치 쪽 자동)
  function alignSelectedWires() {
    var ids = WE.model.getMultiWire();
    if (!ids || ids.length < 2) return;
    var anchor = WE.model.getWire(ids[0]); if (!anchor) return;
    var aPts = WE.geometry.wireRoutePoints(anchor); if (!aPts) return;
    var aIdx = wireTargetSeg(anchor, aPts, null); if (aIdx < 0) return;
    var vertical = segIsVertical(aPts, aIdx);
    var C = vertical ? aPts[aIdx].x : aPts[aIdx].y;
    var gapEl = document.getElementById("wireGap");
    var gap = gapEl ? parseInt(gapEl.value, 10) : 0; if (isNaN(gap)) gap = 0;

    var others = [];
    for (var k = 1; k < ids.length; k++) {
      var w = WE.model.getWire(ids[k]); if (!w) continue;
      var pts = WE.geometry.wireRoutePoints(w); if (!pts || pts.length < 3) continue;
      var idx = wireTargetSeg(w, pts, vertical); if (idx < 0) continue;
      var s1 = pts[idx], s2 = pts[idx + 1];
      others.push({
        id: ids[k], w: w, pts: pts, idx: idx, coord: vertical ? s1.x : s1.y,
        lo: vertical ? Math.min(s1.y, s2.y) : Math.min(s1.x, s2.x),
        hi: vertical ? Math.max(s1.y, s2.y) : Math.max(s1.x, s2.x)
      });
    }
    if (!others.length) return;
    // 앵커 쪽 방향(현재 배선들이 있는 쪽)으로 밀기 우선
    var avg = others.reduce(function (s, o) { return s + o.coord; }, 0) / others.length;
    var dir = (avg - C) < 0 ? -1 : 1;
    others.sort(function (a, b) { return dir * (a.coord - b.coord); });   // 앵커에 가까운 것부터
    // 앵커에 맞추되(C), 겹치면 자동으로 옆 레인(gap)으로 회피. 순차 배치로 서로도 안 겹침.
    others.forEach(function (o) {
      var target = WE.geometry.avoidOverlapCoord(o.id, vertical, C, o.lo, o.hi, gap, dir);
      setWireSeg(o.w, o.pts, o.idx, vertical, target);
    });
    WE.render.renderAll(); WE.render.renderOverlay(); refreshProps();
    setHint((vertical ? "세로선" : "가로선") + " 정렬: " + others.length + "개" + (gap > 0 ? (" · 간격 " + gap + "px") : ""));
  }
  // 균등 배치: alongX=true → 세로선들의 x를 균등 간격 / false → 가로선들의 y를 균등
  function distributeSelectedWires(alongX) {
    var ids = WE.model.getMultiWire();
    if (!ids || ids.length < 3) { setHint("균등 배치는 배선 3개 이상 선택하세요."); return; }
    var items = [];
    ids.forEach(function (id) {
      var w = WE.model.getWire(id); if (!w) return;
      var pts = WE.geometry.wireRoutePoints(w); if (!pts || pts.length < 3) return;
      var idx = wireTargetSeg(w, pts, alongX); if (idx < 0) return;
      if (segIsVertical(pts, idx) !== alongX) { var s = wireMainSeg(pts, alongX); if (!s) return; idx = s.i; }
      items.push({ w: w, pts: pts, idx: idx, coord: alongX ? pts[idx].x : pts[idx].y });
    });
    if (items.length < 3) { setHint("균등 배치할 " + (alongX ? "세로" : "가로") + " 구간이 부족합니다."); return; }
    items.sort(function (a, b) { return a.coord - b.coord; });
    var first = items[0].coord, step = (items[items.length - 1].coord - first) / (items.length - 1);
    items.forEach(function (it, i) {
      setWireSeg(it.w, it.pts, it.idx, alongX, first + step * i);
    });
    WE.render.renderAll(); WE.render.renderOverlay(); refreshProps();
    setHint((alongX ? "가로" : "세로") + " 균등 배치: " + items.length + "개");
  }

  function wireConnText(w) {
    function nm(ref) {
      var c = WE.model.getComponent(ref.componentId);
      if (!c) return "?";
      var t = WE.model.getTerminal(c, ref.terminalId);
      return c.name + " · " + (t ? t.name : "?");
    }
    return nm(w.from) + "  ──  " + nm(w.to);
  }

  // ---- 배선 리스트(와이어 리스트) ----
  // 색 → 팔레트 라벨(없으면 hex)
  function colorLabel(color) {
    var pal = WE.model.project.palette || [];
    for (var i = 0; i < pal.length; i++) if (pal[i].color === color) return pal[i].label;
    return color;
  }
  function endParts(ref) {
    var c = WE.model.getComponent(ref.componentId);
    var t = c ? WE.model.getTerminal(c, ref.terminalId) : null;
    return { cmp: c ? c.name : "?", term: t ? t.name : "?" };
  }
  // 화면·PDF·CSV 공용 배선 리스트 데이터
  function wireListData() {
    return WE.model.project.wires.map(function (w, i) {
      var a = endParts(w.from), b = endParts(w.to);
      return {
        no: "W" + (i + 1), color: colorLabel(w.color), colorHex: w.color,
        awg: w.awg || "", current: w.current > 0 ? w.current : "",
        fromCmp: a.cmp, fromTerm: a.term, toCmp: b.cmp, toTerm: b.term
      };
    });
  }
  function exportWireListCSV() {
    var rows = wireListData();
    if (!rows.length) { setHint("배선이 없습니다."); return; }
    function cell(v) { v = (v == null ? "" : String(v)); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var lines = [["번호", "색", "AWG", "전류(A)", "출발 부품", "출발 단자", "도착 부품", "도착 단자"].map(cell).join(",")];
    rows.forEach(function (r) {
      lines.push([r.no, r.color, r.awg, r.current, r.fromCmp, r.fromTerm, r.toCmp, r.toTerm].map(cell).join(","));
    });
    var csv = "﻿" + lines.join("\r\n");   // UTF-8 BOM: 엑셀 한글 깨짐 방지
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = (WE.model.project.meta.name || "배선도") + "_배선리스트.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    setHint("배선 리스트 내보내기: " + rows.length + "개");
  }

  // ---- 단자 편집 ----
  function bindTerminals() {
    document.getElementById("btnTermEdit").addEventListener("click", function () {
      var c = WE.model.getSelectedComponent();
      if (c) WE.termeditor.open(c);
    });
    document.getElementById("propHideTermLabels").addEventListener("change", function (e) {
      var c = WE.model.getSelectedComponent(); if (!c) return;
      c.hideTermLabels = e.target.checked;
      WE.render.renderAll();
    });
  }

  // ---- 프리셋 관리 모달 ----
  function bindPresetModal() {
    document.getElementById("presetClose").addEventListener("click", function () {
      document.getElementById("presetModal").hidden = true;
    });
    document.getElementById("btnAddPreset").addEventListener("click", function () {
      var label = document.getElementById("newPresetLabel").value.trim();
      var color = document.getElementById("newPresetColor").value;
      if (!label) { document.getElementById("newPresetLabel").focus(); return; }
      WE.presets.add(label, color);
      document.getElementById("newPresetLabel").value = "";
      renderPresetList();
      onPresetsChanged();
    });
    var pl = document.getElementById("presetList");
    pl.addEventListener("input", function (e) {
      var row = e.target.closest(".preset-row"); if (!row) return;
      if (e.target.classList.contains("plabel")) WE.presets.update(row.dataset.id, { label: e.target.value });
      else if (e.target.classList.contains("pcolor")) WE.presets.update(row.dataset.id, { color: e.target.value });
      onPresetsChanged();
    });
    pl.addEventListener("click", function (e) {
      if (!e.target.classList.contains("pdel")) return;
      var row = e.target.closest(".preset-row");
      WE.presets.remove(row.dataset.id);
      renderPresetList();
      onPresetsChanged();
    });
  }

  function openPresetModal() {
    renderPresetList();
    document.getElementById("presetModal").hidden = false;
  }

  function renderPresetList() {
    var pl = document.getElementById("presetList");
    pl.innerHTML = "";
    WE.presets.getAll().forEach(function (p) {
      var row = document.createElement("div");
      row.className = "preset-row"; row.dataset.id = p.id;
      var color = document.createElement("input");
      color.type = "color"; color.className = "pcolor"; color.value = p.color;
      var label = document.createElement("input");
      label.type = "text"; label.className = "plabel"; label.value = p.label;
      var del = document.createElement("button");
      del.className = "pdel"; del.textContent = "삭제";
      row.appendChild(color); row.appendChild(label); row.appendChild(del);
      pl.appendChild(row);
    });
  }

  // 프리셋 목록 변경 시 관련 UI 갱신
  function onPresetsChanged() {
    if (WE.termeditor.isOpen()) WE.termeditor.refreshPresets();
  }

  // ---- 부품 ⋯ 컨텍스트 메뉴 ----
  var _menuCmpId = null;

  function bindMenu() {
    var menu = document.getElementById("cmpMenu");
    menu.addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      var act = btn.getAttribute("data-act");
      var c = WE.model.getComponent(_menuCmpId);
      closeComponentMenu();
      if (!c) return;
      if (act === "terminals") {
        WE.termeditor.open(c);
      } else if (act === "bg" && c.image) {
        WE.bgremove.open(c.image, function (url, tf) { applyInstanceImage(c, url, tf); });
      } else if (act === "tolib") {
        var savedPart = saveToLibrary(c.name, function () {
          return {
            name: c.name, image: c.image,
            defaultWidth: c.width, defaultHeight: c.height, terminals: c.terminals
          };
        });
        if (savedPart) { c.libraryId = savedPart.id; openLibEdit(savedPart.id); }
      } else if (act === "duplicate") {
        var copy = WE.model.duplicateComponent(c.id);
        WE.model.select("component", copy.id);
        WE.render.renderAll(); refreshProps();
      } else if (act === "delete") {
        WE.model.removeComponent(c.id);
        WE.render.renderAll(); refreshProps();
      }
    });
  }

  function openComponentMenu(menuBtnEl, cmp) {
    _menuCmpId = cmp.id;
    var menu = document.getElementById("cmpMenu");
    var r = menuBtnEl.getBoundingClientRect();
    menu.hidden = false;
    menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8) + "px";
    menu.style.top = (r.bottom + 2) + "px";
    // 다음 pointerdown이 메뉴 밖이면 닫기
    setTimeout(function () {
      document.addEventListener("pointerdown", outsideClose, true);
    }, 0);
  }

  function outsideClose(e) {
    if (!e.target.closest("#cmpMenu")) closeComponentMenu();
  }

  function closeComponentMenu() {
    document.getElementById("cmpMenu").hidden = true;
    document.removeEventListener("pointerdown", outsideClose, true);
    _menuCmpId = null;
  }

  // ---- 툴바 ----
  function bindToolbar() {
    document.getElementById("chkGrid").addEventListener("change", function (e) {
      WE.render.setGridVisible(e.target.checked);
    });
    document.getElementById("chkSnap").addEventListener("change", function (e) {
      WE.model.project.meta.canvas.snap = e.target.checked;
    });
    document.getElementById("chkWireNums").addEventListener("change", function (e) {
      WE.model.ui.showWireNums = e.target.checked;
      saveWireSettings();
      WE.render.renderWires();
    });

    var pn = document.getElementById("projName");
    pn.value = WE.model.project.meta.name || "";
    pn.addEventListener("input", function (e) {
      WE.model.project.meta.name = e.target.value;
    });
  }

  // ---- 속성 패널 ----
  function bindProps() {
    document.getElementById("propName").addEventListener("input", function (e) {
      applyProp(function (c) { c.name = e.target.value; }, true);
    });
    ["propX", "propY"].forEach(function (id) {
      document.getElementById(id).addEventListener("input", function (e) {
        var v = parseFloat(e.target.value);
        if (isNaN(v)) return;
        applyProp(function (c) {
          if (id === "propX") c.x = v; else c.y = v;
        }, true);
      });
    });
    document.getElementById("propW").addEventListener("input", function (e) {
      var v = parseFloat(e.target.value); if (isNaN(v) || v < 10) return;
      applyProp(function (c) {
        if (WE.model.ui.lockAspect) c.height = Math.max(10, Math.round(v * c.height / c.width));
        c.width = v;
      }, true);
      refreshProps(); // 비율 고정 시 높이 값도 반영
    });
    document.getElementById("propH").addEventListener("input", function (e) {
      var v = parseFloat(e.target.value); if (isNaN(v) || v < 10) return;
      applyProp(function (c) {
        if (WE.model.ui.lockAspect) c.width = Math.max(10, Math.round(v * c.width / c.height));
        c.height = v;
      }, true);
      refreshProps();
    });
    document.getElementById("propLockAspect").addEventListener("change", function (e) {
      WE.model.ui.lockAspect = e.target.checked;
    });
    document.getElementById("propRot").addEventListener("input", function (e) {
      var v = parseFloat(e.target.value); if (isNaN(v)) return;
      applyProp(function (c) { c.rotation = ((v % 360) + 360) % 360; }, true);
    });
    document.getElementById("propRot90").addEventListener("click", function () {
      applyProp(function (c) { c.rotation = (c.rotation + 90) % 360; }, false);
    });
    document.getElementById("propDelete").addEventListener("click", function () {
      var c = WE.model.getSelectedComponent();
      if (c) { WE.model.removeComponent(c.id); WE.render.renderAll(); refreshProps(); }
    });
    document.getElementById("propBgRemove").addEventListener("click", function () {
      var c = WE.model.getSelectedComponent();
      if (!c || !c.image) return;
      WE.bgremove.open(c.image, function (url, tf) { applyInstanceImage(c, url, tf); });
    });
    document.getElementById("propDuplicate").addEventListener("click", function () {
      var c = WE.model.getSelectedComponent();
      if (c) {
        var copy = WE.model.duplicateComponent(c.id);
        WE.model.select("component", copy.id);
        WE.render.renderAll(); refreshProps();
      }
    });
  }

  // 속성 변경 적용 후 렌더 (fromInput=true면 입력창 값은 다시 안 덮어씀)
  function applyProp(fn, fromInput) {
    var c = WE.model.getSelectedComponent();
    if (!c) return;
    fn(c);
    WE.render.renderAll();
    if (!fromInput) refreshProps();
    else { WE.render.renderOverlay(); }
  }

  // 속성 패널을 현재 선택으로 갱신
  function refreshProps() {
    updateHistoryButtons();
    var powerPanel = document.getElementById("powerPanel");
    powerPanel.hidden = true;   // 전력 요약은 기본(무선택) 상태에서만 표시
    var empty = document.getElementById("propEmpty");
    var body = document.getElementById("propBody");
    var wp = document.getElementById("wireProps");
    var al = document.getElementById("alignProps");
    var ap = document.getElementById("annoProps");

    // 다중 선택 → 정렬 패널
    var multi = WE.model.getMulti();
    if (multi.length > 1) {
      empty.hidden = true; body.hidden = true; wp.hidden = true; ap.hidden = true; al.hidden = false;
      document.getElementById("alignCount").textContent = "부품 " + multi.length + "개 선택됨";
      return;
    }
    al.hidden = true;

    // 주석 선택
    var anno = WE.model.getSelectedAnnotation();
    if (anno) {
      empty.hidden = true; body.hidden = true; wp.hidden = true; ap.hidden = false;
      setIfNotFocused("annoText", anno.text);
      setIfNotFocused("annoColor", anno.color);
      setIfNotFocused("annoSize", anno.fontSize);
      document.getElementById("annoBold").checked = anno.bold;
      return;
    }
    ap.hidden = true;

    // 배선 선택
    var wire = WE.model.getSelectedWire();
    if (wire) {
      empty.hidden = true; body.hidden = true; wp.hidden = false;
      var mw = WE.model.getMultiWire();
      document.getElementById("wireConn").textContent =
        (mw && mw.length > 1) ? ("배선 " + mw.length + "개 선택됨 (색·두께 일괄 변경)") : wireConnText(wire);
      document.getElementById("wireAlign").hidden = !(mw && mw.length >= 2);
      document.getElementById("wireAllowOverlap").checked = !!wire.allowOverlap;
      setIfNotFocused("wireColor", wire.color);
      setIfNotFocused("wireWidth", wire.width);
      setIfNotFocused("wireLabelText", wire.labelText || "");
      setIfNotFocused("wireCurrent", wire.current > 0 ? wire.current : "");
      updateWireAwgOut(wire);
      renderWireLoadList();
      return;
    }
    wp.hidden = true;

    var c = WE.model.getSelectedComponent();
    if (!c) {
      empty.hidden = false; body.hidden = true;
      powerPanel.hidden = false; renderPowerSummary();   // 무선택 = 전력 요약 표시
      return;
    }
    empty.hidden = true; body.hidden = false;

    setIfNotFocused("propName", c.name);
    setIfNotFocused("propX", Math.round(c.x));
    setIfNotFocused("propY", Math.round(c.y));
    setIfNotFocused("propW", Math.round(c.width));
    setIfNotFocused("propH", Math.round(c.height));
    setIfNotFocused("propRot", Math.round(c.rotation));
    document.getElementById("propLockAspect").checked = WE.model.ui.lockAspect;
    document.getElementById("propHideTermLabels").checked = !!c.hideTermLabels;
    renderCompElec(c);
  }

  // 선택 부품의 전기 정보(라이브러리 값)를 속성 하단에 읽기전용 표시
  function renderCompElec(c) {
    var box = document.getElementById("compElec");
    var lib = c.libraryId ? WE.library.get(c.libraryId) : null;
    if (!lib) { box.hidden = true; return; }
    var roleMap = { battery: "배터리(소스)", load: "부하", converter: "변환기" };
    var role = lib.role || "load";
    function row(k, v) { return "<div class='ce-row'><span>" + k + "</span><b>" + v + "</b></div>"; }
    var html = row("역할", roleMap[role] || role);
    if (n(lib.volt)) html += row("전압", n(lib.volt) + " V");
    if (n(lib.current)) html += row("전류", n(lib.current) + " A");
    if (partPower(lib)) html += row("전력", round(partPower(lib)) + " W");
    if (role === "battery" && n(lib.capacityAh)) html += row("용량", n(lib.capacityAh) + " Ah" + (n(lib.dod) ? (" · DoD " + n(lib.dod) + "%") : ""));
    if (role === "load" && n(lib.minPerHour) && n(lib.minPerHour) !== 60) html += row("가동", n(lib.minPerHour) + " 분/시간");
    if (role === "converter" && n(lib.efficiency)) html += row("효율", n(lib.efficiency) + " %");
    var hasVal = n(lib.volt) || n(lib.current) || partPower(lib) || n(lib.capacityAh);
    document.getElementById("compElecBody").innerHTML = hasVal ? html
      : "<span class='muted'>전기값 미입력 — ⚙ 부품 정보에서 입력</span>";
    box.hidden = false;
  }

  function setIfNotFocused(id, value) {
    var elm = document.getElementById(id);
    if (document.activeElement !== elm) elm.value = value;
  }

  function setHint(text) {
    var h = document.getElementById("hint");
    h.textContent = text; h.classList.remove("hint-save");
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  // 저장 안내(날짜·시간, 작은 글씨)
  function setSavedHint() {
    var d = new Date();
    var s = "💾 저장됨 " + d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
    var h = document.getElementById("hint");
    h.textContent = s; h.classList.add("hint-save");
  }

  // 프로젝트 열기 후 전체 UI 갱신
  // 배치된 부품의 libraryId가 라이브러리에서 사라진 경우(다른 브라우저에서 만든 파일,
  // 예전 버전의 라이브러리 불러오기로 id가 재발급된 경우 등) 같은 이름의 부품으로 다시 연결.
  // 연결이 끊기면 BOM의 스펙·가격·구매링크·데이터시트가 전부 빈칸으로 보이므로 열 때마다 복구 시도.
  function relinkOrphanComponents() {
    var fixed = 0;
    WE.model.project.components.forEach(function (c) {
      if (!c.libraryId || WE.library.get(c.libraryId)) return;   // 정상 연결이면 통과
      var byName = WE.library.findByName(c.name);
      if (byName) { c.libraryId = byName.id; fixed++; }
    });
    return fixed;
  }

  function reloadUI() {
    var snap = WE.model.project.meta.canvas.snap !== false;
    document.getElementById("chkSnap").checked = snap;
    document.getElementById("projName").value = WE.model.project.meta.name || "";
    document.getElementById("wireWidthSel").value = String(WE.model.ui.wireWidth);
    document.getElementById("wireRoutingSel").value = WE.model.ui.wireRouting;
    relinkOrphanComponents();
    renderPalette();
    WE.render.renderAll();
    refreshProps();
  }

  return {
    init: init, refreshProps: refreshProps, setHint: setHint, setSavedHint: setSavedHint, reloadUI: reloadUI,
    renderLibrary: renderLibrary,
    openComponentMenu: openComponentMenu,
    openPresetModal: openPresetModal,
    focusAnnoText: focusAnnoText,
    afterTerminalEdit: afterTerminalEdit,
    buildBOM: buildBOM,
    bomData: bomData,
    bomColumns: visibleCols,
    linkLabel: linkLabel,
    renderBOMView: renderBOMView,
    wireListData: wireListData,
    afterModelRender: afterModelRender,
    powerSummaryRows: powerSummaryRows,
    handleShortcut: handleShortcut,
    setMode: setMode,
    track: track, trackOnce: trackOnce
  };
})();

window.addEventListener("DOMContentLoaded", WE.app.init);

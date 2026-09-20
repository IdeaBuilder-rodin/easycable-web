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
    // 저장공간 부족 시 브라우저가 IndexedDB(라이브러리·자동저장)를 임의 삭제하지 못하도록 보존 요청
    // (사용자에게 아무것도 안 보이고, 거부돼도 동작엔 영향 없음)
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    } catch (e) { /* 무시 */ }
    loadShortcuts();
    bindToolbar();
    bindModes();
    bindPalette();
    bindProps();
    bindWireProps();
    bindAnnoProps();
    bindMenu();
    bindTerminals();
    // 프리셋 관리 모달은 js/presetmodal.js 가 처음 열릴 때 스스로 묶는다(지연 초기화)
    bindFileButtons();
    bindLibrary();
    if (WE.publicLibrary) {
      WE.publicLibrary.init({ renderLibrary: renderLibrary, placePart: placeLibraryPart });
    }
    if (WE.publicPublisher) {
      WE.publicPublisher.init({ onAdminChange: syncPublicPublishMenu });
    }
    bindLibEdit();
    bindBackupNotice();
    bindDatasheetViewer();
    bindResizers();
    bindZoom();
    bindCanvasMark();
    bindPaste();
    bindNotice();
    bindAlign();
    bindSettings();
    bindModalBackdrops();
    bindWelcome();
    bindBeta();
    bindFeedback();
    bindNotify();
    bindQuickColorPicker();
    bindHelp();
    bindAppMenu();
    bindBOMView();
    bindWireListView();   // 결선표 비고 칸
    bindRestoreBanner();
    bindRecentModal();
    loadSettings();
    loadWireSettings();
    document.getElementById("wireWidthSel").value = String(WE.model.ui.wireWidth);
    syncWireRoutingBtns();
    renderPalette();
    WE.render.renderAll();
    refreshProps();

    // 시작 순서는 반드시 이 차례여야 한다(예전엔 라이브러리와 샘플이 동시에 떠서 순서가 들쭉날쭉했다):
    //   자산 풀 → 라이브러리 → 이전 작업 복원 → (복원할 게 없을 때만) 첫 방문 샘플
    // 자산 풀이 먼저 올라와야 라이브러리·도면의 첨부물 참조를 되돌릴 수 있다.
    WE.store.init(function () {
      function finish() {
        WE.store.syncBaseline();
        WE.store.onYield(showYieldBanner);   // 다른 탭이 같은 작업을 열면 알린다
        WE.store.start();
        applySettings();
        bindWireGap();   // 간격을 고치면 기억하도록
        bindPageSize();  // 우측 하단 용지 크기 고르기
        bindDateDrag();  // 작성일 상자 — 캔버스 위에 떠 있고 손잡이로 끌어 옮긴다
        applyCanvasSize();   // 이 페이지의 용지 크기로 화면을 맞춘다
        WE.history.reset();
        WE.history.start();
        updateHistoryButtons();
        requestAnimationFrame(fitZoom);   // 최초 화면은 현재 크기에 '맞춤'으로 시작
        setTimeout(applyAdminInbox, 300);  // 관리자 페이지가 넘긴 부품이 있으면 넣고 배치 (없으면 아무 일 없음)
        WE.store.pruneDrafts(20);         // 문서 슬롯이 무한정 쌓이지 않게 (현재·타 탭 문서는 제외)
        // 쓰이지 않는 첨부물 정리 — 시작 직후 화면을 방해하지 않도록 조금 뒤로 미룬다
        setTimeout(function () { WE.assets.sweepIfDue(); }, 4000);
      }
      WE.assets.loadAll(function () {
        WE.library.load(function () {
          renderLibrary();
          WE.store.migrateLegacy(function () {
            /* 지난 작업 이어서 하기.
               ⚠ 어느 탭에서 들어오든 **마지막으로 보던 도면**이 나와야 한다.
                  사용자에게 탭은 보이지 않는다 — 관리자 페이지를 갔다 오든 랜딩에서
                  들어오든, 하던 작업이 그대로 이어져야 한다. (2026-09-02) */
            var mine = WE.store.lastDoc();
            if (mine) {
              WE.store.loadDraft(mine, function (saved) {
                if (saved && restoreDraft(saved)) { finish(); return; }
                // 저장본이 없으면 '비워둔 채였다'는 뜻 — 다른 도면을 끌어오지 않는다
                WE.model.project.meta.id = mine;
                startFresh(false);
              });
              return;
            }
            // 기억이 아예 없는 첫 방문만 여기로 온다 — 가장 최근 작업을 잇는다
            WE.store.listDrafts(function (drafts) {
              if (!drafts.length) { startFresh(false); return; }
              WE.store.loadDraft(drafts[0].id, function (saved) {
                if (saved && restoreDraft(saved)) { finish(); return; }
                startFresh(true);
              });
            });
          });

          // 되살릴 게 없을 때: 첫 방문이면 샘플, 아니면 빈 화면
          function startFresh(othersBusy) {
            tryLoadSample(function (loaded) {
              if (!loaded) {
                applyDefaultLayoutToProject();
                applyDefaultPaletteToProject();  // 저장해둔 배선색 팔레트로 시작(새로고침해도 유지)
                renderPalette();
              }
              finish();
              if (othersBusy) {
                setHint(WE.i18n.t("새 배선도로 시작했습니다."), WE.i18n.t("이전 작업을 불러오지 못해 새 배선도로 시작했습니다. (☰ → 최근 작업)"));
              }
            });
          }
        });
      });
    });
  }

  // 자동저장본으로 화면을 되돌린다. 되돌릴 내용이 없으면 false.
  function restoreDraft(saved) {
    // 빈 도면은 복원해봐야 빈 화면 — 샘플/기본 시작에 양보.
    // ⚠ 판정을 여기서 직접 하지 않는다. 예전에는 최상위 components 만 봐서,
    //    시트에 들어 있는 도면을 전부 '비었다'고 판정해 복원이 통째로 안 됐다.
    if (!WE.model.hasContent(saved)) return false;
    try {
      WE.model.loadProject(saved);
      reloadUI();
    } catch (e) { return false; }
    // 복원본은 아직 어떤 파일에도 담기지 않은 상태다. 파일 연결을 끊어두어야
    // 다음 Ctrl+S가 예전 파일을 조용히 덮어쓰지 않고 저장 위치를 다시 묻는다.
    WE.io.clearFileHandle();
    WE.store.claimCurrent();   // 이 문서는 내가 편집한다고 표시 (다른 탭이 겹쳐 열지 않게)
    // 되살린 시점을 즉시 스냅샷으로 남긴다 — 바로 '새 배선도로 시작'을 눌러도 되돌릴 수 있게
    WE.store.pushSnapshot();
    showRestoreBanner(saved._savedAt);
    return true;
  }

  // ---- 복원 알림 띠 ----
  var _restoreBannerTimer = null;
  function fmtSavedAt(t) {
    if (!t) return "";
    var d = new Date(t), now = new Date();
    var hm = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    var sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return WE.i18n.t("오늘 ") + hm;
    var yst = new Date(now.getTime() - 86400000);
    if (d.toDateString() === yst.toDateString()) return WE.i18n.t("어제 ") + hm;
    return (d.getMonth() + 1) + "/" + d.getDate() + " " + hm;
  }
  function hideRestoreBanner() {
    if (_restoreBannerTimer) { clearTimeout(_restoreBannerTimer); _restoreBannerTimer = null; }
    document.getElementById("restoreBanner").hidden = true;
  }
  function showRestoreBanner(savedAt) {
    var when = fmtSavedAt(savedAt);
    var name = (WE.model.project.meta && WE.model.project.meta.name) || "";
    document.getElementById("restoreBannerText").innerHTML =
      WE.i18n.t("지난 작업을 이어서 불러왔습니다.") +
      (when || name
        ? "<span class='rb-sub'>" + esc(when) + (when && name ? " · " : "") + esc(name) + "</span>"
        : "");
    document.getElementById("restoreBanner").hidden = false;
    // 방해가 되지 않도록 잠시 뒤 스스로 사라진다(내용은 이미 화면에 복원돼 있다)
    _restoreBannerTimer = setTimeout(hideRestoreBanner, 15000);
  }
  /* 같은 작업을 다른 탭에서 열었을 때. 이 탭은 자동저장을 멈춘 상태다.
     말없이 멈추면 사용자는 계속 그리다가 전부 잃는다 — 배너는 스스로 사라지지 않는다. */
  function showYieldBanner() {
    if (_restoreBannerTimer) { clearTimeout(_restoreBannerTimer); _restoreBannerTimer = null; }
    document.getElementById("restoreBannerText").innerHTML =
      WE.i18n.t("이 작업을 다른 탭에서 열었습니다.") +
      "<span class='rb-sub'>" +
      esc(WE.i18n.t("여기서 고친 내용은 저장되지 않습니다. 새로 연 탭에서 작업하세요.")) + "</span>";
    document.getElementById("restoreBanner").hidden = false;
  }

  function bindRestoreBanner() {
    document.getElementById("restoreBannerClose").addEventListener("click", hideRestoreBanner);
    document.getElementById("restoreBannerNew").addEventListener("click", function () {
      hideRestoreBanner();
      startNewProject();
      setHint(WE.i18n.t("새 배선도로 시작했습니다."), WE.i18n.t("새 배선도로 시작했습니다. 이전 작업은 ☰ 메뉴 → 최근 작업에서 이어서 열 수 있습니다."));
    });
  }

  function updateHistoryButtons() {
    document.getElementById("btnUndo").disabled = !WE.history.canUndo();
    document.getElementById("btnRedo").disabled = !WE.history.canRedo();
  }

  // ---- 첫 부품 등록 후 저장 위치 안내 모달 ----
  // 등록 직후엔 부품 정보 편집 모달이 자동으로 열리므로, 그 모달이 닫힐 때 띄움 (겹침 방지)
  var _backupNoticePending = false;
  function backupNoticeDone() {
    try { return !!localStorage.getItem("we_backupNoticeDone"); } catch (e) { return true; }
  }
  function queueBackupNotice() { if (!backupNoticeDone()) _backupNoticePending = true; }
  function maybeShowBackupNotice() {
    if (!_backupNoticePending) return;
    _backupNoticePending = false;
    if (backupNoticeDone()) return;
    document.getElementById("backupNoticeModal").hidden = false;
  }
  function bindBackupNotice() {
    function dismiss() {
      try { localStorage.setItem("we_backupNoticeDone", "1"); } catch (e) { /* 무시 */ }
      document.getElementById("backupNoticeModal").hidden = true;
    }
    document.getElementById("backupNoticeLater").addEventListener("click", dismiss);
    document.getElementById("backupNoticeNow").addEventListener("click", function () {
      dismiss();
      document.getElementById("btnLibExport").click();   // 그 자리에서 라이브러리 파일 백업 실행
    });
  }

  // 라이브러리 저장 (이름 중복 시 덮어쓰기/새로 추가 확인). 저장된 부품 반환
  /* 배치된 부품의 '지금 모습' 을 라이브러리 부품 자료로 옮긴다.
     여러 곳에서 같은 항목을 적어야 해서 한 군데로 모은다 —
     빠뜨린 항목이 있으면 "저장했는데 그 부분만 안 따라온다" 가 된다. */
  function 부품자료(c) {
    return {
      name: c.name, image: c.image,
      defaultWidth: c.width, defaultHeight: c.height, terminals: c.terminals,
      nameLabelPos: c.nameLabelPos,
      terminalPlacementQueue: c.terminalPlacementQueue,
      terminalPlacementQueueVersion: c.terminalPlacementQueueVersion
    };
  }

  /* 공용 부품을 배치한 뒤 이미지·단자·이름을 고치면 그 부품만 개인 사본으로 분리한다.
     위치·회전·크기처럼 도면 위 배치만 바꾸는 동작에서는 부르지 않는다. */
  function makeComponentIndependent(c, syncDefinition) {
    if (!c) return false;
    var source = c.libraryId && WE.library.get(c.libraryId);
    var linked = !!(c.publicId || (source && source.publicId));
    if (!linked) return false;
    if (source && source.publicId) {
      var copy = WE.library.copyAsIndependent(source.id);
      if (copy) c.libraryId = copy.id;
    }
    c.publicId = null;
    c.publicVersion = null;
    c.publicSnapshot = null;
    // 편집이 끝난 현재 모습을 새 개인 항목에도 넣어 다음 배치부터 그대로 나오게 한다.
    if (syncDefinition && c.libraryId && WE.library.get(c.libraryId)) {
      WE.library.updatePart(c.libraryId, 부품자료(c));
    }
    renderLibrary();
    return true;
  }

  function saveToLibrary(name, buildData) {
    var existing = WE.library.findByName(name);
    var part;
    if (existing) {
      var overwrite = confirm(
        WE.i18n.t("이미 '") + name + WE.i18n.t("' 부품이 라이브러리에 있습니다.\n\n") +
        WE.i18n.t("[확인] 기존 부품 덮어쓰기\n[취소] 새 부품으로 추가"));
      if (overwrite) { part = WE.library.updatePart(existing.id, buildData()); setHint(WE.i18n.t("덮어썼습니다: ") + name); }
      else { part = WE.library.addPart(buildData()); setHint(WE.i18n.t("새 부품으로 추가: ") + name); }
    } else {
      var data = buildData();
      // 새 부품은 마지막 사용 폴더에 넣어 제안 (바로 열리는 편집 모달에서 변경 가능)
      if (data.folderId === undefined) data.folderId = libLastFolder();
      part = WE.library.addPart(data);
      setHint(WE.i18n.t("라이브러리에 저장: ") + name);
    }
    renderLibrary();
    queueBackupNotice();
    return part;
  }

  // ---- 라이브러리 부품 정보(BOM) 편집 ----
  var _editLibId = null;
  function gv(id) { return document.getElementById(id).value; }

  // ---- 단가 입력 천단위 쉼표 ----
  // ⚠ input[type=number] 로는 못 한다 — 브라우저가 "29,000" 을 잘못된 값으로 보고 빈 값을 준다.
  //    그래서 type=text + inputmode=numeric 으로 두고 여기서 직접 찍는다.
  // 소수점 이하는 건드리지 않는다 — 예전에 소수로 넣어 둔 단가를 조용히 바꾸면 안 된다.
  function moneyText(v) {
    var s = String(v == null ? "" : v).replace(/,/g, "").trim();
    if (s === "") return "";
    var neg = s.charAt(0) === "-" ? "-" : "";
    s = s.replace(/[^\d.]/g, "");
    var dot = s.indexOf(".");
    var int = dot < 0 ? s : s.slice(0, dot);
    var frac = dot < 0 ? "" : s.slice(dot);          // 점 포함
    int = int.replace(/^0+(?=\d)/, "");              // 앞자리 0 제거
    // Number() 로 돌리지 않는다 — 아주 큰 값에서 자릿수가 뭉개진다
    int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return neg + int + frac;
  }
  function moneyRaw(v) { return String(v == null ? "" : v).replace(/,/g, "").trim(); }
  // 입력 중에도 쉼표를 찍는다. 커서는 **앞에 있던 숫자 개수** 기준으로 되돌린다 —
  // 그냥 두면 쉼표가 끼면서 커서가 튀어 가운데를 못 고친다.
  function bindMoneyInput(id) {
    var elx = document.getElementById(id); if (!elx) return;
    elx.addEventListener("input", function () {
      var before = elx.value.slice(0, elx.selectionStart || 0).replace(/[^\d]/g, "").length;
      elx.value = moneyText(elx.value);
      var i = 0, seen = 0;
      while (i < elx.value.length && seen < before) {
        if (/\d/.test(elx.value.charAt(i))) seen++;
        i++;
      }
      try { elx.setSelectionRange(i, i); } catch (_) {}
    });
  }
  function sv(id, v) { document.getElementById(id).value = v == null ? "" : v; }

  var _editDatasheets = [];   // 라이브러리 모달 편집 중인 데이터시트 작업본

  // 마지막으로 지정한 폴더 — 새 부품 등록 시 기본 폴더로 제안 (연속 등록 편의)
  function libLastFolder() {
    var fid = null;
    try { fid = localStorage.getItem("we_libLastFolder"); } catch (e) { /* 무시 */ }
    return (fid && WE.library.getFolder(fid)) ? fid : null;
  }
  function setLibLastFolder(fid) {
    try {
      if (fid) localStorage.setItem("we_libLastFolder", fid);
      else localStorage.removeItem("we_libLastFolder");
    } catch (e) { /* 무시 */ }
  }

  // 편집 모달의 폴더 드롭다운 채우기 (미분류 + 대분류/└하위)
  function fillLibFolderSel(selectedId) {
    var sel = document.getElementById("libFolderSel");
    sel.innerHTML = "";
    function opt(v, label) {
      var o = document.createElement("option");
      o.value = v; o.textContent = label; sel.appendChild(o);
    }
    opt("", WE.i18n.t("(미분류)"));
    var folders = WE.library.getFolders();
    folders.forEach(function (f) {
      if (f.parentId) return;
      opt(f.id, "📁 " + f.name);
      folders.forEach(function (s) {
        if (s.parentId === f.id) opt(s.id, "   └ " + s.name);
      });
    });
    sel.value = (selectedId && WE.library.getFolder(selectedId)) ? selectedId : "";
  }

  // 단가 칸에 천단위 쉼표를 물린다. 모달을 처음 열 때 한 번만.
  var _moneyBound = false;
  function bindMoneyInputsOnce() {
    if (_moneyBound) return;
    _moneyBound = true;
    bindMoneyInput("libPrice"); bindMoneyInput("libPriceKr");
  }

  function openLibEdit(id) {
    bindMoneyInputsOnce();
    var p = WE.library.get(id); if (!p) return;
    _editLibId = id;
    fillLibFolderSel(p.folderId);
    sv("libName", p.name); sv("libSpec", p.spec);
    // 구매 링크·단가 — 해외(link/price)·국내(linkKr/priceKr) 두 벌, 체크는 linkPref.
    // 단가도 링크와 **같은 규칙**으로 BOM 에 나간다 — WE.library.bomPrice() 참고.
    //
    // ⚠ 예전 부품(체크한 적 없음)은 **국내로 놓는다.** 그때 넣어 둔 link/price 는
    //    국내 쇼핑몰 기준이므로 국내 칸에 담아 보여준다(WE.library.legacyPref).
    //    이러면 저장하는 순간 국내로 자연스럽게 옮겨가고, 넣어 둔 값도 안 사라진다.
    var pref = WE.library.legacyPref(p);
    var 예전 = p.linkPref !== "kr" && p.linkPref !== "global";
    sv("libLink", 예전 ? "" : p.link);
    sv("libLinkKr", 예전 ? (p.linkKr || p.link) : p.linkKr);
    sv("libPrice", moneyText(예전 ? "" : p.price));
    sv("libPriceKr", moneyText(예전 ? (p.priceKr !== "" && p.priceKr != null ? p.priceKr : p.price) : p.priceKr));
    document.getElementById(pref === "kr" ? "libLinkPrefKr" : "libLinkPrefGlobal").checked = true;
    document.getElementById("libRole").value = p.role || "load";
    sv("libVolt", p.volt); sv("libCurrent", p.current); sv("libPower", p.power);
    sv("libAh", p.capacityAh); sv("libDod", p.dod); sv("libMin", p.minPerHour); sv("libEff", p.efficiency);
    _editDatasheets = (p.datasheets || []).map(function (d) { return { id: d.id, name: d.name, type: d.type, data: d.data }; });
    renderDsList();
    updateLibRoleRows();
    document.getElementById("libEditModal").hidden = false;
  }
  // 첨부 이미지를 저장용으로 줄인다 — 캡처한 데이터시트는 대부분 PNG라 원본 그대로 넣으면
  // 라이브러리가 금방 10MB를 넘는다(실측: 부품라이브러리 13.6MB 중 데이터시트 PNG가 8.77MB).
  // 실측 결과 WebP q85에서 용량 85% 절감 · 원본과의 평균 픽셀차 1.05로, 2154x1449 회로도의
  // 핀 이름까지 2배 확대에서 그대로 읽혔다. 부품 사진(bgremove.js)이 쓰는 품질과 같은 값이다.
  // PDF·SVG·움직이는 GIF는 손대지 않고, 변환이 실패하거나 오히려 커지면 원본을 그대로 쓴다.
  var SHRINK_TYPES = { "image/png": 1, "image/jpeg": 1, "image/jpg": 1, "image/bmp": 1 };
  function shrinkAttachment(dataUrl, type, name, done) {
    if (!SHRINK_TYPES[type]) { done(dataUrl, type, name); return; }
    var im = new Image();
    im.onload = function () {
      var w = im.naturalWidth, h = im.naturalHeight;
      // 캔버스 한계를 넘는 큰 이미지는 건드리지 않는다(브라우저마다 상한이 다르다)
      if (!w || !h || w > 8192 || h > 8192) { done(dataUrl, type, name); return; }
      var out;
      try {
        var cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        var cx = cv.getContext("2d");
        cx.imageSmoothingQuality = "high";
        cx.drawImage(im, 0, 0);
        out = cv.toDataURL("image/webp", 0.85);
      } catch (err) { done(dataUrl, type, name); return; }
      // WebP 미지원 브라우저는 PNG를 돌려준다. 줄지 않았으면 바꿀 이유가 없다.
      if (out.indexOf("data:image/webp") !== 0 || out.length >= dataUrl.length) { done(dataUrl, type, name); return; }
      // 내용이 WebP가 됐으니 확장자도 맞춰야 '다운로드'가 올바른 파일을 내놓는다
      done(out, "image/webp", name.replace(/\.[^.]+$/, "") + ".webp");
    };
    im.onerror = function () { done(dataUrl, type, name); };
    im.src = dataUrl;
  }

  // 데이터시트는 **파일**과 **링크** 두 가지다.
  // 링크는 type:"link" 로 두고 data 에 주소를 담는다 — PDF 를 통째로 담으면
  // 저장·게시·백업이 전부 무거워진다(고원빈, 2026-08-30).
  // 사용자가 **링크로 붙인** 데이터시트. 게시·백업이 이 값만 보고 "파일이 아니다"를 판단한다.
  function isDsLink(d) { return !!d && d.type === "link"; }
  // data 가 주소인 것 전부. 링크뿐 아니라 **게시된 파일**(Storage 주소)도 여기 걸린다.
  // ⚠ 이런 건 dataURLtoBlob 이 atob(undefined) 로 터진다 —
  //    공용 부품을 담아서 「보기」를 누르면 예전부터 깨져 있었다. 새 탭으로 보내 같이 고친다.
  function isDsRemote(d) { return !!d && (isDsLink(d) || /^https?:\/\//i.test(String(d.data || ""))); }

  // 데이터시트 편집 목록 렌더
  function renderDsList() {
    var box = document.getElementById("libDsList");
    if (!_editDatasheets.length) { box.innerHTML = WE.i18n.t("<span class='muted'>첨부된 파일 없음</span>"); return; }
    box.innerHTML = _editDatasheets.map(function (d, i) {
      var link = isDsRemote(d);
      var icon = link ? "🔗" : (d.type === "application/pdf" ? "📄" : "🖼️");
      // 링크는 제목 툴팁에 주소를 같이 보여준다 — 어디로 가는지 모르고 누르면 안 된다
      var tip = link ? (d.name + " — " + d.data) : d.name;
      return "<div class='ds-item'><span class='ds-name' title='" + esc(tip) + "'>" + icon + " " + esc(d.name) + "</span>" +
        "<button type='button' class='ds-item-view' data-i='" + i + "'>" + (link ? WE.i18n.t("열기") : WE.i18n.t("보기")) + "</button>" +
        "<button type='button' class='ds-item-del' data-i='" + i + "' title='" + WE.i18n.t("삭제") + "'>×</button></div>";
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
    document.getElementById("libDsAddLink").addEventListener("click", function () {
      var url = (prompt(WE.i18n.t("데이터시트 주소를 붙여넣으세요 (http:// 또는 https://)")) || "").trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) { alert(WE.i18n.t("http:// 또는 https:// 로 시작하는 주소만 넣을 수 있습니다.")); return; }
      // 이름은 주소의 파일명에서 뽑아 기본값으로 준다. 길고 지저분한 주소를 그대로 쓰면 목록이 안 읽힌다
      var guess = "";
      try { guess = decodeURIComponent((url.split("?")[0].split("#")[0].split("/").pop() || "")).slice(0, 60); } catch (_) {}
      var name = (prompt(WE.i18n.t("이 링크의 이름"), guess || WE.i18n.t("데이터시트")) || "").trim() || (guess || WE.i18n.t("데이터시트"));
      _editDatasheets.push({ id: WE.model.nextId("ds"), name: name, type: "link", data: url });
      renderDsList();
    });
    document.getElementById("libDsInput").addEventListener("change", function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      files.forEach(function (f) {
        if (f.size > 20 * 1024 * 1024) { alert(WE.i18n.t("파일이 너무 큽니다(20MB 초과): ") + f.name); return; }
        var reader = new FileReader();
        reader.onload = function () {
          shrinkAttachment(reader.result, f.type || "application/octet-stream", f.name, function (data, type, name) {
            _editDatasheets.push({ id: WE.model.nextId("ds"), name: name, type: type, data: data });
            renderDsList();
          });
        };
        reader.readAsDataURL(f);
      });
      e.target.value = "";   // 같은 파일 다시 선택 가능하게
    });
    document.getElementById("libDsList").addEventListener("click", function (e) {
      var v = e.target.closest(".ds-item-view");
      if (v) {
        var dv = _editDatasheets[+v.dataset.i];
        // 링크는 뷰어에 못 띄운다 — 다른 사이트 문서라 iframe 이 막히는 경우가 많다. 새 탭으로 연다
        if (isDsRemote(dv)) { window.open(dv.data, "_blank", "noopener"); return; }
        openDatasheetViewer(_editDatasheets, gv("libName") || WE.i18n.t("데이터시트"), +v.dataset.i);
        return;
      }
      var d = e.target.closest(".ds-item-del");
      if (d) { _editDatasheets.splice(+d.dataset.i, 1); renderDsList(); }
    });

    document.getElementById("libEditCancel").addEventListener("click", function () {
      document.getElementById("libEditModal").hidden = true; _editLibId = null;
      maybeShowBackupNotice();
    });
    document.getElementById("libEditSave").addEventListener("click", function () {
      if (_editLibId) {
        var newName = gv("libName").trim() || WE.i18n.t("부품");
        var selFolder = gv("libFolderSel") || null;
        setLibLastFolder(selFolder);
        WE.library.updatePart(_editLibId, {
          name: newName, folderId: selFolder,
          spec: gv("libSpec").trim(),
          price: moneyRaw(gv("libPrice")), priceKr: moneyRaw(gv("libPriceKr")),
          link: gv("libLink").trim(), linkKr: gv("libLinkKr").trim(),
          linkPref: document.getElementById("libLinkPrefKr").checked ? "kr" : "global",
          role: gv("libRole"),
          volt: gv("libVolt"), current: gv("libCurrent"), power: gv("libPower"),
          capacityAh: gv("libAh"), dod: gv("libDod"), minPerHour: gv("libMin"), efficiency: gv("libEff"),
          datasheets: _editDatasheets
        });
        // 이미 배치된 부품의 이름표(캔버스 라벨)도 같이 갱신 (전기정보·BOM은 라이브러리를 실시간 참조라 자동 반영됨)
        // 전체 시트 — 다른 시트에 놓인 같은 부품도 이름표가 갱신돼야 한다
        var placed = WE.model.allComponents().filter(function (x) { return x.libraryId === _editLibId; });
        if (placed.length) {
          placed.forEach(function (x) { x.name = newName; });
          WE.render.renderAll();
          refreshProps();
        }
        renderLibrary();
        if (SHOW_POWER_SUMMARY) renderPowerSummary();
        if (_view === "bom") renderBOMView();   // BOM 열려 있으면 갱신
      }
      document.getElementById("libEditModal").hidden = true; _editLibId = null;
      maybeShowBackupNotice();
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
    // 링크 하나만 열려는 것이면 뷰어를 띄우지 않고 바로 새 탭으로 보낸다
    var only = list[startIdx || 0];
    if (isDsRemote(only)) { window.open(only.data, "_blank", "noopener"); return; }
    _dsList = list; _dsIdx = startIdx || 0;
    document.getElementById("dsViewerTitle").textContent = title || WE.i18n.t("데이터시트");
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
    // 링크는 blob 으로 못 만든다(dataURLtoBlob 이 터진다). 탭에서 고르면 새 창으로 보낸다
    if (isDsRemote(d)) {
      document.getElementById("dsZoomBtns").style.display = "none";
      document.getElementById("dsViewerPreview").innerHTML =
        "<p class='muted'>" + esc(d.name) + WE.i18n.t(" — 새 탭에서 열었습니다.</p>");
      window.open(d.data, "_blank", "noopener");
      return;
    }
    _dsUrl = URL.createObjectURL(dataURLtoBlob(d.data, d.type));
    _dsZoom = 1; _dsPanX = 0; _dsPanY = 0;
    var box = document.getElementById("dsViewerPreview");
    var isImg = /^image\/(png|jpe?g|gif|webp|bmp)$/.test(d.type);
    document.getElementById("dsZoomBtns").style.display = isImg ? "" : "none";  // 이미지일 때만 확대버튼
    box.classList.toggle("img-mode", isImg);
    if (d.type === "application/pdf") box.innerHTML = "<iframe src='" + _dsUrl + "' title='" + esc(d.name) + "'></iframe>";
    else if (isImg) { box.innerHTML = "<img class='ds-img' src='" + _dsUrl + "' alt='" + esc(d.name) + "' />"; applyDsTransform(); }
    else box.innerHTML = WE.i18n.t("<p class='muted'>미리보기를 지원하지 않는 형식입니다. 다운로드해서 확인하세요.</p>");
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
      this.textContent = on ? WE.i18n.t("🗗 축소") : WE.i18n.t("⛶ 최대화");
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
      // 편집으로 사라진 단자를 참조하던 배선만 정리.
      // 현재 시트만 본다 — 배선은 자기 시트의 부품만 참조하고,
      // 편집 대상 부품도 현재 시트에 있다. 모든 시트를 훑으면
      // 다른 시트 배선이 "끝점 없음"으로 잘못 판정돼 통째로 지워진다.
      //
      // ⚠ 끝점은 두 종류다 — { componentId, terminalId }(단자) 와 { wireId, x, y }(분기).
      //    wireEndpoint 는 단자만 해석하므로 분기에는 늘 null 을 준다.
      //    예전 코드는 그 null 을 "끝점 없음"으로 읽어 **분기선을 전부 지웠다**.
      //    단자 편집기를 열었다 아무것도 안 고치고 닫기만 해도 사라졌다.
      //    (2026-08-23 사용자 제보로 발견. 재현: _ai/직접확인목록.md E절)
      //
      // 그래서 '단자 끝점인데 그 단자가 없는' 배선만 고른다. 분기는 여기서 판단하지 않는다 —
      // 호스트가 지워지면 removeWire 가 그 위 분기를 연쇄로 정리한다(분기의 분기까지).
      //
      // ⚠ 이 정리는 없애면 안 된다. 단자 편집기의 되돌리기(teApply)가 cmp.terminals 를
      //    통째로 갈아끼워 removeTerminal 을 거치지 않는 단자 제거가 생길 수 있다.
      var 죽은 = WE.model.project.wires.filter(function (w) {
        return [w.from, w.to].some(function (r) {
          return r && !WE.geometry.isBranchRef(r) && !WE.geometry.wireEndpoint(r);
        });
      }).map(function (w) { return w.id; });
      // 미리 id 배열로 뽑아 둔다 — removeWire 가 project.wires 를 갈아끼우므로
      // 배열을 직접 순회하면 건너뛰는 것이 생긴다.
      죽은.forEach(function (id) { WE.model.removeWire(id); });
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
  function applyInstanceImage(c, url, tf, size) {
    var probe = new Image();
    probe.onload = function () {
      var aspect = probe.width > 0 ? probe.height / probe.width : (c.height / c.width);
      var swap = tf && (tf.rotation === 90 || tf.rotation === 270);   // 90/270°는 가로세로가 실제로 뒤바뀜
      c.image = url;
      if (size) {                       // 모달의 '배치 크기' 입력값 우선
        c.width = size.width; c.height = size.height;
      } else {
        if (swap) c.width = Math.max(10, c.height);
        c.height = Math.max(10, Math.round(c.width * aspect));
      }
      (c.terminals || []).forEach(function (t) { transformTerminal(t, tf); });
      makeComponentIndependent(c, true);
      WE.render.renderAll();
    };
    probe.src = url;
  }

  // ---- 부품 라이브러리 ----
  var _placeN = 0;
  // 이미지 파일 → 배경제거 모달 → 라이브러리 저장 → 편집 모달 오픈 (버튼 클릭/드래그앤드롭 공용)
  // 부품 사진이 들어오는 모든 길(＋버튼 · 드래그 · 붙여넣기)이 여기를 지난다 — 제한도 여기 한 곳에만 둔다.
  // 10MB 인 이유: 실제 쓰는 부품 사진이 최대 2.1MB 였고, 폰 사진까지 넉넉히 통과하는 선이다.
  // 저장 용량 때문이 아니다(무엇이 들어와도 긴 변 800px·WebP 로 줄어 40~90KB 가 된다).
  // 막으려는 건 디코드 순간에 잠깐 크게 잡히는 메모리다. 다만 파일 크기와 그 메모리는 비례하지 않아
  // (3MB 사진이 183MB 를 쓰기도 한다) 이 검사는 극단만 거르는 1차 방어이고,
  // 실제 한계는 bgremove 의 onerror 가 잡는다.
  var MAX_IMG_BYTES = 10 * 1024 * 1024;

  // 이미 있는 이름이면 뒤에 _01, _02 를 붙여 겹치지 않게 한다(배선도 시트 이름과 같은 규칙).
  // 파일에서 온 이름이 겹치는 건 사용자가 같은 이름을 쓴 것이니 '덮어쓸까요?' 를 묻는 게 맞다.
  // 하지만 붙여넣기처럼 **우리가 지어 준 이름**이 겹치는 건 우리 탓이다 —
  // 캡처를 연달아 붙여넣으면 매번 확인창이 뜨고, 무심코 [확인] 을 누르면 앞서 넣은 부품이 사라진다.
  function uniquePartName(base) {
    if (!WE.library.findByName(base)) return base;
    for (var n = 1; n < 1000; n++) {
      var cand = base + "_" + (n < 10 ? "0" + n : String(n));
      if (!WE.library.findByName(cand)) return cand;
    }
    return base + "_" + Date.now().toString(36);
  }
  function addImageFileToLibrary(file, fallbackName) {
    if (!file || file.type.indexOf("image/") !== 0) return;
    if (file.size > MAX_IMG_BYTES) {
      // 힌트바에만 띄우면 작업 중에는 눈에 안 들어와 "왜 안 되지?" 로 남는다 — 가운데서 한 번 막고 알린다.
      // 필요한 건 '무엇을 하면 되는가' 하나뿐이다. 지금 몇 MB 인지도 결국 사용자가 할 일을 바꾸지 않는다.
      notice(WE.i18n.t("이미지가 너무 큽니다"), WE.i18n.t("파일 용량을 줄여 주세요 (10MB 이내)."));
      return;
    }
    // 클립보드에서 온 파일은 이름이 "image.png" 같은 껍데기라 부품 이름으로 쓸 게 못 된다.
    // 그럴 땐 알아볼 수 있는 기본 이름을 주고, 바로 열리는 편집 모달에서 고치게 한다.
    var name = String(file.name || "").replace(/\.[^.]+$/, "");
    if (fallbackName && (!name || /^(image|clipboard|캡처|screenshot)$/i.test(name))) name = uniquePartName(fallbackName);
    var reader = new FileReader();
    reader.onload = function (ev) {
      WE.bgremove.open(ev.target.result, function (url, tf, size) {
        var probe = new Image();
        probe.onload = function () {
          // 모달의 '배치 크기' 입력값 우선, 없으면 기존 규칙(긴 변 160px)
          var w, h;
          if (size) { w = size.width; h = size.height; }
          else {
            var maxSide = 160, r = probe.width / probe.height;
            w = probe.width; h = probe.height;
            if (w >= h) { w = maxSide; h = Math.round(maxSide / r); } else { h = maxSide; w = Math.round(maxSide * r); }
          }
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
      a.href = URL.createObjectURL(blob); a.download = WE.i18n.t("부품라이브러리.ezclib");
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
          setHint(WE.i18n.t("라이브러리 불러오기: 새 부품 ") + r.added + WE.i18n.t("개") +
            (r.updated ? (WE.i18n.t(" · 기존 부품 ") + r.updated + WE.i18n.t("개 갱신")) : "") +
            (relinked ? (WE.i18n.t(" · 배치 부품 ") + relinked + WE.i18n.t("개 재연결")) : ""));
        } catch (err) { alert(WE.i18n.t("가져오기 실패: ") + err.message); }
      };
      reader.readAsText(file); e.target.value = "";
    });

    bindLibraryDnD();

    // 새 폴더 (대분류)
    document.getElementById("btnFolderCollapse").addEventListener("click", toggleAllFolders);
    document.getElementById("btnFolderAdd").addEventListener("click", function () {
      var name = prompt(WE.i18n.t("새 폴더 이름 (예: 센서류, MCU)"));
      if (name == null) return;
      name = name.trim(); if (!name) return;
      WE.library.addFolder(name, null);
      renderLibrary();
    });

    document.getElementById("libList").addEventListener("click", function (e) {
      // 폴더 헤더: 접기/펼치기 · 이름변경 · 하위폴더 · 삭제
      var fh = e.target.closest(".lib-folder");
      if (fh) {
        var fid = fh.dataset.fid;
        if (fid.indexOf("__") === 0) {   // 가상 섹션: 최근사용 개수 조절 + 접기/펼치기
          if (e.target.closest(".lib-f-minus")) { setLibRecentCount(libRecentCount() - 1); renderLibrary(); return; }
          if (e.target.closest(".lib-f-plus")) { setLibRecentCount(libRecentCount() + 1); renderLibrary(); return; }
          toggleVfCollapsed(fid); renderLibrary(); return;
        }
        var folder = WE.library.getFolder(fid); if (!folder) return;
        if (e.target.closest(".lib-f-ren")) {
          var nn = prompt(WE.i18n.t("폴더 이름"), folder.name);
          if (nn != null && nn.trim()) { WE.library.renameFolder(fid, nn.trim()); renderLibrary(); }
          return;
        }
        if (e.target.closest(".lib-f-sub")) {
          var sn = prompt(WE.i18n.t("하위 폴더 이름 (예: 온도센서)"));
          if (sn != null && sn.trim()) { WE.library.addFolder(sn.trim(), fid); renderLibrary(); }
          return;
        }
        if (e.target.closest(".lib-f-del")) {
          if (confirm("‘" + folder.name + WE.i18n.t("’ 폴더를 삭제할까요?\n(부품은 삭제되지 않고 상위/미분류로 이동합니다)"))) {
            WE.library.removeFolder(fid); renderLibrary();
          }
          return;
        }
        WE.library.toggleFolder(fid); renderLibrary();
        return;
      }
      var item = e.target.closest(".lib-item"); if (!item) return;
      var part = WE.library.get(item.dataset.id); if (!part) return;
      if (e.target.closest(".lib-del")) {
        if (confirm("‘" + part.name + WE.i18n.t("’ 부품을 라이브러리에서 삭제할까요?"))) {
          WE.library.remove(part.id); renderLibrary();
        }
        return;
      }
      if (e.target.closest(".lib-fav")) { WE.library.toggleFav(part.id); renderLibrary(); return; }
      if (e.target.closest(".lib-edit")) { openLibEdit(part.id); return; }
      // 클릭 → 캔버스에 배치
      placeLibraryPart(part);
    });
    // 검색: 입력 즉시 필터링
    document.getElementById("libSearch").addEventListener("input", function (e) {
      _libQuery = e.target.value.trim().toLowerCase();
      renderLibrary();
    });
  }

  // 좌측 내 라이브러리와 공용 부품 검색이 같은 배치 경로를 쓴다.
  // 한쪽만 따로 구현하면 무료 한도·최근 사용·선택 갱신이 쉽게 어긋난다.
  function placeLibraryPart(part) {
    if (!part) return null;
    _placeN = (_placeN + 1) % 8;
    var opts = WE.library.instanceOpts(part, 180 + _placeN * 24, 150 + _placeN * 24);
    var cmp = WE.model.addComponent(opts);
    // 무료 한도에 걸리면 null 이 온다 — 안내는 addComponent 안에서 이미 띄웠다.
    if (!cmp) return null;
    trackOnce("place_component");
    WE.model.select("component", cmp.id);
    touchLibRecent(part.id);
    renderLibrary();
    WE.render.renderAll(); refreshProps();
    return cmp;
  }

  /* 관리자 페이지 「사용자 부품」의 [에디터에 배치] — 같은 브라우저의 localStorage 우편함(we_admin_inbox)으로 넘어온다.
     (관리자 페이지에는 캔버스가 없어서 이렇게 건넨다. 2026-09-15)
     시작이 끝난 뒤 한 번 읽고 바로 지운다. 무슨 오류가 나도 에디터 시작을 막지 않는다. */
  function applyAdminInbox() {
    var raw = null;
    try { raw = localStorage.getItem("we_admin_inbox"); } catch (e) { return; }
    if (!raw) return;
    try { localStorage.removeItem("we_admin_inbox"); } catch (e) { /* 무시 */ }
    try {
      var box = JSON.parse(raw);
      if (!box || !Array.isArray(box.parts) || Date.now() - (box.at || 0) > 10 * 60 * 1000) return;   // 10분 지난 우편은 버린다
      var n = 0;
      box.parts.forEach(function (p) {
        if (!p || !p.name) return;
        var part = WE.library.addPart({
          name: p.name, spec: p.spec || "", image: p.image || "",
          defaultWidth: p.defaultWidth || p.width, defaultHeight: p.defaultHeight || p.height,
          terminals: p.terminals || [], terminalPlacementQueue: p.terminalPlacementQueue, terminalPlacementQueueVersion: p.terminalPlacementQueueVersion,
          link: p.link, linkKr: p.linkKr, linkPref: p.linkPref, price: p.price, priceKr: p.priceKr, datasheets: p.datasheets || [],
          role: p.role, volt: p.volt, current: p.current, power: p.power
        });
        if (part && placeLibraryPart(part)) n++;
      });
      if (n) setHint(WE.i18n.t("관리자 페이지에서 보낸 부품 ") + n + WE.i18n.t("개를 라이브러리에 넣고 배치했습니다."));
    } catch (e) { try { console.warn("[inbox] 관리자 우편함 처리 실패", e && e.message); } catch (x) { /* 무시 */ } }
  }

  function componentPart(c) {
    if (!c) return null;
    return (c.libraryId && WE.library.get(c.libraryId)) || c.publicSnapshot || null;
  }

  // 라이브러리 드래그: 부품 순서 변경 + 폴더 이동
  // - 폴더 헤더 위에 놓으면 그 폴더로 이동 (미분류 헤더 = 폴더 해제)
  // - 폴더 본문/목록 사이에 놓으면 그 위치로 순서 변경 (다른 폴더 본문이면 이동 겸)
  // - 즐겨찾기·최근사용 가상 섹션 본문은 자동 정렬이라 드롭 대상에서 제외
  function bindLibraryDnD() {
    var list = document.getElementById("libList");
    var dragId = null;        // 드래그 중인 부품 id
    var dragFolderId = null;  // 드래그 중인 폴더 id
    var indicator = document.createElement("div");
    indicator.className = "lib-drop-line";

    // 가장자리 자동 스크롤: 드래그 중 목록 상/하단 40px 안이면 스크롤 (가까울수록 빠르게)
    // 드래그 중엔 휠 이벤트가 안 들어오므로 rAF 루프로 대신함
    var _autoDir = 0, _autoSpeed = 0, _autoRaf = null;
    function autoScrollStep() {
      if (_autoDir) {
        list.scrollTop += _autoDir * _autoSpeed;
        _autoRaf = requestAnimationFrame(autoScrollStep);
      } else _autoRaf = null;
    }
    function updateAutoScroll(y) {
      var r = list.getBoundingClientRect(), Z = 40;
      if (y < r.top + Z) { _autoDir = -1; _autoSpeed = Math.min(16, Math.ceil((r.top + Z - y) / 3)); }
      else if (y > r.bottom - Z) { _autoDir = 1; _autoSpeed = Math.min(16, Math.ceil((y - (r.bottom - Z)) / 3)); }
      else _autoDir = 0;
      if (_autoDir && !_autoRaf) autoScrollStep();
    }
    function stopAutoScroll() { _autoDir = 0; }

    // container 직속 부품 카드 중, y 아래에 오는 첫 카드
    function afterElement(container, y) {
      var items = [].filter.call(container.children, function (c) {
        return c.classList && c.classList.contains("lib-item") && !c.classList.contains("dragging");
      });
      var closest = { offset: -Infinity, el: null };
      items.forEach(function (child) {
        var box = child.getBoundingClientRect();
        var offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) closest = { offset: offset, el: child };
      });
      return closest.el;
    }
    function clearInd() { if (indicator.parentNode) indicator.parentNode.removeChild(indicator); }
    function clearFolderHl() {
      var h = list.querySelector(".lib-folder.drop-into");
      if (h) h.classList.remove("drop-into");
    }
    // 드롭 지점 해석 → { folderHeader } 또는 { container }
    function dropTarget(e) {
      var fh = e.target.closest(".lib-folder");
      if (fh) {
        var fid = fh.dataset.fid;
        // 실제 폴더 또는 미분류(드롭 허용 표시)만 대상
        if (fid.indexOf("__") !== 0 || fh.dataset.drop) return { header: fh, fid: fid };
        return null;
      }
      var body = e.target.closest(".lib-folder-body");
      if (body) {
        var bfid = body.dataset.fid;
        if (bfid === "__fav" || bfid === "__recent") return null;   // 자동 정렬 섹션
        return { container: body, fid: bfid };
      }
      if (e.target === list || e.target.closest("#libList")) return { container: list, fid: null };
      return null;
    }

    // 드래그 중인 폴더와 같은 계층(같은 부모)의 폴더 헤더 중, y 아래에 오는 첫 헤더
    function afterSiblingFolder(y) {
      var me = WE.library.getFolder(dragFolderId); if (!me) return null;
      var headers = [].filter.call(list.querySelectorAll(".lib-folder:not(.dragging)"), function (h) {
        var f = h.dataset.fid.indexOf("__") === 0 ? null : WE.library.getFolder(h.dataset.fid);
        return f && (f.parentId || null) === (me.parentId || null);
      });
      var closest = { offset: -Infinity, el: null };
      headers.forEach(function (h) {
        var box = h.getBoundingClientRect();
        var offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) closest = { offset: offset, el: h };
      });
      return closest.el;
    }

    list.addEventListener("dragstart", function (e) {
      var item = e.target.closest(".lib-item");
      if (item) {
        dragId = item.dataset.id;
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", dragId); } catch (_) {}
        setTimeout(function () { item.classList.add("dragging"); }, 0);
        return;
      }
      var fh = e.target.closest(".lib-folder");
      if (fh && fh.dataset.fid.indexOf("__") !== 0) {
        dragFolderId = fh.dataset.fid;
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", "folder:" + dragFolderId); } catch (_) {}
        setTimeout(function () { fh.classList.add("dragging"); }, 0);
      }
    });
    list.addEventListener("dragover", function (e) {
      // 폴더 드래그: 같은 계층 폴더 사이 순서 변경
      if (dragFolderId != null) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        updateAutoScroll(e.clientY);
        var afterF = afterSiblingFolder(e.clientY);
        if (afterF) afterF.parentNode.insertBefore(indicator, afterF);
        else { clearInd(); }   // 맨 끝 이동은 드롭 시 처리 (아래 빈 곳)
        return;
      }
      if (dragId == null) return;
      updateAutoScroll(e.clientY);
      var t = dropTarget(e);
      if (!t) { clearInd(); clearFolderHl(); return; }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (t.header) {
        clearInd(); clearFolderHl();
        t.header.classList.add("drop-into");
      } else {
        clearFolderHl();
        var after = afterElement(t.container, e.clientY);
        if (after) t.container.insertBefore(indicator, after);
        else t.container.appendChild(indicator);
      }
    });
    list.addEventListener("drop", function (e) {
      stopAutoScroll();
      if (dragFolderId != null) {
        e.preventDefault();
        var afterF = afterSiblingFolder(e.clientY);
        WE.library.reorderFolderBefore(dragFolderId, afterF ? afterF.dataset.fid : null);
        clearInd(); dragFolderId = null;
        renderLibrary();
        return;
      }
      if (dragId == null) return;
      var t = dropTarget(e);
      clearInd(); clearFolderHl();
      if (!t) { dragId = null; return; }
      e.preventDefault();
      var part = WE.library.get(dragId);
      if (part) {
        if (t.header) {
          // 폴더 헤더에 드롭 → 그 폴더로 이동 (미분류면 해제)
          var hfid = t.fid === "__none" ? null : t.fid;
          WE.library.movePart(dragId, hfid);
          setLibLastFolder(hfid);
        } else {
          // 본문에 드롭 → 폴더가 다르면 이동, 위치까지 반영
          var destFid = t.fid === "__none" ? null : t.fid;
          if ((part.folderId || null) !== destFid) { WE.library.movePart(dragId, destFid); setLibLastFolder(destFid); }
          var after = afterElement(t.container, e.clientY);
          WE.library.reorderBefore(dragId, after ? after.dataset.id : null);
        }
      }
      dragId = null;
      renderLibrary();
    });
    list.addEventListener("dragend", function () {
      stopAutoScroll();
      clearInd(); clearFolderHl(); dragId = null; dragFolderId = null;
      var d = list.querySelector(".dragging"); if (d) d.classList.remove("dragging");
    });
  }

  // ---- 라이브러리 검색/최근 사용 ----
  var _libQuery = "";
  function libRecentMap() {
    try { return JSON.parse(localStorage.getItem("we_libRecent") || "{}"); } catch (e) { return {}; }
  }
  // 🕘 최근 사용 섹션 표시 개수 (0~20, 0이면 헤더만 남기고 목록 숨김)
  var LIB_RECENT_DEFAULT = 8, LIB_RECENT_MAX = 20;
  function libRecentCount() {
    var n = LIB_RECENT_DEFAULT;
    try {
      var v = localStorage.getItem("we_libRecentCount");
      if (v != null && v !== "" && !isNaN(+v)) n = +v;
    } catch (e) { /* 무시 */ }
    return Math.max(0, Math.min(LIB_RECENT_MAX, Math.round(n)));
  }
  function setLibRecentCount(n) {
    n = Math.max(0, Math.min(LIB_RECENT_MAX, Math.round(n)));
    try { localStorage.setItem("we_libRecentCount", String(n)); } catch (e) { /* 무시 */ }
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

  // 부품 카드 한 장 생성 (pathText: 검색 결과에서 소속 폴더 경로 뱃지)
  function buildPartItem(part, q, pathText) {
    var item = document.createElement("div");
    item.className = "lib-item" + (part.fav ? " fav" : ""); item.dataset.id = part.id;
    item.setAttribute("draggable", "true");
    item.title = WE.i18n.t("클릭: 캔버스에 배치 · 드래그: 순서 변경/폴더 이동");
    var fav = document.createElement("button");
    fav.className = "lib-fav" + (part.fav ? " on" : "");
    fav.textContent = part.fav ? "★" : "☆";
    fav.title = part.fav ? WE.i18n.t("즐겨찾기 해제") : WE.i18n.t("즐겨찾기");
    item.appendChild(fav);
    var thumbWrap = document.createElement("div"); thumbWrap.className = "lib-thumb-wrap";
    var thumb = document.createElement(part.image ? "img" : "div");
    thumb.className = "lib-thumb";
    if (part.image) thumb.src = part.image;
    thumbWrap.appendChild(thumb);
    if (part.link || part.linkKr) {   // 국내·해외 어느 쪽이든 있으면 사슬 배지를 붙인다
      /* ⚠ 예전에는 🔗 이모지였다. 배지가 15px 라 이모지가 뭉개져 무슨 그림인지 안 보였고,
         OS 마다 다르게 그려졌다. SVG 로 바꾼다 (2026-09-10). 겉모습은 styles.css 의 .lib-haslink. */
      var lk = document.createElement("span"); lk.className = "lib-haslink";
      lk.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
        '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
      lk.title = WE.i18n.t("구매 링크 있음");
      thumbWrap.appendChild(lk);
    }
    var info = document.createElement("div"); info.className = "lib-info";
    var nm = document.createElement("div"); nm.className = "lib-name";
    nm.innerHTML = hlHtml(part.name, q);
    /* 두 줄로 늘려도 아주 긴 이름은 잘린다. 그때 전체를 볼 길을 남긴다. (2026-09-10)
       ⚠ 툴팁은 **안쪽 것이 이긴다** — 이름 위에서는 행 툴팁("클릭: 캔버스에 배치 …")
          대신 이것이 뜬다. 고원빈 확정: 이름 칸에서는 이름을 보여 준다. */
    nm.title = part.name;
    info.appendChild(nm);
    if (part.spec) {
      var meta = document.createElement("div"); meta.className = "lib-meta";
      meta.innerHTML = hlHtml(part.spec, q);
      info.appendChild(meta);
    }
    if (pathText) {
      var pb = document.createElement("div"); pb.className = "lib-path";
      pb.textContent = "📁 " + pathText;
      info.appendChild(pb);
    }
    var edit = document.createElement("button"); edit.className = "lib-edit"; edit.textContent = "✎"; edit.title = WE.i18n.t("정보/구매링크 편집");
    var del = document.createElement("button"); del.className = "lib-del"; del.textContent = "×"; del.title = WE.i18n.t("삭제");
    item.appendChild(thumbWrap); item.appendChild(info); item.appendChild(edit); item.appendChild(del);
    return item;
  }

  // 부품이 속한 폴더 경로 문구 ("대분류 > 소분류")
  function folderPathText(part) {
    var f = part.folderId ? WE.library.getFolder(part.folderId) : null;
    if (!f) return "";
    var pf = f.parentId ? WE.library.getFolder(f.parentId) : null;
    return pf ? pf.name + " > " + f.name : f.name;
  }

  // 가상 섹션(즐겨찾기·최근사용·미분류) 접힘 상태 — 실제 폴더와 달리 localStorage에 보관
  function vfCollapsedMap() {
    try { return JSON.parse(localStorage.getItem("we_libVfCollapse") || "{}"); } catch (e) { return {}; }
  }
  function toggleVfCollapsed(id) {
    var m = vfCollapsedMap(); m[id] = !m[id];
    try { localStorage.setItem("we_libVfCollapse", JSON.stringify(m)); } catch (e) { /* 무시 */ }
  }
  var VF_IDS = ["__fav", "__recent", "__none"];
  function setAllVfCollapsed(v) {
    var m = vfCollapsedMap();
    VF_IDS.forEach(function (id) { m[id] = !!v; });
    try { localStorage.setItem("we_libVfCollapse", JSON.stringify(m)); } catch (e) { /* 무시 */ }
  }

  // ---- 폴더 전체 접기/펼치기 (Shift+C) ----
  // 폴더가 많아지면 하나씩 누르기 힘들다. 하나라도 펼쳐져 있으면 전부 접고,
  // 이미 다 접혀 있으면 전부 펼친다(같은 키로 되돌릴 수 있게).
  //
  // 판정은 화면(DOM)이 아니라 데이터로 한다 — 검색 중에는 폴더 헤더가 아예 안 그려져
  // DOM을 보면 "펼쳐진 게 없다"고 잘못 읽는다.
  function allFoldersCollapsed() {
    if (!WE.library.allCollapsed()) return false;
    var m = vfCollapsedMap();
    for (var i = 0; i < VF_IDS.length; i++) if (!m[VF_IDS[i]]) return false;
    return true;
  }
  function toggleAllFolders() {
    var collapse = !allFoldersCollapsed();
    WE.library.setAllCollapsed(collapse);
    setAllVfCollapsed(collapse);      // 보이지 않는 섹션까지 함께 맞춰야 다음 누름에 토글이 성립한다
    renderLibrary();
    setHint(collapse ? WE.i18n.t("폴더를 모두 접었습니다.") : WE.i18n.t("폴더를 모두 펼쳤습니다."));
  }

  // 폴더 헤더 한 줄 생성. fid: 실제 폴더 id 또는 "__fav"/"__recent"/"__none"
  function buildFolderHeader(fid, icon, name, count, collapsed, depth, isVirtual) {
    var h = document.createElement("div");
    h.className = "lib-folder" + (depth ? " sub" : "") + (isVirtual ? " virtual" : "") + (collapsed ? " collapsed" : "");
    h.dataset.fid = fid;
    if (!isVirtual) {
      h.setAttribute("draggable", "true");
      h.title = WE.i18n.t("클릭: 접기/펼치기 · 드래그: 순서 변경");
    }
    var arrow = document.createElement("span"); arrow.className = "lib-f-arrow"; arrow.textContent = collapsed ? "▸" : "▾";
    var nm = document.createElement("span"); nm.className = "lib-f-name"; nm.textContent = icon + " " + name;
    var cnt = document.createElement("span"); cnt.className = "lib-f-count"; cnt.textContent = count;
    h.appendChild(arrow); h.appendChild(nm); h.appendChild(cnt);
    if (!isVirtual) {
      var ren = document.createElement("button"); ren.className = "lib-f-btn lib-f-ren"; ren.textContent = "✎"; ren.title = WE.i18n.t("폴더 이름 변경");
      h.appendChild(ren);
      if (!depth) {   // 하위 폴더 추가는 대분류에서만 (2단계 제한)
        var add = document.createElement("button"); add.className = "lib-f-btn lib-f-sub"; add.textContent = "＋"; add.title = WE.i18n.t("하위 폴더 추가");
        h.appendChild(add);
      }
      var del = document.createElement("button"); del.className = "lib-f-btn lib-f-del"; del.textContent = "×"; del.title = WE.i18n.t("폴더 삭제 (부품은 남음)");
      h.appendChild(del);
    }
    return h;
  }

  // 실제 폴더 렌더 (하위 폴더 → 직속 부품 순)
  function renderFolder(list, folder, depth, byFolder) {
    var subs = WE.library.getFolders().filter(function (f) { return f.parentId === folder.id; });
    var own = byFolder[folder.id] || [];
    var count = own.length;
    subs.forEach(function (s) { count += (byFolder[s.id] || []).length; });
    list.appendChild(buildFolderHeader(folder.id, "📁", folder.name, count, folder.collapsed, depth, false));
    if (folder.collapsed) return;   // 접힌 폴더 내용은 렌더 자체를 생략 (부품 많아도 가벼움)
    var body = document.createElement("div");
    body.className = "lib-folder-body" + (depth ? " sub" : "");
    body.dataset.fid = folder.id;
    // 직속 부품을 먼저, 하위 폴더는 그 뒤에 — 부품이 항상 자기 폴더 헤더 바로 밑에 붙어
    // "어느 폴더 소속인지" 경계가 헷갈리지 않게 함
    own.forEach(function (p) { body.appendChild(buildPartItem(p, "", "")); });
    subs.forEach(function (s) { renderFolder(body, s, depth + 1, byFolder); });
    if (!subs.length && !own.length) {
      var e = document.createElement("p"); e.className = "muted lib-f-empty";
      e.textContent = WE.i18n.t("비어 있음 — 부품을 끌어다 놓으세요");
      body.appendChild(e);
    }
    list.appendChild(body);
  }

  // 가상 섹션 렌더 (즐겨찾기/최근사용/미분류)
  function renderVirtualSection(list, fid, icon, name, sectionParts, droppable) {
    var collapsed = !!vfCollapsedMap()[fid];
    var h = buildFolderHeader(fid, icon, name, sectionParts.length, collapsed, 0, true);
    if (droppable) h.dataset.drop = "1";   // 미분류: 드롭으로 폴더 해제 허용
    if (fid === "__recent") {
      // 표시 개수 −/＋ 스텝퍼 (hover 시 표시 — 폴더 헤더 버튼과 같은 문법)
      var n = libRecentCount();
      var minus = document.createElement("button");
      minus.className = "lib-f-btn lib-f-minus"; minus.textContent = "−";
      minus.title = WE.i18n.t("표시 개수 줄이기 (0이면 목록 숨김)");
      minus.disabled = n <= 0;
      var plus = document.createElement("button");
      plus.className = "lib-f-btn lib-f-plus"; plus.textContent = "＋";
      plus.title = WE.i18n.t("표시 개수 늘리기");
      plus.disabled = n >= LIB_RECENT_MAX;
      h.appendChild(minus); h.appendChild(plus);
    }
    list.appendChild(h);
    if (collapsed) return;
    if (fid === "__recent" && !libRecentCount()) return;   // 0개: 헤더만 남기고 목록 숨김
    var body = document.createElement("div");
    body.className = "lib-folder-body virtual"; body.dataset.fid = fid;
    sectionParts.forEach(function (p) { body.appendChild(buildPartItem(p, "", "")); });
    list.appendChild(body);
  }

  function renderLibrary() {
    var list = document.getElementById("libList");
    list.innerHTML = "";
    var parts = WE.library.getAll();
    var folders = WE.library.getFolders();
    if (!parts.length && !folders.length) {
      var p = document.createElement("p");
      p.className = "muted"; p.textContent = WE.i18n.t("등록된 부품이 없습니다.");
      list.appendChild(p); return;
    }
    var q = _libQuery;
    var recent = libRecentMap();

    // ---- 검색 중: 폴더 무시하고 평면 결과 + 소속 폴더 경로 뱃지 ----
    if (q) {
      var shown = parts.filter(function (part) {
        return (part.name || "").toLowerCase().indexOf(q) >= 0 ||
               (part.spec || "").toLowerCase().indexOf(q) >= 0;
      });
      if (!shown.length) {
        var np = document.createElement("p");
        np.className = "muted"; np.textContent = "'" + q + WE.i18n.t("' 검색 결과가 없습니다.");
        list.appendChild(np); return;
      }
      shown.sort(function (a, b) {
        var f = (b.fav ? 1 : 0) - (a.fav ? 1 : 0);
        if (f) return f;
        return (recent[b.id] || 0) - (recent[a.id] || 0);
      });
      shown.forEach(function (part) { list.appendChild(buildPartItem(part, q, folderPathText(part))); });
      return;
    }

    // ---- 폴더가 하나도 없으면 기존 그대로: 단일 리스트 (★ → 최근 사용 순) ----
    if (!folders.length) {
      var flat = parts.slice().sort(function (a, b) {
        var f = (b.fav ? 1 : 0) - (a.fav ? 1 : 0);
        if (f) return f;
        return (recent[b.id] || 0) - (recent[a.id] || 0);
      });
      flat.forEach(function (part) { list.appendChild(buildPartItem(part, "", "")); });
      return;
    }

    // ---- 폴더 뷰 ----
    function byRecent(a, b) { return (recent[b.id] || 0) - (recent[a.id] || 0); }
    var favs = parts.filter(function (p) { return p.fav; }).sort(byRecent);
    if (favs.length) renderVirtualSection(list, "__fav", "★", WE.i18n.t("즐겨찾기"), favs, false);
    var rn = libRecentCount();
    var recents = parts.filter(function (p) { return recent[p.id]; }).sort(byRecent).slice(0, rn);
    // 개수를 0으로 줄인 경우엔 헤더만 남겨 ＋로 되살릴 수 있게 함
    if (recents.length || rn === 0) renderVirtualSection(list, "__recent", "🕘", WE.i18n.t("최근 사용"), recents, false);
    if (favs.length || recents.length || rn === 0) {
      var hr = document.createElement("div"); hr.className = "lib-divider";
      list.appendChild(hr);
    }

    // 폴더별 부품 분류 (없는 폴더를 가리키면 미분류)
    var byFolder = {}, unfiled = [];
    parts.forEach(function (p) {
      if (p.folderId && WE.library.getFolder(p.folderId)) {
        (byFolder[p.folderId] = byFolder[p.folderId] || []).push(p);
      } else unfiled.push(p);
    });
    folders.forEach(function (f) {
      if (!f.parentId) renderFolder(list, f, 0, byFolder);
    });
    if (unfiled.length) renderVirtualSection(list, "__none", "📦", WE.i18n.t("미분류"), unfiled, true);
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
    // 자재 발주는 프로젝트 단위 → 모든 시트의 부품을 합산한다(사용자 확정 2026-08-08)
    WE.model.allComponents().forEach(function (c) {
      var lib = componentPart(c);
      var key = WE.model.cmpGroupKey(c);   // 집계 기준은 model 한 곳에 (부품 번호와 같은 기준이어야 한다)
      if (!map[key]) {
        // 부품 기본 단가 — 부품 정보에서 체크한 쪽(기본 해외). WE.library.bomPrice() 가 그 규칙을 갖는다.
        // 링크는 해외인데 단가는 국내 것이 나가면 BOM 이 앞뒤가 안 맞는다.
        var basePrice = lib ? (WE.library.bomPrice(lib) || "") : (c.bomPrice || "");
        var ov = WE.model.project.bomPrice ? WE.model.project.bomPrice[key] : undefined;
        // BOM 은 사용자의 작업물이다. 표에서 고친 값(project.bomEdit)이 부품 기본값보다 항상 우선한다.
        // 예전 프로젝트는 그 값이 부품 인스턴스(c.bomName/bomSpec/bomLink)에 남아 있으므로 같이 읽는다 —
        // 안 읽으면 예전에 고쳐 둔 품명·구매처가 사라진다.
        var ed = (WE.model.project.bomEdit && WE.model.project.bomEdit[key]) || {};
        function edited(field, legacy, base) {
          if (ed[field] != null) return { v: ed[field], on: true };
          if (legacy != null) return { v: legacy, on: true };
          return { v: base, on: false };
        }
        var baseName = lib ? lib.name : c.name;
        var baseSpec = lib ? (lib.spec || "") : "";
        // 부품 기본 구매링크 — 부품 정보에서 체크한 쪽(기본 해외). WE.library.bomLink() 가 그 규칙을 갖는다.
        var baseLink = lib ? WE.library.bomLink(lib) : "";
        var eName = edited("name", c.bomName, baseName);
        var eSpec = edited("spec", c.bomSpec, baseSpec);
        var eLink = edited("link", c.bomLink, baseLink);
        map[key] = {
          key: key, libraryId: c.libraryId || null, publicId: c.publicId || null,
          name: eName.v, qty: 0, spec: eSpec.v, link: eLink.v,
          baseName: baseName, baseSpec: baseSpec, baseLink: baseLink,
          nameEdited: eName.on, specEdited: eSpec.on, linkEdited: eLink.on,
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
    if ((lib.role || "load") === "load" && n(lib.minPerHour) && n(lib.minPerHour) !== 60) a.push(WE.i18n.t("가동 ") + n(lib.minPerHour) + WE.i18n.t("분/시간"));
    if (lib.role === "battery" && n(lib.capacityAh)) a.push(n(lib.capacityAh) + "Ah");
    return a.join(" · ");
  }

  /* 결선표 노출 여부.
     예전에는 "라벨 붙은 배선만" 담아 목록이 거의 비어서 꺼 두었다.
     지금은 넷 묶음(netListData)으로 바꿔 라벨 없이도 전부 나온다 — 그래서 켠다. */
  var SHOW_WIRE_LIST = true;   // 결선표(넷 묶음)로 되살렸다 (2026-09-03)
  // 전력/배터리 요약은 계산이 아직 불안정해 화면·인쇄에서 모두 감춰 둔다(사용자 확정 2026-08-10).
  // 기능 자체는 코드로 살려 둔다 — 다시 켤 땐 이 값만 true 로.
  var SHOW_POWER_SUMMARY = false;

  // ---- BOM 표 뷰(하단 탭) ----
  var _view = "wiring";
  function setActiveTab(view) {
    var tabs = document.querySelectorAll("#viewTabs > .view-tab");
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("active", tabs[i].dataset.view === view);
    // 시트 탭은 '배선도를 보고 있을 때'만 활성으로 보인다
    var cur = WE.model.getActiveSheetId();
    document.querySelectorAll("#sheetTabs .sheet-tab").forEach(function (b) {
      b.classList.toggle("active", view === "wiring" && b.dataset.sid === cur);
    });
  }

  // ---- 복사 / 붙여넣기 (Ctrl+C · Ctrl+V) ----
  // 목적은 하나다: **작업해 둔 것을 그대로 다른 배선도로 가져오기.**
  // 그래서 복사한 내용은 손대지 않는다 — 라벨(W번호)·색·굵기·AWG 전부 원본 그대로 붙는다.
  // 클립보드는 앱 안에서만 도는 변수다. 시스템 클립보드에 넣으면 다른 앱에서 Ctrl+V 했을 때
  // JSON 덩어리가 튀어나오고 권한 처리가 붙는다 — 필요해지면 그때 얹는다.
  var _clip = null;   // { sheetId, data:{components,wires,annotations} }
  // ---- 클립보드 붙여넣기 (Ctrl+V) ----
  // 화면을 캡처하면(Win+Shift+S 등) 파일로 저장하기 전에 이미 클립보드에 이미지가 들어 있다.
  // 그래서 '캡처 → 파일 저장 → 드래그' 세 단계 중 가운데 단계는 우리가 파일을 요구해서 생긴 것이다.
  // 붙여넣기를 받으면 그 단계가 사라진다. 들어온 이미지는 파일로 넣었을 때와 똑같은 길을 탄다
  // (배경제거 모달 → 라이브러리 저장 → 편집 모달). WebP 변환도 그 길에서 자동으로 걸린다.
  //
  // keydown 이 아니라 paste 이벤트로 받는 이유: 클립보드 내용은 이 이벤트에서만 직접 볼 수 있다.
  // 그래서 '이미지냐 부품이냐'를 한 곳에서 판단할 수 있고, 두 번 처리될 일이 없다.
  //
  // 둘 중 무엇이 더 최근인가 — 시각을 재서는 풀 수 없다. 시스템 클립보드에 이미지가 '언제' 들어왔는지
  // 알 방법이 없기 때문이다. (그렇게 만들었다가, 한 번 Ctrl+C 하면 그 뒤로 이미지 붙여넣기가
  // 영영 막히는 문제가 났다 — 이미지 분기로 못 들어가니 비교 기준이 갱신되지 않았다.)
  //
  // 대신 **클립보드 자신에게 묻는다.** 앱에서 복사할 때 시스템 클립보드에 표식을 하나 심어 둔다.
  // 그 뒤 사용자가 화면을 캡처하면 클립보드가 통째로 바뀌면서 표식이 사라진다.
  //   표식이 남아 있다  → 앱에서 복사한 것이 가장 최근이다  → 부품을 붙인다
  //   표식이 사라졌다   → 캡처가 더 최근이다                → 이미지를 붙인다
  // 클립보드가 이미 순서를 알고 있으니 추측할 필요가 없다.
  var _clipToken = "";   // 이번 복사 때 시스템 클립보드에 심어 둔 표식

  function clipboardImageFile(dt) {
    if (!dt) return null;
    var items = dt.items || [], i;
    for (i = 0; i < items.length; i++) {
      if (items[i].kind === "file" && /^image\//.test(items[i].type)) {
        var f = items[i].getAsFile();
        if (f) return f;
      }
    }
    var fs = dt.files || [];   // items 없이 files 로만 주는 브라우저 대비
    for (i = 0; i < fs.length; i++) if (/^image\//.test(fs[i].type)) return fs[i];
    return null;
  }
  function bindPaste() {
    document.addEventListener("paste", function (e) {
      var t = e.target, tag = (t && t.tagName) || "";
      // 입력창에서는 평소대로 글자가 붙어야 한다(프로젝트명·비고·BOM 칸)
      if (tag === "INPUT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;
      if (document.querySelector(".modal:not([hidden])")) return;   // 모달 위에서는 손대지 않는다
      var dt = e.clipboardData;
      var img = clipboardImageFile(dt);
      var txt = dt ? String(dt.getData("text/plain") || "") : "";
      // 표식이 그대로면 앱에서 복사한 것이 가장 최근이다. 사라졌으면 그 뒤에 캡처한 것이다.
      var mineIsLatest = !!_clipToken && txt === _clipToken;
      if (img && !mineIsLatest) {
        e.preventDefault();
        addImageFileToLibrary(img, WE.i18n.t("붙여넣은 부품"));
        return;
      }
      if (pasteClipboard()) e.preventDefault();
    });
  }

  function copySelection() {
    var cmpIds = (WE.model.getMulti() || []).slice();
    var annoIds = (WE.model.getMultiAnno() || []).slice();
    var wireIds = (WE.model.getMultiWire() || []).slice();
    var b = WE.model.extractSelection(cmpIds, annoIds, wireIds);
    var n = b.components.length + b.wires.length + b.annotations.length;
    if (!n) { setHint(WE.i18n.t("복사할 대상을 먼저 선택하세요.")); return false; }
    // lastSheetId = 이 내용이 지금 '놓여 있는' 배선도. 붙일 때 어긋나게 할지 판단하는 기준.
    _clip = { sheetId: WE.model.getActiveSheetId(), lastSheetId: WE.model.getActiveSheetId(), off: 0, data: b };
    var parts = [];
    if (b.components.length) parts.push(WE.i18n.t("부품 ") + b.components.length);
    if (b.wires.length) parts.push(WE.i18n.t("배선 ") + b.wires.length);
    if (b.annotations.length) parts.push(WE.i18n.t("주석 ") + b.annotations.length);

    // 시스템 클립보드에 표식을 심는다. 나중에 캡처를 하면 이 표식이 지워지고,
    // 그걸로 '캡처가 더 최근'임을 알 수 있다(bindPaste 참조).
    // 알아볼 수 없는 문자열 대신 사람이 읽을 수 있는 문구로 둔다 — 메모장 등에 잘못 붙여넣어도 뜻이 통하게.
    _clipToken = "[" + WE.i18n.t("이지케이블") + "] " + parts.join(" · ") + " #" +
                 Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(_clipToken).catch(function () { /* 권한 없으면 그냥 둔다 */ });
      }
    } catch (e) { /* 무시 — 표식이 없으면 이미지가 있을 때 이미지를 택한다 */ }
    setHint(WE.i18n.t("복사: ") + parts.join(" · ") + WE.i18n.t("  (Ctrl+V로 붙여넣기 · 다른 배선도에도 됩니다)"));
    return true;
  }
  function pasteClipboard() {
    if (!_clip) { setHint(WE.i18n.t("복사한 것이 없습니다.")); return false; }
    // 자리 규칙:
    //   다른 배선도로 처음 가져올 땐 **원래 있던 자리 그대로** — 그게 '그대로 가져오기'다.
    //   방금 붙인 그 배선도에 또 붙이면 20px씩 누적해 어긋나게 — 겹쳐 놓으면 뭐가 새 건지 안 보인다.
    var cur = WE.model.getActiveSheetId();
    if (_clip.lastSheetId === cur) _clip.off += 20; else _clip.off = 0;
    _clip.lastSheetId = cur;
    var off = _clip.off;
    var made = WE.model.pasteBundle(_clip.data, off, off);
    if (!made) return false;
    /* ⚠ 붙여넣기는 같은 자리에 또 붙일 때마다 20px 씩 민다(위 참조).
       계속 붙이면 결국 캔버스 밖으로 나가고, 밖에 있는 부품은 화면에서 사라진다.
       그래서 붙인 부품만 안쪽으로 당긴다. (2026-09-02) */
    if (WE.geometry && WE.geometry.pullInside) {
      made.components.forEach(function (c) { WE.geometry.pullInside(c); });
    }
    // 붙인 것을 바로 선택해 둔다 — 방향키·드래그로 곧장 옮길 수 있게
    WE.model.setMultiSelection(
      made.components.map(function (c) { return c.id; }),
      made.annotations.map(function (a) { return a.id; }),
      made.wires.map(function (w) { return w.id; }));
    WE.render.renderAll(); WE.render.renderOverlay(); refreshProps();
    if (WE.history) WE.history.commit();
    if (WE.store) WE.store.saveNow();
    var parts = [];
    if (made.components.length) parts.push(WE.i18n.t("부품 ") + made.components.length);
    if (made.wires.length) parts.push(WE.i18n.t("배선 ") + made.wires.length);
    if (made.annotations.length) parts.push(WE.i18n.t("주석 ") + made.annotations.length);
    setHint(WE.i18n.t("붙여넣기: ") + parts.join(" · "));
    return true;
  }

  // ---- 배선도 시트 탭 ----
  // 한 프로젝트에 배선도가 여러 장. 탭 하나 = 도면 한 장.
  function renderSheetTabs() {
    var box = document.getElementById("sheetTabs");
    if (!box) return;
    var sheets = WE.model.project.sheets, cur = WE.model.getActiveSheetId();
    box.innerHTML = "";
    sheets.forEach(function (s) {
      var b = document.createElement("button");
      b.className = "view-tab sheet-tab" + (_view === "wiring" && s.id === cur ? " active" : "");
      b.dataset.sid = s.id;
      // 이름이 잘렸을 때 전체를 볼 수 있도록 툴팁 맨 앞에 이름을 넣는다
      b.title = s.name + "\n" + WE.i18n.t("더블클릭 = 이름 바꾸기 · 우클릭 = 메뉴");
      var sp = document.createElement("span");
      sp.textContent = s.name;
      b.appendChild(sp);
      box.appendChild(b);
    });
    var add = document.createElement("button");
    add.className = "view-tab"; add.id = "sheetAdd";
    add.textContent = "＋";
    add.title = WE.i18n.t("배선도 추가");
    box.appendChild(add);
  }
  // 시트 전환 — 그리던 배선·선택을 정리하고 새 시트를 그린다.
  // (별칭이 가리키는 곳만 바뀌므로 모델은 건드릴 게 없다)
  function selectSheet(id) {
    if (id === WE.model.getActiveSheetId() && _view === "wiring") return;
    if (WE.interactions && WE.interactions.resetWire) WE.interactions.resetWire();   // 그리던 배선이 다른 시트로 넘어가지 않게
    WE.model.setActiveSheet(id);
    WE.model.clearSelection();
    if (WE.model.setMultiSelection) WE.model.setMultiSelection([], [], []);   // 다중 선택·배선 클릭 지점까지 비운다
    switchView("wiring");
    applyCanvasSize(); syncPageSizeBtn();   // 용지도 시트마다 다르다(2026-09-08)
    WE.render.renderAll(); WE.render.renderOverlay();
    renderSheetTabs(); refreshProps();
    syncProjNote();   // 비고는 시트마다 다르다 — 전환하면 그 시트 것으로 갈아 끼운다
  }
  function afterSheetChange(msg) {
    applyCanvasSize(); syncPageSizeBtn();   // 새 시트는 기본 용지일 수 있다
    WE.render.renderAll(); WE.render.renderOverlay();
    renderSheetTabs(); setActiveTab(_view); refreshProps(); syncProjNote();
    if (WE.history) WE.history.commit();
    if (WE.store) WE.store.saveNow();
    if (msg) setHint(msg);
  }
  // 탭 위에서 제자리 이름 편집 (Enter/포커스아웃 = 저장, Esc = 취소)
  function beginRenameSheet(btn) {
    var id = btn.dataset.sid, s = null;
    WE.model.project.sheets.forEach(function (x) { if (x.id === id) s = x; });
    if (!s || btn.querySelector("input")) return;
    var old = s.name;
    var inp = document.createElement("input");
    inp.type = "text"; inp.value = old; inp.maxLength = 40;
    btn.innerHTML = ""; btn.appendChild(inp);
    inp.focus(); inp.select();
    var done = false;
    function finish(ok) {
      if (done) return; done = true;
      if (ok && inp.value.trim() && inp.value.trim() !== old) {
        WE.model.renameSheet(id, inp.value);
        renderSheetTabs(); setActiveTab(_view);
        if (WE.history) WE.history.commit();
        if (WE.store) WE.store.saveNow();
      } else { renderSheetTabs(); setActiveTab(_view); }
    }
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
      e.stopPropagation();   // 캔버스 단축키(Delete 등)로 새지 않게
    });
    inp.addEventListener("blur", function () { finish(true); });
  }
  var _smSid = null;   // 우클릭 메뉴가 겨냥한 시트
  function openSheetMenu(sid, x, y) {
    var m = document.getElementById("sheetMenu"); if (!m) return;
    _smSid = sid;
    var sheets = WE.model.project.sheets, i = -1;
    sheets.forEach(function (s, k) { if (s.id === sid) i = k; });
    m.querySelector('[data-sm="del"]').disabled = sheets.length <= 1;
    m.querySelector('[data-sm="left"]').disabled = i <= 0;
    m.querySelector('[data-sm="right"]').disabled = i < 0 || i >= sheets.length - 1;
    m.hidden = false;
    // 화면 밖으로 나가지 않게
    var r = m.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 6)) + "px";
    m.style.top = Math.max(4, Math.min(y - r.height, window.innerHeight - r.height - 6)) + "px";
  }
  function closeSheetMenu() {
    var m = document.getElementById("sheetMenu");
    if (m && !m.hidden) { m.hidden = true; _smSid = null; }
  }
  function bindSheetTabs() {
    var box = document.getElementById("sheetTabs");
    if (!box) return;
    box.addEventListener("click", function (e) {
      if (e.target.closest("#sheetAdd")) {
        var s = WE.model.addSheet();
        WE.model.setActiveSheet(s.id);
        WE.model.clearSelection();
        switchView("wiring");
        afterSheetChange(WE.i18n.t("배선도 추가: ") + s.name);
        return;
      }
      var b = e.target.closest(".sheet-tab");
      if (b && !b.querySelector("input")) selectSheet(b.dataset.sid);
    });
    box.addEventListener("dblclick", function (e) {
      var b = e.target.closest(".sheet-tab");
      if (b) { e.preventDefault(); beginRenameSheet(b); }
    });
    box.addEventListener("contextmenu", function (e) {
      var b = e.target.closest(".sheet-tab");
      if (!b) return;
      e.preventDefault();
      selectSheet(b.dataset.sid);
      openSheetMenu(b.dataset.sid, e.clientX, e.clientY);
    });
    document.getElementById("sheetMenu").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-sm]"); if (!b || b.disabled) return;
      var act = b.dataset.sm, sid = _smSid;
      closeSheetMenu();
      if (!sid) return;
      var sheets = WE.model.project.sheets, name = "";
      sheets.forEach(function (s) { if (s.id === sid) name = s.name; });
      if (act === "rename") {
        var tab = document.querySelector('.sheet-tab[data-sid="' + sid + '"]');
        if (tab) beginRenameSheet(tab);
      } else if (act === "add") {
        var ns = WE.model.addSheet(); WE.model.setActiveSheet(ns.id);
        WE.model.clearSelection(); switchView("wiring");
        afterSheetChange(WE.i18n.t("배선도 추가: ") + ns.name);
      } else if (act === "dup") {
        var cp = WE.model.duplicateSheet(sid);
        if (cp) { WE.model.setActiveSheet(cp.id); WE.model.clearSelection(); switchView("wiring");
          afterSheetChange(WE.i18n.t("복제 완료: ") + cp.name); }
      } else if (act === "del") {
        if (!confirm(WE.i18n.t("배선도 '") + name + WE.i18n.t("'를 삭제할까요? 되돌리기(Ctrl+Z)로 복구할 수 있습니다."))) return;
        if (WE.model.removeSheet(sid)) { switchView("wiring"); afterSheetChange(WE.i18n.t("배선도 삭제: ") + name); }
      } else if (act === "left" || act === "right") {
        if (WE.model.moveSheet(sid, act === "left" ? -1 : 1)) afterSheetChange(null);
      }
    });
    document.addEventListener("pointerdown", function (e) {
      if (!e.target.closest("#sheetMenu")) closeSheetMenu();
    }, true);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheetMenu(); });
  }
  /* BOM·배선 리스트가 화면을 채울 만큼 아래 여백을 준다. (2026-09-02)

     이 창들은 배선도 **아래에** 붙고, 탭은 거기로 스크롤할 뿐이다.
     그런데 창이 화면보다 짧으면 스크롤이 끝에 걸려 배선도 아랫부분이 화면에 남는다.
     실측: 창 높이 714 · BOM 550 → 탭이 가려는 곳 637 인데 최대 스크롤이 509 라
     **128px 모자라** 배선도가 그만큼 걸쳐 보였다. 부품이 적은 도면일수록 심하다.

     모자란 만큼을 아래 여백으로 채우면 스크롤이 끝까지 가서 그 창이 화면 맨 위에 온다.
     배선도를 숨기는 게 아니라 위로 밀어내는 것이라, '배선도는 항상 표시'라는 구성은 그대로다. */
  /* BOM·배선 리스트가 화면을 꽉 채우게 만든다 — 짧은 표에서 카드가 반만 차고
     아래가 허옇게 비어 보이는 것을 막는다.

     ⚠ 예전에는 아래쪽 padding 을 늘렸다. 그러면 남는 공간이 내용보다 **바깥**에 깔려서,
        맨 끝에 둔 제휴 고지가 표 바로 밑에 붙어 버린다(고지는 내용이니까).
        min-height 로 바꾸면 남는 공간이 카드 **안쪽**에 생기고, 고지는 margin-top:auto 로
        진짜 맨 아래까지 내려간다. box-sizing 이 border-box 라 바깥 높이는 예전과 같다. */
  function 화면채우기(el) {
    var wrap = document.getElementById("canvasWrap");
    if (!wrap || !el || el.hidden) return;
    el.style.minHeight = Math.max(0, wrap.clientHeight - 8) + "px";
  }

  // 배선도는 항상 표시. BOM/배선 리스트 탭 = 배선도 아래에 해당 창을 추가 표시(스크롤 이동), 배선도 탭 = 둘 다 숨김.
  function switchView(view) {
    if (view === "wirelist" && !SHOW_WIRE_LIST) view = "wiring";   // 숨긴 상태에선 진입 자체를 막는다
    _view = view; setActiveTab(view);
    var wrap = document.getElementById("canvasWrap");
    var bom = document.getElementById("bomView");
    var wl = document.getElementById("wireListView");
    bom.hidden = view !== "bom";
    wl.hidden = view !== "wirelist";
    if (view === "bom") { renderBOMView(); wrap.scrollTo({ top: bom.offsetTop - 8, behavior: "smooth" }); }
    else if (view === "wirelist") { renderWireListView(); wrap.scrollTo({ top: wl.offsetTop - 8, behavior: "smooth" }); }
    else { wrap.scrollTo({ top: 0, behavior: "smooth" }); }   // 배선도만
    syncCanvasMark();   // 탭 전환 직후엔 스크롤 애니메이션 중이라도, 곧이어 scroll 이벤트가 실제 위치로 다시 잡아준다
  }
  // ---- 미연결 단자 확인 ----
  // 켜 두면 배선을 이을 때마다 빨간 표시가 하나씩 사라진다 — 고치면서 바로 확인이 된다.
  // 화면 표시일 뿐이라 저장·인쇄에는 영향이 없다(ui는 직렬화 대상이 아니다).
  function toggleCheckTerminals() {
    WE.model.ui.checkTerminals = !WE.model.ui.checkTerminals;
    var b = document.getElementById("btnCheckTerm");
    if (b) {
      b.classList.toggle("active", !!WE.model.ui.checkTerminals);
      // 색만으로 상태를 알리면 화면을 못 보는 사람은 켜졌는지 모른다
      b.setAttribute("aria-pressed", WE.model.ui.checkTerminals ? "true" : "false");
    }
    WE.render.renderOverlay();
    syncCheckTermHint(true);
  }
  // force=true면 껐을 때도 알린다(버튼을 눌러 끈 순간). 평소엔 켜져 있을 때만 개수를 갱신한다.
  function syncCheckTermHint(force) {
    if (!WE.model.ui.checkTerminals) { if (force) setHint(WE.i18n.t("미연결 확인 끔")); return; }
    /* ⚠ 숨긴 단자까지 세어 세 경우를 구분한다 (2026-09-07).
       예전에는 보이는 것만 세서, 안 이어진 단자를 숨기면 "모든 단자가 이어졌습니다" 가
       나왔다. 이어진 게 아니라 숨긴 것인데도. 점검 도구가 거짓 보고를 하면
       배선이 빠진 도면을 그대로 납품하게 된다. */
    if (!WE.render.unconnectedTerminals) return;
    var 보임 = WE.render.unconnectedTerminals().length;
    var 전부 = WE.render.unconnectedTerminals({ includeHidden: true }).length;
    var 숨김 = 전부 - 보임;
    if (보임) {
      setHint(WE.i18n.t("미연결 단자 ") + 보임 + WE.i18n.t("개 — 도면에 표시했습니다"));
    } else if (숨김) {
      // 여기서 "모두 이어졌다" 고 말하면 안 된다 — 숨겨서 안 보이는 것뿐이다
      setHint(WE.i18n.t("표시된 미연결 없음 · 숨긴 단자 ") + 숨김 + WE.i18n.t("개가 아직 안 이어졌습니다"),
        WE.i18n.t("숨긴 단자는 도면에 안 보이지만 배선은 붙어 있지 않습니다. 단자 배치에서 다시 켜면 보입니다."));
    } else {
      setHint(WE.i18n.t("미연결 단자 없음 — 모든 단자가 이어졌습니다"));
    }
  }

  // 모델 변경 시 BOM/배선 리스트가 열려 있으면 갱신
  function afterModelRender() {
    syncCheckTermHint(false);   // 배선을 이으면 개수가 바로 줄어든다
    if (_view === "bom") renderBOMView();
    else if (_view === "wirelist") renderWireListView();
    syncNoteWidth();   // 배선 색이 늘면 범례 열이 늘고 그만큼 비고 폭이 준다
  }
  /* 결선표 화면 — 인쇄물과 같은 모양으로 보여 준다(종이가 본체라 화면이 그걸 따라간다).
     한 넷을 여러 줄로 늘어놓되 첫 줄에만 색·굵기·체크칸을 두고 나머지는 이어지는 줄로 묶는다. */
  /* ---- 결선표 비고 (2026-09-09 고원빈) ----
     "배선수 우측에 칸 하나 만들자 비고란. 케이블 길이 같은 거 입력하면 좋을 것 같아"

     ⚠ 넷 하나에 하나다 — 배선수 칸과 같은 묶음(rowspan)이라 자리도 그대로 맞는다.
     ⚠ 키는 기준 단자의 **id** 로 잡는다. 단자 이름으로 잡으면 이름을 고치는 순간
        적어 둔 메모가 사라진다.
     ⚠ 값은 project.wireNote 에 담겨 **파일에 저장된다** — 현장 메모는 도면의 일부다. */
  function 비고키(net) {
    if (!net || !net.origin) return "";
    return net.origin.cmpId + "|" + (net.origin.tid || net.origin.term || "");
  }
  function 비고읽기(k) {
    var m = WE.model.project.wireNote;
    return (m && m[k]) || "";
  }
  function 비고쓰기(k, v) {
    var p = WE.model.project;
    if (!p.wireNote) p.wireNote = {};
    v = String(v == null ? "" : v).trim();
    if (v) p.wireNote[k] = v; else delete p.wireNote[k];
  }

  function bindWireListView() {
    var t = document.getElementById("wireListTable");
    if (!t) return;
    t.addEventListener("focusout", function (e) {
      var td = e.target.closest ? e.target.closest("td.wl-note") : null;
      if (!td) return;
      비고쓰기(td.dataset.k, td.textContent);
      WE.history.commit();
    });
    t.addEventListener("keydown", function (e) {
      var td = e.target.closest ? e.target.closest("td.wl-note") : null;
      if (!td) return;
      if (e.key === "Enter") { e.preventDefault(); td.blur(); }
      else if (e.key === "Escape") { td.textContent = 비고읽기(td.dataset.k); td.blur(); }
    });
  }

  function renderWireListView() {
    var nets = netListByComponent();
    var t = document.getElementById("wireListTable");
    if (!nets.length) {
      t.innerHTML = "<tr><td class='muted' style='border:none'>" +
        esc(WE.i18n.t("연결된 배선이 없습니다.")) + "</td></tr>";
      return;
    }
    // 연결부는 부품명과 단자를 **칸으로 나눈다** — 한 칸에 붙여 쓰면 굵기 차이만으로는
    // 어디까지가 부품 이름인지 안 보인다(2026-09-03 고원빈)
    /* 연결부는 부품명과 단자를 **칸으로 나눈다** — 한 칸에 붙여 쓰면 굵기 차이만으로는
       어디까지가 부품 이름인지 안 보인다(2026-09-03 고원빈).
       단자 앞의 색은 **같은 색이 이어지면 한 칸으로 합친다** — #1·#2 스텝다운의 IN- 처럼
       같은 색으로 잇는 경우가 대부분이라, 줄마다 같은 견본을 반복하면 눈만 어지럽다.
       색이 달라지는 자리에서만 칸이 새로 생기므로 **다른 색이 오히려 눈에 띈다.** */
    // 표머리는 칸마다 t() — HTML 한 줄을 통째로 키에 넣으면 사전과 절대 안 맞는다(2026-09-14 영어판 검토). pdf.js 의 인쇄 결선표도 같은 목록.
    var 표머리 = ["순번", "부품", "시작", "연결 부품", "연결부 단자", "규격", "배선", "비고"];
    var html = "<thead><tr>" + 표머리.map(function (k) { return "<th>" + WE.i18n.t(k) + "</th>"; }).join("") + "</tr></thead><tbody>";
    /* 체크칸(☐)을 순번으로 바꿨다 (2026-09-13 고원빈: "체크박스보다 그냥 번호가 낫겠다").
       빈 칸에 손으로 체크하는 대신, 넷마다 번호를 매겨 종이에서 "몇 번째 넷인지" 로 짚게 한다.
       ⚠ "번호" 대신 "순번" 을 쓴다 — 이 앱에는 이미 "배선 번호"(도면 위 W1·W2 수축튜브 번호,
       개발_기록.md 6.10)가 있어서 "번호"라고만 하면 그것과 헷갈린다. */
    var 순번 = 1;
    nets.forEach(function (그룹) {
      var 부품첫줄 = true;
      그룹.rows.forEach(function (net) {
        net.targets.forEach(function (m, i) {
          var 넷첫줄 = i === 0;
          html += "<tr class='wl-row" + (넷첫줄 ? " wl-first" : "") + "'>";
          if (넷첫줄) html += "<td class='wl-chk' rowspan='" + net.count + "'>" + (순번++) + "</td>";
          if (부품첫줄) {
            // 부품 그림 + 이름은 그 부품의 모든 줄에 걸쳐 한 번만 — 손에 쥔 부품을 바로 알아보게
            html += "<td class='wl-part' rowspan='" + 그룹.lines + "'>" +
              (그룹.image ? "<img class='wl-thumb' src='" + esc(그룹.image) + "' alt='' />" : "") +
              "<span class='wl-part-name'>" + esc(그룹.name) + "</span></td>";
            부품첫줄 = false;
          }
          if (넷첫줄) {
            html += "<td class='wl-origin' rowspan='" + net.count + "'>" +
              "<span class='wl-sw' style='background:" + esc(net.colorHex) + "'></span>" +
              "<b>" + esc(net.origin.term) + "</b></td>";
          }
          // 같은 이름이 이어지면 위 칸이 덮는다 (_cmpSpan === 0 이면 칸을 안 만든다)
          if (m._cmpSpan !== 0) {
            html += "<td class='wl-member'" +
              (m._cmpSpan > 1 ? " rowspan='" + m._cmpSpan + "'" : "") +
              ">" + esc(m.cmp) + "</td>";
          }
          /* ⚠ 연결부 단자에는 색을 안 붙인다. 이어진 단자끼리는 같은 색으로 잇게 되어 있어
                시작 칸의 색과 늘 같다 — 줄마다 같은 견본을 반복하면 칸만 넓어진다.
                (2026-09-03 고원빈) */
          html += "<td class='wl-mterm'><b>" + esc(m.term) + "</b></td>";
          if (넷첫줄) {
            /* 규격(AWG) — 넷 하나에 하나, 배선수·비고와 같은 자리(2026-09-13 고원빈).
               "22" 처럼 숫자만 적으면 뭘 뜻하는지 안 보여서 "AWG22" 로 단위를 붙인다
               (2026-09-13 고원빈: "AWG인지 뭔지 표현을 적어야 맞을것 같아"). */
            html += "<td class='wl-awg' rowspan='" + net.count + "'>" +
              (net.awg ? "AWG" + esc(net.awg) : "") + "</td>";
            html += "<td class='wl-count' rowspan='" + net.count + "'>" +
              net.count + "</td>";
            var k = 비고키(net);
            html += "<td class='wl-note' contenteditable='true' data-k='" + esc(k) +
              "' rowspan='" + net.count + "'>" + esc(비고읽기(k)) + "</td>";
          }
          html += "</tr>";
        });
      });
    });
    html += "</tbody>";
    t.innerHTML = html;
    화면채우기(document.getElementById("wireListView"));   // BOM 과 같은 이유
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
      case "name": return { id: "name", label: WE.i18n.t("부품명"), kind: "text" };
      case "spec": return { id: "spec", label: WE.i18n.t("스펙"), kind: "text" };
      case "qty": return { id: "qty", label: WE.i18n.t("수량"), kind: "num" };
      case "price": return { id: "price", label: WE.i18n.t("단가"), kind: "num" };
      case "sum": return { id: "sum", label: WE.i18n.t("합계"), kind: "num" };
      case "link": return { id: "link", label: WE.i18n.t("구매링크"), kind: "link" };
      case "ds": return { id: "ds", label: WE.i18n.t("데이터시트"), kind: "ds" };
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
        baseName: r.baseName, baseSpec: r.baseSpec, baseLink: r.baseLink,
        nameEdited: r.nameEdited, specEdited: r.specEdited, linkEdited: r.linkEdited,
        publicId: r.publicId || null, link: r.link, dsNames: r.dsNames || [], custom: proj.bomCustom[rowId] || {}
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
      return "<a class='bom-link' data-url='" + esc(url) + "' title='" + esc(url) + WE.i18n.t(" (더블클릭: 수정)'>") + esc(linkLabel(url)) + "</a>";
    }
    if (url) return WE.i18n.t("<span class='bom-link-plain' title='더블클릭: 수정'>") + esc(url) + "</span>";
    return WE.i18n.t("<span class='bom-link-empty' title='더블클릭: 링크 입력'>—</span>");
  }

  // 한 행의 한 열 셀 HTML
  function bomCellHtml(col, r) {
    if (col.kind === "custom") {
      var v = (r.custom && r.custom[col.colId]) || "";
      return "<td class='editable' data-col='" + esc(col.colId) + "'>" + esc(v) + "</td>";
    }
    var priceTxt;
    // 고친 칸의 툴팁 — 원래 기본값이 무엇이었는지 알려 준다(되돌리면 이 값으로 간다)
    function editedTitle(on, base) {
      if (!on) return "";
      var b = String(base == null ? "" : base).trim();
      return " title='" + esc(b
        ? WE.i18n.t("부품 기본값: ") + b + WE.i18n.t(" → 이 배선도에서 수정됨 (↺ 로 되돌리기)")
        : WE.i18n.t("이 배선도에서 추가된 값 (↺ 로 되돌리기)")) + "'";
    }
    switch (col.id) {
      // 고친 칸은 단가와 같은 표시(파란 굵은 글씨 + 기본값 툴팁)를 쓴다 — 표 안에서 규칙이 하나여야 한다
      case "name": return "<td class='editable" + (r.nameEdited ? " overridden" : "") + "' data-f='name'" +
        editedTitle(r.nameEdited, r.baseName) + ">" + esc(r.name) + "</td>";
      case "spec": return "<td class='editable" + (r.specEdited ? " overridden" : "") + "' data-f='spec'" +
        editedTitle(r.specEdited, r.baseSpec) + ">" + esc(r.spec) + "</td>";
      case "qty":
        if (r.kind === "manual") return "<td class='num editable' data-f='qty'>" + r.qty + "</td>";
        return "<td class='num'>" + r.qty + "</td>";
      case "price":
        priceTxt = n(r.price) ? Math.round(n(r.price)).toLocaleString() : "";
        if (r.kind === "manual") return "<td class='num editable' data-f='price'>" + priceTxt + "</td>";
        var pCls = "num editable" + (r.overridden ? " overridden" : "");
        var pTitle = (r.overridden && n(r.basePrice)) ?
          WE.i18n.t(" title='라이브러리 기본단가 ₩") + Math.round(n(r.basePrice)).toLocaleString() + WE.i18n.t(" → 이 배선도에서 수정됨 (비우면 기본값 복귀)'") : "";
        return "<td class='" + pCls + "' data-f='price'" + pTitle + ">" + priceTxt + "</td>";
      case "sum": return "<td class='num'>" + won(r.sum) + "</td>";
      case "link": return "<td class='bom-link-cell" + (r.linkEdited ? " overridden" : "") + "' data-f='link'" +
        editedTitle(r.linkEdited, r.baseLink) + ">" + linkCell(r.link) + "</td>";
      case "ds":
        var nn = (r.dsNames || []).length;
        if (nn) return "<td class='ds-cell'><button class='ds-view' data-lib='" + esc(r.libraryId || "") + "' data-pub='" + esc(r.publicId || "") + WE.i18n.t("' title='데이터시트 보기'>📎 ") + nn + "</button></td>";
        if (r.libraryId) return "<td class='ds-cell'><button class='ds-add' data-lib='" + esc(r.libraryId) + WE.i18n.t("' title='데이터시트 첨부'>＋</button></td>");
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

    var resize = WE.i18n.t("<span class='col-resize' title='드래그로 너비 조절'></span>");
    var html = cg + "<thead><tr><th class='bom-gutter-h'></th><th class='num'>#</th>";
    cols.forEach(function (col) {
      var key = esc(colKey(col));
      if (col.kind === "custom") {
        html += "<th class='custom-col reorder' draggable='true' data-colkey='" + key + "'><span class='col-name' data-col='" + esc(col.colId) + WE.i18n.t("' title='더블클릭: 열 이름 변경'>") + esc(col.label) + "</span>" +
          "<button class='col-del' data-col='" + esc(col.colId) + WE.i18n.t("' title='열 삭제'>×</button>") + resize + "</th>";
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
      html += WE.i18n.t("<td class='bom-gutter'><span class='row-grip' draggable='true' title='드래그로 행 이동'>⠿</span>") +
        (r.kind === "manual" ? WE.i18n.t("<button class='row-del' title='행 삭제'>×</button>") : "") +
        // 되돌리기 — 자동집계 행에만. 고친 것이 없으면 흐리게 두어 '되돌릴 게 없음'을 보여준다
        (r.kind === "auto"
          ? "<button class='row-reset" + (bomRowEdited(r) ? " on" : "") + "'" +
            (bomRowEdited(r) ? "" : " disabled") +
            " title='" + esc(WE.i18n.t("부품 정보에 설정한 기본값으로 되돌리기")) + "'>↺</button>"
          : "") + "</td>";
      html += "<td class='num'>" + r.no + "</td>";
      cols.forEach(function (col) { html += bomCellHtml(col, r); });
      html += "</tr>";
    });

    // 합계 행
    html += "<tr class='total-row'><td class='bom-gutter'></td><td></td>";
    cols.forEach(function (col) {
      if (col.id === "name") html += WE.i18n.t("<td>합계</td>");
      else if (col.id === "qty") html += "<td class='num'>" + data.totalQty + "</td>";
      else if (col.id === "sum") html += "<td class='num'>" + won(data.total) + "</td>";
      else html += "<td" + (col.kind === "num" ? " class='num'" : "") + "></td>";
    });
    html += "</tr></tbody>";
    t.innerHTML = html;
    화면채우기(document.getElementById("bomView"));   // 행 수가 바뀌면 여백도 다시
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // BOM 사용자 수정값 저장 — 빈 값이면 지워서 부품 기본값으로 되돌린다(단가와 같은 규칙)
  function setBomEdit(key, field, text) {
    var proj = WE.model.project;
    if (!proj.bomEdit) proj.bomEdit = {};
    if (text === "") {
      if (proj.bomEdit[key]) {
        delete proj.bomEdit[key][field];
        if (!Object.keys(proj.bomEdit[key]).length) delete proj.bomEdit[key];
      }
      return;
    }
    if (!proj.bomEdit[key]) proj.bomEdit[key] = {};
    proj.bomEdit[key][field] = text;
  }
  // 행 되돌리기 — 이 배선도에서 고친 이름·스펙·링크·단가를 모두 지우고 부품 기본값으로.
  // 예전 프로젝트가 부품 인스턴스에 들고 있던 값도 함께 지워야 실제로 기본값이 나온다.
  function resetBomRow(key) {
    var proj = WE.model.project;
    if (proj.bomEdit) delete proj.bomEdit[key];
    if (proj.bomPrice) delete proj.bomPrice[key];
    WE.model.allComponents().forEach(function (c) {
      if ((c.libraryId || c.publicId || ("name:" + c.name)) !== key) return;
      var lib = componentPart(c);
      if (lib && c.bomName) c.name = lib.name;   // 캔버스 이름표도 부품 이름으로 되돌린다
      delete c.bomName; delete c.bomSpec; delete c.bomLink;
    });
    WE.render.renderAll();
    renderBOMView();
  }
  // 이 행에 되돌릴 사용자 수정이 하나라도 있는가 (↺ 버튼 활성 여부)
  function bomRowEdited(r) {
    return !!(r.nameEdited || r.specEdited || r.linkEdited || r.overridden);
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
      // 이름·스펙·링크는 '이 배선도에만' 덮어쓴다. 부품 정보(라이브러리)는 건드리지 않는다.
      // 그래야 우리가 부품 기본값(어필리에이트 링크 등)을 갱신해도 사용자가 넣은 값이 안 밀린다.
      // 되돌리려면 행의 ↺ 버튼. 단가(bomPrice)와 같은 방식이다.
      var key = tr.dataset.key;
      setBomEdit(key, f, text);
      // 예전 프로젝트가 부품 인스턴스에 들고 있던 값은 정리한다 — 안 지우면 ↺ 를 눌러도 그게 남아 되살아난다
      WE.model.allComponents().forEach(function (c) {
        if ((c.libraryId || c.publicId || ("name:" + c.name)) !== key) return;
        if (f === "name") { c.name = text; delete c.bomName; }
        else if (f === "spec") delete c.bomSpec;
        else if (f === "link") delete c.bomLink;
      });
      if (f === "name") WE.render.renderAll();
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
    cols.push({ id: WE.model.nextId("col"), name: WE.i18n.t("열 ") + (cols.length + 1) });
    renderBOMView();
  }
  function renameBomColumn(colId) {
    var col = WE.model.project.bomExtraCols.filter(function (c) { return c.id === colId; })[0];
    if (!col) return;
    var name = prompt(WE.i18n.t("열 이름"), col.name);
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
  // ---- BOM·결선표 내보내기 (CSV · Excel) ----
  /* 내보내기 표 만들기 — CSV 와 Excel 이 **같은 행 데이터**를 쓴다.
     예전에는 CSV 만 있어서 이 안에 다 있었는데, 엑셀을 붙이면서 둘로 갈라졌다.
     행 만드는 규칙이 두 벌이 되면 한쪽만 고쳐 표가 서로 달라진다. (2026-09-06)

     숫자는 숫자 그대로 둔다 — 엑셀에서 합계·정렬이 되려면 문자열이면 안 된다.
     CSV 쪽은 어차피 문자로 찍히므로 손해가 없다. */
  function bomExportRows() {
    /* 데이터시트 열은 파일로 내보내지 않는다 (2026-09-14 고원빈). 파일 안에는 첨부 이름만 실을 수 있는데
       (PDF·이미지는 브라우저 안에 있어 엑셀에 못 넣는다) 이름만으로는 의미가 없다. 화면·인쇄의 📎 표시는 그대로. */
    var data = bomData(), cols = visibleCols().filter(function (c) { return c.id !== "ds"; });
    var head = ["No"].concat(cols.map(function (c) { return c.label; }));
    var rows = [];
    data.rows.forEach(function (r) {
      var row = [r.no];
      cols.forEach(function (c) {
        if (c.kind === "custom") row.push((r.custom && r.custom[c.colId]) || "");
        else if (c.id === "qty") row.push(r.qty);
        else if (c.id === "price") row.push(n(r.price) || "");
        else if (c.id === "sum") row.push(r.sum || "");
        else if (c.id === "link") row.push(r.link || "");
        else if (c.id === "name") row.push(r.name);
        else if (c.id === "spec") row.push(r.spec);
        else row.push("");
      });
      rows.push(row);
    });
    var tot = [""];
    cols.forEach(function (c) {
      if (c.id === "name") tot.push(WE.i18n.t("합계"));
      else if (c.id === "qty") tot.push(data.totalQty);
      else if (c.id === "sum") tot.push(data.total);
      else tot.push("");
    });
    rows.push(tot);
    return { head: head, rows: rows };
  }

  /* 한 칸을 CSV 규격으로 감싼다 — 쉼표·따옴표·줄바꿈이 든 값이 표를 깨뜨린다.
     ⚠ =, +, -, @ 로 시작하는 글자는 엑셀이 **수식으로 오해**한다 — 팔레트 이름 "+ (전원)" 이
        `#NAME?` 로 나왔다(2026-09-14 고원빈 스크린샷). 따옴표로 감싸도 마찬가지라 앞에 공백 한 칸을 둔다
        (숫자는 그대로 — 숫자형으로 넘긴 칸은 이 조건에 안 걸린다). 엑셀 파일(.xlsx)은 문자열로 넣어 이 문제가 없다. */
  function csvCell(v) {
    if (typeof v === "number") return String(v);
    v = (v == null ? "" : String(v));
    if (/^[=+\-@\t\r]/.test(v)) v = " " + v;
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  /* CSV 파일로 내려받기. 앞의 BOM(\ufeff)은 엑셀에서 한글이 깨지지 않게 하는 표식이다. */
  function csvDownload(filename, table) {
    var lines = [table.head.map(csvCell).join(",")];
    table.rows.forEach(function (r) { lines.push(r.map(csvCell).join(",")); });
    var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* 표 내보내기는 Pro 전용이다 (2026-09-06).
     화면에서 보는 것·인쇄하는 것은 무료로 그대로 둔다 — 막는 것은 '파일로 빼는 것'뿐이다.

     ⚠ 기준이 limited() 인 이유 (watermark() 와 일부러 다르다).
        limited() 는 FREE_LIMIT 을 함께 본다. 심사 기간에는 그 값이 false 라
        아무도 안 막힌다 — 그게 맞다. 아직 실결제가 안 되는 때(포트원 테스트 채널)
        내보내기를 막으면 "막히는데 살 수는 없는" 상태가 되고, 그건 FREE_LIMIT 을
        만든 이유 그 자체다(js/flags.js). 개수 한도만 그 규칙을 따르고 내보내기는
        안 따르면 같은 실수를 다시 하는 것이다.

        워터마크는 반대로 isPro() 를 본다 — 그건 **막는 것이 아니라** 결과물에
        서명을 남기는 것이라, 심사 기간에도 남겨야 Pro 의 값어치가 보인다.

     ⚠ 실채널로 넘어가면서 FREE_LIMIT 을 true 로 되돌리면 이 차단도 함께 켜진다.
        스위치가 하나라 되돌리는 것을 잊을 수가 없다. */
  function 내보내기막힘() {
    if (!WE.pro || !WE.pro.limited()) return false;
    if (WE.app && WE.app.notice) {
      WE.app.notice(
        WE.i18n.t("Pro 전용 기능입니다"),
        WE.i18n.t("BOM·결선표를 CSV·엑셀 파일로 내보내는 것은 Pro 이용권이 필요합니다.")
        + "\n\n"
        + WE.i18n.t("화면에서 보고 인쇄하는 것은 무료로 그대로 쓸 수 있습니다.")
      );
    }
    return true;
  }

  function exportBomCSV() {
    if (내보내기막힘()) return;
    csvDownload((WE.model.project.meta.name || "BOM") + "_BOM.csv", bomExportRows());
  }

  /* 엑셀(.xlsx) — CSV 와 같은 표를 진짜 엑셀 파일로 낸다(js/xlsx.js). */
  function exportBomXlsx() {
    if (내보내기막힘()) return;
    var t = bomExportRows();
    WE.xlsx.download((WE.model.project.meta.name || "BOM") + "_BOM.xlsx",
      [{ name: "BOM", headRows: 1, rows: [t.head].concat(t.rows) }]);
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
    sel.innerHTML = WE.i18n.t("<option value=''>레이아웃…</option>") +
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
        if (!lp && dsv.dataset.pub) {
          var pc = WE.model.allComponents().filter(function (c) { return c.publicId === dsv.dataset.pub; })[0];
          lp = pc && pc.publicSnapshot;
        }
        if (lp && lp.datasheets && lp.datasheets.length) openDatasheetViewer(lp.datasheets, lp.name, 0);
        return;
      }
      var dsa = e.target.closest(".ds-add");
      if (dsa) { openLibEdit(dsa.dataset.lib); return; }
      var cdel = e.target.closest(".col-del");
      if (cdel) { removeBomColumn(cdel.dataset.col); return; }
      var rst = e.target.closest(".row-reset");
      if (rst) {
        if (rst.disabled) return;
        resetBomRow(rst.closest("tr").dataset.key);
        return;
      }
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
    document.getElementById("bomExportXlsx").addEventListener("click", exportBomXlsx);
    document.getElementById("wlExportCsv").addEventListener("click", exportWireListCSV);
    document.getElementById("wlExportXlsx").addEventListener("click", exportWireListXlsx);
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
      var name = prompt(WE.i18n.t("이 레이아웃을 저장할 이름")); if (name == null) return;
      name = name.trim(); if (!name) return;
      var arr = getSavedLayouts(), ex = arr.filter(function (l) { return l.name === name; })[0];
      if (ex) ex.layout = getBomLayout(); else arr.push({ name: name, layout: getBomLayout() });
      setSavedLayouts(arr); refreshLayoutSel(); setHint(WE.i18n.t("레이아웃 저장: ") + name);
    });
    document.getElementById("bomLayoutDel").addEventListener("click", function () {
      var sel = document.getElementById("bomLayoutSel");
      if (sel.value === "") { alert(WE.i18n.t("삭제할 레이아웃을 목록에서 먼저 고르세요.")); return; }
      var arr = getSavedLayouts(); arr.splice(+sel.value, 1);
      setSavedLayouts(arr); sel.value = ""; refreshLayoutSel();
    });

    var tabs = document.querySelectorAll("#viewTabs > .view-tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function () { switchView(this.dataset.view); });
    }
    bindSheetTabs();
    renderSheetTabs();
    applyWireListVisibility();
  }

  // 배선 리스트 관련 UI를 한 곳에서 감춘다 (탭 · BOM 툴바의 CSV 버튼)
  function applyWireListVisibility() {
    if (SHOW_WIRE_LIST) return;
    var tab = document.querySelector('#viewTabs > .view-tab[data-view="wirelist"]');
    if (tab) tab.hidden = true;
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
    WE.model.allComponents().forEach(function (c) {   // BOM과 같은 이유로 전체 시트
      var lib = componentPart(c);
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
    if (h < 1) return Math.round(h * 60) + WE.i18n.t("분");
    var days = h / 24;
    if (days >= 1) return fmt(days, 1) + WE.i18n.t("일 (") + fmt(h, 0) + WE.i18n.t("시간)");
    return fmt(h, 1) + WE.i18n.t("시간 (") + fmt(days, 2) + WE.i18n.t("일)");
  }
  // PDF용: 요약을 [라벨, 값] 배열로
  function powerSummaryRows() {
    if (!SHOW_POWER_SUMMARY) return [];   // 인쇄·PDF에서도 통째로 빠진다(pdf.js가 길이로 판단)
    var s = buildPowerSummary();
    if (!s.hasLoad && !s.hasBatt) return [];
    var rows = [[WE.i18n.t("총 소비전력(평균)"), fmt(s.loadW, 2) + " W"]];
    if (s.hasConv) rows.push([WE.i18n.t("변환효율(평균)"), fmt(s.effPct, 0) + "%"]);
    if (s.hasBatt) {
      rows.push([WE.i18n.t("배터리 소비"), fmt(s.inW, 2) + " W" + (s.battV > 0 ? " / " + fmt(s.battA, 2) + " A" : "")]);
      rows.push([WE.i18n.t("하루 소비 에너지"), fmt(s.inW * 24, 1) + WE.i18n.t(" Wh/일")]);
      rows.push([WE.i18n.t("배터리 가용용량"), fmt(s.battWh, 1) + " Wh"]);
      rows.push([WE.i18n.t("배터리 지속"), fmtRuntime(s.hours)]);
    }
    return rows;
  }
  function renderPowerSummary() {
    var box = document.getElementById("powerSummary");
    var s = buildPowerSummary();
    if (!s.hasLoad && !s.hasBatt) {
      box.innerHTML = WE.i18n.t('<p class="muted">부품 정보(✎)에 역할·전압·전류(부하는 하루 가동시간)를 입력하면 소비전력과 배터리 지속시간이 계산됩니다.</p>');
      return;
    }
    var html = "";
    html += WE.i18n.t('<div class="pw-row"><span>총 소비전력(평균)</span><b class="pw-big">') + fmt(s.loadW, 2) + " W</b></div>";
    if (s.hasConv) html += WE.i18n.t('<div class="pw-row"><span>변환효율(평균)</span><b>') + fmt(s.effPct, 0) + "%</b></div>";
    if (s.hasBatt) {
      html += WE.i18n.t('<div class="pw-row"><span>배터리 소비</span><b>') + fmt(s.inW, 2) + " W" + (s.battV > 0 ? " / " + fmt(s.battA, 2) + " A" : "") + "</b></div>";
      html += WE.i18n.t('<div class="pw-row"><span>하루 소비</span><b>') + fmt(s.inW * 24, 1) + WE.i18n.t(" Wh/일</b></div>");
      html += WE.i18n.t('<div class="pw-row"><span>배터리 가용용량</span><b>') + fmt(s.battWh, 1) + " Wh</b></div>";
      html += WE.i18n.t('<div class="pw-runtime"><span>배터리 지속</span><br><b class="pw-big">') + fmtRuntime(s.hours) + "</b></div>";
    } else {
      html += WE.i18n.t('<p class="muted" style="margin-top:6px">배터리 역할 부품을 넣으면 지속시간이 계산됩니다.</p>');
    }
    box.innerHTML = html;
  }

  // 빈 배선도로 되돌린다 (☰ 새로 만들기 / 복원 띠의 '새 배선도로 시작' 공용)
  function startNewProject() {
    // 비우기 전에 스냅샷을 남긴다. 실수로 눌렀더라도 ☰ → 이전 버전 복구로 되살릴 수 있어야 한다.
    WE.store.pushSnapshot();
    var prev = WE.model.project.meta.id;
    WE.model.newProject();           // 새 문서 id 발급 → 자기 슬롯을 새로 갖는다
    applyDefaultLayoutToProject();   // 새 배선도도 마지막 BOM 레이아웃 유지
    applyDefaultPaletteToProject();  // 새 배선도도 마지막 배선색 팔레트 유지
    WE.io.clearFileHandle();         // 이전 파일과의 연결 해제 → 다음 저장은 "다른 이름으로" 새로 지정
    reloadUI();
    WE.store.syncBaseline();
    WE.history.reset();
    // 이전 문서의 자동저장본은 지우지 않는다 — ☰ → 최근 작업에서 그대로 이어서 열 수 있다.
    // 점유만 놓아주어 다른 탭이 이어받을 수 있게 한다.
    WE.store.claimCurrent();   // 새 문서를 점유하고 이 탭의 문서로 기억 (옛 문서는 자동으로 놓아준다)
  }

  function bindFileButtons() {
    document.getElementById("btnNew").addEventListener("click", function () {
      if (!confirm(WE.i18n.t("현재 작업을 비우고 새 프로젝트를 시작할까요?\n(지금 작업은 ☰ → 최근 작업에서 다시 열 수 있습니다)"))) return;
      startNewProject();
      setHint(WE.i18n.t("새 배선도로 시작했습니다."), WE.i18n.t("새 배선도로 시작했습니다. 이전 작업은 ☰ 메뉴 → 최근 작업에서 이어서 열 수 있습니다."));
    });
    document.getElementById("btnUndo").addEventListener("click", function () { WE.history.doUndo(); });
    document.getElementById("btnRedo").addEventListener("click", function () { WE.history.doRedo(); });
  }

  /* ⊘ 숨기기 — 배선이 안 붙은 단자를 이 도면(현재 시트)에서 한 번에 숨긴다. (2026-09-07)

     예전에는 부품마다 단자 배치 창을 열고 "전체 미사용" 을 눌러야 했다. 부품이 열댓 개면
     그 짓을 열댓 번 한다. 실제 작업 흐름이 "다 그림 → 미연결 확인 → 정리" 라서
     점검 버튼 바로 옆이 제자리다.

     ⚠ 연결된 단자는 애초에 안 숨겨진다 — WE.model.setTerminalVisible 이 거부한다.
        그래서 여기서 따로 걸러낼 필요가 없고, 걸러내면 규칙이 두 곳에 생겨 갈라진다.

     ⚠ 범위는 **현재 시트**다. 옆의 미연결 확인이 현재 시트만 보므로 맞췄다 —
        나란히 둔 두 버튼이 서로 다른 범위를 보면 "확인한 것과 숨긴 것이 다른" 상태가 된다. */
  /* 이 버튼이 숨겨 둔 단자가 있는가 — 있으면 다음 누름은 '도로 보이기' 가 된다. */
  function 숨긴것있나() {
    return WE.model.project.components.some(function (c) {
      return (c.terminals || []).some(function (t) { return t.visible === false && t.autoHidden; });
    });
  }
  function syncHideUnusedBtn() {
    var b = document.getElementById("btnHideUnused"); if (!b) return;
    var 켜짐 = 숨긴것있나();
    b.classList.toggle("active", 켜짐);
    b.setAttribute("aria-pressed", 켜짐 ? "true" : "false");
  }

  function hideUnusedTerminals() {
    /* 한 번 더 누르면 되돌린다 — 실수로 눌렀을 때 되찾는 길을 버튼 자신이 갖고 있어야 한다.
       (2026-09-08 고원빈)

       ⚠ "전부 다시 보이게" 로 하면 안 된다. 사용자가 **예전에 일부러 숨겨 둔 단자**까지
          같이 켜져서, 되돌리는 것이 아니라 남의 작업을 망치는 것이 된다.
          그래서 이 버튼이 숨긴 것만 autoHidden 으로 표시해 두고 그것만 되돌린다. */
    if (숨긴것있나()) {
      var 되살림 = 0;
      WE.model.project.components.forEach(function (c) {
        (c.terminals || []).forEach(function (t) {
          if (t.visible === false && t.autoHidden && WE.model.setTerminalVisible(c, t.id, true)) 되살림++;
        });
      });
      WE.render.renderAll(); refreshProps(); syncHideUnusedBtn(); syncCheckTermHint();
      setHint(WE.i18n.t("숨겼던 단자 ") + 되살림 + WE.i18n.t("개를 도로 켰습니다"),
        WE.i18n.t("이 버튼으로 숨긴 것만 되돌립니다. 직접 끄신 단자는 그대로 둡니다."));
      return;
    }

    var 숨김 = 0, 부품 = 0;
    WE.model.project.components.forEach(function (c) {
      var 이번 = 0;
      (c.terminals || []).forEach(function (t) {
        if (t.visible === false) return;                       // 이미 숨겨져 있다
        if (WE.model.setTerminalVisible(c, t.id, false)) {      // 연결된 것은 여기서 거부된다
          t.autoHidden = true;                                  // 이 버튼이 숨긴 것 — 되돌릴 대상
          이번++;
        }
      });
      if (이번) { 숨김 += 이번; 부품++; }
    });
    if (!숨김) {
      setHint(WE.i18n.t("숨길 단자가 없습니다 — 보이는 단자가 모두 이어져 있습니다"));
      return;
    }
    WE.render.renderAll();
    refreshProps();
    syncHideUnusedBtn();
    /* 미연결 확인이 켜져 있었으면 끈다 (2026-09-08 고원빈).
       숨기고 나면 확인할 것이 화면에 없다 — 켜 둔 채로 두면 아무것도 강조되지 않는
       빈 점검 상태가 남고, "미연결이 없구나" 로 잘못 읽힌다.
       ⚠ setHint 보다 **먼저** 부른다 — 이 함수가 "미연결 확인 끔" 을 상태줄에 쓰므로,
          뒤에 두면 방금 무슨 일을 했는지 알려주는 문구를 덮어쓴다. */
    if (WE.model.ui.checkTerminals) toggleCheckTerminals();
    setHint(WE.i18n.t("안 쓰는 단자 ") + 숨김 + WE.i18n.t("개를 숨겼습니다 · 부품 ") + 부품 + WE.i18n.t("개에서"),
      WE.i18n.t("한 번 더 누르면 도로 보입니다. Ctrl+Z 로도 되돌아갑니다."));
  }

  // ---- 모드 (선택 / 배선 / 라벨 / 텍스트) ----
  function bindModes() {
    // ⚠ 미연결 확인 — 켜 두는 토글. 배타적 모드가 아니라 어느 모드에서든 켤 수 있다.
    document.getElementById("btnCheckTerm").addEventListener("click", toggleCheckTerminals);
    document.getElementById("btnHideUnused").addEventListener("click", hideUnusedTerminals);
    document.getElementById("modeSelect").addEventListener("click", function () { setMode("select"); });
    document.getElementById("modeWire").addEventListener("click", function () { setMode("wire"); });
    document.getElementById("modeLabel").addEventListener("click", function () { setMode("label"); });
    document.getElementById("modeText").addEventListener("click", function () { setMode("text"); });
  }
  function setMode(mode) {
    WE.model.ui.mode = mode;
    if (WE.interactions.resetWire) WE.interactions.resetWire();
    document.getElementById("modeSelect").classList.toggle("active", mode === "select");
    document.getElementById("modeWire").classList.toggle("active", mode === "wire");
    document.getElementById("modeLabel").classList.toggle("active", mode === "label");
    document.getElementById("modeText").classList.toggle("active", mode === "text");
    document.body.classList.toggle("wire-mode", mode === "wire");
    document.body.classList.toggle("text-mode", mode === "text");
    document.body.classList.toggle("label-mode", mode === "label");
    /* 라벨 모드에서만 우측 패널에 '다음에 붙일 글자' 를 보인다.
       ⚠ 들어갈 때마다 새로 채운다 — 그 도면에 이미 붙은 번호를 보고 다음 값을 고른다. */
    if (mode === "label") 라벨칸채우기();
    refreshProps();
    if (WE.render.setLabelPreview) WE.render.setLabelPreview(null);   // 모드 전환 시 미리보기 정리
    if (WE.render.setTextPreview) WE.render.setTextPreview(null);
    if (mode !== "select") { WE.model.clearSelection(); WE.render.renderOverlay(); refreshProps(); }
    // 짧은 안내를 보여주고, 원래의 자세한 설명은 툴팁으로 남긴다
    if (mode === "wire") {
      setHint(WE.i18n.t("단자나 배선을 클릭해 시작하세요."),
        WE.i18n.t("단자·기존 배선 어디서든 시작해 다른 단자나 배선에서 끝냅니다. 중간에 빈 곳을 클릭하면 수평·수직으로 꺾입니다. (Esc·우클릭: 취소 · Backspace: 한 점 무르기)"));
    } else if (mode === "text") {
      setHint(WE.i18n.t("캔버스를 클릭해 텍스트를 추가하세요."),
        WE.i18n.t("캔버스를 클릭해 텍스트를 추가하세요. (더블클릭으로 편집)"));
    } else if (mode === "label") {
      setHint(WE.i18n.t("라벨을 붙일 배선을 클릭하세요."),
        WE.i18n.t("라벨을 붙일 배선을 클릭하세요. 번호는 자동으로 매겨집니다. (더블클릭: 수정)"));
    } else {
      setHint("");
    }
  }

  /* ---- 라벨 모드의 '다음에 붙일 글자' 칸 (2026-09-09 고원빈) ----
     "라벨 버튼을 누르면 그 상태에서 Q1 R1 이런 식으로 바로 설정할 수 있게"
     "W1 W2 W3 으로 하다가 갑자기 Q1 Q2 Q3 이렇게 될 수도 있다"
     "꼭 저런 식이 아니라 그냥 텍스트만 입력할 수도 있고"

     ⚠ '접두사 설정' 이 아니라 **다음에 붙일 글자 그 자체**를 보여 준다. 그래야 도면 중간에
        규칙이 바뀌어도 칸만 고쳐 쓰면 되고, 숫자 없는 자유 글자도 그대로 쓸 수 있다.
     ⚠ 값은 어디에도 저장하지 않는다. 라벨 모드에 들어갈 때마다 이미 붙은 번호를 보고
        다음 값을 채운다 — 도면을 열 때마다 그 도면의 규칙을 따라간다. */
  function 라벨칸() { return document.getElementById("labelNext"); }

  function 라벨칸채우기() {
    var el =라벨칸(); if (!el) return;
    el.value = nextWireLabel();
  }

  // 지금 붙일 글자. 칸이 비어 있으면 자동 번호로 되돌린다.
  function 붙일라벨() {
    var el = 라벨칸();
    var v = el ? (el.value || "").trim() : "";
    return v || nextWireLabel();
  }

  /* 하나 붙인 뒤 다음 값. 끝이 숫자면 +1, 아니면 그대로.
     ⚠ 그대로 두는 쪽이 맞다 — "전원" 같은 글자를 억지로 올릴 수는 없고,
        같은 글자를 여러 배선에 붙이는 것도 정상적인 쓰임이다. */
  function 라벨칸올리기() {
    var el = 라벨칸(); if (!el) return;
    var m = /^(.*?)(\d+)$/.exec((el.value || "").trim());
    if (!m) return;
    var 다음 = String(parseInt(m[2], 10) + 1);
    // 자릿수를 맞춰 쓰고 있었다면(W01) 그대로 이어간다
    if (m[2].length > 1 && m[2][0] === "0") {
      while (다음.length < m[2].length) 다음 = "0" + 다음;
    }
    el.value = m[1] + 다음;
  }

  // 다음 자동 라벨 번호: 사용자가 마지막에 쓴 접두사(W/B/C 등)를 이어감 — "B3"까지 썼으면 "B4"
  function nextWireLabel() {
    // ★ 전체 시트를 훑는다. 현재 시트만 보면 시트마다 W1이 또 생겨,
    //   작업 지시서에서 같은 번호가 두 장에 나온다.
    var prefix = "W", maxN = 0;
    var re = /^([A-Za-z]+)-?(\d+)$/;
    var all = WE.model.allWires();
    all.forEach(function (w) {
      var m = re.exec((w.labelText || "").trim());
      if (m) prefix = m[1];   // 가장 나중 배선의 접두사가 남음
    });
    all.forEach(function (w) {
      var m = re.exec((w.labelText || "").trim());
      if (m && m[1].toLowerCase() === prefix.toLowerCase()) maxN = Math.max(maxN, parseInt(m[2], 10));
    });
    return prefix + (maxN + 1);
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
    var sz = WE.geometry.canvasSize();          // 페이지마다 다를 수 있다(2026-09-08)
    var before = canvas.getBoundingClientRect();
    var scaleOld = before.width / sz.width;
    if (clientX == null) { var wr = wrap.getBoundingClientRect(); clientX = wr.left + wr.width / 2; clientY = wr.top + wr.height / 2; }
    var px = (clientX - before.left) / scaleOld, py = (clientY - before.top) / scaleOld;
    _zoom = Math.max(0.15, Math.min(7, z));
    canvas.style.width = (sz.width * _zoom) + "px";
    canvas.style.height = (sz.height * _zoom) + "px";
    var after = canvas.getBoundingClientRect();
    wrap.scrollLeft += (after.left + px * _zoom) - clientX;   // 커서 지점 고정
    wrap.scrollTop += (after.top + py * _zoom) - clientY;
    if (WE.render.setViewZoom) WE.render.setViewZoom(_zoom);   // 단자 점 크기를 화면상 일정하게 유지
    updateZoomLabel();
  }
  function zoomBy(f, x, y) { setZoom(_zoom * f, x, y); }

  // 작업창 각인을 '보이는 도면의 좌하단'에 붙여 둔다.
  // 회색 여백에 두면 창 전체를 캡처할 때만 남고 도면만 잘라내면 사라진다 — 그래서 흰 도면 위에 얹는다.
  // 도면이 확대·스크롤로 화면 밖까지 나가면 보이는 부분 기준으로 자리를 잡아 늘 화면 안에 남는다.
  function syncCanvasMark() {
    var mark = document.getElementById("canvasMark");
    var canvas = document.getElementById("canvas"), wrap = document.getElementById("canvasWrap");
    if (!mark || !canvas || !wrap) return;
    // Pro 는 각인을 안 쓴다 (2026-09-06). 화면 각인도 같이 뗀다 — 결과물에는 안 나오는데
    // 작업 화면에만 남아 있으면 "샀는데 로고가 그대로네" 로 읽힌다.
    if (WE.pro && !WE.pro.watermark()) { mark.hidden = true; return; }
    mark.hidden = false;
    // BOM·배선 리스트는 같은 스크롤 영역 안에서 도면 아래에 붙는다. 탭을 바꾸면 도면 대부분이
    // 스크롤로 밀려나가 아래 겹침 계산이 자연히 '안 보임'으로 판정하지만, BOM·배선 리스트를
    // 연 채로 위로 스크롤해 도면이 다시 보이면 각인도 같이 있어야 한다 — 그래서 _view 로
    // 미리 끄지 않고 실제 겹침만으로 판단한다.
    // (2026-09-03 수정 — 예전엔 _view !== "wiring" 이면 무조건 껐다. BOM 화면에서 스크롤을
    //  올려 도면이 보여도 각인이 안 나와, 그 상태를 캡처하면 출처 표시가 빠지는 문제였다.)
    if (canvas.hidden) { mark.style.display = "none"; return; }
    mark.style.display = "";
    var c = canvas.getBoundingClientRect(), w = wrap.getBoundingClientRect(), p = wrap.offsetParent;
    var base = p ? p.getBoundingClientRect() : { left: 0, bottom: window.innerHeight };
    // 도면과 작업창이 겹치는 부분 = 지금 실제로 보이는 도면
    var left = Math.max(c.left, w.left), right = Math.min(c.right, w.right);
    var bottom = Math.min(c.bottom, w.bottom), top = Math.max(c.top, w.top);
    if (right - left < 60 || bottom - top < 30) { mark.style.display = "none"; return; }
    var PAD = 12;
    var btm = Math.round(base.bottom - bottom + PAD);
    mark.style.right = Math.round(base.right - right + PAD) + "px";
    mark.style.bottom = btm + "px";

    // 확대하면 도면이 작업창을 꽉 채워 각인이 확대·축소 버튼과 같은 자리에 놓인다.
    // 그때는 버튼 위로 비켜 준다 — 도구가 각인에 가려지면 안 되니까.
    var tools = document.querySelector(".canvas-corner-tools");
    if (tools) {
      var m = mark.getBoundingClientRect(), t = tools.getBoundingClientRect();
      if (m.right > t.left - 8 && m.left < t.right + 8 && m.bottom > t.top - 4 && m.top < t.bottom + 4) {
        mark.style.bottom = Math.round(base.bottom - t.top + 10) + "px";
      }
    }
  }
  function bindCanvasMark() {
    var wrap = document.getElementById("canvasWrap"), canvas = document.getElementById("canvas");
    if (!wrap || !canvas) return;
    var queued = false;
    function ping() {
      if (queued) return;                       // 스크롤 중 매 프레임 계산하지 않도록 묶는다
      queued = true;
      requestAnimationFrame(function () { queued = false; syncCanvasMark(); });
    }
    wrap.addEventListener("scroll", ping);
    window.addEventListener("resize", ping);
    // 여백은 창 높이에 딸린 값이라 창이 바뀌면 다시 잰다 (스크롤 때는 잴 필요가 없다)
    window.addEventListener("resize", function () {
      화면채우기(document.getElementById("bomView"));
      화면채우기(document.getElementById("wireListView"));
    });
    // 확대·축소는 canvas 의 width/height 를, 비고 바 펼침은 wrap 의 높이를 바꾼다.
    // 크기 변화를 직접 보면 각 기능의 구현을 몰라도 자리를 맞출 수 있다.
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(ping);
      ro.observe(canvas); ro.observe(wrap);
    }
    syncCanvasMark();
  }
  function fitZoom() {
    var wrap = document.getElementById("canvasWrap");
    var sz = WE.geometry.canvasSize();
    var z = Math.min((wrap.clientWidth - 60) / sz.width, (wrap.clientHeight - 60) / sz.height);
    setZoom(z);
  }

  /* 용지 크기가 바뀌었을 때 화면을 통째로 맞춘다.
     ⚠ viewBox 를 같이 고쳐야 한다 — 이게 좌표계라서, 안 고치면 부품이 늘어나 보인다.
     ⚠ 인쇄 전용 각인(#canvasMarkPrint)도 우하단에 붙어 있어야 하므로 함께 옮긴다.
     ⚠ @page 방향도 바꾼다 — 세로 도면을 가로 용지에 인쇄하면 반이 빈다. */
  /* 인쇄 용지 방향. 세로 도면을 가로 용지에 뽑으면 반이 빈다.

     ⚠ CSS 변수로는 못 한다 — 크롬은 @page 안에서 var() 를 풀지 않는다.
        규칙에 글자로는 남아 있어서 "썼으니 되겠지" 하고 넘어가기 딱 좋다(2026-09-08에 걸림).
        그래서 방향만 **글자 그대로** 규칙에 써 넣는다. 여백(margin)은 styles.css 에 그대로 둔다. */
  function setPageOrient(방향) {
    var st = document.getElementById("pageOrient");
    if (!st) {
      st = document.createElement("style");
      st.id = "pageOrient";
      document.head.appendChild(st);
    }
    /* 세 규칙을 **한 덩어리로** 넣는다.
       ⚠ 이름 없는 @page 는 모든 쪽에 걸린다. 이름 붙은 규칙(pr-wide/pr-tall)이 그것을
          이겨야 하는데, 둘이 다른 파일에 흩어져 있으면 나중에 온 쪽이 이긴다.
          같은 style 안에 **이름 없는 것 먼저, 이름 있는 것 나중에** 두면 순서가 확실하다.
       ⚠ 용지를 A4 로 박는다. 예전에는 방향만 적어서 브라우저 기본 용지(레터 279×216mm)가
          나왔다 — 이 앱의 인쇄 배치는 처음부터 A4(210×297) 기준이라 그만큼 어긋난다
          (2026-09-10 고원빈: "배치가 맞지 않는 것 같아"). 실측으로 확인했다. */
    var 원하는 =
      "@page { size: A4 " + 방향 + "; margin: 8mm; }" +
      "@page pr-wide { size: A4 landscape; margin: 8mm; }" +
      "@page pr-tall { size: A4 portrait; margin: 8mm; }";
    if (st.textContent !== 원하는) st.textContent = 원하는;
  }

  /* ── 인쇄했을 때 도면이 차지할 칸 (2026-09-08) ─────────────────────
     종이는 A4 로 본다. 브라우저는 실제 용지를 알려 주지 않고, 이 프로그램의
     인쇄 레이아웃은 처음부터 A4 로 맞춰 다듬어 왔다.

       인쇄 가능 폭  = 210 − 여백 8×2 = 194mm  (세로일 때. 가로면 297 − 16 = 281)
       머리글·범례 몫 = 35mm

     이 35mm 는 인쇄 매체에서 **실제로 재서** 나온 값이다(tests/probe_print.mjs) —
       제목칸 7.9 + 제목 아래 여백 3 + 밴드 위 여백 3 + 범례 밴드 19.4 = 33.3mm
     범례 밴드는 BAND_MAX_LINES(=4줄, js/pdf.js) 로 묶여 있어 19.4mm 가 천장이다.
     비고를 아무리 길게 써도 더 커지지 않으므로 예산이 흔들리지 않는다.
     남은 1.7mm 는 반올림·글꼴 차이 몫이다.

     ⚠ 왜 하필 35 인가 — 가로(1600×900) 출력이 예전과 **한 치도 달라지면 안 되기** 때문이다.
        그 배치는 수십 번 다듬어 확정한 것이다. 35mm 까지는 가로 가용 높이가 159mm 로
        1600×900 이 필요로 하는 158.1mm 보다 커서 폭이 먼저 걸린다 → 결과가 그대로다.
        36mm 로 올리면 158mm 가 되어 높이가 먼저 걸리고 도면이 0.1mm 줄어든다.
        즉 **가로를 안 건드리면서 세로 여유를 가장 많이 주는 값**이 35다.

     ⚠ 남은 위험: 도면 제목(프로젝트 이름)이 길어 두 줄로 접히면 제목칸이 6mm 쯤 커져
        1.7mm 여유를 넘어선다. 이건 예전부터 있던 위험이고(가로도 여유가 2.6mm 뿐이었다)
        이번에 더 나빠지지는 않았다. 실제로 겪으면 그때 제목을 한 줄로 묶어야 한다.

     ⚠ 폭·높이를 **둘 다** 준다. 폭만 100% 로 두면 비율이 안 맞을 때
        테두리는 지면 끝까지 가고 도면만 가운데로 쪼그라든다(= 신고된 증상). */
  var 종이_짧은쪽 = 210, 종이_긴쪽 = 297, 종이여백 = 8, 머리글과범례 = 35;
  function printBox(sz) {
    var 세로냐 = sz.height > sz.width;
    var 폭 = (세로냐 ? 종이_짧은쪽 : 종이_긴쪽) - 종이여백 * 2;
    var 높이 = (세로냐 ? 종이_긴쪽 : 종이_짧은쪽) - 종이여백 * 2 - 머리글과범례;
    var 배율 = Math.min(폭 / sz.width, 높이 / sz.height);
    return { w: sz.width * 배율, h: sz.height * 배율 };
  }
  function setPrintSize(sz) {
    var svg = document.getElementById("canvas"); if (!svg) return;
    var b = printBox(sz);
    // 인쇄에서만 쓰이는 값이다 — 화면 크기는 setZoom 이 정한다(@media print 에서만 읽는다).
    // ⚠ 인라인으로 둬야 한다: 여러 장 인쇄는 #canvas 를 시트마다 복제하는데(js/pdf.js),
    //    복제본이 자기 시트의 크기를 그대로 들고 가야 한다.
    svg.style.setProperty("--print-w", (Math.round(b.w * 10) / 10) + "mm");
    svg.style.setProperty("--print-h", (Math.round(b.h * 10) / 10) + "mm");
  }

  function applyCanvasSize() {
    var sz = WE.geometry.canvasSize();
    var svg = document.getElementById("canvas");
    if (svg) svg.setAttribute("viewBox", "0 0 " + sz.width + " " + sz.height);
    var mk = document.getElementById("canvasMarkPrint");
    if (mk) { mk.setAttribute("x", sz.width - 14); mk.setAttribute("y", sz.height - 14); }
    setPageOrient(sz.height > sz.width ? "portrait" : "landscape");
    setPrintSize(sz);
    if (WE.render.refreshWatermark) WE.render.refreshWatermark();   // 타일 범위가 달라진다
    setZoom(_zoom);                                                  // 픽셀 크기 다시 계산
  }
  /* ── 용지 크기 (페이지마다 다르게) ────────────────────────────────
     고원빈 확정 2026-09-08:
       · 페이지(시트) 단위다 — 파일 단위가 아니다
       · 부품은 **옮기지 않는다.** 자리가 모자라면 가장자리로 밀어 넣기만 한다
       · Ctrl+Z 로 되돌아가야 한다

     ⚠ 목록에 "A4" 를 함께 둔다. 지금 쓰던 1600×900 은 사실 16:9 라
        A4 용지에 인쇄하면 위아래가 남는다. 종이에 꽉 채우고 싶은 사람을 위해 √2 비율을 준다. */
  /* 용지는 둘뿐이다 — 둘 다 **A4 를 꽉 채운다** (2026-09-10 고원빈).

     예전에는 "A4 가로/세로" 를 따로 뒀다. 기본 세로(900×1600)가 A4 에 인쇄하면 좌우가
     많이 남아서, 종이를 채우고 싶은 사람에게 √2 비율을 따로 준 것이다.
     그런데 목록에 비슷한 항목이 넷이면 무엇을 골라야 하는지가 오히려 어려워진다.
     "세로형에서 여백이 많으면 그냥 에디터에서 가로 사이즈를 키우면 되는 거 아닌가" —
     맞는 말이라 **세로 자체를 채우는 비율로 바꾸고 A4 항목을 없앴다.**

     숫자의 근거 (printBox 참고, A4·여백 8mm·머리글과범례 35mm):
       가로 — 도면 칸 281 × 159mm. 1600×900 → 배율 min(281/1600, 159/900)=0.17563
              → 281.0 × 158.1mm. 폭을 꽉 채운다. **이 배치는 건드리지 않는다.**
       세로 — 도면 칸 194 × 246mm(비율 0.7886). 1262×1600 = 0.7888
              → 배율 min(194/1262, 246/1600)=0.15372 → 194.0 × 246.0mm. 딱 맞는다.
              (900×1600 은 0.5625 라 가로를 71% 만 썼다 — 그 29% 가 신고된 여백이다)

     ⚠ 예전에 900×1600 이나 1131×1600 으로 저장해 둔 도면은 **그대로 둔다.**
        목록에 없는 크기는 지금용지()가 null 을 주고 단추에 숫자로 표시된다. */
  var PAGE_SIZES = [
    { id: "wide",     이름: "가로형",    w: 1600, h: 900,  아이콘: "▭" },
    { id: "tall",     이름: "세로형",    w: 1262, h: 1600, 아이콘: "▯" }
  ];
  function 지금용지() {
    var sz = WE.model.sheetSize();
    for (var i = 0; i < PAGE_SIZES.length; i++) {
      if (PAGE_SIZES[i].w === sz.width && PAGE_SIZES[i].h === sz.height) return PAGE_SIZES[i];
    }
    return null;   // 목록에 없는 크기(예전 파일이 손으로 바꾼 값) — 그대로 존중한다
  }
  function syncPageSizeBtn() {
    var b = document.getElementById("btnPageSize"); if (!b) return;
    var cur = 지금용지(), sz = WE.model.sheetSize();
    b.textContent = cur ? (cur.아이콘 + " " + WE.i18n.t(cur.이름))
                        : ((sz.height > sz.width ? "▯ " : "▭ ") + sz.width + "×" + sz.height);
    b.title = WE.i18n.t("이 페이지의 용지 — ") + sz.width + "×" + sz.height + WE.i18n.t(" · 페이지마다 다르게 둘 수 있습니다");
  }
  function buildPageSizeMenu() {
    var m = document.getElementById("pageSizeMenu"); if (!m) return;
    var sz = WE.model.sheetSize();
    m.innerHTML = "";
    PAGE_SIZES.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = (p.w === sz.width && p.h === sz.height) ? "on" : "";
      /* ⚠ 예전에는 옆에 '1600×900' 같은 화면 크기를 함께 보였는데 걷어냈다. (2026-09-10)
         사용자에게 의미가 없는 숫자다 — 고르는 기준은 '종이를 눕히나 세우나' 뿐이고,
         두 값의 비율이 서로 달라서(각자 A4 가로·세로를 꽉 채우도록 정한 값이라 그렇다)
         나란히 놓으면 오히려 "왜 다르지?" 하는 의문만 만든다. */
      b.innerHTML = '<span>' + p.아이콘 + " " + esc(WE.i18n.t(p.이름)) + '</span>';
      b.addEventListener("click", function () { 용지바꾸기(p.w, p.h); closePageSizeMenu(); });
      m.appendChild(b);
    });
  }
  function openPageSizeMenu() {
    buildPageSizeMenu();
    document.getElementById("pageSizeMenu").hidden = false;
    document.getElementById("btnPageSize").setAttribute("aria-expanded", "true");
    setTimeout(function () { document.addEventListener("pointerdown", pageSizeOutside, true); }, 0);
  }
  function closePageSizeMenu() {
    var m = document.getElementById("pageSizeMenu"); if (!m) return;
    m.hidden = true;
    document.getElementById("btnPageSize").setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", pageSizeOutside, true);
  }
  function pageSizeOutside(e) {
    if (!e.target.closest(".canvas-size-pick")) closePageSizeMenu();
  }

  /* ⚠ 앞뒤로 commit 을 감싼다 — 이 동작 하나가 되돌리기 한 단계가 되게.
     history 는 0.7초마다 스스로 저장하는데, 그 타이밍에 맡기면 크기 변경과
     직전 작업이 한 단계로 뭉치거나 아예 안 남을 수 있다. 크기 변경은
     부품 위치까지 건드리므로 **확실히 되돌아가야 한다**(고원빈 요구). */
  function 용지바꾸기(w, h) {
    WE.history.commit();                       // 바꾸기 **전** 상태를 확실히 남긴다
    if (!WE.model.setSheetSize(w, h)) return;
    applyCanvasSize();
    WE.render.renderAll();
    refreshProps();
    syncPageSizeBtn();
    WE.history.commit();                       // 이 변경을 한 단계로 확정
    setHint(WE.i18n.t("용지를 ") + w + "×" + h + WE.i18n.t(" 로 바꿨습니다"),
      WE.i18n.t("부품은 그대로 두고, 새 용지 밖으로 나가는 것만 가장자리로 넣었습니다. Ctrl+Z 로 되돌릴 수 있습니다."));
  }
  /* ── 작성일 상자를 끌어서 옮긴다 (2026-09-09 고원빈) ──────────────
     예전에는 캔버스 위에 줄 하나(#canvasHeader)를 차지해 도면 볼 자리를 그만큼 먹었다.
     띄우고 나니 "저 자리가 도면과 겹친다" 는 경우가 생기므로 옮길 수 있어야 한다.

     ⚠ **손잡이로만** 끈다. 입력칸을 끌게 하면 날짜 글자를 선택할 수 없다.
     ⚠ 자리는 이 브라우저에만 기억한다 — 도면이 아니라 보는 사람의 취향이다.
        파일에 넣으면 남에게 보낼 때 그 사람 화면에서 엉뚱한 데 붙는다. */
  var _날짜자리키 = "we_datePos";

  function 날짜상자가두기() {
    var box = document.getElementById("canvasHeader");
    var wrap = document.getElementById("canvasWrap");
    if (!box || !wrap || !box.style.left) return;
    var W = wrap.clientWidth, H = wrap.clientHeight;
    var w = box.offsetWidth, h = box.offsetHeight;
    var x = Math.max(4, Math.min(parseFloat(box.style.left) || 0, Math.max(4, W - w - 4)));
    var y = Math.max(4, Math.min(parseFloat(box.style.top) || 0, Math.max(4, H - h - 4)));
    box.style.left = x + "px"; box.style.top = y + "px";
  }

  function bindDateDrag() {
    var box = document.getElementById("canvasHeader");
    var grip = box && box.querySelector(".fd-grip");
    var wrap = document.getElementById("canvasWrap");
    if (!box || !grip || !wrap) return;

    // 기억해 둔 자리로 되돌린다. 없으면 CSS 기본(우측 상단) 그대로 둔다.
    try {
      var 저장 = JSON.parse(localStorage.getItem(_날짜자리키) || "null");
      if (저장 && typeof 저장.x === "number" && typeof 저장.y === "number") {
        box.style.left = 저장.x + "px"; box.style.top = 저장.y + "px"; box.style.right = "auto";
        날짜상자가두기();
      }
    } catch (e) { /* 무시 — 기본 자리로 둔다 */ }

    var 끄는중 = null;
    grip.addEventListener("pointerdown", function (e) {
      var r = box.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      끄는중 = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      box.style.left = (r.left - wr.left) + "px";
      box.style.top = (r.top - wr.top) + "px";
      box.style.right = "auto";
      box.classList.add("dragging");
      try { grip.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    grip.addEventListener("pointermove", function (e) {
      if (!끄는중) return;
      var wr = wrap.getBoundingClientRect();
      box.style.left = (e.clientX - wr.left - 끄는중.dx) + "px";
      box.style.top = (e.clientY - wr.top - 끄는중.dy) + "px";
      날짜상자가두기();
    });
    function 끝() {
      if (!끄는중) return;
      끄는중 = null;
      box.classList.remove("dragging");
      try {
        localStorage.setItem(_날짜자리키, JSON.stringify({
          x: Math.round(parseFloat(box.style.left) || 0),
          y: Math.round(parseFloat(box.style.top) || 0)
        }));
      } catch (e) { /* 저장 못 해도 이번 화면에서는 그대로 쓴다 */ }
    }
    grip.addEventListener("pointerup", 끝);
    grip.addEventListener("pointercancel", 끝);

    // 창을 줄이면 상자가 화면 밖으로 나갈 수 있다 — 그때마다 도로 넣는다
    window.addEventListener("resize", 날짜상자가두기);
  }

  function bindPageSize() {
    var b = document.getElementById("btnPageSize"); if (!b) return;
    b.addEventListener("click", function () {
      if (document.getElementById("pageSizeMenu").hidden) openPageSizeMenu();
      else closePageSizeMenu();
    });
    syncPageSizeBtn();
  }

  function updateZoomLabel() {
    document.getElementById("btnZoomLevel").textContent = Math.round(_zoom * 100) + "%";
  }

  // ---- 좌/우 패널 크기 조절 ----
  // 패널 기본 너비 — 값을 여기 적어두면 CSS와 어긋나므로, 인라인 폭을 잠깐 걷어내고 CSS 값을 읽는다
  var _defaultPanelW = {};
  function defaultPanelWidth(panelId) {
    if (_defaultPanelW[panelId] != null) return _defaultPanelW[panelId];
    var panel = document.getElementById(panelId);
    var saved = panel.style.width;
    panel.style.width = "";
    var w = Math.round(panel.getBoundingClientRect().width);
    panel.style.width = saved;
    _defaultPanelW[panelId] = w;
    return w;
  }

  function bindResizers() {
    // 저장된 너비를 덮어쓰기 전에 CSS 기본값을 먼저 재둔다
    ["leftPanel", "rightPanel"].forEach(function (id) { defaultPanelWidth(id); });
    setupResizer("resizerLeft", "leftPanel", 1);
    setupResizer("resizerRight", "rightPanel", -1);
    // 저장된 너비 복원 — 한계 밖의 옛 값은 한계 안으로 당겨 넣는다.
    // (한계를 좁힌 뒤에도 예전에 저장해 둔 넓은 값이 그대로 살아나면 제한이 무의미해진다)
    ["leftPanel", "rightPanel"].forEach(function (id) {
      try {
        var w = parseFloat(localStorage.getItem("we_" + id + "W"));
        if (!(w > 0)) return;
        var lim = PANEL_LIMIT[id];
        document.getElementById(id).style.width = Math.max(lim.min, Math.min(lim.max, w)) + "px";
      } catch (e) { /* 무시 */ }
    });
  }
  // 패널별 너비 한계. 속성창은 값 확인·수정용이라 넓힐 이유가 없고,
  // 라이브러리는 부품 이름이 길어 조금 더 여유를 준다.
  var PANEL_LIMIT = {
    leftPanel: { min: 160, max: 420 },
    // 최소 225px — 다중 선택 시 나오는 정렬 버튼 줄이 그만큼을 요구한다.
    // 그보다 좁으면 '가로선 정렬' 같은 오른쪽 버튼이 잘려 못 누른다.
    // (실측 2026-08-18: 220px 에서 3px 모자라고 225px 부터 안 잘린다.
    //  내용 자체는 201px 이지만 패널 안쪽 여백 10px×2 와 테두리가 더 든다)
    // 넓게 쓰고 싶으면 사용자가 늘리면 된다. 최대는 300px.
    rightPanel: { min: 225, max: 300 }
  };
  function setupResizer(resId, panelId, dir) {
    var res = document.getElementById(resId), panel = document.getElementById(panelId);
    var startX = 0, startW = 0, dragging = false, moved = false;
    res.title = WE.i18n.t("드래그로 너비 조절 · 더블클릭하면 기본 너비로");
    res.addEventListener("pointerdown", function (e) {
      dragging = true; moved = false; startX = e.clientX; startW = panel.getBoundingClientRect().width;
      try { res.setPointerCapture(e.pointerId); } catch (_) {}
      document.body.style.cursor = "col-resize"; e.preventDefault();
    });
    window.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      if (Math.abs(e.clientX - startX) > 2) moved = true;
      var lim = PANEL_LIMIT[panelId];
      var w = Math.max(lim.min, Math.min(lim.max, startW + (e.clientX - startX) * dir));
      panel.style.width = w + "px";
    });
    window.addEventListener("pointerup", function (e) {
      if (!dragging) return;
      dragging = false; document.body.style.cursor = "";
      try { res.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!moved) return;   // 제자리 클릭(더블클릭의 절반)은 너비를 건드리지 않는다
      try { localStorage.setItem("we_" + panelId + "W", panel.style.width); } catch (_) {}
    });
    // 더블클릭 → 기본 너비로 되돌리기
    res.addEventListener("dblclick", function () {
      panel.style.width = defaultPanelWidth(panelId) + "px";
      try { localStorage.removeItem("we_" + panelId + "W"); } catch (_) {}
      setHint(WE.i18n.t("기본 너비로 되돌렸습니다."));
    });
  }

  // ---- 설정 (자동저장 등) ----
  var _settings = {
    autosaveEnabled: true, autosaveSec: 3,
    labelFontSize: 12, labelBold: true, labelBox: true,  // 부품명: 굵게 + 배경 사각블럭이 기본
    /* 구간 정렬로 배선을 나란히 놓을 때 줄 사이 간격(px).
       ⚠ 도면이 아니라 **작업하는 사람**에게 딸린 값이다 — 20으로 맞춰 쓰는 사람은
          다음 도면에서도 20을 쓴다. 그래서 파일이 아니라 여기(브라우저 설정)에 둔다.
          남에게 파일을 줘도 그 사람이 쓰던 간격을 덮어쓰지 않는다. (2026-09-08) */
    wireGap: 15,
    drawAnim: false,        // 촬영용: 배선을 긋는 모습 보이기 (관리자 전용)
    drawAnimSpeed: 500      // px/s
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
        if (s.wireGap >= 0) _settings.wireGap = s.wireGap;
        if (typeof s.drawAnim === "boolean") _settings.drawAnim = s.drawAnim;
        if (s.drawAnimSpeed > 0) _settings.drawAnimSpeed = s.drawAnimSpeed;
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
    var gapEl = document.getElementById("wireGap");
    if (gapEl) gapEl.value = String(_settings.wireGap);
  }

  /* 간격을 고칠 때마다 기억해 둔다.
     ⚠ 'change' 가 아니라 'input' 으로 받는다 — 화살표로 값을 올리다 창을 닫아도
        마지막 값이 남아야 한다. change 는 포커스를 잃어야 오는데 그때는 늦다. */
  function bindWireGap() {
    var el = document.getElementById("wireGap"); if (!el) return;
    el.addEventListener("input", function () {
      var v = parseInt(el.value, 10);
      if (!(v >= 0)) return;                 // 지우는 중(빈 칸)에는 저장하지 않는다
      _settings.wireGap = v;
      persistSettings();
    });
  }
  // 첫 방문 시 샘플 프로젝트(sample.json) 자동 로드 (한 번만). 없거나 file://면 그냥 빈 화면.
  // 첫 방문자에게 샘플 프로젝트 자동 표시.
  // sample.ezc는 "공유(🔗)" 버튼으로 내보낸 번들 파일을 그대로 사이트에 올린 것 —
  // 프로젝트+사용 부품(스펙·가격·데이터시트 포함)이 한 파일이라 DB 없이도 완전한 샘플이 되고,
  // 열면서 부품들이 방문자의 라이브러리(IndexedDB)에 병합되어 바로 재사용 가능.
  // 샘플 프로젝트 번역: 영어 UI에서는 도면 데이터(프로젝트명·부품명·팔레트 라벨)도 사전으로 치환
  // (데이터는 t()를 안 거치므로 로드 전에 한 번 변환 — 사전에 없는 이름은 그대로 유지)
  function translateSampleText(text) {
    if (WE.i18n.lang() === "ko") return text;
    try {
      var d = JSON.parse(text);
      var t = WE.i18n.t;
      var p = d.project || {};
      if (p.meta && p.meta.name) p.meta.name = t(p.meta.name);
      (p.components || []).forEach(function (c) { if (c.name) c.name = t(c.name); });
      (p.palette || []).forEach(function (x) { if (x.label) x.label = t(x.label); });
      (d.libraryParts || []).forEach(function (lp) { if (lp.name) lp.name = t(lp.name); });
      return JSON.stringify(d);
    } catch (e) { return text; }
  }

  function tryLoadSample(cb) {
    var seen;
    try { seen = localStorage.getItem("we_sampleShown"); } catch (e) { /* 무시 */ }
    if (seen || !window.fetch) { cb(false); return; }
    fetch("sample.ezc").then(function (r) {
      if (!r.ok) throw 0;
      return r.text();
    }).then(function (text) {
      JSON.parse(text);   // 손상된 파일이면 여기서 throw → 조용히 빈 화면으로 시작(알림창 없이)
      WE.io.loadProjectText(translateSampleText(text), WE.i18n.t("샘플 프로젝트"));
      try { localStorage.setItem("we_sampleShown", "1"); } catch (e) { /* 무시 */ }
      cb(true);
    }).catch(function () { cb(false); });
  }

  /* ---- 방문 안내 모달 ------------------------------------------------
     2026-09-01 고원빈 결정으로 **더 이상 띄우지 않는다.**

     왜 껐나: 들어오자마자 읽을 것을 내미는 것이 진입을 막는다.
              랜딩에서 이미 "무엇을 하는 도구인지" 를 다 말하고 들어온다.

     ⚠ 기능 코드는 지우지 않고 스위치만 내렸다 (SHOW_WIRE_LIST 와 같은 방식).
        다시 필요하면 이 값만 true 로 되돌리면 된다. HTML(#welcomeModal)도 그대로다.

     ⚠ 이 모달에 있던 "이용 시 개인정보처리방침에 동의한 것으로 간주됩니다" 안내가
        같이 사라졌다. 다만 법적 고지는 랜딩·푸터와 로그인 동의 화면이 맡고 있고,
        여기 것은 보조 안내였다. (로그인할 때는 별도 동의 절차가 그대로 있다) */
  var SHOW_WELCOME = false;

  /* ---- 베타 안내 모달 ------------------------------------------------
     아직 베타이므로 들어온 사람에게 한 번은 알린다(고원빈 결정 2026-09-03).

     ⚠ 새로고침마다 뜨면 성가시다. 그래서 닫으면 **그 탭에서는** 다시 안 뜬다
        (sessionStorage 는 탭 단위이고 새로고침에도 남는다).
        체크하면 7일간 아예 안 뜬다(localStorage).
     ⚠ 정식 출시하면 SHOW_BETA 만 false 로 내린다 — SHOW_WELCOME 과 같은 방식이다. */
  var SHOW_BETA = true;
  var 베타본키 = "we_betaSeen", 베타숨김키 = "we_betaHideUntil";

  function bindBeta() {
    var modal = document.getElementById("betaModal");
    if (!modal) return;
    var 숨길때까지 = 0, 이탭에서봤나 = false;
    try { 숨길때까지 = Number(localStorage.getItem(베타숨김키) || 0); } catch (e) { /* 무시 */ }
    try { 이탭에서봤나 = sessionStorage.getItem(베타본키) === "1"; } catch (e) { /* 무시 */ }
    if (SHOW_BETA && !이탭에서봤나 && Date.now() >= 숨길때까지) modal.hidden = false;

    document.getElementById("betaOk").addEventListener("click", function () {
      /* 확인을 누르면 7일 동안 안 뜬다.
         체크박스를 없애고(고원빈 2026-09-03: 「확인 버튼만 하나」) 기본 동작으로 옮겼다 —
         누를 것이 하나뿐인 창에서 「다시 보지 않기」를 또 고르게 할 이유가 없다. */
      try { localStorage.setItem(베타숨김키, String(Date.now() + 7 * 24 * 60 * 60 * 1000)); } catch (e) { /* 무시 */ }
      try { sessionStorage.setItem(베타본키, "1"); } catch (e) { /* 무시 */ }
      modal.hidden = true;
    });

    /* Esc 로도 닫는다. 이 앱에는 「모든 모달을 Esc 로 닫는」 공용 규칙이 없고
       모달마다 따로 붙여 왔다 — 여기서 구조를 바꾸지 않고 같은 방식을 따른다. */
    /* ⚠ 버튼에 focus() 를 주지 않는다. 브라우저가 검은 포커스 링을 그려서
       파란 버튼에 테두리가 두른 것처럼 보인다(고원빈 지적 2026-09-03).
       Enter 는 여기서 직접 받으므로 초점을 안 줘도 똑같이 동작한다. */
    document.addEventListener("keydown", function (e) {
      if (modal.hidden) return;
      if (e.key !== "Escape" && e.key !== "Enter") return;
      document.getElementById("betaOk").click();
    });
  }

  function bindWelcome() {
    var modal = document.getElementById("welcomeModal");
    var hideUntil = 0;
    try { hideUntil = Number(localStorage.getItem("we_welcomeHideUntil") || 0); } catch (e) { /* 무시 */ }
    if (SHOW_WELCOME && Date.now() >= hideUntil) modal.hidden = false;
    document.getElementById("welcomeStart").addEventListener("click", function () {
      if (document.getElementById("welcomeDismiss").checked) {
        try { localStorage.setItem("we_welcomeHideUntil", String(Date.now() + 24 * 60 * 60 * 1000)); } catch (e) { /* 무시 */ }
      }
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

  // ---- 출시 알림(이메일 수집) — Web3Forms 재사용. '가치를 준 뒤'에만 제안(내보내기/저장 완료 후) ----
  var _notifyOfferedThisSession = false;
  function hasNotifySubscribed() {
    try { return localStorage.getItem("we_notify_done") === "1"; } catch (e) { return false; }
  }
  function openNotifyModal(reason) {
    var lead = document.getElementById("notifyLead");
    // 완료 직후 제안이면 축하 문구, 링크로 직접 열면 기본 문구
    lead.innerHTML = reason === "after_export"
      ? WE.i18n.t("완성됐어요! 🎉 정식 출시·새 기능 소식을 이메일로 가장 먼저 알려드릴까요?<br />(스팸 없이 큰 소식만)")
      : WE.i18n.t("정식 출시·새 기능 소식을 이메일로 가장 먼저 알려드릴게요.<br />(스팸 없이 큰 소식만)");
    document.getElementById("notifyEmail").value = "";
    document.getElementById("notifyStatus").textContent = "";
    document.getElementById("notifyBotcheck").checked = false;
    document.getElementById("notifyModal").hidden = false;
    document.getElementById("notifyEmail").focus();
    track("notify_open", { reason: reason || "manual" });
  }
  // 내보내기/저장 완료 후 호출 — 이미 구독했거나 이번 세션에 한 번 제안했으면 다시 안 뜸(벽 방지)
  function offerNotifyAfterValue() {
    // ⚠ 출시 후에는 제안하지 않는다. "정식 출시 소식을 알려드릴게요" 는
    //    이미 출시된 서비스에서는 말이 안 된다. (아래 bindNotify 도 같이 막는다)
    if (WE.flags && WE.flags.LAUNCH) return;
    if (hasNotifySubscribed() || _notifyOfferedThisSession) return;
    _notifyOfferedThisSession = true;
    setTimeout(function () { openNotifyModal("after_export"); }, 700);   // 저장/다운로드 끝난 뒤 살짝 여유
  }
  function bindNotify() {
    var 알림버튼 = document.getElementById("btnNotify");

    /* ⚠ 출시 후에는 「🔔 출시 알림」 자체가 사라진다.
       출시 전 베타에서 "정식 출시되면 알려드릴게요" 로 이메일을 받던 기능이라,
       출시하고 나면 문구도 목적도 성립하지 않는다.

       ⚠ 파일에서 지우지 않고 플래그로 끄는 이유 —
          app.html(에디터)은 출시준비에만 있다. 예전에는 양쪽 index.html 이 둘 다
          에디터였는데, 2026-09-11 에 랜딩을 루트로 올리며 에디터를 app.html 로 옮겼다.
          한쪽에서만 지우면
          병합할 때 충돌한다(CLAUDE.md §2). 그리고 9/1 에 손으로 지우려면 잊는다.
          LAUNCH 가 켜지는 순간 자동으로 사라지는 편이 안전하다.

       지금 어디서 꺼지나 — 미리보기 · 로컬(?launch=1) · 출시 후.
       베타 본서비스(easycable.co.kr)에서는 그대로 보인다. */
    if (WE.flags && WE.flags.LAUNCH) {
      if (알림버튼) 알림버튼.hidden = true;
      return;   // 모달을 여는 길 자체를 막는다
    }

    알림버튼.addEventListener("click", function () { openNotifyModal("manual"); });
    document.getElementById("notifyClose").addEventListener("click", function () {
      document.getElementById("notifyModal").hidden = true;
    });
    document.getElementById("notifySend").addEventListener("click", sendNotify);
    document.getElementById("notifyEmail").addEventListener("keydown", function (e) {
      if (e.key === "Enter") sendNotify();
    });
  }
  function sendNotify() {
    var emailEl = document.getElementById("notifyEmail");
    var email = emailEl.value.trim();
    var statusEl = document.getElementById("notifyStatus");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { statusEl.textContent = WE.i18n.t("올바른 이메일 주소를 입력해주세요."); emailEl.focus(); return; }
    if (document.getElementById("notifyBotcheck").checked) { statusEl.textContent = WE.i18n.t("감사합니다!"); return; }   // 허니팟
    var btn = document.getElementById("notifySend");
    btn.disabled = true; statusEl.textContent = WE.i18n.t("등록 중…");
    fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        access_key: WEB3FORMS_KEY,
        subject: WE.i18n.t("[이지케이블] 출시 알림 신청"),
        from_name: WE.i18n.t("이지케이블 출시알림"),
        message: WE.i18n.t("출시 알림 신청 이메일: ") + email,
        email: email,
        botcheck: false
      })
    }).then(function (r) { return r.json(); }).then(function (res) {
      btn.disabled = false;
      if (res.success) {
        try { localStorage.setItem("we_notify_done", "1"); } catch (e) { /* 무시 */ }
        track("notify_subscribe");
        statusEl.textContent = WE.i18n.t("등록됐습니다. 소식이 있을 때 알려드릴게요. 감사합니다! 🙌");
        setTimeout(function () { document.getElementById("notifyModal").hidden = true; }, 1200);
      } else {
        statusEl.textContent = WE.i18n.t("등록 실패: ") + (res.message || WE.i18n.t("잠시 후 다시 시도해주세요."));
      }
    }).catch(function () {
      btn.disabled = false;
      statusEl.textContent = WE.i18n.t("네트워크 오류로 등록하지 못했습니다.");
    });
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
        return WE.i18n.t("잠시 후 다시 보내주세요. (") + sec + WE.i18n.t("초)");
      }
      var today = new Date().toDateString();
      if (localStorage.getItem("we_fb_day") === today &&
          Number(localStorage.getItem("we_fb_count") || 0) >= FB_DAILY_MAX) {
        return WE.i18n.t("오늘은 더 보낼 수 없습니다. 급하시면 ") + FEEDBACK_EMAIL + WE.i18n.t(" 으로 보내주세요.");
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
      "?subject=" + encodeURIComponent(WE.i18n.t("[이지케이블] 피드백")) +
      "&body=" + encodeURIComponent(text);
    statusEl.innerHTML += ' <a href="' + href + WE.i18n.t('">메일로 보내기</a>');
  }

  function sendFeedback() {
    var text = document.getElementById("feedbackText").value.trim();
    var statusEl = document.getElementById("feedbackStatus");
    if (!text) { statusEl.textContent = WE.i18n.t("내용을 입력해주세요."); return; }
    // 허니팟: 사람은 절대 체크할 수 없는 숨은 필드 → 채워져 있으면 봇으로 보고 조용히 무시
    if (document.getElementById("feedbackBotcheck").checked) {
      statusEl.textContent = WE.i18n.t("전달됐습니다. 감사합니다!");
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
    statusEl.textContent = WE.i18n.t("보내는 중…");
    fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        access_key: WEB3FORMS_KEY,
        subject: WE.i18n.t("[이지케이블] 피드백"),
        from_name: WE.i18n.t("이지케이블 피드백"),
        message: text,
        botcheck: false,
        브라우저: navigator.userAgent
      })
    }).then(function (r) { return r.json(); }).then(function (res) {
      btn.disabled = false;
      if (res.success) {
        feedbackMarkSent();
        track("feedback_sent");
        statusEl.textContent = WE.i18n.t("전달됐습니다. 감사합니다!");
        setTimeout(function () { document.getElementById("feedbackModal").hidden = true; }, 900);
      } else {
        // 무료 한도 초과 등으로 실패해도 의견이 유실되지 않도록 메일 경로 안내
        statusEl.textContent = WE.i18n.t("전송 실패: ") + (res.message || WE.i18n.t("다시 시도해주세요."));
        showMailFallback(statusEl, text);
      }
    }).catch(function () {
      btn.disabled = false;
      statusEl.textContent = WE.i18n.t("네트워크 오류로 전송하지 못했습니다.");
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
    betaModal: "betaOk",
    helpModal: "helpClose",
    feedbackModal: "feedbackClose",
    historyModal: "historyClose",
    notifyModal: "notifyClose"
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
      document.getElementById("setDrawAnim").checked = !!_settings.drawAnim;
      document.getElementById("setDrawAnimSpeed").value = String(_settings.drawAnimSpeed || 500);
      document.getElementById("settingsModal").hidden = false;
    });
    document.getElementById("setClose").addEventListener("click", function () {
      document.getElementById("settingsModal").hidden = true;
    });
    document.getElementById("setDrawAnim").addEventListener("change", function (e) {
      _settings.drawAnim = e.target.checked; persistSettings();
    });
    document.getElementById("setDrawAnimSpeed").addEventListener("change", function (e) {
      _settings.drawAnimSpeed = parseInt(e.target.value, 10) || 500; persistSettings();
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
  var _shortcuts = { "mode-select": "v", "mode-wire": "w", "mode-label": "l", "mode-text": "t" };
  function loadShortcuts() {
    try { var r = localStorage.getItem("we_shortcuts"); if (r) { var s = JSON.parse(r); for (var k in _shortcuts) if (s[k] !== undefined) _shortcuts[k] = s[k]; } }
    catch (e) { /* 무시 */ }
  }
  function saveShortcuts() { try { localStorage.setItem("we_shortcuts", JSON.stringify(_shortcuts)); } catch (e) {} }
  function scLabel(k) { return k ? (k.length === 1 ? k.toUpperCase() : k) : WE.i18n.t("(없음)"); }
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
  //
  // 같은 모드 키를 다시 누르면 선택 모드로 돌아온다 — 배선·라벨·텍스트는 모두
  // '잠깐 들어갔다 나오는' 모드라, 나올 때 다른 키를 찾지 않아도 되게 한 키로 왕복시킨다.
  // 규칙은 모드 키 전체에 같이 적용한다(W만 되면 "왜 L은 안 되지"가 된다).
  // 예외 둘:
  //  - 선택 모드는 돌아갈 곳이 없으므로 토글하지 않는다.
  //  - 배선을 그리는 중이면 토글하지 않는다(allowToggle=false). 다시 그리려고 누른 건데
  //    그리던 배선이 사라지면 곤란하다. 그리던 것 취소는 Esc가 맡는다.
  function handleShortcut(key, allowToggle) {
    key = (key || "").toLowerCase();
    if (!key) return false;
    for (var action in _shortcuts) {
      if (!_shortcuts[action] || _shortcuts[action] !== key) continue;
      if (action.indexOf("mode-") !== 0) continue;
      var target = action.slice(5);                       // "select" | "wire" | "label" | "text"
      if (allowToggle !== false && target !== "select" && WE.model.ui.mode === target) target = "select";
      // 이미 그 모드면 아무것도 하지 않는다. setMode 는 안에서 resetWire() 를 부르므로
      // 그냥 다시 설정하기만 해도 그리던 배선이 사라진다 — 배선 도중 W 를 눌렀을 때가 그 경우다.
      if (target === WE.model.ui.mode) return true;
      setMode(target);
      if (target === "wire") openQuickColorPicker(); else closeQuickColorPicker();
      return true;
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
      sw.addEventListener("click", function () { pickQuickColor(p); });
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
  /* 팔레트 색 하나를 지금 배선에 적용한다 — 색만이 아니라 그 색에 매인 굵기·규격까지.
     p 는 팔레트 항목 { color, label, width?, awg? }.
     · width/awg 가 있으면 그 값을, 없으면 색만 바꾸고 굵기·규격은 건드리지 않는다
       (규격 없는 색을 골랐다고 이미 정한 굵기를 지우면 안 된다).
     · 배선을 골라 뒀으면 그 배선들에도 같은 값을 입힌다(색과 같은 규칙). */
  function applyPalette(p) {
    if (!p) return;
    WE.model.ui.wireColor = p.color;
    // 굵기는 색마다 반드시 있다(미지정이면 기본 2). 색을 고르면 그 굵기가 늘 따라온다.
    var wv = (p.width != null && p.width !== "" && !isNaN(+p.width)) ? +p.width : 2;
    WE.model.ui.wireWidth = wv;
    var wIn = document.getElementById("wireWidthSel");
    if (wIn) wIn.value = String(wv);
    var hasW = true;
    var hasA = typeof p.awg === "string" && p.awg !== "";
    WE.model.ui.wireAwg = hasA ? p.awg : "";
    saveWireSettings();
    var 대상 = WE.model.getMultiWire();
    if (!대상.length) { var one = WE.model.getSelectedWire(); if (one) 대상 = [one.id]; }
    if (대상.length) {
      대상.forEach(function (id) {
        var w = WE.model.getWire(id); if (!w) return;
        w.color = p.color;
        if (hasW) w.width = +p.width;
        w.awg = hasA ? p.awg : "";
      });
      WE.render.renderWires(); WE.render.renderOverlay();
    }
    renderPalette();
    refreshProps();
  }
  // 빠른 색상 팝업에서 부른다 — 팝업만 닫고 나머지는 applyPalette 가 한다.
  function pickQuickColor(p) {
    applyPalette(typeof p === "string" ? { color: p } : p);
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
    if (x1 === Infinity) { setHint(WE.i18n.t("내보낼 내용이 없습니다. 부품을 먼저 배치하세요.")); return; }
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
    /* 격자는 통째로 뺀다.
       ⚠ 예전에는 `grid.setAttribute("fill", "#ffffff")` 로 흰색을 칠했는데 **안 먹었다** —
          바로 위 반복문이 이미 복제본에 style="fill:url(#gridPattern)" 을 박아 놓았고
          인라인 style 이 attribute 를 이긴다. 그래서 이미지에 격자가 그대로 남아 있었다.
          PDF 쪽(pdf.js buildSheetPages)도 같은 이유로 지운다 — 칠하지 말고 없앤다.
          배경 흰색은 아래 캔버스가 fillRect 로 먼저 칠한다. */
    var grid = clone.querySelector("#gridBg");
    if (grid && grid.parentNode) grid.parentNode.removeChild(grid);

    /* 인쇄 전용 각인(#canvasMarkPrint)도 지운다. styles.css 의 display:none 은 화면 안에서만
       먹는 규칙이라, 잘라낸 SVG 를 홀로 띄우면(styles.css 를 안 물고 오므로) 기본값(보임)으로
       같이 찍혀 아래서 새로 넣는 PNG 전용 각인과 겹쳐 두 번 찍힌다. */
    var markPrint = clone.querySelector("#canvasMarkPrint");
    if (markPrint && markPrint.parentNode) markPrint.parentNode.removeChild(markPrint);

    var W = x2 - x1, H = y2 - y1, SCALE = 2;
    clone.setAttribute("viewBox", x1 + " " + y1 + " " + W + " " + H);

    /* ── 워터마크를 '내보낼 범위'에 맞춰 다시 깐다 ────────────────────────
       ⚠ 왜 다시 까는가 (2026-08-26 에 실측으로 드러난 결함) —
          render.js 의 buildWatermark() 는 타일을 **고정 좌표**에만 깐다
          (x 120~2060 · y 140~1130, 23개). 내보내기는 내용 범위로 viewBox 를
          바꾸므로 두 사각형이 어긋나고, 어긋난 만큼 워터마크가 없다.
          부품을 아래쪽에 놓고 내보내면 **워터마크가 통째로 없는 이미지**가 나왔다 —
          무료 사용자가 서명 없는 결과물을 얻는 우회로였다.

       ⚠ 스타일을 손으로 적지 않고 화면의 견본에서 베낀다.
          내보낸 SVG 는 홀로 서는 파일이라 styles.css 가 따라가지 않는다.
          여기에 색·크기를 또 적어두면 CSS 를 고칠 때 이쪽만 남아 어긋난다. */
    var wm = clone.querySelector("#layerWatermark");
    /* ⚠ Pro 는 여기서 끝난다. render.js 에서 화면 레이어를 비워도 이 코드가 견본 없이
       기본 문구로 **다시 채우므로**, 여기를 막지 않으면 Pro 가 내보낸 PNG 에 워터마크가
       그대로 남는다 (2026-09-06). */
    if (wm && WE.pro && !WE.pro.watermark()) {
      while (wm.firstChild) wm.removeChild(wm.firstChild);
      wm = null;
    }
    if (wm) {
      var 견본 = svg.querySelector("#layerWatermark text");
      var 무늬style = "";
      if (견본) {
        var cs2 = getComputedStyle(견본);
        for (var q = 0; q < PROPS.length; q++) {
          var v2 = cs2.getPropertyValue(PROPS[q]);
          if (v2) 무늬style += PROPS[q] + ":" + v2 + ";";
        }
      }
      var 문구 = 견본 ? 견본.textContent : "EasyCable · easycable.co.kr";
      wm.setAttribute("style", "display:block");   // 화면에선 숨긴 레이어다
      while (wm.firstChild) wm.removeChild(wm.firstChild);

      // 한 칸씩 더 바깥에서 시작해 가장자리에도 빈틈이 없게 한다
      var COL_W = 460, ROW_H = 230;
      for (var r2 = 0, wy = y1 - ROW_H; wy < y2 + ROW_H; r2++, wy += ROW_H) {
        var off = (r2 % 2) ? COL_W / 2 : 0;        // 벽돌식 엇배치 — 화면과 같은 규칙
        for (var wx = x1 - COL_W + off; wx < x2 + COL_W; wx += COL_W) {
          var t2 = document.createElementNS("http://www.w3.org/2000/svg", "text");
          t2.setAttribute("transform", "translate(" + wx + "," + wy + ") rotate(-30)");
          t2.setAttribute("text-anchor", "middle");
          t2.setAttribute("style", 무늬style);
          t2.textContent = 문구;
          wm.appendChild(t2);
        }
      }
    }

    /* 대각선 워터마크는 옅게 반복돼 눈에 잘 안 띌 수 있다 — 내보낸 범위(x1~x2,y1~y2)의
       우하단에 뚜렷한 로고 각인 하나를 더 찍는다. 화면 전용 #canvasMark 와 같은 문구·색이지만
       이건 실제 출력물 안에 들어가는 별개의 표식이다(작업 화면 로고 ≠ 결과물 서명). (2026-09-03) */
    var markPad = 14;
    // Pro 는 각인 없이 내보낸다 (2026-09-06)
    if (!WE.pro || WE.pro.watermark()) {
      var mark2 = document.createElementNS("http://www.w3.org/2000/svg", "text");
      mark2.setAttribute("x", x2 - markPad);
      mark2.setAttribute("y", y2 - markPad);
      mark2.setAttribute("text-anchor", "end");
      mark2.setAttribute("style",
        "font:700 44px 'Segoe UI','Malgun Gothic',sans-serif;letter-spacing:.1em;" +
        "fill:#5a6675;opacity:.35;" +
        "text-shadow:0 1px 0 rgba(255,255,255,.55), 0 -1px 0 rgba(255,255,255,.35);");
      mark2.textContent = "EASYCABLE";
      clone.appendChild(mark2);
    }

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
        if (!blob) { setHint(WE.i18n.t("이미지 생성에 실패했습니다.")); return; }
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = ((WE.model.project.meta.name || WE.i18n.t("배선도")).replace(/[\\/:*?"<>|]/g, "_")) + ".png";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        track("export", { method: "png" });
        setHint(WE.i18n.t("이미지 저장 완료 (PNG)"));
        offerNotifyAfterValue();
      }, "image/png");
    };
    img.onerror = function () { URL.revokeObjectURL(svgUrl); setHint(WE.i18n.t("이미지 생성에 실패했습니다.")); };
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
          box.innerHTML = WE.i18n.t("<p class='muted'>아직 보관된 스냅샷이 없습니다. 작업을 시작하면 5분 간격으로 자동 보관됩니다.</p>");
        } else {
          box.innerHTML = list.map(function (s, i) {
            return "<div class='history-row'>" +
              "<div class='history-info'><b>" + fmtSnapTime(s.t) + "</b>" +
              "<span class='muted'> — " + esc(s.name || WE.i18n.t("이지케이블 배선도")) +
              WE.i18n.t(" (부품 ") + s.comps + WE.i18n.t(" · 배선 ") + s.wires + ")</span></div>" +
              "<button class='history-restore' data-i='" + i + WE.i18n.t("'>복구</button></div>");
          }).join("");
        }
        modal.hidden = false;
      });
    });
    document.getElementById("historyClose").addEventListener("click", function () { modal.hidden = true; });
    document.getElementById("historyList").addEventListener("click", function (e) {
      var btn = e.target.closest(".history-restore"); if (!btn) return;
      var s = _snapList[+btn.dataset.i]; if (!s) return;
      if (!confirm(fmtSnapTime(s.t) + WE.i18n.t(" 시점으로 되돌릴까요?\n(지금 화면의 작업은 사라집니다)"))) return;
      try {
        // 스냅샷은 첨부물이 자산 참조로 빠진 형태로 보관된다 →
        // 되돌리지 않으면 부품 그림 자리에 참조 문자열이 들어가 단자만 보인다
        WE.model.loadProject(WE.assets.unpack(JSON.parse(s.json)));
      } catch (err) { alert(WE.i18n.t("스냅샷을 읽을 수 없습니다: ") + err.message); return; }
      WE.io.clearFileHandle();   // 옛 버전이 연결된 파일을 조용히 덮어쓰지 않도록 연결 해제
      reloadUI();
      if (WE.history) WE.history.reset();
      WE.store.saveNow();
      modal.hidden = true;
      setHint(WE.i18n.t("복구 완료: ") + fmtSnapTime(s.t) + WE.i18n.t(" 시점"));
    });
  }

  // ---- 최근 작업 목록 (문서별 자동저장본) ----
  var _recentList = [];
  function bindRecentModal() {
    var modal = document.getElementById("recentModal");
    document.getElementById("btnRecent").addEventListener("click", function () {
      WE.store.listDrafts(function (list) {
        _recentList = list;
        var here = WE.store.docId();
        var box = document.getElementById("recentList");
        if (!list.length) {
          box.innerHTML = WE.i18n.t("<p class='muted'>아직 보관된 작업이 없습니다.</p>");
        } else {
          box.innerHTML = list.map(function (d, i) {
            var isHere = d.id === here;
            var busy = !isHere && WE.store.claimedByOther(d.id);
            var tag = isHere ? WE.i18n.t(" · 지금 편집 중")
                    : busy ? WE.i18n.t(" · 다른 탭에서 편집 중") : "";
            return "<div class='history-row'>" +
              "<div class='history-info'><b>" + fmtSavedAt(d.t) + "</b>" +
              "<span class='muted'> — " + esc(d.name || WE.i18n.t("이지케이블 배선도")) +
              WE.i18n.t(" (부품 ") + d.comps + WE.i18n.t(" · 배선 ") + d.wires + ")" + tag + "</span></div>" +
              (isHere ? "" : "<button class='history-restore' data-i='" + i + WE.i18n.t("'>열기</button>")) +
              "</div>";
          }).join("");
        }
        modal.hidden = false;
      });
    });
    document.getElementById("recentClose").addEventListener("click", function () { modal.hidden = true; });
    document.getElementById("recentList").addEventListener("click", function (e) {
      var btn = e.target.closest(".history-restore"); if (!btn) return;
      var d = _recentList[+btn.dataset.i]; if (!d) return;
      if (WE.store.claimedByOther(d.id) &&
          !confirm(WE.i18n.t("이 작업은 다른 탭에서 편집 중입니다.\n그래도 여시겠습니까? (두 탭이 서로 덮어쓸 수 있습니다)"))) return;
      // 지금 화면의 작업은 자기 슬롯에 남으므로 잃지 않는다
      WE.store.saveNow();
      var prev = WE.store.docId();
      WE.store.loadDraft(d.id, function (proj) {
        if (!proj) { alert(WE.i18n.t("작업을 읽을 수 없습니다.")); return; }
        WE.model.loadProject(proj);
        WE.io.clearFileHandle();   // 자동저장본은 아직 어떤 파일에도 담기지 않은 상태
        reloadUI();
        if (WE.history) WE.history.reset();
        WE.store.syncBaseline();
        WE.store.claimCurrent();
        modal.hidden = true;
        setHint(WE.i18n.t("불러왔습니다: ") + (d.name || WE.i18n.t("이지케이블 배선도")));
      });
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
    });
    // 내보내기 하위 옵션(PDF/PNG)은 CSS 우측 플라이아웃(:hover)으로 펼침 — '내보내기' 자체 클릭은 드로어를 닫지 않음
    // 항목 클릭(각자의 핸들러 실행 후) / 바깥 클릭 / Esc → 닫기
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
    document.getElementById("btnSaveAsMenu").addEventListener("click", function () { WE.io.saveAs(); });
    document.getElementById("btnPng").addEventListener("click", exportPng);

    bindHistoryModal();

    // 샘플 프로젝트 열기 (사이트에 올려둔 sample.ezc — 공유 번들이라 부품·스펙까지 온전)
    document.getElementById("btnSample").addEventListener("click", function () {
      if (!confirm(WE.i18n.t("현재 작업을 비우고 샘플 프로젝트를 열까요?\n(저장 안 한 내용은 사라집니다)"))) return;
      fetch("sample.ezc").then(function (r) {
        if (!r.ok) throw 0;
        return r.text();
      }).then(function (text) {
        JSON.parse(text);
        track("open_sample");
        WE.io.loadProjectText(translateSampleText(text), WE.i18n.t("샘플 프로젝트"));
      }).catch(function () {
        setHint(WE.i18n.t("샘플 프로젝트가 아직 준비되지 않았습니다."));
      });
    });
  }
  function renderHelpShortcuts() {
    var rows = [
      [WE.i18n.t("선택 모드"), scLabel(_shortcuts["mode-select"])],
      [WE.i18n.t("배선 모드 (진입 시 배선색 팝업 자동 표시)"), scLabel(_shortcuts["mode-wire"])],
      [WE.i18n.t("라벨 모드"), scLabel(_shortcuts["mode-label"])],
      [WE.i18n.t("텍스트 모드"), scLabel(_shortcuts["mode-text"])],
      [WE.i18n.t("실행 취소 / 다시 실행"), "Ctrl+Z / Ctrl+Shift+Z"],
      [WE.i18n.t("부품 복제"), "Ctrl+D"],
      [WE.i18n.t("화면 이동(팬)"), WE.i18n.t("Space 드래그 · 휠클릭 드래그")],
      [WE.i18n.t("확대 / 축소"), WE.i18n.t("Ctrl+휠")],
      [WE.i18n.t("선택 항목 이동 (Shift: 1px 미세)"), WE.i18n.t("방향키")],
      [WE.i18n.t("단자명·부품명 이동"), WE.i18n.t("Alt+드래그")],
      [WE.i18n.t("단자명·부품명 위치 초기화"), WE.i18n.t("Alt+더블클릭")],
      [WE.i18n.t("단자 이름 위치 초기화"), WE.i18n.t("부품 더블클릭")],
      [WE.i18n.t("선택 항목 삭제"), "Delete / Backspace"],
      [WE.i18n.t("즉시 저장"), "Ctrl+S"],
      [WE.i18n.t("다른 이름으로 저장"), "Ctrl+Shift+S"],
      [WE.i18n.t("파일 열기"), "Ctrl+O"],
      [WE.i18n.t("라이브러리 폴더 전체 접기/펼치기"), "Shift+C"],
      [WE.i18n.t("배선 라벨 지우기 (양 끝 모두)"), "Delete"],
      [WE.i18n.t("배선 라벨 한쪽 끝만 감추기"), "Shift+Delete"],
      [WE.i18n.t("이 도움말"), "?"]
    ];
    document.getElementById("helpShortcutList").innerHTML = rows.map(function (r) {
      return "<div class='sc-row'><span>" + esc(r[0]) + "</span><b>" + esc(r[1]) + "</b></div>";
    }).join("");
  }

  // 배선 기본값(색·두께) 마지막 설정 기억
  function loadWireSettings() {
    try {
      var w = localStorage.getItem("we_wireWidth");
      /* ⚠ 상한을 30 → 15 로 낮췄다(2026-09-09). 그 전에 저장된 값이 그대로 돌아오면
         칸에는 15 가 최대라고 적혀 있는데 실제로는 20 이 들어가 있는 상태가 된다. */
      if (w) {
        var wv = parseInt(w, 10);
        if (!isNaN(wv)) WE.model.ui.wireWidth = Math.max(1, Math.min(WIRE_WIDTH_MAX, wv));
      }
      var c = localStorage.getItem("we_wireColor");
      if (c) WE.model.ui.wireColor = c;
      var ag = localStorage.getItem("we_wireAwg");
      if (ag != null) WE.model.ui.wireAwg = ag;
      var r = localStorage.getItem("we_wireRouting");
      if (r === "ortho" || r === "straight") WE.model.ui.wireRouting = r;
    } catch (e) { /* 무시 */ }
  }
  function saveWireSettings() {
    try {
      localStorage.setItem("we_wireWidth", String(WE.model.ui.wireWidth));
      localStorage.setItem("we_wireColor", WE.model.ui.wireColor);
      localStorage.setItem("we_wireAwg", WE.model.ui.wireAwg || "");
      localStorage.setItem("we_wireRouting", WE.model.ui.wireRouting);
    } catch (e) { /* 무시 */ }
  }
  /* 팔레트 창의 "추가" 줄이 기억하는 마지막 규격(AWG) — we_wireAwg(지금 그리는 배선의 규격)과는
     다른 값이다. 이건 "색을 새로 등록할 때 규격 칸의 기본값"만을 위한 것이라 따로 키를 둔다. */
  function lastPalAwg() {
    try { return localStorage.getItem("we_lastPalAwg") || ""; } catch (e) { return ""; }
  }
  function saveLastPalAwg(v) {
    try { localStorage.setItem("we_lastPalAwg", v || ""); } catch (e) { /* 무시 */ }
  }

  /* 배선 두께 상한. 도면에서 그 이상은 쓸 일이 없다 (2026-09-09 고원빈).
     app.html 의 두 입력칸(#wireWidthSel · #wireWidth)의 max 와 **같은 값이어야 한다.** */
  var WIRE_WIDTH_MAX = 15;

  // ---- 색상 팔레트 ----
  function bindPalette() {
    document.getElementById("wireWidthSel").addEventListener("input", function (e) {
      var v = parseInt(e.target.value, 10);
      if (isNaN(v) || v < 1) return;
      /* ⚠ HTML 의 max="15" 는 **브라우저 힌트일 뿐**이다 — 칸에 직접 30 을 쳐 넣으면
         그대로 들어간다. 실제로 막는 것은 여기다. (2026-09-09 상한 30 → 15) */
      if (v > WIRE_WIDTH_MAX) { v = WIRE_WIDTH_MAX; e.target.value = String(v); }
      WE.model.ui.wireWidth = v;
      saveWireSettings();
    });
    // 배선 모양 — 배선색과 완전히 같은 규칙으로 움직인다.
    //   배선을 선택한 상태 → 그 배선들의 모양을 바꾼다
    //   아무것도 선택 안 함 → 앞으로 그릴 배선의 기본값이 된다
    // 예전처럼 이미 그려 둔 배선을 통째로 다시 계산하지 않는다.
    document.getElementById("wireRouting").addEventListener("click", function (e) {
      var b = e.target.closest(".seg-btn"); if (!b) return;
      var mode = b.dataset.routing;
      WE.model.ui.wireRouting = mode;
      saveWireSettings();

      var ids = WE.model.getMultiWire();
      if (!ids.length) {
        var one = WE.model.getSelectedWire();
        if (one) ids = [one.id];
      }
      if (ids.length) {
        var manual = 0;
        ids.forEach(function (id) {
          var w = WE.model.getWire(id); if (!w) return;
          w.routing = mode;
          if (w.waypoints && w.waypoints.length) manual++;   // 꺾임점이 있으면 그 모양이 우선이라 티가 안 난다
        });
        if (WE.history) WE.history.commit();
        WE.render.renderWires(); WE.render.renderOverlay();
        // 아무 변화가 없어 보이는 경우를 말없이 넘기지 않는다
        if (manual === ids.length) setHint(WE.i18n.t("꺾임점을 찍은 배선은 그 모양을 그대로 씁니다."));
      }
      syncWireRoutingBtns();
      refreshProps();
    });
    document.getElementById("btnPaletteManage").addEventListener("click", openPaletteModal);

    var pm = document.getElementById("paletteModal");
    document.getElementById("palClose").addEventListener("click", function () { pm.hidden = true; });
    /* 추가 줄의 규격 드롭다운은 한 번만 채운다(목록은 바뀌지 않는다).
       기본값은 **지난번에 추가할 때 골랐던 규격**이다 (2026-09-13 고원빈:
       "AWG22로 추가를 한 상태면 기본값을 AWG22로 해놓는거지 — 다음에 바로 변경 없이
       추가 가능하니까"). 브라우저에 저장해 두므로 새로고침·다음 방문에도 이어진다. */
    fillAwgSelect(document.getElementById("newPalAwg"), lastPalAwg());
    document.getElementById("btnAddPal").addEventListener("click", function () {
      var label = document.getElementById("newPalLabel").value.trim() || WE.i18n.t("색");
      var color = document.getElementById("newPalColor").value;
      /* 굵기·규격도 추가 줄에서 바로 받는다 (2026-09-13 고원빈).
         예전엔 현재 배선 굵기(ui.wireWidth)를 몰래 넣고 규격은 비워서, 추가한 뒤 위로 올라가
         다시 고쳐야 했다. 굵기가 비었거나 이상하면 기본 2, 규격은 미지정 가능. */
      var wv = parseInt(document.getElementById("newPalWidth").value, 10);
      var width = (isNaN(wv) || wv < 1) ? 2 : Math.min(15, wv);
      var awg = document.getElementById("newPalAwg").value || "";
      WE.model.project.palette.push({ color: color, label: label, width: width, awg: awg });
      saveLastPalAwg(awg);   // 방금 고른 규격을 다음 추가의 기본값으로 남긴다
      // 이름만 비운다. 색·굵기·규격은 그대로 둔다 — 비슷한 선을 연달아 등록할 때 다시 고르지 않게.
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
        WE.model.allWires().forEach(function (w) { if (w.color === oldC) w.color = newC; });   // 전체 시트
        if (WE.model.ui.wireColor === oldC) WE.model.ui.wireColor = newC;
        WE.render.renderWires(); WE.render.renderOverlay();
      } else if (e.target.classList.contains("plabel")) {
        p.label = e.target.value;
      } else if (e.target.classList.contains("pwidth")) {
        var v = parseInt(e.target.value, 10);
        p.width = (isNaN(v) || v < 1) ? "" : Math.min(15, v);
      }
      renderPalette(); saveDefaultPalette();
    });
    // 규격 드롭다운은 change 로 받는다
    pl.addEventListener("change", function (e) {
      if (!e.target.classList.contains("pawg")) return;
      var row = e.target.closest(".preset-row"); if (!row) return;
      var p = WE.model.project.palette[+row.dataset.idx]; if (!p) return;
      p.awg = e.target.value || "";
      saveDefaultPalette();
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
  // 이 열쇠는 '마지막으로 쓴 팔레트'다. 기본값을 바꿔도 이 열쇠는 절대 건드리지 않는다 —
  // 이미 자기 팔레트를 맞춰 쓰던 사람의 설정을 초기화하는 셈이 되기 때문이다.
  // 기본값 변경은 저장된 팔레트가 없는 사람(처음 쓰는 사람)에게만 적용된다.
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

  // 현재 배선 모양을 버튼에 반영. 배선을 골라 뒀으면 '그 배선의 모양'을 보여 주는 게 맞다 —
  // 그 상태에서 버튼을 누르면 바뀌는 대상이 그 배선이기 때문이다.
  /* 지금 고른 배선들. 하나만 골랐으면 한 개짜리 목록.
     ⚠ 예전에는 같은 규칙이 세 군데(속성 갱신·팔레트·이벤트 연결부)에 따로 적혀 있었다.
        한 곳만 고치면 화면이 서로 다른 말을 하게 된다. */
  function 고른배선들() {
    var ids = WE.model.getMultiWire();
    if (ids && ids.length) {
      return ids.map(function (id) { return WE.model.getWire(id); }).filter(Boolean);
    }
    var w = WE.model.getSelectedWire();
    return w ? [w] : [];
  }

  /* 고른 배선들이 그 값에 대해 한목소리인가. 같으면 그 값, 섞여 있으면 null.

     ⚠ 섞였을 때 대표 배선의 값을 보여 주면 **거짓말**이 된다 — 두께 2 와 3 을 함께
        골랐는데 칸에 3 이라고 적혀 있으면 전부 3 인 줄 안다. 그 상태에서 옆 칸을
        건드리면 두께가 3 으로 덮인 줄도 모른다.
        (2026-09-09 고원빈: "보통 다른 서비스들은 이런 경우에는 공란으로 뒀던 거 같은데")
        비워 두면 "여기는 하나가 아니다" 가 눈에 보이고, 값을 넣을 때만 전부 바뀐다. */
  function 공통값(ws, get) {
    if (!ws || !ws.length) return null;
    var v = get(ws[0]);
    for (var i = 1; i < ws.length; i++) if (get(ws[i]) !== v) return null;
    return v;
  }

  // 섞여 있으면 칸을 비우고 '혼합' 이라고 옅게 적어 둔다
  function 값칸(id, 값) {
    var el = document.getElementById(id); if (!el) return;
    setIfNotFocused(id, 값 == null ? "" : 값);
    el.placeholder = (값 == null) ? WE.i18n.t("혼합") : "";
  }

  function syncWireRoutingBtns() {
    var box = document.getElementById("wireRouting"); if (!box) return;
    var mode = WE.model.ui.wireRouting;
    var ids = WE.model.getMultiWire();
    if (!ids.length) { var one = WE.model.getSelectedWire(); if (one) ids = [one.id]; }
    if (ids.length) {
      var first = WE.model.getWire(ids[0]);
      var same = ids.every(function (id) {
        var w = WE.model.getWire(id);
        return w && (w.routing || mode) === (first.routing || mode);
      });
      /* ⚠ 섞여 있으면 **아무 버튼도 켜지 않는다.** 예전에는 기본값 버튼이 켜져 있어
         "고른 배선이 전부 꺾임" 처럼 보였다 — 두께 칸을 비우는 것과 같은 이유다. */
      if (!same) mode = null;
      else if (first) mode = first.routing || mode;
    }
    Array.prototype.forEach.call(box.querySelectorAll(".seg-btn"), function (b) {
      b.classList.toggle("active", mode != null && b.dataset.routing === mode);
    });
  }

  /* 속성창의 팔레트 스와치.
     툴바 팔레트와 같은 project.palette 를 쓴다 — 목록을 두 벌로 두면
     한쪽에서 색을 추가했을 때 다른 쪽이 안 따라오는 사고가 난다.
     색을 등록·수정하는 곳은 툴바 한 군데뿐이다(여기서는 고르기만).
     선택된 배선이 있을 때만 뜻이 있으므로, 없으면 아무것도 안 그린다. */
  var 스와치한줄 = 7;        // 패널 폭(225px)에서 한 줄에 들어가는 개수 — 실측값
  var 스와치펼침 = false;    // 8개 이상일 때 나머지를 펼쳤는가

  function renderWirePalette() {
    var wrap = document.getElementById("wirePalette");
    if (!wrap) return;
    wrap.innerHTML = "";
    var ws = 고른배선들();
    if (!ws.length) { wrap.hidden = true; return; }
    wrap.hidden = false;

    // 고른 배선들이 서로 다른 색이면 '지금 색'이 하나로 정해지지 않는다 → 표시하지 않는다
    var 현재 = ws[0].color;
    var 같은색 = ws.every(function (w) { return w.color === 현재; });

    var pal = WE.model.project.palette || [];
    // 8개 이상이면 7개만 보이고 마지막 칸은 펼치기 버튼이 된다.
    // 접혀 있어도 줄 높이가 고정돼 패널이 위아래로 출렁이지 않는다.
    var 넘침 = pal.length > 스와치한줄;
    var 보일것 = (넘침 && !스와치펼침) ? pal.slice(0, 스와치한줄 - 1) : pal;

    보일것.forEach(function (p) {
      var sw = document.createElement("div");
      sw.className = "swatch" + (같은색 && p.color === 현재 ? " active" : "");
      sw.style.background = p.color;
      sw.title = p.label || p.color;
      sw.addEventListener("click", function () {
        ws.forEach(function (w) { w.color = p.color; });
        // 앞으로 그릴 기본색도 같이 바꾼다 — 툴바 스와치와 동작을 맞춘다
        WE.model.ui.wireColor = p.color;
        saveWireSettings();
        WE.render.renderWires(); WE.render.renderOverlay();
        renderPalette();
        refreshProps();
        WE.history.commit();
      });
      wrap.appendChild(sw);
    });

    if (넘침) {
      var more = document.createElement("button");
      more.type = "button";
      more.className = "swatch-more";
      more.textContent = 스와치펼침 ? "▲" : "＋" + (pal.length - (스와치한줄 - 1));
      more.title = 스와치펼침
        ? WE.i18n.t("접기")
        : WE.i18n.t("나머지 색 보기 — 색을 추가·수정하려면 툴바 배선색의 ⋯ 를 쓰세요");
      more.addEventListener("click", function () {
        스와치펼침 = !스와치펼침;
        renderWirePalette();
      });
      wrap.appendChild(more);
    }
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
      sw.addEventListener("click", function () { applyPalette(p); });
      wrap.appendChild(sw);
    });
  }

  function openPaletteModal() { renderPaletteList(); document.getElementById("paletteModal").hidden = false; }
  /* 규격(AWG) 드롭다운 채우기 — 색 행과 추가 줄이 같은 목록을 쓴다. 한 곳에서만 만든다.
     (두 벌로 두면 한쪽만 고쳐져 목록이 서로 달라진다 — BOM 내보내기에서 이미 겪은 함정) */
  function fillAwgSelect(sel, current) {
    sel.innerHTML = "";
    var opt0 = document.createElement("option"); opt0.value = ""; opt0.textContent = WE.i18n.t("규격");
    sel.appendChild(opt0);
    (WE.awg ? WE.awg.TABLE : []).forEach(function (e) {
      var o = document.createElement("option"); o.value = e.awg; o.textContent = e.awg + "AWG";
      if (current === e.awg) o.selected = true;
      sel.appendChild(o);
    });
  }
  function renderPaletteList() {
    var pl = document.getElementById("paletteList");
    pl.innerHTML = "";
    WE.model.project.palette.forEach(function (p, i) {
      var row = document.createElement("div");
      // .pal-grid: 머리글·추가 줄과 같은 열 구조 (styles.css 의 #paletteModal .pal-grid)
      row.className = "preset-row pal-grid"; row.dataset.idx = i;
      var color = document.createElement("input");
      color.type = "color"; color.className = "pcolor"; color.value = p.color;
      var label = document.createElement("input");
      label.type = "text"; label.className = "plabel"; label.value = p.label;
      // 굵기(px) — 이 색으로 그릴 때의 선 두께. 상황에 따라 색마다 다르게 둘 수 있다.
      var width = document.createElement("input");
      width.type = "number"; width.className = "pwidth"; width.min = "1"; width.max = "15"; width.step = "1";
      width.title = WE.i18n.t("선 두께(px)");
      width.value = String((p.width != null && p.width !== "" && !isNaN(+p.width)) ? +p.width : 2);
      // 규격(AWG) — 결선표에 나온다. 미지정 가능.
      var awg = document.createElement("select");
      awg.className = "pawg"; awg.title = WE.i18n.t("배선 규격(AWG)");
      fillAwgSelect(awg, p.awg);
      var del = document.createElement("button");
      /* ⚠ 글자는 반드시 × 하나여야 한다.
         .pdel 은 28×28 정사각(styles.css)이라 "삭제" 두 글자를 넣으면 줄바꿈이 나서
         버튼 안에서 글자가 위아래로 쪼개진다. 실제로 그렇게 보였다(2026-09-01).
         프리셋 관리(js/presetmodal.js)가 이미 × 를 쓰고 있으므로 같은 모양으로 맞춘다 —
         같은 자리에서 같은 일을 하는 버튼이 화면마다 다르면 안 된다.
         뜻은 title·aria-label 이 전한다(눈으로도, 화면읽기 프로그램에도). */
      del.className = "pdel"; del.type = "button"; del.textContent = "×";
      del.title = WE.i18n.t("삭제"); del.setAttribute("aria-label", WE.i18n.t("삭제"));
      row.appendChild(color); row.appendChild(label); row.appendChild(width); row.appendChild(awg); row.appendChild(del);
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
    var selectedWires = 고른배선들;
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
    /* 선 종류. 값이 빈 문자열이면 '실선'이고, 그때는 필드를 아예 지운다.
       기본값을 파일에 안 남겨야 예전 파일과 새로 만든 파일이 같은 모양이 된다. */
    document.getElementById("wireDash").addEventListener("change", function (e) {
      var v = e.target.value;
      var ws = selectedWires(); if (!ws.length) return;
      ws.forEach(function (w) { if (v) w.dash = v; else delete w.dash; });
      WE.render.renderWires(); WE.render.renderOverlay();
      WE.history.commit();
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
    /* 라벨 모드로 가지 않고 바로 번호를 붙인다 (2026-09-09 고원빈).
       ⚠ nextWireLabel() 은 이미 붙은 번호들을 보고 다음 번호를 고른다. 그래서 여러 개를
          고른 채 눌러도 하나씩 차례로 붙는다 — 먼저 붙인 것이 다음 계산에 반영된다. */
    document.getElementById("wireLabelAuto").addEventListener("click", function () {
      var ws = selectedWires(); if (!ws.length) return;
      var 붙임 = 0;
      ws.forEach(function (w) {
        if ((w.labelText || "").trim()) return;   // 이미 있으면 그대로 둔다
        w.labelText = 붙일라벨();
        라벨칸올리기();
        delete w.labelPos; delete w.labelT; delete w.labelAt; delete w.labelSkip;
        붙임++;
      });
      if (!붙임) return;
      WE.render.renderWires();
      WE.render.renderOverlay();
      WE.history.commit();
      refreshProps();
      if (trackOnce) trackOnce("add_wire_label");
    });
    document.getElementById("wireLabelReset").addEventListener("click", function () {
      var ws = selectedWires(); if (!ws.length) return;
      // labelSkip 도 함께 지운다 — 한쪽 끝을 Delete 로 치웠던 것도 여기서 되살아난다
      ws.forEach(function (w) {
        delete w.labelPos; delete w.labelT; delete w.labelAt; delete w.labelSkip;
      });
      WE.render.renderWires();
      WE.history.commit();
    });
    document.getElementById("wireLabelRemove").addEventListener("click", function () {
      var ws = selectedWires(); if (!ws.length) return;
      ws.forEach(function (w) {
        delete w.labelText; delete w.labelPos; delete w.labelT;
        delete w.labelAt; delete w.labelSkip;
      });
      WE.render.renderWires();
      WE.render.renderOverlay();
      WE.history.commit();
      refreshProps();
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
      if (!cnt) { setHint(WE.i18n.t("합산할 부하를 선택하세요.")); return; }
      if (!(V > 0)) { setHint(WE.i18n.t("구간 전압(V)을 입력하세요.")); return; }
      var I = totalP / V;
      document.getElementById("wireCurrent").value = Math.round(I * 1000) / 1000;
      applyWireGauge(w, I); updateWireAwgOut(w);
      document.getElementById("wireCalcOut").textContent =
        WE.i18n.t("부하 ") + cnt + WE.i18n.t("개 = ") + round(totalP) + "W ÷ " + V + "V = " + (Math.round(I * 100) / 100) + "A";
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
      // 이름은 '무엇이 움직이는가' 기준 — 세로선을 고르면 세로선 균등을 누른다
      else if (m === "distVert") distributeSelectedWires(true);    // 세로선 균등(세로선들의 x를 균등 간격으로)
      else if (m === "distHoriz") distributeSelectedWires(false);  // 가로선 균등(가로선들의 y를 균등 간격으로)
      else if (m === "alignVert") alignSelectedWiresAxis(true);    // 세로선 정렬(세로선들의 x를 한 줄로)
      else if (m === "alignHoriz") alignSelectedWiresAxis(false);  // 가로선 정렬(가로선들의 y를 한 줄로)
      else if (m === "merge") mergeSelectedWires();
      else if (m === "unmerge") unmergeSelectedWires();
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
      out.textContent = WE.i18n.t("권장 AWG ") + w.awg + " · Ø" + e.dia + WE.i18n.t("mm · 허용 ") + e.ampEff + WE.i18n.t("A (여유 ×") + WE.awg.MARGIN + ")";
    } else out.textContent = "";   // 미입력 시 설명 문구 없이 비움 (속성창 정돈)
  }
  // 부하 부품(전력 있는 load) 체크박스 목록
  function renderWireLoadList() {
    var box = document.getElementById("wireLoadList"); if (!box) return;
    var seen = {}, html = "";
    WE.model.allComponents().forEach(function (c) {   // 전체 시트 — 다른 시트 부품도 부하로 고를 수 있게
      var lib = componentPart(c);
      var role = lib ? (lib.role || "load") : "load";
      if (role !== "load") return;
      var P = lib ? partPower(lib) : 0;
      if (!(P > 0)) return;   // 전력 있는 부하만
      var key = WE.model.cmpGroupKey(c);   // 집계 기준은 model 한 곳에 (부품 번호와 같은 기준이어야 한다)
      if (seen[key]) return; seen[key] = 1;
      var name = lib ? lib.name : c.name;
      html += "<label class='wg-load'><input type='checkbox' data-p='" + P + "' /> " + esc(name) + " (" + round(P) + "W)</label>";
    });
    box.innerHTML = html || WE.i18n.t("<span class='muted'>전력이 입력된 부하 부품이 없습니다.</span>");
  }

  // 이 구간을 정렬로 옮길 수 있는가.
  //
  // 단자에 맞닿은 구간은 못 옮긴다. 단자 좌표는 부품에서 나오는 값이라 옮겨도 제자리에 남고,
  // 옆 꺾임점만 끌려간다. 그러면 둘이 어긋나 직각 보정이 모서리를 새로 끼워 넣고,
  // 배선이 단자에서 위/아래로 꺾여 나가는 낯선 모양이 된다(점 3개가 5개가 되는 그 증상).
  // 렌더 시 겹침 분리(nudge)도 같은 이유로 같은 규칙을 쓴다 — "양끝이 모두 내부점이어야 이동 가능".
  //
  // 분기로 끝나는 쪽은 예외다. 접점은 호스트 선 위를 미끄러질 수 있어 진짜로 움직인다.
  // 길이 0인 구간도 뺀다 — 두 좌표가 같아 '세로'로 분류되지만 실제로는 방향이 없어서,
  // 그대로 두면 엉뚱한 자리가 정렬 대상으로 뽑힌다.
  // 양끝이 모두 꺾임점인 '내부 구간'인가 — 이런 구간은 언제나 자유롭게 옮길 수 있다.
  function segInterior(wire, pts, i) {
    var last = pts.length - 1;
    if (i === 0 && !WE.geometry.isBranchRef(wire.from)) return false;
    if (i + 1 === last && !WE.geometry.isBranchRef(wire.to)) return false;
    return true;
  }
  function segMovable(wire, pts, i) {
    var last = pts.length - 1;
    if (i < 0 || i + 1 > last) return false;
    var a = pts[i], b = pts[i + 1];
    if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5) return false;   // 길이 0
    if (segInterior(wire, pts, i)) return true;
    // 단자에 맞닿은 구간은 반대쪽 끝이 분기일 때만 옮길 수 있다.
    // 접점은 호스트 선 위를 미끄러지므로 배선이 통째로 다시 놓이는 정상적인 결과가 나온다.
    // 양끝이 모두 단자면 좌표가 못 박혀 있어, 옮겨도 단자는 제자리에 남고 옆 꺾임점만 끌려간다
    // → 직각 보정이 모서리를 새로 끼워 넣어 배선이 단자에서 꺾여 나가는 낯선 모양이 된다.
    return WE.geometry.isBranchRef(wire.from) || WE.geometry.isBranchRef(wire.to);
  }
  // 배선의 가장 긴 세로(vertical=true)/가로 구간 → {i, coord}.
  // 내부 구간을 먼저 찾고, 없을 때만 단자에 맞닿은 구간까지 본다 — 옮길 수 있어도
  // 단자 옆을 건드리면 배선 모양이 크게 바뀌므로 마지막 수단이어야 한다.
  function wireMainSeg(pts, vertical, wire) {
    function pick(interiorOnly) {
      var best = null, bestLen = -1;
      for (var i = 0; i < pts.length - 1; i++) {
        if (wire && !segMovable(wire, pts, i)) continue;
        if (wire && interiorOnly && !segInterior(wire, pts, i)) continue;
        var a = pts[i], b = pts[i + 1];
        if (vertical && Math.abs(a.x - b.x) < 0.5) {
          var L = Math.abs(a.y - b.y); if (L > bestLen) { bestLen = L; best = { i: i, coord: a.x }; }
        } else if (!vertical && Math.abs(a.y - b.y) < 0.5) {
          var L2 = Math.abs(a.x - b.x); if (L2 > bestLen) { bestLen = L2; best = { i: i, coord: a.y }; }
        }
      }
      return best;
    }
    return pick(true) || pick(false);
  }
  function segIsVertical(pts, i) { return Math.abs(pts[i].x - pts[i + 1].x) < 0.5; }
  // 이 배선에서 정렬 대상 구간 인덱스: 클릭한 구간 우선, 없으면 원하는 방향의 가장 긴 구간
  /* 이 배선에서 '대상 구간'을 고른다.
     기준용=true 면 **옮길 수 있는지 따지지 않는다.** (2026-09-02)
       기준 배선은 방향과 좌표만 읽히고 setWireSeg 에 아예 안 넘어간다 — 즉 안 움직인다.
       그런데 예전에는 기준에도 segMovable 을 물어서, 단자에 바로 붙은 구간을 기준으로
       잡으면 **나머지 배선까지 통째로 멈췄다.** 옮기지도 않을 구간에 '옮길 수 있는가'를
       물은 것이 잘못이었다. (고원빈 보고: 솔밸브 GND 를 기준으로 3개 정렬 → 아무것도 안 움직임) */
  function wireTargetSeg(wire, pts, wantVertical, 기준용) {
    var pt = WE.model.getWireClickPt(wire.id);
    if (pt) {
      var idx = WE.geometry.nearestSegmentIndex(pts, pt);
      // 클릭해 둔 구간(굵게 표시)이 곧 대상이다. 방향이 안 맞으면 이 배선은 건너뛴다(-1).
      // 예전엔 여기서 그 배선의 '다른' 가로/세로 구간을 대신 집었다. 그래서 세로 구간을 잡아 둔
      // 배선에 가로 정렬을 누르면 엉뚱한 구간이 끌려가 경로가 통째로 일그러졌다.
      // 지정해 둔 구간을 못 쓰면 아무것도 안 하는 편이 맞다 — 사용자가 이미 뜻을 밝혔으니까.
      // 잡아 둔 구간이 단자에 물려 있어 못 옮기는 자리여도 건너뛴다. 다른 구간을 대신 집으면
      // 사용자가 보고 있는 굵은 구간과 실제로 움직이는 구간이 달라진다.
      if (idx >= 0) {
        if (!기준용 && !segMovable(wire, pts, idx)) return -1;
        return (wantVertical == null || segIsVertical(pts, idx) === wantVertical) ? idx : -1;
      }
    }
    var seg = wireMainSeg(pts, wantVertical == null ? true : wantVertical, wire);
    if (seg) return seg.i;
    if (wantVertical == null) { var sh = wireMainSeg(pts, false, wire); if (sh) return sh.i; }
    return -1;
  }
  function setWireSeg(w, pts, idx, vertical, coord) {
    var np = pts.map(function (p) { return { x: p.x, y: p.y }; });
    if (vertical) { np[idx].x = coord; np[idx + 1].x = coord; }
    else { np[idx].y = coord; np[idx + 1].y = coord; }
    np = WE.geometry.simplify(np);   // 일직선상 중간점 제거(불필요한 꺾임점 방지)
    w.waypoints = np.slice(1, np.length - 1);
    // 분기로 끝나는 배선은 접점도 호스트 선 위에서 함께 옮겨야 한다.
    // 안 그러면 구간만 이동하고 접점은 남아 마지막이 ㄱ자로 꺾인다(구간 정렬에서 그랬다).
    // 접점은 **옮긴 구간이 그 끝에 닿아 있을 때만** 따라간다.
    // 조건 없이 옮기면, 엉뚱한 구간을 정렬했는데 접점만 끌려가 배선이 꼬인다(아래 참조).
    snapBranchEndsTo(w, np, vertical, coord, idx === 0, idx + 1 === pts.length - 1);
  }
  // 옮긴 구간의 좌표에 맞춰 분기 접점을 호스트 선 위로 다시 붙인다
  /* 분기로 끝나는 배선은 접점도 호스트 선 위에서 함께 옮긴다.
     안 그러면 구간만 이동하고 접점은 남아 마지막이 ㄱ자로 꺾인다.

     ⚠ 단, **옮긴 구간이 실제로 그 끝에 닿아 있을 때만** 이다. (2026-09-02)
        예전에는 분기로 끝나기만 하면 조건 없이 접점을 coord 로 끌고 갔다.
        그래서 접점과 상관없는 가운데 구간을 정렬해도 접점이 딸려 갔고,
        정작 접점 옆 꺾임점은 제자리에 남아 배선이 Z 자로 꼬였다.

          전   705,706 → 835,706 → 835,810 → 510,810 → 510,740 → 208,740
          후   705,706 → 835,706 → 835,839 → 510,839 → 510,740 → 510,780 → 208,780
                                                       └ 위로 갔다 다시 아래로 ┘

        (실제 도면 「퍼미어스 테스트」의 릴레이 COM2 배선. 고원빈 보고)
        접점은 호스트 배선 위에서만 미끄러지므로, 가운데 구간이 움직였다고
        접점이 따라갈 이유가 없다.

     앞끝/뒤끝이 undefined 로 오면(옛 호출) 예전처럼 둘 다 옮긴다 — false 일 때만 건너뛴다. */
  function snapBranchEndsTo(w, np, vertical, coord, 앞끝, 뒤끝) {
    ["from", "to"].forEach(function (k) {
      var ref = w[k];
      if (!ref || !ref.wireId) return;
      if (k === "from" ? 앞끝 === false : 뒤끝 === false) return;
      var host = WE.model.getWire(ref.wireId);
      var hp = host && WE.geometry.wireRoutePoints(host);
      if (!hp) return;
      // 그 끝이 붙어 있던 자리를 정렬된 좌표로 옮긴 뒤 호스트에 투영
      var end = (k === "from") ? np[0] : np[np.length - 1];
      var moved = vertical ? { x: coord, y: end.y } : { x: end.x, y: coord };
      var q = WE.geometry.placeOnHost(ref, hp, moved);
      if (q) { ref.x = q.x; ref.y = q.y; }
    });
  }
  // 처음 클릭한 배선(anchor)의 클릭한 구간에 나머지 선택 배선을 맞춤(세로/가로 자동)
  // 간격(px)>0이면 기준선에서 그 간격씩 벌려 평행 배치(방향은 현재 위치 쪽 자동)
  // forceGap!=null이면 입력칸 대신 그 값을 씀(합치기가 gap 0으로 호출).
  function alignSelectedWires(forceGap) {
    var ids = WE.model.getMultiWire();
    if (!ids || ids.length < 2) return;
    var anchor = WE.model.getWire(ids[0]); if (!anchor) return;
    var aPts = WE.geometry.wireRoutePoints(anchor); if (!aPts) return;
    // 기준선은 좌표만 읽어 가므로 '옮길 수 있는 구간'일 필요가 없다(기준용=true).
    // 여기서 -1 이 나오는 건 잡아 둔 구간 자체가 없을 때뿐이다.
    var aIdx = wireTargetSeg(anchor, aPts, null, true);
    if (aIdx < 0) { setHint(WE.i18n.t("기준으로 삼을 구간이 없습니다."), WE.i18n.t("기준 배선에서 맞출 구간을 찾지 못했습니다. 기준 배선의 구간을 한 번 클릭한 뒤 다시 눌러 주세요.")); return; }
    var vertical = segIsVertical(aPts, aIdx);
    var C = vertical ? aPts[aIdx].x : aPts[aIdx].y;
    var gapEl = document.getElementById("wireGap");
    var gap = (forceGap != null) ? forceGap : (gapEl ? parseInt(gapEl.value, 10) : 0); if (isNaN(gap)) gap = 0;

    var others = [];
    for (var k = 1; k < ids.length; k++) {
      var w = WE.model.getWire(ids[k]); if (!w) continue;
      // 점 2개짜리(단자 → 접점 한 줄)도 대상이다. 예전엔 3점 이상만 봐서,
      // 버스에 곧게 물린 배선이 통째로 빠졌다 — 정작 이런 배선이 가장 흔하다.
      var pts = WE.geometry.wireRoutePoints(w); if (!pts || pts.length < 2) continue;
      var idx = wireTargetSeg(w, pts, vertical); if (idx < 0) continue;
      var s1 = pts[idx], s2 = pts[idx + 1];
      others.push({
        id: ids[k], w: w, pts: pts, idx: idx, coord: vertical ? s1.x : s1.y,
        lo: vertical ? Math.min(s1.y, s2.y) : Math.min(s1.x, s2.x),
        hi: vertical ? Math.max(s1.y, s2.y) : Math.max(s1.x, s2.x)
      });
    }
    if (!others.length) {
      setHint(WE.i18n.t("맞출 수 있는 ") + (vertical ? WE.i18n.t("세로선") : WE.i18n.t("가로선")) +
              WE.i18n.t(" 구간이 없습니다. 단자에 바로 붙은 구간은 옮길 수 없습니다."));
      return;
    }
    // 앵커 쪽 방향(현재 배선들이 있는 쪽)으로 밀기 우선
    var avg = others.reduce(function (s, o) { return s + o.coord; }, 0) / others.length;
    var dir = (avg - C) < 0 ? -1 : 1;
    others.sort(function (a, b) { return dir * (a.coord - b.coord); });   // 앵커에 가까운 것부터
    if (gap > 0) {
      // 간격 지정 → 앵커에서 gap씩 벌려 한쪽으로 나란히 평행 배치.
      // 자동 회피를 태우지 않는다(회피는 gap의 정수배로 튀고 앵커 양옆으로 갈라져서
      // 입력한 픽셀값과 결과가 어긋남). 넣은 값이 그대로 배선 간 간격이 된다.
      // 다발(bundleId)은 한 슬롯 = 한 선으로 취급(멤버끼리 안 벌어짐 → 합친 상태 유지).
      // 앵커와 같은 다발이면 기준선(C)에 그대로 붙인다.
      var anchorBid = anchor.bundleId, slotMap = {}, nextSlot = 0;
      others.forEach(function (o) {
        if (anchorBid && o.w.bundleId === anchorBid) { setWireSeg(o.w, o.pts, o.idx, vertical, C); return; }
        var key = o.w.bundleId || o.id;
        if (!(key in slotMap)) slotMap[key] = nextSlot++;
        setWireSeg(o.w, o.pts, o.idx, vertical, C + dir * gap * (slotMap[key] + 1));
      });
    } else {
      // 간격 0 → 앵커와 같은 선에 맞추되, 겹치면 자동으로 옆 레인으로 회피(순차 배치라 서로도 안 겹침)
      others.forEach(function (o) {
        var target = WE.geometry.avoidOverlapCoord(o.id, vertical, C, o.lo, o.hi, gap, dir);
        setWireSeg(o.w, o.pts, o.idx, vertical, target);
      });
    }
    WE.render.renderAll(); WE.render.renderOverlay(); refreshProps();
    setHint((vertical ? WE.i18n.t("세로선") : WE.i18n.t("가로선")) + WE.i18n.t(" 정렬: ") + others.length + WE.i18n.t("개") + (gap > 0 ? (WE.i18n.t(" · 간격 ") + gap + "px") : ""));
  }
  // 축 정렬: alongX=true → 세로선들의 x를 한 줄로 / false → 가로선들의 y를 한 줄로.
  // 균등 배치와 짝이고, 구간 정렬과는 쓰임이 다르다 —
  //   구간 정렬은 방향을 앵커 구간에서 자동으로 정하고 '간격'만큼 나란히 벌린다.
  //   이건 방향을 버튼으로 못 박고 간격 없이 한 줄에 모은다. 멀리 떨어진 선을 줄 맞출 때 쓴다.
  // 기준 좌표는 처음 선택한 배선(구간 정렬과 같은 규칙) — 어디로 모일지 미리 알 수 있다.
  function alignSelectedWiresAxis(alongX) {
    var ids = WE.model.getMultiWire();
    if (!ids || ids.length < 2) { setHint(WE.i18n.t("정렬은 배선 2개 이상 선택하세요.")); return; }
    var items = [], crossed = 0;
    ids.forEach(function (id) {
      var w = WE.model.getWire(id); if (!w) return;
      var pts = WE.geometry.wireRoutePoints(w); if (!pts || pts.length < 2) return;
      var idx = wireTargetSeg(w, pts, alongX);
      if (idx < 0) { crossed++; return; }   // 잡아 둔 구간이 반대 방향 → 이 배선은 손대지 않음
      items.push({ w: w, pts: pts, idx: idx, coord: alongX ? pts[idx].x : pts[idx].y });
    });
    var dirName = alongX ? WE.i18n.t("세로선") : WE.i18n.t("가로선");
    if (items.length < 2) {
      // 반대 방향 구간을 잡아 놓고 이 버튼을 누른 것 — 어느 버튼을 눌러야 하는지 알려 준다
      setHint(crossed
        ? (WE.i18n.t("선택한 구간이 ") + (alongX ? WE.i18n.t("가로선") : WE.i18n.t("세로선")) +
           WE.i18n.t(" 구간입니다. ") + (alongX ? WE.i18n.t("가로선") : WE.i18n.t("세로선")) + WE.i18n.t(" 정렬을 쓰세요."))
        : (WE.i18n.t("정렬할 ") + dirName + WE.i18n.t(" 구간이 부족합니다.")));
      return;
    }
    var C = items[0].coord;   // 처음 선택한 배선이 기준 — 그 선은 그대로 두고 나머지가 모인다
    items.forEach(function (it) { setWireSeg(it.w, it.pts, it.idx, alongX, C); });
    WE.render.renderAll(); WE.render.renderOverlay(); refreshProps();
    setHint(dirName + WE.i18n.t(" 정렬: ") + items.length + WE.i18n.t("개"));
  }
  // 균등 배치: alongX=true → 세로선들의 x를 균등 간격 / false → 가로선들의 y를 균등
  function distributeSelectedWires(alongX) {
    var ids = WE.model.getMultiWire();
    if (!ids || ids.length < 3) { setHint(WE.i18n.t("균등 배치는 배선 3개 이상 선택하세요.")); return; }
    var items = [];
    ids.forEach(function (id) {
      var w = WE.model.getWire(id); if (!w) return;
      // 점 2개짜리(단자 → 접점 한 줄)도 대상 — 구간 정렬과 같은 이유로 예전엔 빠져 있었다
      var pts = WE.geometry.wireRoutePoints(w); if (!pts || pts.length < 2) return;
      var idx = wireTargetSeg(w, pts, alongX); if (idx < 0) return;
      if (segIsVertical(pts, idx) !== alongX) { var s = wireMainSeg(pts, alongX, w); if (!s) return; idx = s.i; }
      items.push({ w: w, pts: pts, idx: idx, coord: alongX ? pts[idx].x : pts[idx].y });
    });
    if (items.length < 3) { setHint(WE.i18n.t("균등 배치할 ") + (alongX ? WE.i18n.t("세로선") : WE.i18n.t("가로선")) + WE.i18n.t(" 구간이 부족합니다.")); return; }
    items.sort(function (a, b) { return a.coord - b.coord; });
    // 다발(bundleId)은 한 열로 취급 — 멤버끼리 안 벌어짐(합친 상태 유지)
    var colOf = {}, cols = [];
    items.forEach(function (it) {
      var key = it.w.bundleId || it.w.id;
      if (!(key in colOf)) { colOf[key] = cols.length; cols.push(it.coord); }
    });
    if (cols.length < 2) { setHint(WE.i18n.t("균등 배치할 ") + (alongX ? WE.i18n.t("세로선") : WE.i18n.t("가로선")) + WE.i18n.t(" 구간이 부족합니다.")); return; }
    var first = cols[0], step = (cols[cols.length - 1] - first) / (cols.length - 1);
    items.forEach(function (it) {
      var key = it.w.bundleId || it.w.id;
      setWireSeg(it.w, it.pts, it.idx, alongX, first + step * colOf[key]);
    });
    WE.render.renderAll(); WE.render.renderOverlay(); refreshProps();
    setHint((alongX ? WE.i18n.t("세로선") : WE.i18n.t("가로선")) + WE.i18n.t(" 균등 배치: ") + items.length + WE.i18n.t("개"));
  }

  // ---- 배선 합치기/풀기 (시각적 다발) ----
  // 원칙: 배선은 기본적으로 안 겹치게 벌어진다. '합치기'는 그 예외 —
  //   선택한 배선들을 겹침 허용(allowOverlap)으로 표시하고 한 좌표로 겹쳐 한 선처럼 보이게 함.
  //   같은 bundleId로 묶여 함께 이동하며, '풀기'로 해제하면 다시 수동으로 떼어놓을 수 있다.
  //   데이터는 계속 개별 배선 N개(넷·리스트·BOM 그대로) — 겹치는 건 시각뿐.
  function mergeSelectedWires() {
    var ids = WE.model.getMultiWire();
    if (!ids || ids.length < 2) { setHint(WE.i18n.t("합치기는 배선 2개 이상 선택하세요.")); return; }
    var bid = "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    ids.forEach(function (id) {
      var w = WE.model.getWire(id); if (!w) return;
      w.bundleId = bid; w.allowOverlap = true;   // allowOverlap → avoidOverlapCoord가 회피 안 함 = 진짜 겹침
    });
    alignSelectedWires(0);   // gap 0 정렬: allowOverlap이 켜져 회피가 꺼지므로 기준선 위에 그대로 포개짐
    if (WE.history) WE.history.commit();
    setHint(ids.length + WE.i18n.t("개 배선 합침"));
  }
  function unmergeSelectedWires() {
    var ids = WE.model.getMultiWire() || [];
    var bids = {};
    ids.forEach(function (id) { var w = WE.model.getWire(id); if (w && w.bundleId) bids[w.bundleId] = 1; });
    var count = 0;
    WE.model.project.wires.forEach(function (w) {
      if (w.bundleId && bids[w.bundleId]) { delete w.bundleId; delete w.allowOverlap; count++; }
    });
    if (!count) { setHint(WE.i18n.t("합쳐진 배선이 없습니다.")); return; }
    WE.render.renderAll(); WE.render.renderOverlay(); refreshProps();
    if (WE.history) WE.history.commit();
    setHint(count + WE.i18n.t("개 배선 풀림"));
  }

  // ---- 배선 리스트(와이어 리스트) ----
  // 색 → 팔레트 라벨(없으면 hex)
  function colorLabel(color) {
    var pal = WE.model.project.palette || [];
    for (var i = 0; i < pal.length; i++) if (pal[i].color === color) return pal[i].label;
    return color;
  }
  /* ⚠ 예전에는 여기 wireListData(배선 한 가닥씩, 라벨 붙은 것만)가 있었다. 지웠다.
        · 라벨 붙은 배선만 담아서 목록이 거의 비었고 그래서 기능이 통째로 꺼져 있었다
        · 한 가닥씩 늘어놓으면 "이 단자에 몇 군데가 물리는지" 를 알 수 없다
        · 끝점이 분기면 "? / ?" 로 찍혔다(endParts 가 componentId 만 봐서)
        아래 netListData 가 대신한다. 되살리지 말 것. (2026-09-03) */

  /* ---- 결선표(넷 묶음) ----
     종이를 보며 결선할 때 쓰는 표다. **한 가닥씩이 아니라 넷(전기적으로 이어진 한 덩어리)으로 묶는다.**

     왜 넷인가 (2026-09-03 고원빈, 실제 결선 중에 막힘)
       배터리 VCC 에 스텝다운모듈 둘과 릴레이가 물려 있는데, From-To 를 한 줄씩 늘어놓으면
       세 줄로 흩어진다. 그러면 **"여기 몇 군데가 물리는가"** 를 알 수 없어서 케이블을 어떻게 뺄지
       (분기할지·단자에 여러 가닥을 압착할지) 판단이 안 되고, 두 군데 중 한 군데만 하고 넘어간다.
       한 덩어리로 보여 주면 그 자리에서 정할 수 있다.

     ⚠ 분기는 netFrom 이 타고 넘어가 **실제 단자까지** 펼친다. 한 가닥만 보면 분기 지점이
        끝점으로 잡혀 "? / ?" 가 된다(예전 wireListData 가 그랬다).
     ⚠ 라벨(수축튜브 번호)이 없어도 담는다. 예전 목록은 라벨 붙은 배선만 담아 거의 비어 있었고
        그래서 기능이 통째로 꺼져 있었다 — 실제 작업은 표를 보고 그 자리에서 전선을 만드는
        방식이라, 줄을 가리키는 것은 번호가 아니라 **양 끝 이름**이다. */
  function netListData() {
    var 본것 = {}, out = [];
    _열표 = null;   // 부품을 옮기면 열이 달라진다 — 표를 만들 때마다 새로 센다
    WE.model.allComponents().forEach(function (c) {
      (c.terminals || []).forEach(function (t) {
        if (본것[c.id + "|" + t.id]) return;
        var net = WE.geometry.netFrom([{ componentId: c.id, terminalId: t.id }]);
        if (!net.wireIds.length) return;                    // 배선이 없는 단자는 표에 안 넣는다
        var 멤버 = [];
        net.terms.forEach(function (r) {
          본것[r.componentId + "|" + r.terminalId] = 1;
          var cc = WE.model.getComponent(r.componentId);
          var tt = cc && WE.model.getTerminal(cc, r.terminalId);
          if (!cc || !tt) return;
          var lib = componentPart(cc);
          /* 이 단자에 실제로 꽂히는 배선의 색.
             넷 전체를 한 색으로 뭉뚱그리면 안 된다 — 분기된 넷은 구간마다 색이 다를 수 있고,
             작업자는 "이 단자에 무슨 색을 꽂는가" 를 알아야 한다. (2026-09-03 고원빈) */
          var 내배선 = null;
          net.wireIds.forEach(function (wid) {
            if (내배선) return;
            var w = WE.model.getWire(wid); if (!w) return;
            [w.from, w.to].forEach(function (ref) {
              if (내배선) return;
              if (ref && ref.componentId === r.componentId && ref.terminalId === r.terminalId) 내배선 = w;
            });
          });
          멤버.push({ cmp: WE.model.cmpLabel(cc), term: tt.name || "", no: Number(cc.no) || 0,
                      // tid: 결선표 비고를 매다는 키. 이름은 바뀌지만 id 는 안 바뀐다.
                      cmpId: cc.id, tid: tt.id,
                      image: cc.image || (lib && lib.image) || null,
                      color: 내배선 ? colorLabel(내배선.color) : "",
                      colorHex: 내배선 ? 내배선.color : "#000",
                      awg: (내배선 && 내배선.awg) || "",
                      role: (lib && lib.role) || (cc.publicSnapshot && cc.publicSnapshot.role) || "load" });
        });
        if (멤버.length < 2) return;                        // 한쪽만 남은 것은 결선이 아니다
        // 부품을 놓은 순서대로 — 같은 부품에서 나가는 넷들이 표에서 서로 붙어 있게 된다
        멤버.sort(function (a, b) { return a.no - b.no || a.term.localeCompare(b.term); });
        /* 기준이 될 한쪽(origin)을 고른다.
           작업자는 한 단자 앞에 서서 "여기서 나갈 선이 몇 가닥인가" 를 본다. 다섯을 대등하게
           늘어놓으면 지금 어디에 서 있는지가 없어서 눈에 안 들어온다(2026-09-03 고원빈).
           그래서 공급하는 쪽을 왼쪽에 두고 받는 쪽을 뻗어나가게 적는다.

           ⚠ 전기적 방향은 데이터에 없다. 아래는 **어림짐작**이다:
             배터리(role) > OUT/VCC 로 시작하는 단자 > 그 밖 > IN 으로 시작하는 단자
           맞추기 어려운 넷에서는 기준이 뒤바뀔 수 있다. 그래도 표의 모양('한쪽 + 뻗어나감')이
           유지되므로 '몇 가닥인가' 는 그대로 읽힌다. */
        멤버.forEach(function (m) {
          var t = String(m.term || "").toUpperCase();
          m.rank = m.role === "battery" ? 0
                 : /^OUT/.test(t) ? 1
                 : /^(VCC|VBAT|\+V|V\+)/.test(t) ? 2
                 : /^IN/.test(t) ? 4
                 : 3;
        });
        var 기준 = 멤버.slice().sort(function (a, b) {
          return a.rank - b.rank || a.no - b.no || a.term.localeCompare(b.term);
        })[0];
        // 연결부도 도면 읽는 순서(좌→우, 위→아래)로 — 표를 훑는 눈과 도면을 훑는 눈이 같아야 한다
        var 상대 = 멤버.filter(function (m) { return m !== 기준; }).sort(function (a, b) {
          return 자리비교(WE.model.getComponent(a.cmpId), WE.model.getComponent(b.cmpId));
        });
        /* 넷을 대표하는 색·굵기는 **기준 단자에 꽂히는 배선** 것을 쓴다.
           연결부 쪽 색은 멤버가 각자 들고 있다(위 참고) — 분기 구간마다 다를 수 있어서다. */
        var w0 = WE.model.getWire(net.wireIds[0]);
        out.push({
          color: 기준.color || (w0 ? colorLabel(w0.color) : ""),
          colorHex: 기준.colorHex || (w0 ? w0.color : "#000"),
          awg: 기준.awg || (w0 && w0.awg) || "",
          origin: 기준,          // 왼쪽에 세우는 기준 단자
          targets: 상대,         // 거기서 뻗어나가는 단자들
          count: 상대.length,    // = 그 단자에서 나가야 하는 가닥 수
          members: 멤버          // (검사·CSV 용 전체 목록)
        });
      });
    });
    // 기준 부품이 도면에 놓인 자리 순서(좌→우, 위→아래)로 — 표와 도면을 같은 눈으로 훑는다
    out.sort(function (a, b) {
      return 자리비교(WE.model.getComponent(a.origin.cmpId), WE.model.getComponent(b.origin.cmpId)) ||
             a.origin.term.localeCompare(b.origin.term);
    });
    return out;
  }

  /* 결선표를 **부품 단위로 묶는다.**
     배터리의 GND 줄과 VCC 줄은 결국 같은 배터리 이야기다. 따로 떨어져 있으면 작업자가
     "이 부품에서 할 일" 을 한눈에 못 본다. 부품 그림을 왼쪽에 한 번만 크게 두고 그 아래로
     단자들을 모으면, 손에 부품을 쥔 채 그 칸만 보고 끝낼 수 있다. (2026-09-03 고원빈)
     반환: [{ cmpId, name, image, rows: [넷…], lines: 전체 줄 수 }] */
  function netListByComponent() {
    var 묶음 = [], 색인 = {};
    netListData().forEach(function (net) {
      var k = net.origin.cmpId;
      if (!색인[k]) {
        색인[k] = { cmpId: k, name: net.origin.cmp, image: net.origin.image, rows: [], lines: 0 };
        묶음.push(색인[k]);
      }
      색인[k].rows.push(net);
      색인[k].lines += net.count;
    });
    return 연결부품합치기(작업순서로(묶음));
  }

  /* 「연결 부품」 열에서 같은 이름이 이어지면 한 칸으로 합친다 (2026-09-11 고원빈).
     ESP32 하나에 SD 카드 모듈이 여섯 줄 붙으면 같은 이름이 여섯 번 반복된다.
     종이에서 그건 전부 소음이고, 정작 봐야 할 것은 오른쪽 단자 이름이다.
     「부품」 열은 이미 같은 방식으로 합쳐져 있으니 눈에도 익다.

     ⚠ 합치는 범위를 **부품 묶음 안**으로 한정한다. 묶음을 넘어 합치면 인쇄에서
        칸이 잘린다 — pdf.js 는 좌우 2단으로 나눌 때 **묶음 단위로만** 가르고
        묶음은 절대 쪼개지 않는다(pdf.js 의 '한 부품 묶음은 쪼개지 않는다' 참고).
        그래서 묶음 안에서만 합치면 단·페이지 경계에 걸릴 일이 구조적으로 없다.
     ⚠ 이 규칙을 **여기(데이터)에만** 둔다. 결선표는 화면(app.js)과 인쇄(pdf.js)가
        각각 만들기 때문에, 렌더링 쪽에 두면 규칙이 두 벌이 되어 한쪽만 고쳐진다.
        (BOM 내보내기에서 이미 겪은 함정이다 — "행 만드는 규칙이 두 벌이 되면
         한쪽만 고쳐 표가 서로 달라진다")

     _cmpSpan 의 뜻:
       1 이상 → 이 줄에 칸을 만들고 그만큼 rowspan 을 준다
       0      → 이 줄에는 칸을 만들지 않는다 (위 칸이 덮고 있다)
       없음   → 옛 데이터. 그냥 한 칸으로 그린다(안전한 기본값) */
  function 연결부품합치기(묶음) {
    묶음.forEach(function (그룹) {
      var 줄 = [];
      그룹.rows.forEach(function (net) {
        net.targets.forEach(function (m) { 줄.push(m); });
      });
      var i = 0;
      while (i < 줄.length) {
        var j = i;
        while (j + 1 < 줄.length && 줄[j + 1].cmp === 줄[i].cmp) j++;
        줄[i]._cmpSpan = j - i + 1;
        for (var k = i + 1; k <= j; k++) 줄[k]._cmpSpan = 0;
        i = j + 1;
      }
    });
    return 묶음;
  }

  /* ---- 결선표 순서 = 도면을 읽는 순서(좌→우, 위→아래) ----
     (2026-09-03 고원빈 확정. 실제 회로도 관례를 참고해서 정했다)

     전기 회로도에는 오래된 관례가 있다:
       · 전원부는 **좌상단**에 그린다
       · 신호는 **왼쪽에서 오른쪽으로** 흐르게 배치한다
       · 읽는 사람은 글을 읽듯 좌→우, 위→아래로 훑는다
     그래서 '도면에 놓인 자리 순서'가 곧 '전원부터 시작하는 순서'가 된다 —
     둘을 따로 맞출 필요가 없다. 전원을 좌상단에 두기만 하면 저절로 맞는다.

     이 방식의 장점은 **설명이 한 줄로 끝나고 어림짐작이 없다**는 것이다.
     (예전에는 배터리 role·색 이름으로 전원 계통을 추측해 퍼뜨렸는데, role 은 대부분
      기본값이고 색 이름은 자유 입력이라 근거가 약했다.)

     ⚠ **가로 줄이 아니라 세로 열로 묶는다.** 글처럼 한 줄씩 읽으면 배터리(x=10) 다음에
        같은 높이의 ESP32(x=1050)로 건너뛴다. 그런데 전원은 왼쪽 열에서 오른쪽 열로 단계를
        밟아 흐르므로, 실제 결선은 '열 하나를 끝내고 다음 열' 순서다.
        실측(2026-09-03): 배터리(10) → #1·#2 스텝다운(230) → 릴레이(490) → 레벨시프터(720)
        — 고원빈이 말한 순서와 열 기준이 정확히 일치한다.
     ⚠ 열을 '폭 몇 px 씩' 으로 자르면 안 된다. 20px 차이인 둘이 경계에 걸려 갈라지고
        (워터펌프 920 / 솔밸브 940), 멀리 떨어진 둘이 한 열이 된다.
        **간격이 벌어지는 곳에서 끊는다** — 부품 사이가 60px 넘게 비면 다음 열로 본다.
     ⚠ 굵기(AWG)로 정하는 게 사실 더 정확하다 — 굵은 선을 먼저 깔아야 가는 선을 그 사이에
        끼울 수 있다. 지금은 AWG 가 거의 비어 있어 못 쓴다. 채워지면 1순위로 올릴 것.
     ⚠ '다른 부품에 묻히는 자리를 먼저'는 조립 방향의 문제라 프로그램이 알 수 없다. */
  var 열간격 = 60;      // 좌우로 이만큼 넘게 벌어지면 '다음 열'로 본다
  var _열표 = null;     // { cmpId: {시트, 열} } — 한 번 그릴 때 여러 번 쓰므로 만들어 두고 쓴다

  function 열표만들기() {
    var 표 = {};
    (WE.model.project.sheets || []).forEach(function (sh, si) {
      var cs = (sh.components || []).slice().sort(function (a, b) { return (a.x || 0) - (b.x || 0); });
      var 열 = 0;
      cs.forEach(function (c, i) {
        if (i > 0 && (c.x || 0) - (cs[i - 1].x || 0) > 열간격) 열++;
        표[c.id] = { 시트: si, 열: 열 };
      });
    });
    return 표;
  }
  function 자리순서(cmp) {
    if (!cmp) return { 시트: 0, 열: 0, y: 0 };
    if (!_열표) _열표 = 열표만들기();
    var v = _열표[cmp.id] || { 시트: 0, 열: 0 };
    return { 시트: v.시트, 열: v.열, y: cmp.y || 0 };
  }
  function 자리비교(a, b) {
    var p = 자리순서(a), q = 자리순서(b);
    return p.시트 - q.시트 || p.열 - q.열 || p.y - q.y;
  }
  function 작업순서로(묶음) {
    return 묶음.sort(function (a, b) {
      return 자리비교(WE.model.getComponent(a.cmpId), WE.model.getComponent(b.cmpId));
    });
  }

  // 라벨이 하나도 없을 때 화면에 띄울 안내 (배선은 있는데 목록이 빈 이유를 알려 준다)
  function wireListEmptyHint() {
    return (WE.model.project.wires || []).length
      ? WE.i18n.t("연결된 배선이 없습니다.")
      : WE.i18n.t("배선이 없습니다.");
  }
  /* 결선표 표 만들기 — 넷 하나가 여러 줄이 되므로 '넷 번호' 열로 묶음을 표시한다.
     엑셀에서 그 열로 정렬·필터하면 한 덩어리가 흩어지지 않는다. */
  /* 결선표 파일(CSV·엑셀) — **화면 결선표와 같은 열·같은 순번·같은 부품 표기**로 낸다 (2026-09-14).
       예전에는 옛 "배선 리스트" 형식(넷·색·AWG·여기서/여기로…)이라 화면과 이름·순서가 달랐다.
     화면과 다른 점 두 가지는 스프레드시트라서 일부러 그렇다:
       · 이어지는 줄에도 부품·시작·색·규격·배선·비고를 **다 채운다** — 화면·종이의 병합은 눈으로 읽기 위한 것이고,
         엑셀에서 정렬·필터를 걸면 빈 줄이 흩어진다.
       · 규격은 "AWG22" 글자가 아니라 숫자 22 (머리글에 AWG 를 적는다) — 정렬이 되게.
     넷 하나에 순번 하나 = 화면과 같은 번호. 색은 화면의 색 견본 자리 — 팔레트 이름으로 적는다. */
  function wireListExportRows() {
    var nets = netListData();
    var head = [WE.i18n.t("순번"), WE.i18n.t("부품"), WE.i18n.t("시작 단자"), WE.i18n.t("색"),
                WE.i18n.t("연결 부품"), WE.i18n.t("연결부 단자"), WE.i18n.t("규격(AWG)"),
                WE.i18n.t("배선"), WE.i18n.t("비고")];
    var rows = [];
    nets.forEach(function (net, i) {
      var awg = net.awg === "" || net.awg == null ? "" : (isFinite(Number(net.awg)) ? Number(net.awg) : net.awg);
      var note = 비고읽기(비고키(net));
      net.targets.forEach(function (m) {
        rows.push([i + 1, net.origin.cmp, net.origin.term, net.color,
                   m.cmp, m.term, awg, net.count, note]);
      });
    });
    return { head: head, rows: rows, nets: nets.length };
  }

  function exportWireListCSV() {
    var t = wireListExportRows();
    if (!t.nets) { setHint(wireListEmptyHint()); return; }
    if (내보내기막힘()) return;
    csvDownload((WE.model.project.meta.name || WE.i18n.t("배선도")) + WE.i18n.t("_결선표.csv"), t);
    setHint(WE.i18n.t("결선표 내보내기: ") + t.nets + WE.i18n.t("개 넷"));
  }

  function exportWireListXlsx() {
    var t = wireListExportRows();
    if (!t.nets) { setHint(wireListEmptyHint()); return; }
    if (내보내기막힘()) return;
    WE.xlsx.download((WE.model.project.meta.name || WE.i18n.t("배선도")) + WE.i18n.t("_결선표.xlsx"),
      [{ name: WE.i18n.t("결선표"), headRows: 1, rows: [t.head].concat(t.rows) }]);
    setHint(WE.i18n.t("결선표 내보내기: ") + t.nets + WE.i18n.t("개 넷"));
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
    /* 이름 숨기기 — 도면의 부품 이름표를 감춘다(우클릭 메뉴에서 옮겨 옴, 2026-09-14).
       ⚠ 이름 자체는 안 지운다. BOM·결선표는 그대로 이 부품을 이름으로 부른다.
       켠 것만 저장한다(false 를 파일마다 남기지 않게). */
    document.getElementById("propHideName").addEventListener("change", function (e) {
      var c = WE.model.getSelectedComponent(); if (!c) return;
      if (e.target.checked) c.hideName = true; else delete c.hideName;
      WE.render.renderAll();
    });
    // 번호 숨기기 — 도면 이름표에서만 #n 을 뺀다(model.cmpDiagramLabel). 결선표는 그대로.
    // 켠 것만 저장한다(false 를 파일마다 남기지 않게) — 이름 숨기기(hideName)와 같은 방식.
    document.getElementById("propHideNo").addEventListener("change", function (e) {
      var c = WE.model.getSelectedComponent(); if (!c) return;
      if (e.target.checked) c.hideNo = true; else delete c.hideNo;
      WE.render.renderAll();
    });
  }

  // ---- 프리셋 관리 모달 ----
  // 컨트롤러를 js/presetmodal.js 로 옮겼다 — 관리자 페이지(admin.html)도 같은 코드를 쓴다.
  // 여기 남는 것은 에디터가 부르는 입구뿐이다.
  function openPresetModal() { WE.presetModal.open(); }


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
        WE.bgremove.open(c.image, function (url, tf, size) { applyInstanceImage(c, url, tf, size); }, { width: c.width, height: c.height });
      } else if (act === "info") {
        /* 부품 정보 편집 — 이미 라이브러리에 연결돼 있으면 그 정보를 바로 연다.
           아직 연결이 없으면(직접 그려 넣었거나 예전 프로젝트) 먼저 라이브러리에 저장한
           뒤 같은 편집창을 연다 — 예전 "라이브러리에 저장" 메뉴가 하던 일과 같다.
           메뉴에 두 항목으로 나눠 두면 "뭐부터 눌러야 하지"가 생긴다. (2026-09-03) */
        if (c.libraryId && WE.library.get(c.libraryId)) { openLibEdit(c.libraryId); return; }
        var savedPart = saveToLibrary(c.name, function () { return 부품자료(c); });
        if (savedPart) { c.libraryId = savedPart.id; openLibEdit(savedPart.id); }
      } else if (act === "tolib") {
        /* 도면에서 고친 모습을 라이브러리 원본에 반영한다 (2026-09-08 되살림).
           ⚠ 이미 **배치된** 부품들은 안 바뀐다 — 배치하는 순간 자기 사본을 갖기 때문이다.
              바뀌는 건 '앞으로 꺼내 쓸 때' 다. 그래서 되돌리기(Ctrl+Z)로도 안 돌아온다.
              그러니 자동으로 하지 않고 이 메뉴를 눌렀을 때만 한다. */
        if (c.libraryId && WE.library.get(c.libraryId)) {
          WE.library.updatePart(c.libraryId, 부품자료(c));
          renderLibrary();
          queueBackupNotice();
          setHint(WE.i18n.t("라이브러리 부품을 지금 모습으로 갱신했습니다: ") + c.name,
            WE.i18n.t("이미 배치된 부품은 그대로입니다 — 앞으로 꺼내 쓸 때부터 바뀐 모습이 나옵니다."));
        } else {
          var 새부품 = saveToLibrary(c.name, function () { return 부품자료(c); });
          if (새부품) c.libraryId = 새부품.id;
        }
      } else if (act === "front" || act === "forward" || act === "backward" || act === "back") {
        // 겹침 순서 — 캔바 류의 네 동작. 부품이 서로 겹칠 때 위아래를 바꿀 방법이 없었다(2026-09-03).
        var 바뀜 = act === "front" ? WE.model.bringToFront(c.id)
                : act === "back" ? WE.model.sendToBack(c.id)
                : act === "forward" ? WE.model.bringForward(c.id)
                : WE.model.sendBackward(c.id);
        if (바뀜) WE.render.renderAll();
      } else if (act === "publish" && WE.publicPublisher) {
        WE.publicPublisher.open(c, function (published) {
          if (!published) return;
          c.publicId = published.publicId;
          c.publicVersion = published.publicVersion;
          if (c.libraryId) WE.library.updatePart(c.libraryId, {
            publicId: published.publicId, publicVersion: published.publicVersion
          });
          WE.store.saveNow();
        });
      }
    });
  }

  // 관리자 확인 전에는 게시 버튼 자체를 DOM에 만들지 않는다.
  function syncPublicPublishMenu(isAdmin) {
    var menu = document.getElementById("cmpMenu");
    var old = menu.querySelector('[data-act="publish"]');
    if (isAdmin && !old) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.act = "publish";
      btn.textContent = WE.i18n.t("공용 부품으로 게시…");
      // 게시는 '이 부품에 대한 정보 작업' 묶음의 끝 — 겹침 순서 divider 바로 위에 둔다.
      var divider = document.getElementById("cmpMenuDivider2") || menu.querySelector("hr");
      menu.insertBefore(btn, divider);
    } else if (!isAdmin && old) old.remove();
    syncAdminPageMenu(isAdmin);
    // 설정 창의 「촬영용 (관리자)」 구역 — 배선 긋기 애니메이션. 일반 사용자는 쓸 일이 없다(2026-09-20 고원빈).
    var demo = document.getElementById("setDemoSection");
    if (demo) demo.hidden = !isAdmin;
  }
  /* 배선 긋기 애니메이션이 켜졌나 — 설정이 켜져 있고 **그리고** 관리자일 때만.
     설정만 보면, 관리자로 켜 두고 로그아웃한 브라우저에서 계속 돌 수 있다. 관리자 판정은 public-publisher 가 캐시해 둔 값. */
  function drawAnimEnabled() {
    return !!(_settings.drawAnim && WE.publicPublisher && WE.publicPublisher.isAdmin && WE.publicPublisher.isAdmin());
  }
  function drawAnimSpeed() { return _settings.drawAnimSpeed > 0 ? _settings.drawAnimSpeed : 500; }

  // 계정 메뉴의 '관리자 페이지' — 관리자일 때만 DOM에 만든다.
  // ⚠ 숨기는 것은 보안이 아니다. admin.html 은 정적 파일이라 주소를 아는 사람은 열 수 있다.
  //    실제로 막는 것은 DB의 RLS 이고(supabase/03_public_categories.sql),
  //    관리자가 아니면 분류 추가·수정·삭제가 서버에서 거부된다. 여기서는 눈에 안 띄게만 한다.
  function syncAdminPageMenu(isAdmin) {
    var menu = document.getElementById("acctMenu"); if (!menu) return;
    var old = menu.querySelector("#acctAdmin");
    if (!isAdmin) { if (old) old.remove(); return; }
    if (old) return;
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "acct-item"; btn.id = "acctAdmin";
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 3.2l7 3v5.3c0 4.2-2.9 7.6-7 9.3-4.1-1.7-7-5.1-7-9.3V6.2z"/><path d="M9.4 12.1l1.8 1.8 3.4-3.6"/></svg>' +
      WE.i18n.t("관리자 페이지");
    // 새 창으로 연다 — 그리던 배선도를 두고 나갔다 오게 하지 않는다.
    // noopener: 새 창이 window.opener 로 이 창을 건드리지 못하게 막는다(보안 기본).
    btn.addEventListener("click", function () { window.open("admin.html", "_blank", "noopener"); });
    // 요금제 아래, 로그아웃 위 구분선 앞에 둔다
    var sep = menu.querySelector(".acct-sep");
    if (sep) menu.insertBefore(btn, sep); else menu.appendChild(btn);
  }

  function openComponentMenu(menuBtnEl, cmp) {
    var r = menuBtnEl.getBoundingClientRect();
    openComponentMenuAt(r.left, r.bottom + 2, cmp);
  }

  function openComponentMenuAt(clientX, clientY, cmp) {
    _menuCmpId = cmp.id;
    var menu = document.getElementById("cmpMenu");
    menu.hidden = false;
    menu.style.left = Math.max(8, Math.min(clientX, window.innerWidth - menu.offsetWidth - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(clientY, window.innerHeight - menu.offsetHeight - 8)) + "px";
    // 다음 pointerdown이 메뉴 밖이면 닫기
    document.removeEventListener("pointerdown", outsideClose, true);
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
    var pn = document.getElementById("projName");
    pn.value = WE.model.project.meta.name || "";
    제목폭맞추기();
    pn.addEventListener("input", function (e) {
      WE.model.project.meta.name = e.target.value;
      제목폭맞추기();   // 글자를 치는 대로 칸이 따라 늘어난다
    });

    // 도면 작성일 — PDF 우측 상단에 나가는 값. 비우면 최종 수정일을 자동으로 쓴다.
    var pd = document.getElementById("projDate");
    pd.addEventListener("blur", commitProjDate);
    pd.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); pd.blur(); }
      else if (e.key === "Escape") { syncProjDate(); pd.blur(); }
    });
    syncProjDate();
    bindProjNote();
  }

  // ---- 도면 비고 ----
  // 인쇄물 하단 좌측 비고 칸에 그대로 나가는 값. 칸 높이가 4줄로 묶여 있다.
  //
  // 넘치는 줄은 '잘라내지 않고 입력 자체를 막는다'. 예전엔 초과분을 잘라 버렸는데,
  // 4줄이 찬 상태에서 첫 줄 끝에 엔터를 치면 마지막 줄이 소리 없이 사라졌다.
  // 사용자가 쓴 글을 지우는 쪽보다 안 받아 주는 쪽이 낫다.
  var NOTE_LINES = 4;

  function noteLineCount(v) { return String(v || "").split("\n").length; }

  function bindProjNote() {
    var ta = document.getElementById("projNote");
    if (!ta) return;
    var last = ta.value;

    // 줄이 늘어나는 입력만 미리 가로챈다(엔터·붙여넣기·드롭).
    // 지우기·되돌리기나 줄바꿈 없는 글자는 줄 수를 늘릴 수 없으므로 그냥 통과시킨다.
    ta.addEventListener("beforeinput", function (e) {
      var t = e.inputType || "", ins;
      if (t === "insertLineBreak" || t === "insertParagraph") ins = "\n";
      else if (t === "insertFromPaste" || t === "insertFromDrop") {
        ins = (e.dataTransfer && e.dataTransfer.getData("text/plain")) || "";
      } else if (t.indexOf("insert") === 0) ins = e.data || "";
      else return;
      if (!/[\r\n]/.test(ins)) return;
      var next = ta.value.slice(0, ta.selectionStart) + ins + ta.value.slice(ta.selectionEnd);
      if (noteLineCount(next) > NOTE_LINES) { e.preventDefault(); rejectNote(); }
    });

    ta.addEventListener("input", function () {
      // beforeinput을 안 지원하는 브라우저용 안전망 — 여기서도 자르지 않고 직전 값으로 되돌린다
      if (noteLineCount(ta.value) > NOTE_LINES) {
        var at = Math.min(ta.selectionStart, last.length);
        ta.value = last;
        ta.setSelectionRange(at, at);
        rejectNote();
        return;
      }
      last = ta.value;
      WE.model.setSheetNote(ta.value);   // 비고는 도면(시트)마다 따로
      markNoteOverflow();
    });
    // 작성일과 같은 규칙 — 칸을 벗어날 때 저장(그 사이는 자동저장이 받는다)
    ta.addEventListener("blur", function () { WE.store.saveNow(); });
    ta.addEventListener("focus", function () { setNoteOpen(true); });
    document.getElementById("noteToggle").addEventListener("click", function () {
      var open = !document.body.classList.contains("note-open");
      setNoteOpen(open);
      if (open) ta.focus();
    });
    syncProjNote();
  }

  // 막았다는 걸 알린다 — 아무 반응이 없으면 키가 안 먹은 줄 알고 계속 누르게 된다
  var _noteRejectTimer = null;
  function rejectNote() {
    var ta = document.getElementById("projNote");
    setHint(WE.i18n.t("비고는 최대 4줄까지 넣을 수 있습니다."));
    ta.classList.add("note-blocked");
    clearTimeout(_noteRejectTimer);
    _noteRejectTimer = setTimeout(function () { ta.classList.remove("note-blocked"); }, 700);
  }

  function setNoteOpen(open) {
    document.body.classList.toggle("note-open", !!open);
    document.getElementById("noteToggle").setAttribute("aria-expanded", open ? "true" : "false");
  }

  // 실제로 접힌 줄까지 세어 4줄을 넘으면 테두리로 알린다(그 상태로 인쇄하면 잘린다)
  function markNoteOverflow() {
    var ta = document.getElementById("projNote");
    if (!ta) return;
    var lh = 18;                                   // #projNote line-height
    var over = ta.value !== "" && ta.scrollHeight - 6 > lh * NOTE_LINES + 1;
    ta.classList.toggle("note-over", over);
  }

  // 인쇄 범례에 실제로 실리는 항목 — 도면에 쓰인 색 중 이름이 붙은 것만.
  // 팔레트 전체를 넣으면 안 쓴 색까지 나와 칸만 길어진다. (인쇄는 pdf.js가 이 목록을 그린다)
  function legendItems() {
    var proj = WE.model.project;
    var used = {};
    // proj.wires 는 '현재 시트' 별칭이다. 그것만 보면 시트 2에만 쓴 색이
    // 인쇄물 범례에서 빠져, 보는 사람은 그 색이 무슨 뜻인지 알 길이 없다.
    WE.model.allWires().forEach(function (w) {
      if (w && w.color) used[String(w.color).toLowerCase()] = 1;
    });
    return (proj.palette || []).filter(function (p) {
      return p && p.label && used[String(p.color).toLowerCase()];
    });
  }

  // 화면 비고 칸 폭을 인쇄물과 같은 비율로 맞춘다.
  // 인쇄 밴드 281mm 중 범례가 (열 수 × 약 22mm)를 쓰고 나머지가 비고 몫이다.
  function syncNoteWidth() {
    var cols = Math.max(1, Math.ceil(legendItems().length / NOTE_LINES));
    var legendMm = Math.min(181, cols * 22 + 16);   // 비고 최소 100mm는 남긴다
    var ratio = (281 - legendMm) / 281;
    document.getElementById("canvasFooter").style.setProperty("--note-ratio", ratio.toFixed(3));
    markNoteOverflow();
  }

  function syncProjNote() {
    var ta = document.getElementById("projNote");
    if (!ta) return;
    ta.value = WE.model.getSheetNote();
    syncNoteWidth();
  }

  // 입력값 정리 → YYYY.MM.DD. 사람이 치는 여러 형태를 받아 준다.
  //   20260723 · 2026.07.23 · 2026-7-23 · 2026/7/3  →  2026.07.23 / 2026.07.03
  // 알아들을 수 없으면 null.
  function normDate(v) {
    var raw = String(v || "").trim();
    var y, m, d;
    var parts = raw.split(/[^0-9]+/).filter(function (x) { return x !== ""; });
    if (parts.length === 3 && parts[0].length === 4) {
      y = parts[0]; m = parts[1]; d = parts[2];
    } else {
      var digits = raw.replace(/\D/g, "");
      if (digits.length !== 8) return null;
      y = digits.slice(0, 4); m = digits.slice(4, 6); d = digits.slice(6, 8);
    }
    var mi = +m, di = +d;
    if (m.length > 2 || d.length > 2) return null;
    if (!(mi >= 1 && mi <= 12) || !(di >= 1 && di <= 31)) return null;
    function p2(n) { return (n < 10 ? "0" : "") + n; }
    return y + "." + p2(mi) + "." + p2(di);
  }
  function commitProjDate() {
    var input = document.getElementById("projDate");
    var raw = (input.value || "").trim();
    if (!raw) {                                   // 비우면 자동(최종 수정일)
      delete WE.model.project.meta.drawnAt;
      syncProjDate(); WE.store.saveNow();
      setHint(WE.i18n.t("작성일을 자동(최종 수정일)으로 되돌렸습니다."));
      return;
    }
    var v = normDate(raw);
    if (!v) {                                     // 못 알아들으면 되돌리고 알려 준다
      syncProjDate();
      setHint(WE.i18n.t("날짜 형식을 알 수 없습니다. 예: 20260723 또는 2026.07.23"));
      return;
    }
    WE.model.project.meta.drawnAt = v;
    syncProjDate(); WE.store.saveNow();
  }

  // 날짜 칸 갱신. 지정값이 없으면 비워 두고, 자동값을 흐린 안내값(placeholder)으로 보여 준다.
  function syncProjDate() {
    var input = document.getElementById("projDate");
    if (!input) return;
    var fixed = WE.model.project.meta.drawnAt || "";
    input.value = fixed;
    input.placeholder = autoDrawnDate();
  }
  // 마지막으로 도면 내용이 바뀐 시각 (없으면 오늘)
  function autoDrawnDate() {
    var t = (WE.store && WE.store.lastSavedAt) ? WE.store.lastSavedAt() : 0;
    var d = new Date(t || Date.now());
    function p2(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "." + p2(d.getMonth() + 1) + "." + p2(d.getDate());
  }

  // ---- 속성 패널 ----
  function bindProps() {
    document.getElementById("propName").addEventListener("input", function (e) {
      applyProp(function (c) { c.name = e.target.value; }, true);
    });
    // 입력을 마친 시점에만 개인 사본을 만든다. 키를 누를 때마다 라이브러리를 저장하지 않는다.
    document.getElementById("propName").addEventListener("change", function () {
      var c = WE.model.getSelectedComponent();
      if (c) makeComponentIndependent(c, true);
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
    // 비율 고정 계산은 '입력 시작 시점'의 비율로 — 타이핑 중간값(예: "300" 입력 중 "30")이
    // 부품에 반영되고 최소치(10) 클램프까지 겹치면서 비율이 오염되는 것 방지
    var _propRatio = null;   // { id, r: height/width }
    function propRatioFor(c) {
      if (_propRatio && _propRatio.id === c.id && _propRatio.r > 0) return _propRatio.r;
      return c.height / c.width;
    }
    ["propW", "propH"].forEach(function (fid) {
      document.getElementById(fid).addEventListener("focus", function () {
        var c = WE.model.getSelectedComponent();
        if (c && c.width > 0) _propRatio = { id: c.id, r: c.height / c.width };
      });
    });
    document.getElementById("propW").addEventListener("input", function (e) {
      var v = parseFloat(e.target.value); if (isNaN(v) || v < 10) return;
      applyProp(function (c) {
        if (WE.model.ui.lockAspect) c.height = Math.max(10, Math.round(v * propRatioFor(c)));
        c.width = v;
      }, true);
      refreshProps(); // 비율 고정 시 높이 값도 반영
    });
    document.getElementById("propH").addEventListener("input", function (e) {
      var v = parseFloat(e.target.value); if (isNaN(v) || v < 10) return;
      applyProp(function (c) {
        if (WE.model.ui.lockAspect) c.width = Math.max(10, Math.round(v / propRatioFor(c)));
        c.height = v;
      }, true);
      refreshProps();
    });
    document.getElementById("propLockAspect").addEventListener("change", function (e) {
      WE.model.ui.lockAspect = e.target.checked;
    });
    // 회전은 0/90/180/270 만 허용한다 (2026-08-23 확정) — 회전 핸들도 같은 규칙이다.
    // 90 단위가 아니면 단자 탈출 스텁이 대각선이 되어 직각 배선과 어긋나고,
    // 수동배선을 부품과 함께 돌릴 때 수평·수직이 깨진다.
    // ⚠ 입력 중에 칸의 값을 되돌리면 타이핑을 방해한다 — 반영만 스냅하고 칸은 blur 에서 맞춘다.
    document.getElementById("propRot").addEventListener("input", function (e) {
      var v = parseFloat(e.target.value); if (isNaN(v)) return;
      var 스냅 = ((Math.round(v / 90) * 90) % 360 + 360) % 360;
      applyProp(function (c) { c.rotation = 스냅; }, true);
    });
    document.getElementById("propRot").addEventListener("blur", function (e) {
      var c = WE.model.getSelectedComponent();
      if (c) e.target.value = c.rotation || 0;   // 칸에 남은 어중간한 숫자를 실제 값으로 되돌린다
    });
    // 음수가 나오지 않도록 360을 더한 뒤 나머지를 취한다 (-90 → 270)
    document.getElementById("propRot90").addEventListener("click", function () {
      applyProp(function (c) { c.rotation = (c.rotation + 90) % 360; }, false);
    });
    document.getElementById("propRotL").addEventListener("click", function () {
      applyProp(function (c) { c.rotation = (c.rotation + 270) % 360; }, false);
    });
    document.getElementById("propBgRemove").addEventListener("click", function () {
      var c = WE.model.getSelectedComponent();
      if (!c || !c.image) return;
      WE.bgremove.open(c.image, function (url, tf, size) { applyInstanceImage(c, url, tf, size); }, { width: c.width, height: c.height });
    });
    // 삭제·복제 버튼은 두지 않는다 — Delete / Ctrl+D 가 있고, 파괴적 동작을
    // 다른 버튼과 같은 비중으로 패널에 두면 잘못 누르기 쉽다.
  }

  // 속성 변경 적용 후 렌더 (fromInput=true면 입력창 값은 다시 안 덮어씀)
  function applyProp(fn, fromInput) {
    var c = WE.model.getSelectedComponent();
    if (!c) return;
    // 크기·회전·좌표를 바꾸면 단자가 움직인다 → 연결된 수동배선이 따라오게 감싼다.
    // (드래그로 옮길 때와 같은 처리. 이게 없으면 꺾임점이 제자리에 남아 선이 위로 튄다)
    if (WE.interactions && WE.interactions.withTermFollow) {
      WE.interactions.withTermFollow([c.id], function () { fn(c); });
    } else {
      fn(c);
    }
    WE.render.renderAll();
    if (!fromInput) refreshProps();
    else { WE.render.renderOverlay(); }
  }

  // 속성 패널을 현재 선택으로 갱신
  function refreshProps() {
    updateHistoryButtons();
    syncWireRoutingBtns();   // 고른 배선이 바뀌면 모양 버튼도 그 배선 것을 가리켜야 한다
    var powerPanel = document.getElementById("powerPanel");
    powerPanel.hidden = true;   // 전력 요약은 기본(무선택) 상태에서만 표시
    var empty = document.getElementById("propEmpty");
    var body = document.getElementById("propBody");
    /* 라벨 모드 안내는 선택과 무관하게 늘 맨 위에 둔다 — 라벨을 붙이는 동안에는
       배선이 선택되기도 하고 안 되기도 하는데, 칸이 사라졌다 나타나면 쓸 수가 없다. */
    var lmp = document.getElementById("labelModeProps");
    if (lmp) lmp.hidden = (WE.model.ui.mode !== "label");
    var wp = document.getElementById("wireProps");
    var al = document.getElementById("alignProps");
    var ap = document.getElementById("annoProps");

    // 다중 선택 → 정렬 패널
    var multi = WE.model.getMulti();
    if (multi.length > 1) {
      empty.hidden = true; body.hidden = true; wp.hidden = true; ap.hidden = true; al.hidden = false;
      document.getElementById("alignCount").textContent = WE.i18n.t("부품 ") + multi.length + WE.i18n.t("개 선택됨");
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
      // 연결 설명 문구는 단일 선택에선 표시하지 않음(불필요) — 다중 선택 개수만 안내
      // 선택 개수 표시는 없앴다 — 정렬 구획이 나타나는 것으로 충분하다 (2026-08-18)
      document.getElementById("wireAlign").hidden = !(mw && mw.length >= 2);
      /* 여러 배선을 함께 골랐을 때 값이 서로 다르면 **칸을 비운다** (2026-09-09 고원빈).
         팔레트 스와치는 이미 그렇게 하고 있었다 — 나머지 칸도 같은 규칙으로 맞춘다. */
      var ws = 고른배선들();
      var 겹침 = 공통값(ws, function (w) { return !!w.allowOverlap; });
      var ov = document.getElementById("wireAllowOverlap");
      ov.indeterminate = (겹침 == null);        // 섞임 = 켜짐도 꺼짐도 아닌 상태
      ov.checked = !!겹침;
      // 색 칸(운영체제 색 고르개)은 비울 수가 없다 — 섞였다는 건 아래 팔레트가 알려 준다
      setIfNotFocused("wireColor", wire.color);
      var 종류 = 공통값(ws, function (w) { return w.dash || ""; });
      var ds = document.getElementById("wireDash");
      if (document.activeElement !== ds) {
        if (종류 == null) ds.selectedIndex = -1;   // 섞임 = 아무것도 안 고른 상태
        else ds.value = 종류;
      }
      renderWirePalette();
      값칸("wireWidth", 공통값(ws, function (w) { return w.width; }));
      값칸("wireLabelText", 공통값(ws, function (w) { return w.labelText || ""; }));
      값칸("wireCurrent", 공통값(ws, function (w) { return w.current > 0 ? w.current : ""; }));
      updateWireAwgOut(wire);
      renderWireLoadList();
      return;
    }
    wp.hidden = true;

    var c = WE.model.getSelectedComponent();
    if (!c) {
      // 라벨 모드에서는 위 안내가 이미 무엇을 하라고 말해 준다 — "선택된 대상이 없습니다" 는 군더더기
      empty.hidden = (WE.model.ui.mode === "label"); body.hidden = true;
      if (SHOW_POWER_SUMMARY) { powerPanel.hidden = false; renderPowerSummary(); }   // 무선택 = 전력 요약 표시
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
    document.getElementById("propHideName").checked = !!c.hideName;
    // 번호 숨기기 — 번호가 붙은 부품(같은 품목이 여럿)에만 칸이 보인다.
    // (처음엔 "번호 #2 숨기기" 처럼 실제 번호를 넣었는데 "굳이" 라는 판단 — 2026-09-14 고원빈)
    document.getElementById("propHideNoWrap").hidden = !(WE.model.cmpSeq(c) > 0);
    document.getElementById("propHideNo").checked = !!c.hideNo;
    renderCompElec(c);
  }

  // 선택 부품의 전기 정보(라이브러리 값)를 속성 하단에 읽기전용 표시
  function renderCompElec(c) {
    var box = document.getElementById("compElec");
    var lib = componentPart(c);
    if (!lib) { box.hidden = true; return; }
    var roleMap = { battery: WE.i18n.t("배터리(소스)"), load: WE.i18n.t("부하"), converter: WE.i18n.t("변환기") };
    var role = lib.role || "load";
    function row(k, v) { return "<div class='ce-row'><span>" + k + "</span><b>" + v + "</b></div>"; }
    var html = row(WE.i18n.t("역할"), roleMap[role] || role);
    if (n(lib.volt)) html += row(WE.i18n.t("전압"), n(lib.volt) + " V");
    if (n(lib.current)) html += row(WE.i18n.t("전류"), n(lib.current) + " A");
    if (partPower(lib)) html += row(WE.i18n.t("전력"), round(partPower(lib)) + " W");
    if (role === "battery" && n(lib.capacityAh)) html += row(WE.i18n.t("용량"), n(lib.capacityAh) + " Ah" + (n(lib.dod) ? (" · DoD " + n(lib.dod) + "%") : ""));
    if (role === "load" && n(lib.minPerHour) && n(lib.minPerHour) !== 60) html += row(WE.i18n.t("가동"), n(lib.minPerHour) + WE.i18n.t(" 분/시간"));
    if (role === "converter" && n(lib.efficiency)) html += row(WE.i18n.t("효율"), n(lib.efficiency) + " %");
    var hasVal = n(lib.volt) || n(lib.current) || partPower(lib) || n(lib.capacityAh);
    document.getElementById("compElecBody").innerHTML = hasVal ? html
      : WE.i18n.t("<span class='muted'>전기값 미입력 — ⚙ 부품 정보에서 입력</span>");
    box.hidden = false;
  }

  /* 프로젝트 이름 칸을 글자 길이에 맞춘다 (2026-09-09 고원빈: "창이 너무 작은데").

     ⚠ input 은 글자 수에 맞춰 저절로 늘어나지 않는다. 눈에 안 보이는 쌍둥이 글자에
        같은 글꼴을 입혀 폭을 재고, 그 값을 칸에 준다.
     ⚠ 한계는 CSS(min/max-width)가 진다 — 여기서 숫자를 두 벌 관리하지 않는다. */
  var _제목자 = null;
  function 제목폭맞추기() {
    var el = document.getElementById("projName");
    if (!el) return;
    if (!_제목자) {
      _제목자 = document.createElement("span");
      _제목자.setAttribute("aria-hidden", "true");
      _제목자.style.cssText = "position:absolute;left:-9999px;top:-9999px;white-space:pre;";
      document.body.appendChild(_제목자);
    }
    var cs = getComputedStyle(el);
    _제목자.style.fontFamily = cs.fontFamily;
    _제목자.style.fontSize = cs.fontSize;
    _제목자.style.fontWeight = cs.fontWeight;
    _제목자.style.letterSpacing = cs.letterSpacing;
    _제목자.textContent = el.value || el.placeholder || "";
    // 좌우 안여백 + 테두리 + 커서 자리
    el.style.width = (_제목자.offsetWidth + 24) + "px";
  }

  function setIfNotFocused(id, value) {
    var elm = document.getElementById(id);
    if (document.activeElement !== elm) elm.value = value;
  }

  // 상태 안내. 한 줄에 들어가는 짧은 문장만 보여주고, 자세한 설명은 full 로 받아 툴팁에 둔다.
  // 툴바에 길게 늘어놓으면 줄이 접혀 화면이 흔들리고, 그러면 오히려 아무도 안 읽는다.
  // 화면 가운데서 한 번 막고 알린다. 되돌릴 수 없는 실패에만 쓴다 —
  // 성공·진행 상황까지 이걸로 알리면 곧 닫기 바쁜 창이 되어 정작 중요한 순간에도 안 읽힌다.
  function notice(title, text) {
    var m = document.getElementById("noticeModal");
    if (!m) { alert(title + "\n\n" + (text || "")); return; }   // 마크업이 없으면 최소한 알리기는 한다
    document.getElementById("noticeTitle").textContent = title;
    document.getElementById("noticeText").textContent = text || "";
    m.hidden = false;
    var ok = document.getElementById("noticeOk");
    if (ok) ok.focus();
  }
  /* 안내 모달이 지금 떠 있는가.
     한도 안내처럼 '막힐 때마다 알려야 하는' 쪽에서, 이미 떠 있는 모달을
     또 열지 않으려고 쓴다. (겹치는 것만 막고, 닫은 뒤에는 다시 뜬다) */
  function isNoticeOpen() {
    var m = document.getElementById("noticeModal");
    return !!(m && !m.hidden);
  }
  function bindNotice() {
    var m = document.getElementById("noticeModal"); if (!m) return;
    function close() { m.hidden = true; }
    document.getElementById("noticeOk").addEventListener("click", close);
    m.addEventListener("click", function (e) { if (e.target === m) close(); });   // 바깥을 눌러도 닫힘
    m.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }

  function setHint(text, full) {
    var h = document.getElementById("hint");
    h.textContent = text; h.classList.remove("hint-save");
    h.title = full || text;   // 좁은 화면에서 …으로 잘렸을 때도 전체를 볼 수 있다
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  // 저장 안내(날짜·시간, 작은 글씨)
  function setSavedHint() {
    var d = new Date();
    var s = WE.i18n.t("💾 저장됨 ") + d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
    var h = document.getElementById("hint");
    h.textContent = s; h.classList.add("hint-save");
  }

  // 프로젝트 열기 후 전체 UI 갱신
  // 배치된 부품의 libraryId가 라이브러리에서 사라진 경우(다른 브라우저에서 만든 파일,
  // 예전 버전의 라이브러리 불러오기로 id가 재발급된 경우 등) 같은 이름의 부품으로 다시 연결.
  // 연결이 끊기면 BOM의 스펙·가격·구매링크·데이터시트가 전부 빈칸으로 보이므로 열 때마다 복구 시도.
  /* ⚠ 배치된 부품에는 모델명(spec)이 없다(instanceOpts 가 안 옮긴다). 그래서 여기서는
        findSame 을 그대로 못 쓴다. 대신 이렇게 가른다:
          · publicId 가 있으면 그것으로 찾는다 — 공용 카탈로그 신원이라 확실하다
          · 없으면 **그 이름을 가진 부품이 딱 하나일 때만** 잇는다
        이름이 같은 부품이 둘 이상이면 어느 쪽인지 알 길이 없으므로 잇지 않고 둔다.
        BOM 칸이 비는 편이, 엉뚱한 스펙·가격이 채워지는 것보다 낫다. (2026-09-03) */
  function relinkOrphanComponents() {
    var fixed = 0;
    WE.model.allComponents().forEach(function (c) {   // 전체 시트 — 끊긴 라이브러리 연결 점검
      if (!c.libraryId || WE.library.get(c.libraryId)) return;   // 정상 연결이면 통과
      var 후보 = null;
      if (c.publicId) {
        후보 = WE.library.getAll().filter(function (p) { return p.publicId === c.publicId; })[0] || null;
      }
      if (!후보) {
        var 같은이름 = WE.library.getAll().filter(function (p) { return p.name === c.name; });
        if (같은이름.length === 1) 후보 = 같은이름[0];
      }
      if (후보) { c.libraryId = 후보.id; fixed++; }
    });
    return fixed;
  }

  function reloadUI() {
    var snap = WE.model.project.meta.canvas.snap !== false;
    document.getElementById("chkSnap").checked = snap;
    document.getElementById("projName").value = WE.model.project.meta.name || "";
    제목폭맞추기();
    syncProjDate();
    syncProjNote();
    document.getElementById("wireWidthSel").value = String(WE.model.ui.wireWidth);
    syncWireRoutingBtns();
    relinkOrphanComponents();
    applyCanvasSize();          // 연 파일·바뀐 시트의 용지 크기 반영
    syncPageSizeBtn();
    renderPalette();
    renderSheetTabs();          // 연 파일의 시트 구성으로 탭 줄을 다시 그린다
    WE.render.renderAll();
    refreshProps();
  }

  return {
    copySelection: copySelection, pasteClipboard: pasteClipboard,
    init: init, refreshProps: refreshProps, setHint: setHint, notice: notice, isNoticeOpen: isNoticeOpen, setSavedHint: setSavedHint, reloadUI: reloadUI,
    renderLibrary: renderLibrary,
    toggleAllFolders: toggleAllFolders,
    openComponentMenu: openComponentMenu,
    openComponentMenuAt: openComponentMenuAt,
    openPresetModal: openPresetModal,
    focusAnnoText: focusAnnoText,
    afterTerminalEdit: afterTerminalEdit, makeComponentIndependent: makeComponentIndependent,
    buildBOM: buildBOM,
    bomData: bomData,
    bomColumns: visibleCols,
    linkLabel: linkLabel,
    renderBOMView: renderBOMView,
    netListData: function () { return SHOW_WIRE_LIST ? netListData() : []; },
    // 검사가 '표에 보이는 것' 과 '내보내는 것' 이 같은지 맞춰 볼 때 쓴다
    wireListExportRows: wireListExportRows,
    _테스트_csvCell: csvCell,
    _테스트_우편함: applyAdminInbox,
    // 인쇄용 결선표(js/pdf.js)도 화면과 **같은 비고**를 찍어야 한다
    wireNoteOf: function (net) { return 비고읽기(비고키(net)); },
    renderWireListView: renderWireListView,
    netListByComponent: function () { return SHOW_WIRE_LIST ? netListByComponent() : []; },   // 숨김 시 인쇄 섹션도 빠진다
    legendItems: legendItems,
    syncProjNote: syncProjNote,
    syncNoteWidth: syncNoteWidth,
    afterModelRender: afterModelRender,
    powerSummaryRows: powerSummaryRows,
    handleShortcut: handleShortcut,
    fitZoom: fitZoom,          // 화면 맞춤 — 배율 숫자 클릭과 가운데 버튼 더블클릭이 같이 쓴다
    // 여러 장 인쇄가 시트를 바꿔 가며 부른다 — 시트마다 용지가 다를 수 있어서(2026-09-08)
    applyCanvasSize: applyCanvasSize,
    setMode: setMode,
    nextWireLabel: nextWireLabel,
    // 라벨 모드에서 배선을 클릭할 때 interactions.js 가 쓴다
    붙일라벨: 붙일라벨, 라벨칸올리기: 라벨칸올리기,
    track: track, trackOnce: trackOnce,
    // '새 배선도로 시작'. 검사가 이 이름으로 부르고 있었는데 노출이 안 돼 있어서
    // WE.app.newProject ? ... : 1 이 조용히 지나갔다 (2026-08-18).
    newProject: startNewProject,
    drawAnimEnabled: drawAnimEnabled, drawAnimSpeed: drawAnimSpeed,   // 배선 긋기 애니메이션 (render.js 가 묻는다)
    offerNotifyAfterValue: offerNotifyAfterValue
  };
})();

window.addEventListener("DOMContentLoaded", WE.app.init);

// 예제 창 — 완성품 예제를 보고 배선도를 새 문서로 연다. (CLAUDE 2026-09-20, 로컬 시험 단계)
//
// 무엇을 하나
//   툴바 2행 오른쪽 「예제」 → 창(app.html #exampleModal, 공용 부품 창과 같은 껍데기) →
//   목록에서 고르면 오른쪽 상세·슬라이드가 바뀌고, 바닥의 「문서 열기」가 그 예제의 wiring.ezc 를 새 문서로 연다.
//   「업로드」는 <esp-web-install-button>(js/vendor/esp-web-tools) 이 그 예제의 firmware/manifest.json 대로 보드에 쓴다.
//   예제 폴더 하나(examples/<id>/)에 배선도·펌웨어·캡처·소스(source/)가 다 있다 — 폴더째 옮겨도 된다.
//
// 예제가 둘 이상이면 (2026-09-20 lyric-eoreun 추가 · 2026-09-22 campfire 추가)
//   첫 예제 때는 슬라이드·「문서 열기」·업로드 manifest 가 전부 wild-trail 로 박혀 있어서, 목록에서 다른 것을
//   골라도 오른쪽 글만 바뀌고 열기·업로드는 여전히 wild-trail 을 했다. 지금은 select(id) 가 셋을 함께 바꾼다.
//   상세 글(무슨 앱·필요한 부품)은 여전히 마크업(app.html [data-example-detail])이고, 파일 경로·슬라이드만 아래 표다.
//
// 왜 확인창을 안 띄우나
//   ☰ 샘플 프로젝트는 "현재 작업을 비우고" 열기 때문에 confirm 을 띄운다(app.js btnSample).
//   여기는 다르다 — 열기 전에 지금 문서를 임시저장(saveNow)하고 스냅샷(pushSnapshot)까지 남긴 뒤
//   새 문서를 얹는다. 옛 문서의 초안은 자기 id 로 그대로 남아 ☰ → 최근 작업에서 열린다(store.js 가
//   저장 때마다 점유를 지금 문서로 옮기고, 옛 초안은 지우지 않는다). 잃는 것이 없으니 물을 것도 없다.
//
// 열기는 파일 열기와 같은 길을 탄다
//   WE.io.loadProjectBuffer(buf, 이름, opts) — gzip/텍스트 판별, 부품 라이브러리 병합, reloadUI, history.reset,
//   saveNow, 안내문까지 그 안에서 다 한다. 여기서 따로 하는 것이 없어야 나중에 열기 경로가 바뀌어도
//   예제만 어긋나는 일이 없다.
//   하나만 다르다 — { asNew: true, name } 으로 열어 **예제 이름 + 새 문서 id** 를 붙인다(2026-09-20). 파일 안의 이름
//   ("거북이컷 배선도V1")·id 를 그대로 쓰면 프로젝트 이름이 예제와 안 맞고, 예제 둘이 같은 배선 파일을 쓰므로
//   최근 작업 한 칸을 같이 써서 앞서 열어 손대던 초안이 덮였다. 창 문구 "새 문서로 열립니다" 그대로, 열 때마다 새 문서다.
//
// 예제 상세 글은 아직 마크업에 박혀 있다(app.html). 예제가 더 늘어나면 public_examples 표/JSON 으로 뽑는다.
// 파일 경로(배선도·manifest)와 슬라이드만 여기 표로 둔다. 키 = 폴더 이름 = 마크업의 data-example.
var WE = window.WE || {};
window.WE = WE;

WE.examples = (function () {
  "use strict";

  var WIRING = {
    "wild-trail":   { file: "examples/wild-trail/wiring.ezc",   manifest: "examples/wild-trail/firmware/manifest.json",   name: "파이리와 작은 모험" },
    "lyric-eoreun": { file: "examples/lyric-eoreun/wiring.ezc", manifest: "examples/lyric-eoreun/firmware/manifest.json", name: "애니메이션 비디오" },
    "campfire":     { file: "examples/campfire/wiring.ezc",     manifest: "examples/campfire/firmware/manifest.json",     name: "불멍" }
  };

  // 플레이 장면 슬라이드 — 창이 열려 있는 동안만 1.5초마다 넘긴다(닫히면 멈춤).
  // 정지 화면 하나로는 '게임이구나' 까지만 전해진다. 점프→공격→방어→진화→도감이 돌아가면 뭘 하는 앱인지 말 없이 보인다.
  // 리릭 비디오도 같다 — 지하철→하트→안아주기→웃는 사람들→토닥→웃음이 돌아가면 4분짜리 이야기가 여섯 장으로 보인다.
  var SLIDES = {
    "wild-trail": [
      ["examples/wild-trail/media/title-device.png", "타이틀"],
      ["examples/wild-trail/media/jump-device.png", "점프"],
      ["examples/wild-trail/media/attack-240.png", "타이밍 공격"],
      ["examples/wild-trail/media/guard-240.png", "방어"],
      ["examples/wild-trail/media/evolution-reveal-device.png", "진화"],
      ["examples/wild-trail/media/dex-240.png", "도감"]
    ],
    "lyric-eoreun": [
      ["examples/lyric-eoreun/media/subway-240.png", "퇴근길 지하철"],
      ["examples/lyric-eoreun/media/heart-240.png", "금 가는 하트"],
      ["examples/lyric-eoreun/media/hug-240.png", "안아주기"],
      ["examples/lyric-eoreun/media/crowd-240.png", "웃는 사람들"],
      ["examples/lyric-eoreun/media/pat-240.png", "토닥토닥"],
      ["examples/lyric-eoreun/media/smile-240.png", "웃음"]
    ],
    // 불멍 — 활활 → 장작 넣기 → 잔불 → 푸른 불 → 보랏빛 불. 불이 잦아들고 색이 바뀌는 앱이라는 게 다섯 장으로 보인다 (2026-09-22)
    "campfire": [
      ["examples/campfire/media/fire-240.png", "활활"],
      ["examples/campfire/media/log-240.png", "장작 넣기"],
      ["examples/campfire/media/embers-240.png", "잔불"],
      ["examples/campfire/media/blue-240.png", "푸른 불"],
      ["examples/campfire/media/purple-240.png", "보랏빛 불"]
    ]
  };
  var current = "wild-trail";        // 지금 고른 예제 — init 에서 마크업의 .active 행으로 맞춘다
  var slideTimer = null, slideAt = 1;
  function showSlide(i) {
    var img = $("exSlide"), cap = $("exSlideCap"), s = SLIDES[current];
    if (!img || !cap || !s) return;
    slideAt = (i + s.length) % s.length;
    img.src = s[slideAt][0]; cap.textContent = t(s[slideAt][1]);
  }
  function startSlides() { stopSlides(); showSlide(slideAt); slideTimer = setInterval(function () { showSlide(slideAt + 1); }, 1500); }
  function stopSlides() { if (slideTimer) { clearInterval(slideTimer); slideTimer = null; } }

  var modal, opening = false;
  function $(id) { return document.getElementById(id); }
  function t(s) { return WE.i18n && WE.i18n.t ? WE.i18n.t(s) : s; }

  function open() { modal.hidden = false; startSlides(); }
  function close() { modal.hidden = true; stopSlides(); }

  // 왼쪽 분류를 누르면 목록을 거른다. 분류 버튼 data-cat ↔ 목록 행 data-cat. "all" 은 전부.
  // 걸러서 지금 고른 예제가 사라지면 남은 첫 항목을 고른다 — 오른쪽 상세가 목록과 어긋나지 않게.
  function filterCategory(cat) {
    Array.prototype.forEach.call(modal.querySelectorAll(".public-library-category"), function (b) {
      b.classList.toggle("active", b.dataset.cat === cat);
    });
    var shown = 0, firstShown = null, activeHidden = false;
    Array.prototype.forEach.call(modal.querySelectorAll(".public-library-result"), function (row) {
      var on = cat === "all" || row.dataset.cat === cat;
      row.hidden = !on;
      if (on) { shown++; if (!firstShown) firstShown = row; }
      else if (row.classList.contains("active")) activeHidden = true;
    });
    var count = $("exampleCount");
    if (count) count.textContent = shown + t("개");
    if (activeHidden && firstShown) select(firstShown.dataset.example);
  }

  // 목록에서 고르면 오른쪽 상세를 바꾼다. 상세 패널은 data-example-detail 로 짝을 맞춘다.
  // 글만 바꾸면 안 된다 — 슬라이드(공용 #exSlide)·「문서 열기」가 열 파일·「업로드」가 쓸 manifest 도 이 예제 것으로.
  // install-button 은 클릭 순간에 manifest 속성을 읽으므로(vendor install-button.js: t.manifest || getAttribute) 속성만 바꾸면 된다.
  function select(id) {
    if (!WIRING[id]) return;
    current = id;
    Array.prototype.forEach.call(modal.querySelectorAll(".public-library-result"), function (b) {
      b.classList.toggle("active", b.dataset.example === id);
    });
    Array.prototype.forEach.call(modal.querySelectorAll("[data-example-detail]"), function (p) {
      p.hidden = p.dataset.exampleDetail !== id;
    });
    var go = $("exampleOpen"); if (go) go.dataset.exampleOpen = id;
    var up = $("exampleUpload"); if (up) up.setAttribute("manifest", WIRING[id].manifest);
    slideAt = 0;
    if (!modal.hidden) startSlides();     // 창이 열린 채 고르면 첫 장부터 다시 돈다. 닫혀 있으면 open() 이 돌린다
  }

  // 「새 문서로 열기」
  function openWiring(id) {
    var ex = WIRING[id];
    if (!ex || opening) return;
    opening = true;
    setStatus(t("배선도를 불러오는 중…"));
    // 지금 문서를 확실히 남긴다 — startNewProject(app.js)가 하는 것과 같은 안전망.
    try { WE.store.saveNow(); WE.store.pushSnapshot(); } catch (e) { /* 저장 막힌 환경 — 그래도 연다 */ }
    fetch(ex.file).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      return WE.io.loadProjectBuffer(buf, t(ex.name), { asNew: true, name: t(ex.name) });   // 예제 이름 + 새 id 로. 열기 완료 안내문도 이 안에서 나간다
    }).then(function (ok) {
      opening = false;
      if (ok === false) { setStatus(""); return; }          // io.js 가 이미 alert 를 띄웠다
      if (WE.app && WE.app.track) WE.app.track("open_example", { example: id });
      setStatus("");
      close();
    }).catch(function () {
      opening = false;
      // 파일이 없거나(404) 서버가 없을 때. 창은 그대로 두어 다른 예제를 고를 수 있게 한다.
      setStatus(t("예제 배선도를 불러오지 못했습니다."));
      if (WE.app && WE.app.setHint) WE.app.setHint(t("예제 배선도를 불러오지 못했습니다."));
    });
  }

  var STATUS_DEFAULT = "새 문서로 열립니다 — 지금 그리던 도면은 ☰ → 최근 작업에 그대로 있어요";
  function setStatus(text) { var s = $("exampleStatus"); if (s) s.textContent = text || t(STATUS_DEFAULT); }

  // 버튼의 오른쪽 끝을 속성창 경계선(캔버스와 속성창 사이 세로선 = #resizerRight 왼쪽)에 맞춘다.
  // 방법: 버튼은 margin-left:auto 로 오른쪽에 붙고, 그 뒤 안내문(#hint)의 최대 폭을
  //   「툴바 줄 오른쪽 끝 − 경계선 x − 줄 간격(12px)」 으로 잘라 두면 버튼이 경계선 위에 선다.
  // 속성창은 끌어서 폭이 바뀌고(app.js setupResizer) 창 크기도 바뀌므로 ResizeObserver 로 따라간다.
  // 좁은 창에서는 안내문이 flex-basis 0 으로 줄어들며 버튼이 오른쪽으로 밀리는데, 그건 접힘을 막는 원래 동작이다.
  function alignToPanel() {
    var hint = $("hint"), line = $("resizerRight") || $("rightPanel");
    if (!hint || !line) return;
    var row = hint.closest(".tb-row");
    if (!row) return;
    var gap = parseFloat(getComputedStyle(row).columnGap) || 12;
    var w = row.getBoundingClientRect().right - line.getBoundingClientRect().left - gap;
    if (w > 0) hint.style.maxWidth = Math.round(w) + "px";
  }
  function watchPanel() {
    alignToPanel();
    window.addEventListener("resize", alignToPanel);
    if (typeof ResizeObserver === "function") {
      var ro = new ResizeObserver(alignToPanel);
      var panel = $("rightPanel"); if (panel) ro.observe(panel);
      var tb = $("toolbar"); if (tb) ro.observe(tb);     // 툴바 폭이 바뀌어도(안내문 길이 등) 다시 잰다
    }
  }

  function init() {
    modal = $("exampleModal");
    var btn = $("btnExamples");
    if (!modal || !btn) return;
    watchPanel();
    // 마크업이 처음 보여 주는 예제(.active 행)와 current 를 맞춘다 — 열기·업로드·슬라이드가 첫 화면과 어긋나지 않게.
    var first = modal.querySelector(".public-library-result.active");
    if (first && WIRING[first.dataset.example]) current = first.dataset.example;
    btn.addEventListener("click", open);
    // 닫는 길은 × · 배경 클릭 · Esc 셋. 바닥의 닫기 버튼은 뺐다(고원빈 2026-09-20 — 문서 열기·업로드만 남긴다).
    $("exampleClose").addEventListener("click", close);
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });   // 배경 클릭
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !modal.hidden) close(); });
    modal.addEventListener("click", function (e) {
      var cat = e.target.closest(".public-library-category");
      if (cat && cat.dataset.cat) { filterCategory(cat.dataset.cat); return; }
      var item = e.target.closest(".public-library-result");
      if (item && item.dataset.example) { select(item.dataset.example); return; }
      var go = e.target.closest("[data-example-open]");
      if (go) openWiring(go.dataset.exampleOpen);
      // 「업로드」 — 실제 일은 <esp-web-install-button> 이 한다(포트 선택 → 칩 확인 → 쓰기 → 완료 창).
      // 우리는 예제 창만 닫는다: 설치 창은 body 끝에 붙는 네이티브 <dialog>(top layer)라 어차피 위에 뜨지만,
      // 끝나고 닫혔을 때 사용자가 예제 창이 아니라 에디터(방금 연 배선도)로 돌아오는 편이 자연스럽다.
      // 포트 선택을 취소하면 아무 일도 없이 예제 창만 닫힌 상태가 된다 — 다시 「예제」를 누르면 된다.
      if (e.target.closest("esp-web-install-button [slot=activate]")) {
        if (WE.app && WE.app.track) WE.app.track("upload_example", { example: current });
        setTimeout(close, 0);   // 라이브러리의 click 처리(requestPort 는 사용자 동작 안에서 불려야 한다)가 먼저 돌게 한 박자 늦춘다
      }
    });
  }

  window.addEventListener("DOMContentLoaded", init);
  return { open: open, close: close, openWiring: openWiring };
})();

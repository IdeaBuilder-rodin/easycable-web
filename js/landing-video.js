// landing-video.js — 랜딩의 영상들(히어로 + 비교 + 기능 3개)을 **보고 있을 때만, 하나씩, 가볍게** 돌린다 (2026-09-27)
//
// 예전에는 index.html 안의 인라인 스크립트가 히어로 영상 하나만 맡았다. 영상이 다섯 개가 되면서 여기로 옮겼고,
// 테스트 페이지(홍보영상/랜딩테스트)에서 실측하고 고원빈이 확인한 규칙을 합쳤다. 검사: tests/verify_landingvideo.mjs
//
//   ① 받을지 말지 — 휴대폰(≤820px)·데이터 절약·느린 회선(2G/3G)은 **받지 않는다.** 정지 그림 + 재생 단추만.
//      휴대폰에서는 작업이 안 되고 보기만 한다(고원빈). 몇 MB 를 자동으로 받게 할 이유가 없다.
//   ② 「움직임 줄이기」 — Windows 「애니메이션 효과」 를 끈 PC 가 흔하다(성능 설정·원격 접속). 막아 두면 그런 방문자는
//      영상을 못 본다(고원빈 PC 가 그랬다). 그래서 PC 는 **한 번만** 돌리고 마지막 장면에서 멈춘다.
//   ③ 보고 있는 영상 **하나만** — 화면에 가장 많이 보이는 것(35% 이상) 하나만 돌리고 나머지는 멈춘다.
//      실측(CPU 4배 느림): 보이는 것마다 틀면 스크롤 60→51fps, 하나만이면 60fps(영상 없는 랜딩과 같다).
//   ④ 히어로 영상은 **페이지 로딩(load) 뒤에** 받는다 — 테스트 페이지에서 영상 받기가 첫 그림과 겹쳐
//      첫 화면(LCP)이 가끔 1.0~1.5초로 튀었다. 그동안은 정지 그림(preload)이 자리를 채운다.
//   ⑤ 아래쪽 영상은 포스터를 화면 600px 앞, 영상을 400px 앞에서 받는다 — 열자마자 다 받지 않게.
//   ⑥ 일시정지 단추 — 5초 넘게 자동으로 움직이면 멈출 수 있어야 한다(WCAG 2.2.2). 누르면 스크롤해도 다시 안 튼다.
//
// 마크업: 히어로 = #heroVideo[data-mp4] + #heroPlay 단추 · 나머지 = video.vid-lazy[data-src][data-poster]
var WE = window.WE || {};
window.WE = WE;

(function () {
  "use strict";
  var hero = document.getElementById("heroVideo");
  var heroBtn = document.getElementById("heroPlay");
  var lazy = Array.prototype.slice.call(document.querySelectorAll("video.vid-lazy"));
  var all = (hero && hero.getAttribute("data-mp4") ? [hero] : []).concat(lazy);
  if (!all.length) return;

  function 물어본다(q) { try { return window.matchMedia(q).matches; } catch (e) { return false; } }
  function tr(s) { return WE.i18n && WE.i18n.t ? WE.i18n.t(s) : s; }
  var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
  var 아낀다 = conn.saveData === true || /(^|-)([23]g)$/.test(conn.effectiveType || "");
  var 좁다 = 물어본다("(max-width: 820px)");
  var 움직임줄임 = 물어본다("(prefers-reduced-motion: reduce)");
  var 수동 = 아낀다 || 좁다;

  function 주소(v) { return v === hero ? (hero.getAttribute("data-webm") || hero.getAttribute("data-mp4")) : v.getAttribute("data-src"); }
  // 영상 파일을 붙인다. 히어로는 <source> 로(webm 이 생기면 먼저 고르게), 나머지는 src 로
  function 붙이기(v, 받기) {
    if (v.getAttribute("data-attached")) return;
    v.setAttribute("data-attached", "1");
    if (v === hero) {
      [["data-webm", "video/webm"], ["data-mp4", "video/mp4"]].forEach(function (p) {
        var s = hero.getAttribute(p[0]); if (!s) return;
        var el = document.createElement("source"); el.src = s; el.type = p[1]; hero.appendChild(el);
      });
    } else v.setAttribute("src", v.getAttribute("data-src"));
    v.preload = 받기 ? "auto" : "none";   // none: 누르기 전엔 안 받는다(휴대폰)
    if (v === hero) v.load();
  }
  // ⑤ 포스터는 화면 600px 앞에서 붙인다 (휴대폰도 같은 규칙 — 정지 그림은 보여야 하니까)
  function 포스터(v) { var p = v.getAttribute("data-poster"); if (p && !v.getAttribute("poster")) v.setAttribute("poster", p); }
  if (window.IntersectionObserver) {
    var po = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { 포스터(e.target); po.unobserve(e.target); } });
    }, { rootMargin: "600px 0px" });
    lazy.forEach(function (v) { po.observe(v); });
  } else lazy.forEach(포스터);

  // ── ① 받지 않는 경우: 히어로는 재생 단추, 나머지는 브라우저 조작 막대 ──
  if (수동 || !window.IntersectionObserver) {
    if (heroBtn && all[0] === hero) heroBtn.hidden = false;
    if (heroBtn) heroBtn.addEventListener("click", function () {
      heroBtn.hidden = true; hero.controls = true;   // 누른 뒤엔 멈출 수 있게 조작 막대를 준다
      붙이기(hero, true);
      var p = hero.play(); if (p && p.catch) p.catch(function () { heroBtn.hidden = false; });
    });
    lazy.forEach(function (v) { v.controls = true; 붙이기(v, false); });
    return;
  }

  // ── 자동 재생 ──
  var 로드끝 = document.readyState === "complete";
  var ratio = new Map();
  if (움직임줄임) all.forEach(function (v) {   // ② 한 번만 돌고 마지막 장면에서 멈춘다
    v.loop = false;
    v.addEventListener("ended", function () { v.setAttribute("data-done", "1"); 단추맞춤(v); });
  });

  // ③ 가장 많이 보이는 영상 하나만
  function 고르기() {
    var best = null, br = 0.35;
    all.forEach(function (v) {
      var r = ratio.get(v) || 0;
      if (r === 0) v.removeAttribute("data-done");   // 화면에서 완전히 나갔다 오면 한 번 더
      if (r > br) { br = r; best = v; }
    });
    all.forEach(function (v) {
      var 틀까 = v === best && !v.getAttribute("data-user-paused") && !v.getAttribute("data-done");
      if (틀까 && v === hero && !로드끝) 틀까 = false;   // ④ 히어로는 load 뒤에 (그때 다시 고른다)
      if (틀까) {
        붙이기(v, true);
        if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () { if (v === hero && heroBtn) heroBtn.hidden = false; else v.controls = true; }); }
      } else if (!v.paused) v.pause();
      단추맞춤(v);
    });
  }
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { ratio.set(e.target, e.intersectionRatio); });
    고르기();
  }, { threshold: [0, 0.2, 0.35, 0.5, 0.65, 0.8, 1] });
  all.forEach(function (v) { io.observe(v); });
  // ⑤ 곧 볼 아래 영상은 미리 받아 둔다(재생은 안 함) — 화면 400px 앞
  var pre = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { 붙이기(e.target, true); pre.unobserve(e.target); } });
  }, { rootMargin: "400px 0px" });
  lazy.forEach(function (v) { pre.observe(v); });
  if (!로드끝) window.addEventListener("load", function () { 로드끝 = true; 고르기(); });

  // 히어로 재생 단추(자동재생이 거절된 경우 — iOS 저전력 모드 등)
  if (heroBtn) heroBtn.addEventListener("click", function () {
    heroBtn.hidden = true; hero.removeAttribute("data-user-paused"); 붙이기(hero, true);
    var p = hero.play(); if (p && p.catch) p.catch(function () { heroBtn.hidden = false; });
  });

  // ⑥ 일시정지 단추 — 영상 오른쪽 아래
  var 멈춤그림 = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  var 재생그림 = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  function 단추맞춤(v) {
    var b = v.__pp; if (!b) return;
    var 재생중 = !v.paused;
    b.innerHTML = 재생중 ? 멈춤그림 : 재생그림;
    b.setAttribute("aria-label", tr(재생중 ? "일시정지" : "재생"));
    b.title = tr(재생중 ? "일시정지" : "재생");
  }
  all.forEach(function (v) {
    var box = v.closest(".out-shot, .shot"); if (!box) return;
    var b = document.createElement("button"); b.type = "button"; b.className = "vid-pp";
    b.addEventListener("click", function () {
      if (v.paused) {
        v.removeAttribute("data-user-paused"); v.removeAttribute("data-done"); 붙이기(v, true);
        var p = v.play(); if (p && p.catch) p.catch(function () { /* 못 틀면 그대로 */ });
      } else { v.setAttribute("data-user-paused", "1"); v.pause(); }
    });
    ["play", "pause", "ended"].forEach(function (n) { v.addEventListener(n, function () { 단추맞춤(v); }); });
    box.appendChild(b); v.__pp = b; 단추맞춤(v);
  });
})();

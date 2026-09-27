// i18n.js — 다국어 지원 (사전 방식, 한글 원문을 키로 사용)
// - 언어 감지: localStorage(we_lang) → navigator.language (ko면 한국어, 그 외 영어)
// - HTML: DOM 로드 시 텍스트 노드 + title/placeholder 속성을 일괄 치환 (원본 마크업은 한국어 유지)
// - JS 동적 문구: WE.i18n.t("한글") 로 감싸면 현재 언어로 반환
// - 언어 추가: js/i18n-<언어>.js 를 만들어 WE.i18nMaps.<언어> 에 등록하고, 아래 LANGS 에 이름을 더한다
var WE = window.WE || {};
window.WE = WE;

WE.i18n = (function () {
  "use strict";

  /* 영어 사전은 js/i18n-en.js 로 떼어 냈다 (2026-09-27) — 한국어로 보는 사람은 받지 않는다(약 115KB).
     영어일 때만 **이 자리에서 곧바로** 불러온다(document.write). 이 파일은 모든 페이지에서 일반(동기) 스크립트라
     파서가 그 파일을 바로 다음에 실행한다 → 뒤의 스크립트와 DOMContentLoaded 의 boot() 는 사전이 있는 상태로 돈다.
     즉 영어판 동작은 떼어 내기 전과 똑같다. (검사: tests/verify_lazyload.mjs ⑤ · verify_i18n.mjs 영어 에디터)
     ⚠ 이 파일을 defer/async 로 부르면 document.write 가 무시된다 — 그때는 아래처럼 비동기로 받고 한 번 더 번역한다. */
  var LANGS = ["en"];                              // 사전 파일이 있는 언어
  var MAPS = WE.i18nMaps = WE.i18nMaps || {};     // i18n-<언어>.js 가 여기에 등록한다
  var _me = document.currentScript;               // 사전 파일 주소를 이 파일 주소에서 만든다(페이지 위치와 무관하게)

  var META_DESC = {
    en: "Draw wiring diagrams the easy way: upload part images, place terminals, connect wires. Auto BOM, wire list & PDF. Free during beta."
  };

  // ---- 언어 결정 ----
  //   ?lang=en|ko  →  저장된 선택(we_lang)  →  페이지 기본값  →  브라우저 언어
  //   · ?lang= 은 링크로 영어판을 보낼 때 쓴다(2026-09-15). 값은 저장해 다음 페이지에서도 이어진다.
  //   · 사이트 페이지(랜딩·요금제·약관 …)는 <html data-i18n-default="ko"> 로 **한국어 기본**을 선언한다 —
  //     구글 크롤러는 영어 브라우저로 오므로, 브라우저 언어를 따르면 easycable.co.kr 이 영어로 색인된다.
  //     에디터(app.html)는 선언이 없어 예전처럼 브라우저 언어를 따른다.
  function detect() {
    var q = null;
    try { q = new URLSearchParams(location.search).get("lang"); } catch (e) { /* 무시 */ }
    if (q === "ko" || (q && LANGS.indexOf(q) >= 0)) { try { localStorage.setItem("we_lang", q); } catch (e) { /* 무시 */ } return q; }
    var saved = null;
    try { saved = localStorage.getItem("we_lang"); } catch (e) { /* 무시 */ }
    if (saved && (saved === "ko" || LANGS.indexOf(saved) >= 0)) return saved;
    var def = document.documentElement.getAttribute("data-i18n-default");
    if (def === "ko" || (def && LANGS.indexOf(def) >= 0)) return def;
    var nav = (navigator.language || "ko").toLowerCase();
    return nav.indexOf("ko") === 0 ? "ko" : "en";
  }
  var _lang = detect();

  // 영어면 사전을 지금 불러온다
  if (_lang !== "ko" && !MAPS[_lang]) {
    var 사전 = (_me && _me.src ? _me.src.slice(0, _me.src.lastIndexOf("/") + 1) : "js/") + "i18n-" + _lang + ".js";
    if (document.readyState === "loading" && _me && !_me.async && !_me.defer) {
      document.write('<script src="' + 사전 + '"><\/script>');
    } else {
      // 방어: 파싱이 끝난 뒤(또는 async/defer 로) 불렸다 — 받은 뒤 화면을 한 번 더 번역한다
      var 태그 = document.createElement("script");
      태그.src = 사전;
      태그.onload = function () { if (document.body) translateDom(document.body); };
      (document.head || document.documentElement).appendChild(태그);
    }
  }

  // ---- 번역 함수 (JS 동적 문구용) ----
  function t(ko) {
    if (_lang === "ko") return ko;
    var map = MAPS[_lang];
    // ⚠ "" 도 번역이다 — "개"(단위)·" 시점" 처럼 영어에서 지워야 하는 조각은 사전값이 "" 인데,
    //    예전 `(map[ko] || ko)` 는 "" 를 거짓으로 보고 한국어로 되돌렸다(인쇄 BOM 의 "13개", "Reconnected 3개" — 2026-09-14 검토).
    //    translateDom 은 처음부터 !== undefined 로 봤다. 여기도 같게.
    return map && map[ko] !== undefined ? map[ko] : ko;
  }

  // ---- DOM 일괄 치환 ----
  // data-tip: 툴바 툴팁(app.html 의 자체 툴팁 속성). 2026-09-14 검토에서 18개가 통째로 한국어로 남던 원인 — 목록에 없어서.
  var ATTRS = ["title", "placeholder", "aria-label", "data-tip", "alt"];
  function translateDom(root) {
    if (_lang === "ko") return;
    var map = MAPS[_lang];
    if (!map) return;
    // 텍스트 노드: 앞뒤 공백은 유지하고 내용만 교체
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var raw = node.nodeValue;
      var key = raw.replace(/\s+/g, " ").trim();
      if (key && map[key] !== undefined) {
        // 앞뒤 공백만 지키고 가운데는 통째로 바꾼다. ⚠ 예전엔 raw.replace(key, …) 였는데, 랜딩처럼 문단이
        //    HTML 에서 여러 줄로 나뉘어 있으면 key(공백을 한 칸으로 합친 것)가 raw 의 부분 문자열이 아니라
        //    치환이 조용히 실패했다(2026-09-15 2단계에서 긴 문장 20개가 한국어로 남던 원인).
        var lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0];
        node.nodeValue = lead + map[key] + trail;
      }
    }
    // 속성
    var els = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (var i = 0; i < els.length; i++) {
      for (var a = 0; a < ATTRS.length; a++) {
        var v = els[i].getAttribute(ATTRS[a]);
        if (v && map[v] !== undefined) els[i].setAttribute(ATTRS[a], map[v]);
      }
    }
  }

  // ---- 언어 전환 (저장 후 새로고침 — 상태가 단순하고 확실함) ----
  function setLang(lang) {
    try { localStorage.setItem("we_lang", lang); } catch (e) { /* 무시 */ }
    location.reload();
  }

  // ---- 부팅: 문서 전체 번역 + 메타 + 토글 바인딩 ----
  function boot() {
    document.documentElement.lang = _lang;
    if (_lang !== "ko") {
      translateDom(document.body);
      // <title> · meta description — 페이지마다 다르므로 **지금 값**을 키로 찾는다(랜딩·요금제·계정·결제, 2026-09-15).
      // 에디터는 예전처럼 META_DESC 표도 본다.
      var titleKey = (document.title || "").trim();
      var 지금사전 = MAPS[_lang] || {};
      if (지금사전[titleKey]) document.title = 지금사전[titleKey];
      var md = document.querySelector('meta[name="description"]');
      var descKey = md ? (md.getAttribute("content") || "").trim() : "";
      if (md && 지금사전[descKey]) md.setAttribute("content", 지금사전[descKey]);
      else if (md && META_DESC[_lang] && !document.documentElement.hasAttribute("data-i18n-default")) md.setAttribute("content", META_DESC[_lang]);
    }
    // 언어별로만 보이는 요소 — <p data-i18n-show="en"> 는 영어일 때만 나온다.
    // 약관·개인정보처리방침은 한국어본만 있어(법률 문서), 영어 방문자에게 "한국어 약관이 적용됩니다" 한 줄을 이걸로 보인다(2026-09-15).
    var only = document.querySelectorAll("[data-i18n-show]");
    for (var k = 0; k < only.length; k++) only[k].hidden = only[k].getAttribute("data-i18n-show") !== _lang;
    // 🌐 언어 메뉴 (data-setlang 버튼)
    var btns = document.querySelectorAll("[data-setlang]");
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        var l = b.getAttribute("data-setlang");
        if (l === _lang) b.classList.add("lang-active");
        b.addEventListener("click", function () { if (l !== _lang) setLang(l); });
      })(btns[i]);
    }
  }
  document.addEventListener("DOMContentLoaded", boot);

  return { t: t, lang: function () { return _lang; }, setLang: setLang, translateDom: translateDom };
})();

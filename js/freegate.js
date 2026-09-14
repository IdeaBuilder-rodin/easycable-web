/* freegate.js — 무료 이용 기간 안내 창 두 가지 (2026-09-14)
     ① 요금제 페이지에 **들어올 때** — 「확인」을 눌러야만 닫힌다 (Esc·바깥 클릭 불가). "인지시키는" 창이다(고원빈).
        <body data-freegate-entry="1"> 인 페이지에서만 뜬다(요금제). 랜딩은 첫 화면이라 띄우지 않는다 — 심사자·손님이
        처음 만나는 화면을 모달로 막지 않는다.
     ② 요금제·랜딩의 「결제하기」를 **누를 때** — "무료로 계속 쓰기 / 결제 화면으로 이동" 을 고르게 한다.

   왜 — 지금은 무료 이용 기간이라 결제할 이유가 없는데, 카드 위 띠만으로는 손이 먼저 간다
        ("무의식적으로 결제하기를 눌러버릴 수 있다" — 고원빈). 누르는 그 순간에 한 번 세운다.
        페이지를 열 때마다 띄우는 모달은 닫고 잊히지만, 버튼을 누른 자리에서 묻는 것은 잊히지 않는다.
   무엇을 — 결제 화면으로 가기 전에 "무료로 계속 쓰기 / 결제 화면으로 이동" 둘 중 하나를 고르게 한다.
        진짜 방어선은 서버(order-create 의 PAY_OPEN)다. 여기는 안내이고, 결제 화면으로 가는 길은 남겨 둔다 —
        PG 심사자는 테스트 계정으로 그 길을 끝까지 가야 한다.
   ⚠ 낱말 주의 — 시험판·미완성을 뜻하는 낱말은 쓰지 않는다. PG 심사자에게 준비 중인 서비스로 보이면 안 된다(verify_pgready).
   ⚠ 결제를 여는 날(PG 승인) 이 파일을 싣는 <script> 줄 두 개(index.html · pricing.html)를 지우면 끝이다.
   외부 의존 없음 — 창의 HTML·CSS 를 여기서 만든다. landing.css 를 안 고쳐도 되게. */
(function () {
  "use strict";
  var CSS =
    ".fg-back{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}" +
    ".fg-box{background:#fff;border-radius:16px;max-width:420px;width:100%;padding:28px 26px 22px;box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:inherit}" +
    ".fg-box h2{margin:0 0 10px;font-size:20px;line-height:1.35;letter-spacing:-.01em;color:#111827}" +
    ".fg-box p{margin:0 0 20px;color:#4b5563;font-size:15px;line-height:1.7}" +
    ".fg-btns{display:flex;flex-direction:column;gap:8px}" +
    ".fg-btns button{font:inherit;font-size:15px;font-weight:600;padding:12px 16px;border-radius:10px;border:1px solid #d1d5db;background:#fff;color:#374151;cursor:pointer}" +
    ".fg-btns button.fg-main{background:#1565c0;border-color:#1565c0;color:#fff}" +
    ".fg-btns button.fg-main:hover{background:#0d47a1}" +
    ".fg-btns button:not(.fg-main):hover{background:#f3f4f6}";

  var 제목 = "지금은 무료 이용 기간입니다";
  var 본문 = "모든 기능을 결제 없이 쓸 수 있습니다. 지금은 결제하지 않으셔도 됩니다.";

  /* 창의 뼈대. buttons = [{ key, text, main }]. 반환값의 close() 로 닫는다.
     dismissable=false 면 Esc·바깥 클릭으로는 안 닫힌다 — 버튼을 눌러야만 한다. */
  function 창(buttons, dismissable, onClick) {
    var back = document.createElement("div");
    back.className = "fg-back";
    back.setAttribute("role", "dialog");
    back.setAttribute("aria-modal", "true");
    back.setAttribute("aria-labelledby", "fgTitle");
    back.innerHTML =
      '<div class="fg-box">' +
        '<h2 id="fgTitle">' + 제목 + "</h2>" +
        "<p>" + 본문 + "</p>" +
        '<div class="fg-btns">' +
          buttons.map(function (b) {
            return '<button type="button"' + (b.main ? ' class="fg-main"' : "") + ' data-fg="' + b.key + '">' + b.text + "</button>";
          }).join("") +
        "</div>" +
      "</div>";
    function 닫기() { back.remove(); document.removeEventListener("keydown", esc); }
    function esc(e) { if (dismissable && e.key === "Escape") 닫기(); }
    back.addEventListener("click", function (e) {
      var b = e.target.closest("[data-fg]");
      if (b) { onClick(b.dataset.fg, 닫기); return; }
      if (dismissable && e.target === back) 닫기();   // 바깥 클릭
    });
    document.addEventListener("keydown", esc);
    document.body.appendChild(back);
    back.querySelector(".fg-main, [data-fg]").focus();
    return { close: 닫기, el: back };
  }

  // ② 결제하기 앞 — 둘 중 하나를 고른다
  function 창만들기(href) {
    return 창([{ key: "stay", text: "무료로 계속 쓰기", main: true }, { key: "go", text: "결제 화면으로 이동" }], true,
      function (key, 닫기) { if (key === "go") location.href = href; else 닫기(); });
  }
  // ① 들어올 때 — 「확인」만이 닫는 길이다
  function 입장창() {
    return 창([{ key: "ok", text: "확인", main: true }], false, function (key, 닫기) { 닫기(); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    // ① 요금제 페이지 — 들어올 때마다 (기억하지 않는다: 매번 인지시키는 것이 목적이다)
    if (document.body.dataset.freegateEntry === "1") 입장창();
    // 결제로 가는 링크만 — 「현재 이용 중」으로 잠긴 버튼은 href 가 없어 걸리지 않는다
    document.addEventListener("click", function (e) {
      var a = e.target.closest('a[href^="checkout.html"]');
      if (!a) return;
      e.preventDefault();
      창만들기(a.getAttribute("href"));
    });
  });

  // 검사용 — 창을 열지 않고 규칙만 확인할 수 있게
  window.WE = window.WE || {};
  WE.freegate = { _테스트_열기: 창만들기, _테스트_입장창: 입장창 };
})();

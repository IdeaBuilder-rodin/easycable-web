/* 관리자 「접속자」 (2026-10-12) — 오늘 N명 + 최근 30일 막대그래프.

   왜 — 고원빈 10/12: 하루 접속자 추이를 보고 싶다(「Today 몇 명」 + 그래프), 중복 접속은 빼고.
   숫자의 뜻 — **기기당 하루 1명**(서울 날짜). 같은 기기가 하루에 열 번 열어도 1명이다.
     · 세는 쪽: js/auth.js 「접속자 세기」(그날 처음 열 때만 count_visit 한 번)
     · 서버:   _ai/sql/2026-10-12_접속자_집계.sql (날짜·숫자만 — 식별값 없음)
   읽기 — 이 화면에 들어올 때마다 visit_stats 한 번(관리자만 · jsonb 하나).
     Supabase 로그를 읽지 않는다 → 「로그 조회」 사용량 0 (_ai/함정.md — 로그 화면은 열 때마다 사용량이 든다).
   그리기 — 라이브러리 없이 SVG 를 직접 만든다. CSP 가 외부 스크립트를 막고(_headers), 막대 30개면 이걸로 충분하다.
   에디터 (2026-10-16) — 「그날 에디터(app.html)를 연 기기 수」 를 같이 보여 준다(고원빈 10/16 — 숫자 + 막대 겹치기 · 이름 「에디터」).
     왜: 접속자 40명 중 부품을 만든 기기는 3대였는데, 나머지가 랜딩에서 나갔는지 에디터까지 왔는지 몰랐다.
     · 전체 막대(연한 회색) 위에 같은 폭으로 에디터 막대(진한 회색 · 오늘은 주색)를 겹친다 — 에디터는 전체의 일부라서
     · editor_first_day 이전 날은 에디터 막대를 안 그린다(「0명」 과 「기록 없음」 을 가른다 — 전체 막대와 같은 원칙)
     · 서버가 에디터 키를 안 주면(2026-10-16 SQL 전) 에디터 숫자는 「–」, 막대는 전체만 — 옛 SQL 에서도 화면이 안 깨진다
   검사: tests/verify_adminstats.mjs */
(function () {
  "use strict";
  var WE = window.WE = window.WE || {};
  var NS = "http://www.w3.org/2000/svg";
  var 날수 = 30;
  // 그림 크기(viewBox 단위). CSS 가 너비 100% 로 늘리고 줄인다 — 글자도 같은 비율로 따라간다
  var W = 960, H = 260, 왼 = 44, 오른 = 8, 위 = 24, 아래 = 30;
  var 요일 = ["일", "월", "화", "수", "목", "금", "토"];

  var 자료 = null;     // 마지막으로 받은 visit_stats 결과 { today, first_day, days:[{day, visitors}] }
  var 오류 = null;
  var 읽는중 = false;
  var 묶음 = false;    // 새로 읽기 단추에 손잡이를 걸었는가(한 번만)

  function $(id) { return document.getElementById(id); }
  function client() { return WE.auth && WE.auth._client ? WE.auth._client() : null; }

  function 읽기() {
    var c = client();
    if (!c || !c.rpc) { 오류 = "로그인이 필요합니다"; 자료 = null; 그리기(); return Promise.resolve(); }
    읽는중 = true; 오류 = null; 그리기();
    return c.rpc("visit_stats", { p_days: 날수 }).then(function (res) {
      읽는중 = false;
      // ⚠ 조용히 빈 그래프를 보여 주지 않는다 — SQL 을 아직 안 돌렸을 때가 가장 흔한데,
      //    그때 「0명」 처럼 보이면 원인을 못 찾는다(admin-members.js 와 같은 원칙)
      if (res && res.error) { 오류 = res.error.message || "알 수 없는 오류"; 자료 = null; }
      else { 자료 = res ? res.data : null; }
      그리기();
    }, function (e) {
      읽는중 = false; 오류 = (e && e.message) || String(e); 자료 = null; 그리기();
    });
  }

  /* "2026-10-12" → "10/12" · "10/12(월)". 요일은 그 날짜 자체로 계산한다(브라우저 시간대와 무관하게 UTC 로) */
  function 월일(day) { var p = String(day).split("-"); return Number(p[1]) + "/" + Number(p[2]); }
  function 짧은날(day) {
    var p = String(day).split("-");
    var w = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]))).getUTCDay();
    return 월일(day) + "(" + 요일[w] + ")";
  }
  /* 눈금 최댓값 — 1·2·5 단위로 올린다(37명 → 50). 최소 5 — 처음 며칠 1~2명일 때 막대가 꽉 차 보이지 않게 */
  function 좋은최대(v) {
    if (v <= 5) return 5;
    var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var 후보 = [1, 2, 5, 10];
    for (var i = 0; i < 후보.length; i++) if (후보[i] * p >= v) return 후보[i] * p;
    return 10 * p;
  }

  function 요소(태그, 속성) {
    var e = document.createElementNS(NS, 태그);
    Object.keys(속성 || {}).forEach(function (k) { e.setAttribute(k, 속성[k]); });
    return e;
  }
  function 글(부모, x, y, 문구, 정렬, 클래스) {
    var t = 요소("text", { x: x, y: y, "text-anchor": 정렬, "class": 클래스 });
    t.textContent = 문구;
    부모.appendChild(t);
  }

  function 그리기() {
    var 숫자 = $("admStatsToday"), 에디터숫자 = $("admStatsEditor"), 알림 = $("admStatsMsg"), svg = $("admStatsChart");
    if (!svg) return;
    var days = (자료 && 자료.days) || [];
    var 시작 = (자료 && 자료.first_day) || null;   // 이 날 전은 「기록 없음」 — 0명과 구분해 막대를 안 그린다
    var 에디터시작 = (자료 && 자료.editor_first_day) || null;   // 에디터는 2026-10-16 부터 센다 — 그 전은 「에디터 기록 없음」
    var 에디터키있음 = !!자료 && 자료.editors_today !== undefined;   // 서버가 옛 SQL 이면 이 키가 없다

    if (알림) {
      알림.textContent = 오류 ? "읽지 못했습니다: " + 오류 + " — _ai/sql/2026-10-12_접속자_집계.sql · 2026-10-16_에디터_접속자.sql 을 실행했는지 확인하세요"
                     : 읽는중 ? "읽는 중…"
                     : 자료 && !시작 ? "아직 기록이 없습니다" : "";
      알림.classList.toggle("adm-stats-err", !!오류);
    }
    if (숫자) {
      숫자.textContent = 자료 && !오류 ? String(Number(자료.today) || 0) : "–";
      // 기준은 화면 글자로 늘어놓지 않고 말풍선에 둔다(UI 문구에 부연 설명을 붙이지 않는다)
      if (숫자.parentNode) 숫자.parentNode.title = "기기당 하루 1명 · 서울 시간" + (시작 ? " · " + 월일(시작) + " 부터" : "");
    }
    if (에디터숫자) {
      에디터숫자.textContent = 자료 && !오류 && 에디터키있음 ? String(Number(자료.editors_today) || 0) : "–";
      if (에디터숫자.parentNode) 에디터숫자.parentNode.title = "에디터를 연 기기 · 하루 1명" + (에디터시작 ? " · " + 월일(에디터시작) + " 부터" : "");
    }

    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    if (!days.length) return;

    // 눈금은 두 숫자 중 큰 것으로 — 보통 에디터 ≤ 전체지만, 전체 세기 요청만 실패한 날엔 에디터가 클 수 있다(막대가 그림 밖으로 안 나가게)
    var 최대 = 0;
    days.forEach(function (d) {
      if (시작 && d.day >= 시작) 최대 = Math.max(최대, Number(d.visitors) || 0);
      if (에디터시작 && d.day >= 에디터시작) 최대 = Math.max(최대, Number(d.editors) || 0);
    });
    var 눈금 = 좋은최대(최대);
    var 칸 = (W - 왼 - 오른) / days.length, 막대폭 = Math.max(2, 칸 * 0.68);
    var 바닥 = H - 아래, 높이 = 바닥 - 위;

    // 눈금선 둘(0 과 최댓값)만 — 30일 추이를 보는 데 그 이상은 어지럽다
    svg.appendChild(요소("line", { x1: 왼, y1: 위, x2: W - 오른, y2: 위, "class": "adm-stats-grid" }));
    svg.appendChild(요소("line", { x1: 왼, y1: 바닥, x2: W - 오른, y2: 바닥, "class": "adm-stats-axis" }));
    글(svg, 왼 - 8, 위 + 4, String(눈금), "end", "adm-stats-ylab");
    글(svg, 왼 - 8, 바닥 + 4, "0", "end", "adm-stats-ylab");

    days.forEach(function (d, i) {
      var x = 왼 + i * 칸;
      var n = Number(d.visitors) || 0;
      var 기록있음 = !!시작 && d.day >= 시작;    // "yyyy-mm-dd" 끼리는 글자 비교가 곧 날짜 비교
      var 에디터있음 = !!에디터시작 && d.day >= 에디터시작;
      var e = Number(d.editors) || 0;
      var 오늘인가 = i === days.length - 1;      // 서버가 오늘을 마지막 칸으로 준다
      var g = 요소("g", { "class": "adm-stats-day", "data-day": d.day });
      // 말풍선 — 「10/16(목) 40명 · 에디터 12명」. 전체 기록은 있는데 에디터를 세기 전인 날은 「에디터 기록 없음」
      var 말 = 요소("title");
      말.textContent = 짧은날(d.day) + " " + (기록있음 ? n + "명" : "기록 없음")
                     + (에디터있음 ? " · 에디터 " + e + "명" : 기록있음 && 에디터키있음 ? " · 에디터 기록 없음" : "");
      g.appendChild(말);
      // 마우스를 올릴 자리 — 칸 전체. 0명인 날도 말풍선이 떠야 한다
      g.appendChild(요소("rect", { x: x, y: 위, width: 칸, height: 높이, "class": "adm-stats-hit" }));
      var 막대x = x + (칸 - 막대폭) / 2;
      if (기록있음) {
        var h = Math.round(n / 눈금 * 높이 * 10) / 10;
        g.appendChild(요소("rect", { x: 막대x, y: 바닥 - h, width: 막대폭, height: h,
                                    "class": "adm-stats-bar" + (오늘인가 ? " today" : "") }));
        if (오늘인가) 글(g, x + 칸 / 2, 바닥 - h - 6, String(n), "middle", "adm-stats-val");
      }
      // 에디터 막대 — 전체 막대 **뒤에** 넣어 위에 겹친다. 클래스를 adm-stats-bar 와 따로 둔다(전체 막대 수를 세는 검사·CSS 와 안 섞이게)
      if (에디터있음) {
        var he = Math.round(e / 눈금 * 높이 * 10) / 10;
        g.appendChild(요소("rect", { x: 막대x, y: 바닥 - he, width: 막대폭, height: he,
                                    "class": "adm-stats-ed" + (오늘인가 ? " today" : "") }));
      }
      // 날짜 글자는 오늘과 7일 간격만 — 30개를 다 쓰면 겹친다
      if ((days.length - 1 - i) % 7 === 0) {
        글(g, x + 칸 / 2, 바닥 + 20, 오늘인가 ? "오늘" : 월일(d.day), "middle", "adm-stats-xlab" + (오늘인가 ? " today" : ""));
      }
      svg.appendChild(g);
    });
  }

  function bind() {
    묶음 = true;
    var b = $("admStatsRefresh");
    if (b) b.addEventListener("click", function () { 읽기(); });
  }

  /* 「접속자」 버튼을 누를 때마다 부른다(admin-batch.js setMode) — 매번 새로 읽는다(요청 1번) */
  function enter() {
    if (!묶음) bind();
    return 읽기();
  }

  WE.adminStats = {
    enter: enter,
    /* 검사용 이음매 — 서버 응답을 받은 것처럼 그린다(admin-members.js 의 _테스트_* 와 같은 목적) */
    _테스트_심기: function (d) { 자료 = d; 오류 = null; 읽는중 = false; 그리기(); },
    _테스트_오류: function (m) { 자료 = null; 오류 = m; 읽는중 = false; 그리기(); }
  };
})();

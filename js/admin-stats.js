/* 관리자 「접속자」 (2026-10-12) — 오늘 N명 + 막대그래프.

   왜 — 고원빈 10/12: 하루 접속자 추이를 보고 싶다(「Today 몇 명」 + 그래프), 중복 접속은 빼고.
   숫자의 뜻 — **기기당 하루 1명**(서울 날짜). 같은 기기가 하루에 열 번 열어도 1명이다.
     · 세는 쪽: js/auth.js 「접속자 세기」(그날 처음 열 때만 count_visit 한 번)
     · 서버:   _ai/sql/2026-10-12_접속자_집계.sql (날짜·숫자만 — 식별값 없음)
   읽기 — 이 화면에 들어올 때마다 visit_stats 한 번(관리자만 · jsonb 하나).
     Supabase 로그를 읽지 않는다 → 「로그 조회」 사용량 0 (_ai/함정.md — 로그 화면은 열 때마다 사용량이 든다).
   그리기 — 라이브러리 없이 SVG 를 직접 만든다. CSP 가 외부 스크립트를 막고(_headers), 막대 수백 개도 이걸로 충분하다.
   에디터 (2026-10-16) — 「그날 에디터(app.html)를 연 기기 수」 를 같이 보여 준다(고원빈 10/16 — 숫자 + 막대 겹치기 · 이름 「에디터」).
     왜: 접속자 40명 중 부품을 만든 기기는 3대였는데, 나머지가 랜딩에서 나갔는지 에디터까지 왔는지 몰랐다.
     · 전체 막대(연한 회색) 위에 같은 폭으로 에디터 막대(진한 회색 · 오늘은 주색)를 겹친다 — 에디터는 전체의 일부라서
     · editor_first_day 이전 날은 에디터 막대를 안 그린다(「0명」 과 「기록 없음」 을 가른다 — 전체 막대와 같은 원칙)
     · 서버가 에디터 키를 안 주면(2026-10-16 SQL 전) 에디터 숫자는 「–」, 막대는 전체만 — 옛 SQL 에서도 화면이 안 깨진다
   구간 · 평균 (2026-11-02) — 고원빈 11/02: 구간을 정해서 평균 방문자·에디터 사용자를 보고 싶다.
     · 빠른 버튼(7·30·90일) 또는 날짜 칸 둘. 최대 366일(visit_stats 가 받는 끝)
     · 서버는 「오늘까지 최근 n일」 만 준다 → 구간 시작부터 오늘까지 받아서 [시작, 끝] 만 잘라 그린다(SQL 은 안 바꿨다)
     · 평균 = 구간 안에서 **기록이 있는 날만** 더해 그 날수로 나눈다. **오늘도 넣는다**(고원빈 11/02 — 하루가 덜 끝났어도)
   회원 목록 (2026-11-02) — 고원빈 11/02: 오늘 에디터를 쓴 사람이 누구인지.
     · 로그인한 회원만 이메일로, 나머지는 숫자로(비회원은 누군지 알 수 없다)
     · 막대를 누르면 그날 목록 — 처음엔 오늘(구간에 오늘이 없으면 구간 끝 날)
     · 서버: _ai/sql/2026-11-02_에디터_회원.sql 의 editor_members(관리자만) · 세는 쪽: js/auth.js 「회원 에디터 기록」
   부품 사용 (2026-11-06) — 고원빈 11/06: 「하루 몇 명 방문하며 어떤 부품을 추가하고 사용하는지」.
     · [그날] 은 막대를 따라가고(처음은 오늘 — 회원 목록과 같은 날) [구간] 은 위 7·30·90일 범위의 합계. 놓음 많은 순
     · 운영 계정은 기본으로 뺀다 — 본인 작업이 순위를 덮지 않게(체크하면 들어간다)
     · 집계 시작 전 날의 「놓음」 은 0 이 아니라 「–」(「0명」 과 「기록 없음」 을 가른다 — 막대와 같은 원칙)
     · 서버: _ai/sql/2026-11-06_부품사용.sql 의 part_usage_report(관리자만) · 세는 쪽: js/libsync.js countPlace · library-sync v13
   검사: tests/verify_adminstats.mjs */
(function () {
  "use strict";
  var WE = window.WE = window.WE || {};
  var NS = "http://www.w3.org/2000/svg";
  var 최대날수 = 366;   // visit_stats 가 받는 끝(서버가 1~366 으로 자른다)
  // 그림 크기(viewBox 단위). CSS 가 너비 100% 로 늘리고 줄인다 — 글자도 같은 비율로 따라간다
  var W = 960, H = 260, 왼 = 44, 오른 = 8, 위 = 24, 아래 = 30;
  var 요일 = ["일", "월", "화", "수", "목", "금", "토"];

  var 자료 = null;     // 마지막으로 받은 visit_stats 결과 { today, first_day, editors_today, editor_first_day, days:[{day, visitors, editors}] }
  var 오류 = null;
  var 읽는중 = false;
  var 묶음 = false;    // 단추·날짜 칸에 손잡이를 걸었는가(한 번만)

  // 구간 — 빠른 버튼이 눌려 있으면 「오늘까지 그 날수」, 날짜 칸을 직접 고르면 그 두 날
  var 빠른 = 30;               // 7·30·90 · 날짜 칸을 고치면 null. 처음은 30(예전 화면과 같은 30일)
  var 시작 = null, 끝 = null;  // 날짜 칸으로 고른 "yyyy-mm-dd"(빠른 이 null 일 때만 쓴다)

  // 회원 목록
  var 고른날 = null;           // 막대를 눌러 고른 날. null 이면 기본(오늘 · 구간에 없으면 구간 끝)
  var 보는날 = null;           // 지금 그래프에서 표시된 날 — 그리기() 가 정한다
  var 회원날 = null;           // 회원 자료가 어느 날 것인가
  var 회원 = null, 회원오류 = null, 회원읽는중 = false;   // editor_members 결과 { start, members:[{email, at}] }

  // 부품 사용
  var 부품범위 = "day";        // "day" = 그날 · "range" = 구간 합계
  var 부품 = null, 부품오류 = null, 부품읽는중 = false;   // part_usage_report 결과 { start, total, rows:[{name, spec, is_public, added, placed, devices}] }
  var 부품구간 = null;         // 지금 자료가 어느 구간인가 { 시작, 끝 }
  var 부품요청 = 0;            // 늦게 온 답을 버리는 표 — 빠르게 날을 바꾸면 앞 요청의 답이 나중에 올 수 있다

  function $(id) { return document.getElementById(id); }
  function client() { return WE.auth && WE.auth._client ? WE.auth._client() : null; }

  /* 날짜 계산 — "yyyy-mm-dd" 를 UTC 자정으로 놓고 더한다(브라우저 시간대와 무관하게). 오늘은 서울 날짜(서버와 같은 기준) */
  function 서울오늘() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
  function 날ms(day) { var p = String(day).split("-"); return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function 날더하기(day, n) { return new Date(날ms(day) + n * 86400000).toISOString().slice(0, 10); }
  function 날차(a, b) { return Math.round((날ms(b) - 날ms(a)) / 86400000); }   // b − a (일)

  function 구간() {
    var 오늘 = 서울오늘();
    if (빠른) return { 시작: 날더하기(오늘, -(빠른 - 1)), 끝: 오늘 };
    return { 시작: 시작, 끝: 끝 };
  }

  function 읽기() {
    var c = client();
    if (!c || !c.rpc) { 오류 = "로그인이 필요합니다"; 자료 = null; 그리기(); return Promise.resolve(); }
    // 구간 시작부터 오늘까지 받는다 — 끝이 오늘 전이어도 서버는 「오늘까지」 만 줄 수 있다
    var n = Math.min(최대날수, Math.max(1, 날차(구간().시작, 서울오늘()) + 1));
    읽는중 = true; 오류 = null; 그리기();
    return c.rpc("visit_stats", { p_days: n }).then(function (res) {
      읽는중 = false;
      // ⚠ 조용히 빈 그래프를 보여 주지 않는다 — SQL 을 아직 안 돌렸을 때가 가장 흔한데,
      //    그때 「0명」 처럼 보이면 원인을 못 찾는다(admin-members.js 와 같은 원칙)
      if (res && res.error) { 오류 = res.error.message || "알 수 없는 오류"; 자료 = null; }
      else { 자료 = res ? res.data : null; }
      그리기();
      // 그래프를 그린 뒤 그날 회원 목록·부품 사용 — 「새로 읽기」 를 누르면 전부 다시 읽는다. 그래프를 못 읽었으면 목록도 비운다
      if (자료 && !오류) return Promise.all([회원읽기(), 부품읽기()]);
      회원날 = null; 회원 = null; 회원오류 = null; 회원그리기();
      부품비우기();
    }, function (e) {
      읽는중 = false; 오류 = (e && e.message) || String(e); 자료 = null; 그리기();
      회원날 = null; 회원 = null; 회원오류 = null; 회원그리기();
      부품비우기();
    });
  }

  /* 부품 사용을 읽는 구간 — [그날] 은 그래프에 표시된 날 하루, [구간] 은 위에서 고른 범위 */
  function 부품날짜() {
    if (부품범위 === "range") return 구간();
    return 보는날 ? { 시작: 보는날, 끝: 보는날 } : null;
  }
  function 부품비우기() {
    부품요청++; 부품 = null; 부품오류 = null; 부품읽는중 = false; 부품구간 = null;
    부품그리기();
  }
  /* 부품 사용을 읽는다(관리자만 — 서버가 다시 본다). 응답은 jsonb 하나라 부품이 많아도 요청 한 번이다 */
  function 부품읽기() {
    var c = client(), 날짜 = 부품날짜();
    if (!c || !c.rpc || !날짜) { 부품비우기(); return Promise.resolve(); }
    var 번호 = ++부품요청, 운영 = $("admStatsPartsOp");
    부품구간 = 날짜; 부품 = null; 부품오류 = null; 부품읽는중 = true; 부품그리기();
    return c.rpc("part_usage_report", { p_from: 날짜.시작, p_to: 날짜.끝, p_with_op: !!(운영 && 운영.checked) }).then(function (res) {
      if (번호 !== 부품요청) return;
      부품읽는중 = false;
      if (res && res.error) 부품오류 = res.error.message || "알 수 없는 오류";
      else if (!res || !res.data || !Array.isArray(res.data.rows)) 부품오류 = "응답 모양이 다릅니다";
      else 부품 = res.data;
      부품그리기();
    }, function (e) {
      if (번호 !== 부품요청) return;
      부품읽는중 = false; 부품오류 = (e && e.message) || String(e); 부품그리기();
    });
  }

  /* 그날 회원 목록을 읽는다(관리자만 — 서버가 다시 본다) */
  function 회원읽기() {
    var c = client(), 날 = 보는날;
    if (!c || !c.rpc || !날) return Promise.resolve();
    회원날 = 날; 회원 = null; 회원오류 = null; 회원읽는중 = true; 회원그리기();
    return c.rpc("editor_members", { p_day: 날 }).then(function (res) {
      if (날 !== 회원날) return;   // 그 사이 다른 날을 눌렀다 — 늦게 온 답은 버린다
      회원읽는중 = false;
      if (res && res.error) 회원오류 = res.error.message || "알 수 없는 오류";
      else if (!res || !res.data || !Array.isArray(res.data.members)) 회원오류 = "응답 모양이 다릅니다";
      else 회원 = res.data;
      회원그리기();
    }, function (e) {
      if (날 !== 회원날) return;
      회원읽는중 = false; 회원오류 = (e && e.message) || String(e); 회원그리기();
    });
  }

  /* "2026-10-12" → "10/12" · "10/12(월)". 요일은 그 날짜 자체로 계산한다(브라우저 시간대와 무관하게 UTC 로) */
  function 월일(day) { var p = String(day).split("-"); return Number(p[1]) + "/" + Number(p[2]); }
  function 짧은날(day) { return 월일(day) + "(" + 요일[new Date(날ms(day)).getUTCDay()] + ")"; }
  /* 눈금 최댓값 — 1·2·5 단위로 올린다(37명 → 50). 최소 5 — 처음 며칠 1~2명일 때 막대가 꽉 차 보이지 않게 */
  function 좋은최대(v) {
    if (v <= 5) return 5;
    var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var 후보 = [1, 2, 5, 10];
    for (var i = 0; i < 후보.length; i++) if (후보[i] * p >= v) return 후보[i] * p;
    return 10 * p;
  }

  /* 구간 평균 — 기록이 있는 날(기록시작 이후)만 더해 그 날수로 나눈다. 오늘도 넣는다(고원빈 11/02).
     기록 전 날을 0 으로 넣으면 평균이 거짓으로 내려간다(10/12 전, 에디터는 10/16 전).
     돌려줌: { 값, 날수 } · 기록이 있는 날이 하나도 없으면 null */
  function 평균(days, 기록시작, 키) {
    if (!기록시작) return null;
    var 합 = 0, 수 = 0;
    days.forEach(function (d) { if (d.day >= 기록시작) { 합 += Number(d[키]) || 0; 수++; } });
    return 수 ? { 값: 합 / 수, 날수: 수 } : null;
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
    var 전부 = (자료 && 자료.days) || [];
    var 서버오늘 = 전부.length ? 전부[전부.length - 1].day : null;   // 서버는 오늘을 마지막 칸으로 준다
    var g구간 = 구간();
    // "yyyy-mm-dd" 끼리는 글자 비교가 곧 날짜 비교
    var days = 전부.filter(function (d) { return d.day >= g구간.시작 && d.day <= g구간.끝; });
    var 처음 = (자료 && 자료.first_day) || null;   // 이 날 전은 「기록 없음」 — 0명과 구분해 막대를 안 그린다
    var 에디터시작 = (자료 && 자료.editor_first_day) || null;   // 에디터는 2026-10-16 부터 센다 — 그 전은 「에디터 기록 없음」
    var 에디터키있음 = !!자료 && 자료.editors_today !== undefined;   // 서버가 옛 SQL 이면 이 키가 없다

    if (알림) {
      알림.textContent = 오류 ? "읽지 못했습니다: " + 오류 + " — _ai/sql/2026-10-12_접속자_집계.sql · 2026-10-16_에디터_접속자.sql 을 실행했는지 확인하세요"
                     : 읽는중 ? "읽는 중…"
                     : 자료 && !처음 ? "아직 기록이 없습니다" : "";
      알림.classList.toggle("adm-stats-err", !!오류);
    }
    if (숫자) {
      숫자.textContent = 자료 && !오류 ? String(Number(자료.today) || 0) : "–";
      // 기준은 화면 글자로 늘어놓지 않고 말풍선에 둔다(UI 문구에 부연 설명을 붙이지 않는다)
      if (숫자.parentNode) 숫자.parentNode.title = "기기당 하루 1명 · 서울 시간" + (처음 ? " · " + 월일(처음) + " 부터" : "");
    }
    if (에디터숫자) {
      에디터숫자.textContent = 자료 && !오류 && 에디터키있음 ? String(Number(자료.editors_today) || 0) : "–";
      if (에디터숫자.parentNode) 에디터숫자.parentNode.title = "에디터를 연 기기 · 하루 1명" + (에디터시작 ? " · " + 월일(에디터시작) + " 부터" : "");
    }

    // 구간 평균 — 소수 한 자리. 기준(구간 · 기록 있는 날수)은 말풍선에
    var 평전 = 자료 && !오류 ? 평균(days, 처음, "visitors") : null;
    var 평에 = 자료 && !오류 && 에디터키있음 ? 평균(days, 에디터시작, "editors") : null;
    var 구간글 = 월일(g구간.시작) + "~" + 월일(g구간.끝) + (서버오늘 && g구간.끝 >= 서버오늘 ? " · 오늘 포함" : "");
    if ($("admStatsAvg")) {
      $("admStatsAvg").textContent = 평전 ? 평전.값.toFixed(1) : "–";
      $("admStatsAvg").parentNode.title = 구간글 + (평전 ? " · 기록 있는 " + 평전.날수 + "일" : "");
    }
    if ($("admStatsAvgEd")) {
      $("admStatsAvgEd").textContent = 평에 ? 평에.값.toFixed(1) : "–";
      $("admStatsAvgEd").parentNode.title = 구간글 + (평에 ? " · 에디터 기록 있는 " + 평에.날수 + "일" : "");
    }

    // 회원 목록을 볼 날 — 고른 날이 구간 안이면 그날, 아니면 오늘(구간 안일 때) · 그것도 아니면 구간 끝 날
    var 안에 = function (day) { return !!day && days.some(function (d) { return d.day === day; }); };
    보는날 = 안에(고른날) ? 고른날 : 안에(서버오늘) ? 서버오늘 : days.length ? days[days.length - 1].day : null;

    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("aria-label", 월일(g구간.시작) + "~" + 월일(g구간.끝) + " 접속자");
    if (!days.length) return;

    // 눈금은 두 숫자 중 큰 것으로 — 보통 에디터 ≤ 전체지만, 전체 세기 요청만 실패한 날엔 에디터가 클 수 있다(막대가 그림 밖으로 안 나가게)
    var 최대 = 0;
    days.forEach(function (d) {
      if (처음 && d.day >= 처음) 최대 = Math.max(최대, Number(d.visitors) || 0);
      if (에디터시작 && d.day >= 에디터시작) 최대 = Math.max(최대, Number(d.editors) || 0);
    });
    var 눈금 = 좋은최대(최대);
    var 칸 = (W - 왼 - 오른) / days.length, 막대폭 = Math.max(2, 칸 * 0.68);
    var 바닥 = H - 아래, 높이 = 바닥 - 위;
    // 날짜 글자 간격 — 30일이면 7일마다(5개). 1년치를 7일마다 쓰면 52개가 겹친다 → 길수록 넓힌다
    var 간격 = days.length <= 45 ? 7 : days.length <= 120 ? 14 : 30;

    // 눈금선 둘(0 과 최댓값)만 — 추이를 보는 데 그 이상은 어지럽다
    svg.appendChild(요소("line", { x1: 왼, y1: 위, x2: W - 오른, y2: 위, "class": "adm-stats-grid" }));
    svg.appendChild(요소("line", { x1: 왼, y1: 바닥, x2: W - 오른, y2: 바닥, "class": "adm-stats-axis" }));
    글(svg, 왼 - 8, 위 + 4, String(눈금), "end", "adm-stats-ylab");
    글(svg, 왼 - 8, 바닥 + 4, "0", "end", "adm-stats-ylab");

    days.forEach(function (d, i) {
      var x = 왼 + i * 칸;
      var n = Number(d.visitors) || 0;
      var 기록있음 = !!처음 && d.day >= 처음;
      var 에디터있음 = !!에디터시작 && d.day >= 에디터시작;
      var e = Number(d.editors) || 0;
      // 「오늘」 은 마지막 칸이 아니라 서버의 오늘 날짜다 — 끝이 오늘 전인 구간에는 오늘이 없다
      var 오늘인가 = d.day === 서버오늘;
      var g = 요소("g", { "class": "adm-stats-day" + (d.day === 보는날 ? " sel" : ""), "data-day": d.day });
      // 말풍선 — 「10/16(목) 40명 · 에디터 12명」. 전체 기록은 있는데 에디터를 세기 전인 날은 「에디터 기록 없음」
      var 말 = 요소("title");
      말.textContent = 짧은날(d.day) + " " + (기록있음 ? n + "명" : "기록 없음")
                     + (에디터있음 ? " · 에디터 " + e + "명" : 기록있음 && 에디터키있음 ? " · 에디터 기록 없음" : "");
      g.appendChild(말);
      // 마우스를 올릴 자리 — 칸 전체. 0명인 날도 말풍선이 떠야 하고, 눌러서 그날 회원 목록을 고른다
      g.appendChild(요소("rect", { x: x, y: 위, width: 칸, height: 높이, "class": "adm-stats-hit" }));
      g.addEventListener("click", function () { 날고르기(d.day); });
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
      // 날짜 글자는 구간 끝 날부터 간격마다만 — 다 쓰면 겹친다
      if ((days.length - 1 - i) % 간격 === 0) {
        글(g, x + 칸 / 2, 바닥 + 20, 오늘인가 ? "오늘" : 월일(d.day), "middle", "adm-stats-xlab" + (오늘인가 ? " today" : ""));
      }
      svg.appendChild(g);
    });
  }

  /* 그날 에디터 숫자(기기 수) — 에디터 기록이 있는 날만. 없으면 null */
  function 그날에디터(day) {
    if (!자료 || 자료.editors_today === undefined || !자료.editor_first_day || day < 자료.editor_first_day) return null;
    var d = ((자료.days) || []).filter(function (x) { return x.day === day; })[0];
    return d ? Number(d.editors) || 0 : null;
  }

  function 회원그리기() {
    var 머리 = $("admStatsWhoHead"), 목록 = $("admStatsWhoList");
    if (!머리 || !목록) return;
    while (목록.firstChild) 목록.removeChild(목록.firstChild);
    머리.classList.toggle("adm-stats-err", !!회원오류);
    머리.title = "";
    if (!회원날) { 머리.textContent = ""; return; }
    var 앞 = 짧은날(회원날) + " ";
    if (회원오류) {
      머리.textContent = 앞 + "회원 목록을 읽지 못했습니다: " + 회원오류 + " — _ai/sql/2026-11-02_에디터_회원.sql 을 실행했는지 확인하세요";
      return;
    }
    if (회원읽는중 || !회원) { 머리.textContent = 앞 + "읽는 중…"; return; }
    // 기록 시작(개인정보처리방침 시행일) 전 날은 「0명」 이 아니라 「기록 없음」
    if (!회원.start || 회원날 < 회원.start) {
      머리.textContent = 앞 + "회원 기록 없음";
      if (회원.start) 머리.title = 월일(회원.start) + " 부터 기록";
      return;
    }
    var 명단 = 회원.members, 수 = 명단.length, 에 = 그날에디터(회원날);
    // 「나머지」 = 에디터(기기 수) − 회원. ⚠ 어림이다 — 한 회원이 PC·노트북 두 대로 열면 에디터 2 · 회원 1 이라
    //    나머지가 1 로 나온다. 에디터 세기 요청만 실패한 날엔 회원이 더 많을 수 있어 0 아래로는 안 내린다
    머리.textContent = 앞 + (에 === null ? "회원 " + 수 + "명"
                                          : "에디터 " + 에 + "명 — 회원 " + 수 + "명 · 나머지 " + Math.max(0, 에 - 수) + "명");
    // 이메일은 textContent 로만 넣는다(회원이 정한 글자라 HTML 로 넣지 않는다)
    명단.forEach(function (m) {
      var li = document.createElement("li");
      var em = document.createElement("span"); em.className = "em"; em.textContent = m.email || "(이메일 없음)"; em.title = m.email || "";
      var at = document.createElement("span"); at.className = "at"; at.textContent = m.at || "";
      li.appendChild(em); li.appendChild(at);
      목록.appendChild(li);
    });
  }

  /* 부품 사용 표. 부품 이름·규격은 이용자가 정한 글자라 textContent 로만 넣는다(HTML 로 넣지 않는다) */
  function 부품그리기() {
    var 머리 = $("admStatsPartsHead"), 표 = $("admStatsPartsTable"), 몸 = $("admStatsPartsBody");
    if (!머리 || !표 || !몸) return;
    while (몸.firstChild) 몸.removeChild(몸.firstChild);
    머리.classList.toggle("adm-stats-err", !!부품오류);
    머리.title = "";
    표.hidden = true;
    if (!부품구간) { 머리.textContent = ""; return; }
    var 앞 = (부품구간.시작 === 부품구간.끝 ? 짧은날(부품구간.시작) : 월일(부품구간.시작) + "~" + 월일(부품구간.끝)) + " 부품 사용";
    if (부품오류) {
      머리.textContent = 앞 + " 읽지 못했습니다: " + 부품오류 + " — _ai/sql/2026-11-06_부품사용.sql 을 실행했는지 확인하세요";
      return;
    }
    if (부품읽는중 || !부품) { 머리.textContent = 앞 + " 읽는 중…"; return; }
    var 줄 = 부품.rows, 전체 = Number(부품.total) || 줄.length;
    // 구간이 집계 시작보다 앞에서 끝나면 그 구간엔 「놓음」 기록이 아예 없다 — 0 으로 적으면 안 쓴 것처럼 보인다
    var 놓음기록없음 = !부품.start || 부품구간.끝 < 부품.start;
    머리.textContent = 앞 + " " + 전체 + "개";
    if (부품.start) 머리.title = 월일(부품.start) + " 부터 기록";
    if (!줄.length) return;
    표.hidden = false;
    줄.forEach(function (r) {
      var tr = document.createElement("tr");
      [[r.name || "(이름 없음)", ""], [r.spec || "", ""], [r.is_public ? "공용" : "직접", "kind"],
       [String(Number(r.added) || 0), "n"], [놓음기록없음 ? "–" : String(Number(r.placed) || 0), "n"], [String(Number(r.devices) || 0), "n"]
      ].forEach(function (칸) {
        var td = document.createElement("td");
        td.textContent = 칸[0];
        if (칸[1]) td.className = 칸[1];
        tr.appendChild(td);
      });
      몸.appendChild(tr);
    });
  }

  function 날고르기(day) {
    고른날 = day;
    그리기();                       // 고른 칸 표시만 바꾼다(서버는 다시 안 묻는다)
    if (보는날 !== 회원날 || 회원오류) 회원읽기();
    // [구간] 을 보고 있으면 막대를 눌러도 합계는 그대로다 — [그날] 일 때만 다시 읽는다
    if (부품범위 === "day") 부품읽기();
  }

  /* 날짜 칸·빠른 버튼을 지금 구간에 맞춘다 — 들어올 때마다(날짜가 바뀌었을 수 있다) · 구간을 바꿀 때마다 */
  function 칸맞추기() {
    var g구간 = 구간(), 오늘 = 서울오늘(), 가장앞 = 날더하기(오늘, -(최대날수 - 1));
    ["admStatsFrom", "admStatsTo"].forEach(function (id) { var el = $(id); if (el) { el.min = 가장앞; el.max = 오늘; } });
    if ($("admStatsFrom")) $("admStatsFrom").value = g구간.시작;
    if ($("admStatsTo")) $("admStatsTo").value = g구간.끝;
    Array.prototype.forEach.call(document.querySelectorAll("#admStatsRange .adm-stats-quick"), function (b) {
      b.classList.toggle("on", Number(b.getAttribute("data-days")) === 빠른);
    });
  }

  /* 날짜 칸을 고쳤을 때 — 거꾸로 고르면 뒤집고, 오늘 뒤·1년 전 앞은 잘라 낸다 */
  function 칸바뀜() {
    var a = $("admStatsFrom").value, b = $("admStatsTo").value;
    if (!a || !b) return;                         // 지우는 중이면 다 고를 때까지 기다린다
    if (a > b) { var t = a; a = b; b = t; }
    var 오늘 = 서울오늘(), 가장앞 = 날더하기(오늘, -(최대날수 - 1));
    if (b > 오늘) b = 오늘;
    if (a < 가장앞) a = 가장앞;
    if (a > b) a = b;
    빠른 = null; 시작 = a; 끝 = b; 고른날 = null;
    칸맞추기();
    읽기();
  }

  function bind() {
    묶음 = true;
    var b = $("admStatsRefresh");
    if (b) b.addEventListener("click", function () { 읽기(); });
    Array.prototype.forEach.call(document.querySelectorAll("#admStatsRange .adm-stats-quick"), function (btn) {
      btn.addEventListener("click", function () {
        빠른 = Number(btn.getAttribute("data-days")) || 30; 고른날 = null;
        칸맞추기();
        읽기();
      });
    });
    ["admStatsFrom", "admStatsTo"].forEach(function (id) { var el = $(id); if (el) el.addEventListener("change", 칸바뀜); });
    // 부품 사용 — 그날·구간 전환과 운영 계정 체크. 숫자 그래프는 그대로 두고 표만 다시 읽는다
    Array.prototype.forEach.call(document.querySelectorAll("#admStatsPartsBar .adm-stats-quick"), function (btn) {
      btn.addEventListener("click", function () {
        부품범위 = btn.getAttribute("data-scope") === "range" ? "range" : "day";
        Array.prototype.forEach.call(document.querySelectorAll("#admStatsPartsBar .adm-stats-quick"), function (b) {
          b.classList.toggle("on", b === btn);
        });
        부품읽기();
      });
    });
    var 운영칸 = $("admStatsPartsOp");
    if (운영칸) 운영칸.addEventListener("change", function () { 부품읽기(); });
  }

  /* 「접속자」 버튼을 누를 때마다 부른다(admin-batch.js setMode) — 매번 새로 읽는다(요청: 그래프 1 + 회원 목록 1) */
  function enter() {
    if (!묶음) bind();
    칸맞추기();
    return 읽기();
  }

  WE.adminStats = {
    enter: enter,
    /* 검사용 이음매 — 서버 응답을 받은 것처럼 그린다(admin-members.js 의 _테스트_* 와 같은 목적) */
    _테스트_심기: function (d) { 자료 = d; 오류 = null; 읽는중 = false; 그리기(); },
    _테스트_오류: function (m) { 자료 = null; 오류 = m; 읽는중 = false; 그리기(); },
    _테스트_회원심기: function (day, d) { 회원날 = day; 회원 = d; 회원오류 = null; 회원읽는중 = false; 회원그리기(); },
    _테스트_부품심기: function (시작일, 끝일, d) { 부품요청++; 부품구간 = { 시작: 시작일, 끝: 끝일 }; 부품 = d; 부품오류 = null; 부품읽는중 = false; 부품그리기(); },
    _테스트_부품오류: function (시작일, 끝일, m) { 부품요청++; 부품구간 = { 시작: 시작일, 끝: 끝일 }; 부품 = null; 부품오류 = m; 부품읽는중 = false; 부품그리기(); }
  };
})();

/* ─────────────────────────────────────────────────────────────────────
 *  admin-folders — 「회원·결제」 오른쪽 칸의 **폴더 관리** (2026-09-28 · 2026-09-29 회원 화면으로 합침)
 *
 *  ★ 왜 만들었나
 *    학교·기관이 학생 수십 명을 일정 기간 Pro 로 쓰게 해 달라는 문의가 왔다(공주마이스터고, 약 80명).
 *    관리자가 **폴더**를 만들고 **조건을 건 참여 링크**를 발급해 선생님께 보낸다.
 *    학생이 링크(join.html?j=코드)에서 「참여하기」를 누르면 그 폴더로 들어가고 기간 한정 Pro 가 된다.
 *      · 폴더 = 회원 분류 (관리자 내부 이름 — 학생에게는 안 보인다)
 *      · 링크 = 조건 묶음 (참여 화면에 보이는 이름 · Pro 제공 방식 · 정원 · 참여 마감일 · 담당자)
 *
 *  ★ 2026-09-29 — 따로 있던 「폴더·링크」 화면을 없애고 「회원·결제」 안으로 합쳤다(고원빈 결정).
 *    왼쪽 계정란에서 폴더가 펼침·접힘으로 묶이고(js/admin-members.js), 폴더 머리줄을 누르면
 *    **이 파일이 오른쪽 칸(#admFolPanel)에 그 폴더의 관리 화면을 그린다.**
 *      · 폴더 목록·묶음·새 폴더 입력줄은 admin-members.js 가 맡는다(계정란의 일부라서)
 *      · 이 파일은 고른 폴더 하나의 이름·메모 · 구성원 기간 · 참여 링크만 맡는다
 *    바뀐 것이 있으면 WE.adminMembers.foldersChanged 로 알려 계정란(인원수·묶음)을 다시 읽게 한다.
 *
 *  ★ 2026-09-29 — 링크를 만들 때 **담당자 · 연락처 · 이메일**을 적는다(필수, 고원빈 결정).
 *    관리자만 본다. 학생이 부르는 참여 함수는 이 칸을 읽지 않는다(_ai/sql/2026-09-29_링크_담당자.sql).
 *
 *  ★ 무엇을 하지 않는가 — **판정은 전부 서버가 한다.** 정원·마감·기간 계산, 날짜 변환(한국 시각 그날 끝)은
 *    SQL 함수 안에 있다. 이 파일은 값을 모아 보내고 결과를 그릴 뿐이다.
 *    같은 판단을 화면에도 두면 **서버와 화면이 다른 말을 하는 날**이 온다(admin-members.js 머리말과 같은 원칙).
 *
 *  ★ 데이터 경로 (전부 서버 함수 첫 줄에 관리자 확인이 있다)
 *      폴더      rpc admin_folder_save · admin_folder_delete · admin_folder_set_grant
 *      링크      rpc admin_links · admin_link_create · admin_link_stop
 *
 *  ⚠ 관리자가 적은 글(폴더 이름·메모·링크 제목·담당자)은 전부 esc() 를 거친다.
 * ───────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  window.WE = window.WE || {};

  var 폴더 = null;          // 지금 오른쪽 칸에 그린 폴더 { id, name, memo, member_count, granted_count }
  var 링크들 = [];
  var 링크오류 = null;
  var 묶었나 = false;
  /* 화면을 가볍게 두려고 평소엔 접어 두는 것들 (2026-09-29 오후 정리 — 원빈 "보기 편하게")
     새링크열림: [+ 새 링크] 를 눌러야 양식이 펼쳐진다 · 이름수정중: [이름·메모 수정] 을 눌러야 입력칸 ·
     수정중링크: [수정] 을 누른 링크의 id — 그 링크 카드 안에 수정 양식이 펼쳐진다 */
  var 새링크열림 = false;
  var 이름수정중 = false;
  var 수정중링크 = null;

  function $(id) { return document.getElementById(id); }
  function client() { return WE.auth && WE.auth._client ? WE.auth._client() : null; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  /* 알림은 관리자 페이지 공통 자리(#admMsg) — admin.js · admin-members.js 와 같은 규칙 */
  function msg(text, kind) {
    var el = $("admMsg"); if (!el) return;
    el.textContent = text || "";
    el.className = kind === "err" ? "error" : "muted";
  }
  /* 시각은 한국 시각으로 (admin-members.js 날짜 와 같다) */
  function 날짜(v) {
    if (!v) return "—";
    var d = new Date(v); if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\.$/, "");
  }
  function 코드표시(c) { c = String(c || ""); return c.length === 8 ? c.slice(0, 4) + "-" + c.slice(4) : c; }
  /* <input type="date"> 에 넣을 값 — 한국 시각의 날짜(YYYY-MM-DD). admin-members.js 날짜칸 과 같은 규칙.
     ⚠ toISOString 으로 자르면 한국 시각 00~09시에 끝나는 기간이 하루 앞 날짜로 채워진다 */
  function 날짜칸(v) {
    if (!v) return "";
    var d = new Date(v); if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  }

  /* 학생에게 보낼 주소.
     ⚠ 미리보기 주소에서 복사하면 본 서비스 주소로 바꾼다 — 미리보기 링크가 선생님께 가면
        학생들이 미리보기 사이트에서 수업을 하게 된다(DB 는 같아서 동작은 하지만 그러면 안 된다).
        판별은 flags.js 의 것을 그대로 쓴다(유료화 스위치와 같은 기준). */
  function 링크주소(code) {
    var 기준 = location.origin;
    try {
      if (WE.flags && WE.flags._isPreviewHost && WE.flags._isPreviewHost(location.hostname)) 기준 = "https://easycable.co.kr";
    } catch (e) { /* 무시 */ }
    return 기준 + "/join.html?j=" + code;
  }

  /* 링크가 지금 참여를 받는가 — **보여 주기용**이다. 실제로 막는 것은 서버(_ezc_link_open)다. */
  function 링크상태(l) {
    var 지금 = Date.now();
    if (l.stopped_at) return { 글: "멈춤", 열림: false };
    if (l.join_deadline && new Date(l.join_deadline).getTime() <= 지금) return { 글: "마감", 열림: false };
    if (l.pro_mode === "until" && l.pro_until && new Date(l.pro_until).getTime() <= 지금) return { 글: "기간 끝", 열림: false };
    if ((l.used || 0) >= l.seats) return { 글: "정원 참", 열림: false };
    return { 글: "받는 중", 열림: true };
  }
  /* 링크의 제공 조건 — **앞으로 참여할 사람**에게 주는 것. 「참여하면 ~」 으로 적어
     이미 참여한 사람의 기간(아래 「이미 참여한 사람」 칸)과 헷갈리지 않게 한다(9/29 원빈 "왜 날짜가 둘이냐") */
  function 제공글(l) {
    if (l.pro_mode === "until") return "참여하면 " + 날짜(l.pro_until) + " 까지 Pro";
    if (l.pro_mode === "days") return "참여일부터 " + l.pro_days + "일 Pro";
    return "Pro 안 줌(분류만)";
  }
  /* 담당자 한 줄. 9/29 담당자 칸이 생기기 전에 만든 링크는 비어 있다 */
  function 담당글(l) {
    if (!l.contact_name && !l.contact_phone && !l.contact_email) return "담당자 미기입";
    return "담당 " + [l.contact_name, l.contact_phone, l.contact_email].filter(function (v) { return !!v; }).join(" · ");
  }
  /* 이메일 모양 — @ 앞에 한 글자 이상, @ 뒤에 점이 있는가. 서버(admin_link_create)와 같은 규칙 */
  function 메일모양(v) {
    var at = v.indexOf("@");
    if (at < 1) return false;
    var 뒤 = v.slice(at + 1);
    return 뒤.indexOf(".") >= 1 && 뒤.indexOf("@") < 0;
  }

  // ── 보이기 · 숨기기 (admin-members.js 가 부른다) ─────────────────────────
  /* 폴더 머리줄을 누르면 부른다. f 는 admin_folders 의 한 줄. */
  function show(f) {
    bind();
    var 같은폴더 = 폴더 && f && 폴더.id === f.id;
    폴더 = f || null;
    // 다른 폴더로 가면 펼쳐 둔 양식은 닫는다(앞 폴더에 적던 것이 다음 폴더에 남으면 엉뚱한 곳에 링크가 생긴다)
    if (!같은폴더) { 링크들 = []; 링크오류 = null; 새링크열림 = false; 이름수정중 = false; 수정중링크 = null; }
    그리기();
    if (폴더) 링크읽기();
  }
  function hide() {
    폴더 = null; 링크들 = []; 링크오류 = null;
    var b = $("admFolPanel"); if (b) b.innerHTML = "";
  }
  function current() { return 폴더 ? 폴더.id : null; }

  /* 계정란에 알린다 — 인원수·폴더 이름이 바뀌었으니 다시 읽으라고.
     select: 그 뒤 오른쪽 칸에 둘 폴더(null 이면 닫는다) · reload: 다시 읽을 묶음 */
  function 알리기(opts) {
    if (WE.adminMembers && WE.adminMembers.foldersChanged) WE.adminMembers.foldersChanged(opts || {});
  }

  // ── 읽기 ──────────────────────────────────────────────────────────────────
  function 링크읽기() {
    var c = client(); var id = 폴더 && 폴더.id;
    if (!c || !id) return Promise.resolve();
    return c.rpc("admin_links", { p_folder: id }).then(function (res) {
      if (!폴더 || id !== 폴더.id) return;                // 그 사이 다른 폴더를 골랐으면 버린다
      if (res.error) { 링크오류 = res.error.message || "알 수 없는 오류"; 그리기(); return; }
      링크들 = res.data || []; 링크오류 = null;
      그리기();
    }).catch(function (e) {
      if (!폴더 || id !== 폴더.id) return;
      링크오류 = (e && e.message) || "서버에 닿지 못했습니다."; 그리기();
    });
  }

  // ── 그리기 ────────────────────────────────────────────────────────────────
  /* 폴더 관리 칸 (2026-09-29 오후 정리 — 원빈 "보기 편하게", "날짜가 왜 둘이냐")
       ① 폴더 이름·메모 — 평소엔 글자, [이름·메모 수정] 을 누르면 입력칸
       ② 참여 링크 — 맨 위. 링크 줄의 조건은 「참여하면 ~까지」(= **앞으로 들어올 사람**). [+ 새 링크] 로 양식을 편다
       ③ 이미 참여한 사람 — 인원과 「기간 한꺼번에 바꾸기」(= **이미 들어온 사람**, 학기 연장 때)
       ④ 폴더 삭제 — 맨 아래 작은 글씨(드물고 되돌릴 수 없어 눈에 덜 띄게) */
  function 그리기() {
    var box = $("admFolPanel"); if (!box) return;
    var f = 폴더;
    if (!f) { box.innerHTML = ""; return; }

    var h = "";
    // ── ① 폴더 이름·메모 ──
    if (이름수정중) {
      h += '<div class="adm-fol-grid">' +
        '<span>이름</span><input type="text" id="admFolName" maxlength="60" value="' + esc(f.name) + '" />' +
        '<span>메모</span><input type="text" id="admFolMemo" maxlength="500" placeholder="관리자만 봄" value="' + esc(f.memo || "") + '" />' +
        '<span></span><div class="adm-fol-acts">' +
        '<button type="button" class="adm-edit-btn" id="admFolSave">저장</button>' +
        '<button type="button" class="adm-edit-btn" id="admFolEditCancel">취소</button></div>' +
        "</div>";
    } else {
      h += '<div class="adm-fol-top"><span class="adm-col-meta">' + (f.memo ? esc(f.memo) : "메모 없음") + "</span>" +
        '<button type="button" class="adm-edit-btn" id="admFolEdit">이름·메모 수정</button></div>';
    }

    // ── ② 참여 링크 ──
    h += '<div class="adm-fol-sec"><h4>참여 링크</h4>' +
      '<button type="button" class="adm-edit-btn" id="admLinkNewToggle">' + (새링크열림 ? "새 링크 닫기" : "+ 새 링크") + "</button></div>";
    if (새링크열림) h += 새링크양식(f);
    if (링크오류) {
      h += '<div class="adm-batch-empty">링크를 읽지 못했습니다.<br />' + esc(링크오류) + "</div>";
    } else if (!링크들.length) {
      h += '<div class="adm-col-meta">아직 링크가 없습니다. [+ 새 링크] 로 만드세요.</div>';
    } else {
      링크들.forEach(function (l) { h += 링크카드(l); });
    }

    // ── ③ 이미 참여한 사람 ── (명단은 왼쪽 계정란의 이 폴더 묶음에 있다)
    h += '<div class="adm-fol-sec"><h4>이미 참여한 사람</h4></div>' +
      '<div class="adm-fol-who"><b>' + (f.member_count || 0) + "명</b>" +
      '<span class="adm-col-meta" style="display:inline"> · 기관 제공 중 ' + (f.granted_count || 0) + "명 · 명단은 왼쪽 묶음</span></div>" +
      '<div class="adm-fol-acts adm-fol-bulk"><span class="adm-col-meta" style="display:inline">기간 한꺼번에 바꾸기 (학기 연장 때)</span>' +
      '<input type="date" id="admFolGrantDate" />' +
      '<button type="button" class="adm-edit-btn" id="admFolGrantSet">적용</button>' +
      '<button type="button" class="adm-edit-btn" id="admFolGrantEnd">제공 끝내기</button></div>';

    // ── ④ 폴더 삭제 ──
    h += '<div class="adm-fol-end"><button type="button" class="adm-fol-textbtn" id="admFolDelete" title="구성원이 없을 때만 지울 수 있습니다">폴더 삭제</button></div>';

    box.innerHTML = h;
  }

  /* 링크 한 장 — 제목·상태 / 코드·인원·조건·마감 / 담당자 / 단추. [수정] 을 눌렀으면 그 안에 수정 양식 */
  function 링크카드(l) {
    var 상태 = 링크상태(l);
    var h = '<div class="adm-fol-link' + (상태.열림 ? "" : " off") + '" data-lid="' + esc(l.id) + '">' +
      '<div class="adm-fol-link-row">' +
        '<div class="adm-fol-link-main">' +
          '<span class="adm-fol-link-title"><b>' + esc(l.title) + "</b>" +
          '<span class="adm-fol-dot' + (상태.열림 ? " on" : "") + '">● ' + esc(상태.글) + "</span></span>" +
          '<span class="adm-col-meta"><code>' + esc(코드표시(l.code)) + "</code> · " +
          (l.used || 0) + "/" + l.seats + "명 · " + esc(제공글(l)) +
          " · " + (l.join_deadline ? esc(날짜(l.join_deadline)) + " 마감" : "마감 없음") + "</span>" +
          '<span class="adm-col-meta adm-fol-contact">' + esc(담당글(l)) + "</span>" +
        "</div>" +
        '<div class="adm-fol-link-acts">' +
          '<button type="button" class="adm-edit-btn" data-act="copy" data-code="' + esc(l.code) + '">주소 복사</button>' +
          '<button type="button" class="adm-edit-btn" data-act="edit" data-lid="' + esc(l.id) + '">' + (수정중링크 === l.id ? "수정 닫기" : "수정") + "</button>" +
          '<button type="button" class="adm-edit-btn" data-act="stop" data-lid="' + esc(l.id) + '" data-stop="' + (l.stopped_at ? "0" : "1") + '">' +
          (l.stopped_at ? "재개" : "멈춤") + "</button>" +
        "</div>" +
      "</div>";
    if (수정중링크 === l.id) h += 링크수정양식(l);
    return h + "</div>";
  }

  /* 「Pro 이용 기간」 고르기 — 새 링크 양식과 (참여 0명일 때의) 수정 양식이 같이 쓴다.
     ⚠ 9/29 원빈이 「Pro 제공 없이 소속만」 링크를 모르고 만들었다 — 「참여하면 주는 Pro」 라는 말이 기간으로 안 읽혔고
        「없음 (분류만)」 이 무엇을 뜻하는지 안 보였다. 그래서 말을 「Pro 이용 기간」 으로 바꾸고 맨 위에 두며,
        「Pro 안 줌」 을 고르면 바로 아래에 경고를 띄운다.
     접두 — 새 양식은 "admLink", 수정 양식은 "admLinkEd" (id 가 겹치지 않게) */
  function 기간고르기(접두, 방식, 까지, 일수) {
    var 골 = function (v) { return 방식 === v ? " checked" : ""; };
    return '<span class="adm-fol-key">Pro 이용 기간</span><div class="adm-fol-mode">' +
      '<label><input type="radio" name="' + 접두 + 'Mode" value="until"' + 골("until") + ' /> 날짜까지 <input type="date" id="' + 접두 + 'Until" value="' + esc(까지 || "") + '" /></label>' +
      '<label><input type="radio" name="' + 접두 + 'Mode" value="days"' + 골("days") + ' /> 참여일부터 <input type="number" id="' + 접두 + 'Days" min="1" max="3650" value="' + esc(일수 || 30) + '" /> 일</label>' +
      '<label><input type="radio" name="' + 접두 + 'Mode" value="none"' + 골("none") + ' /> Pro 안 줌 (폴더에 분류만)</label>' +
      '<div class="adm-fol-warn" id="' + 접두 + 'NoneWarn"' + (방식 === "none" ? "" : " hidden") + '>⚠ 이 링크로 들어온 사람은 Pro 를 받지 않습니다 — 폴더에 이름만 올라갑니다</div>' +
      "</div>";
  }

  /* 링크 수정 양식
     · 아직 **0명**이면 「Pro 이용 기간」 도 고를 수 있다(섞일 사람이 없다 — 9/29 원빈 결정)
     · 1명이라도 참여했으면 방식은 못 바꾼다(이미 들어온 사람과 앞으로 들어올 사람의 조건이 섞인다) — 날짜·일수만 */
  function 링크수정양식(l) {
    var 사람 = l.used || 0;
    var h = '<div class="adm-fol-box adm-fol-edit"><div class="adm-fol-grid">';
    if (사람 === 0) {
      h += 기간고르기("admLinkEd", l.pro_mode, 날짜칸(l.pro_until), l.pro_days);
    } else if (l.pro_mode === "until") {
      h += '<span class="adm-fol-key">Pro 이용 기간</span><div class="adm-fol-mode">' +
        '<span>날짜까지 <input type="date" id="admLinkEdUntil" value="' + esc(날짜칸(l.pro_until)) + '" /></span>' +
        '<label><input type="checkbox" id="admLinkEdApply" checked /> 날짜를 바꾸면 이 링크로 이미 참여한 ' + 사람 + "명도 같이 바꾸기</label></div>";
    } else if (l.pro_mode === "days") {
      h += '<span class="adm-fol-key">Pro 이용 기간</span><div class="adm-fol-acts">참여일부터 <input type="number" id="admLinkEdDays" min="1" max="3650" value="' + esc(l.pro_days) + '" /> 일' +
        '<span class="adm-col-meta" style="display:inline">앞으로 참여할 사람부터</span></div>';
    } else {
      h += '<span class="adm-fol-key">Pro 이용 기간</span><div class="adm-fol-acts">Pro 안 줌 (폴더에 분류만)</div>';
    }
    if (사람 > 0) {
      h += '<span></span><div class="adm-col-meta">이미 ' + 사람 + "명이 참여해 이용 기간의 방식(날짜까지·일수·안 줌)은 바꿀 수 없습니다 — 바꾸려면 새 링크</div>";
    }
    h += '<span>참여 화면에 보이는 이름</span><input type="text" id="admLinkEdTitle" maxlength="60" value="' + esc(l.title) + '" />' +
      '<span>정원</span><div class="adm-fol-acts"><input type="number" id="admLinkEdSeats" min="1" max="1000" value="' + esc(l.seats) + '" /> 명' +
      '<span class="adm-col-meta" style="display:inline">이미 ' + 사람 + "명 참여 — 그보다 적게는 안 됩니다</span></div>" +
      '<span>참여 마감일</span><div class="adm-fol-acts"><input type="date" id="admLinkEdDeadline" value="' + esc(날짜칸(l.join_deadline)) + '" />' +
      '<span class="adm-col-meta" style="display:inline">참여를 받는 마지막 날 — Pro 이용 기간과 별개 · 비우면 계속 받습니다</span></div>';
    h += '<span>담당자</span><input type="text" id="admLinkEdContactName" maxlength="40" value="' + esc(l.contact_name || "") + '" />' +
      '<span>연락처</span><input type="text" id="admLinkEdContactPhone" maxlength="30" value="' + esc(l.contact_phone || "") + '" />' +
      '<span>이메일</span><input type="text" id="admLinkEdContactEmail" maxlength="120" value="' + esc(l.contact_email || "") + '" />' +
      '<span></span><div class="adm-fol-acts">' +
      '<button type="button" class="adm-edit-btn" id="admLinkEdSave">저장</button>' +
      '<button type="button" class="adm-edit-btn" data-act="edit" data-lid="' + esc(l.id) + '">취소</button></div>' +
      "</div></div>";
    return h;
  }

  /* 새 링크 양식 — [+ 새 링크] 를 눌러야 펼쳐진다. 「Pro 이용 기간」 이 맨 위(9/29 저녁) */
  function 새링크양식(f) {
    return '<div class="adm-fol-box"><div class="adm-fol-grid">' +
      기간고르기("admLink", "until", "", 30) +
      '<span>참여 화면에 보이는 이름</span><input type="text" id="admLinkTitle" maxlength="60" value="' + esc(f.name) + '" />' +
      '<span>정원</span><div class="adm-fol-acts"><input type="number" id="admLinkSeats" min="1" max="1000" value="40" /> 명</div>' +
      '<span>참여 마감일</span><div class="adm-fol-acts"><input type="date" id="admLinkDeadline" /><span class="adm-col-meta" style="display:inline">참여를 받는 마지막 날 — Pro 이용 기간과 별개 · 비우면 계속 받습니다</span></div>' +
      // 담당자 — 링크를 받은 사람(선생님). 기간 연장·문제 때 연락하려고 적는다. 관리자만 본다
      '<span>담당자</span><input type="text" id="admLinkContactName" maxlength="40" placeholder="예: 박래익 선생님" />' +
      '<span>연락처</span><input type="text" id="admLinkContactPhone" maxlength="30" placeholder="예: 010-0000-0000" />' +
      '<span>이메일</span><input type="text" id="admLinkContactEmail" maxlength="120" placeholder="예: teacher@school.kr" />' +
      '<span></span><div class="adm-fol-acts"><button type="button" class="adm-edit-btn" id="admLinkCreate">링크 만들기</button></div>' +
      "</div></div>";
  }

  // ── 동작 ──────────────────────────────────────────────────────────────────
  /* 서버 함수 부르기 공통 — 실패하면 서버가 보낸 이유(예: 「같은 이름의 폴더가 이미 있습니다」)를 그대로 보인다 */
  function 부르기(이름, 인자, 성공글) {
    var c = client();
    if (!c) { msg("로그인 정보를 읽지 못했습니다.", "err"); return Promise.resolve(null); }
    return c.rpc(이름, 인자 || {}).then(function (res) {
      if (res.error) { msg((res.error.message || "알 수 없는 오류"), "err"); return null; }
      if (성공글) msg(typeof 성공글 === "function" ? 성공글(res.data) : 성공글);
      return res;
    }).catch(function (e) { msg((e && e.message) || "서버에 닿지 못했습니다.", "err"); return null; });
  }

  /* 새 폴더 — 계정란 맨 아래 입력줄(admin-members.js)이 부른다. 만든 폴더의 id 를 돌려준다 */
  function create(이름) {
    이름 = String(이름 || "").trim();
    if (!이름) { msg("폴더 이름을 적어 주세요.", "err"); return Promise.resolve(null); }
    return 부르기("admin_folder_save", { p_id: null, p_name: 이름, p_memo: null }, "폴더를 만들었습니다 — " + 이름)
      .then(function (res) { return res ? (res.data || null) : null; });
  }

  function 폴더저장() {
    var f = 폴더; if (!f) return;
    var 이름 = ($("admFolName").value || "").trim();
    if (!이름) { msg("폴더 이름을 비울 수 없습니다.", "err"); return; }
    부르기("admin_folder_save", { p_id: f.id, p_name: 이름, p_memo: $("admFolMemo").value || null }, "저장했습니다 — " + 이름)
      .then(function (res) { if (res) { 이름수정중 = false; 알리기({ select: f.id }); } });
  }

  function 폴더삭제() {
    var f = 폴더; if (!f) return;
    if (!window.confirm("폴더 「" + f.name + "」 을(를) 지웁니다.\n이 폴더의 참여 링크도 함께 지워집니다.\n\n(구성원이 있으면 서버가 막습니다 — 먼저 옮기거나 빼세요)")) return;
    부르기("admin_folder_delete", { p_id: f.id }, "폴더를 지웠습니다 — " + f.name).then(function (res) {
      if (!res) return;
      hide();
      알리기({ select: null, removed: f.id });
    });
  }

  /* 구성원 전체의 제공 종료일 — p_until 이 null 이면 제공을 끝낸다.
     ⚠ 수업 중인 학생들이 한꺼번에 무료로 떨어질 수 있는 동작이라 인원·날짜를 보여 주고 확인받는다 */
  function 전체기간(끝내기) {
    var f = 폴더; if (!f) return;
    var 날 = 끝내기 ? null : ($("admFolGrantDate").value || null);
    if (!끝내기 && !날) { msg("바꿀 날짜를 고르세요.", "err"); return; }
    var 글 = 끝내기
      ? "폴더 「" + f.name + "」 구성원 " + (f.member_count || 0) + "명 전체의 기관 제공 Pro 를 지금 끝냅니다."
      : "폴더 「" + f.name + "」 구성원 " + (f.member_count || 0) + "명 전체의 기관 제공 종료일을 " + 날 + " (한국 시각 그날 끝)로 바꿉니다.\n줄어드는 사람도 있을 수 있습니다.";
    if (!window.confirm(글 + "\n\n계속할까요?")) return;
    부르기("admin_folder_set_grant", { p_folder: f.id, p_until: 날 }, function (n) {
      return (끝내기 ? "제공을 끝냈습니다 — " : "기간을 바꿨습니다 — ") + (n || 0) + "명";
    }).then(function (res) { if (res) 알리기({ select: f.id, reload: f.id }); });   // 명단의 「제공 ~날짜」 도 바뀐다
  }

  function 링크만들기() {
    var f = 폴더; if (!f) return;
    var 방식 = (document.querySelector('input[name="admLinkMode"]:checked') || {}).value || "until";
    var 제목 = ($("admLinkTitle").value || "").trim();
    var 까지 = $("admLinkUntil").value || null;           // "YYYY-MM-DD" — 한국 시각 그날 끝으로 바꾸는 것은 서버가 한다
    var 일수 = parseInt($("admLinkDays").value, 10);
    var 정원 = parseInt($("admLinkSeats").value, 10);
    var 마감 = $("admLinkDeadline").value || null;
    var 담당 = ($("admLinkContactName").value || "").trim();
    var 전화 = ($("admLinkContactPhone").value || "").trim();
    var 메일 = ($("admLinkContactEmail").value || "").trim();
    // 서버도 같은 것을 막는다. 여기서 먼저 보는 것은 왕복 없이 바로 알려 주기 위해서다.
    if (!제목) { msg("참여 화면에 보이는 이름을 적어 주세요.", "err"); return; }
    if (방식 === "until" && !까지) { msg("Pro 를 언제까지 줄지 날짜를 고르세요.", "err"); return; }
    if (방식 === "days" && !(일수 >= 1 && 일수 <= 3650)) { msg("제공 일수는 1~3650 사이여야 합니다.", "err"); return; }
    if (!(정원 >= 1 && 정원 <= 1000)) { msg("정원은 1~1000 사이여야 합니다.", "err"); return; }
    if (!담당 || !전화 || !메일) { msg("담당자 · 연락처 · 이메일을 모두 적어 주세요.", "err"); return; }
    if (!메일모양(메일)) { msg("담당자 이메일 형식이 올바르지 않습니다.", "err"); return; }
    var btn = $("admLinkCreate"); if (btn) btn.disabled = true;
    부르기("admin_link_create", {
      p_folder: f.id, p_title: 제목, p_mode: 방식,
      p_until: 방식 === "until" ? 까지 : null,
      p_days: 방식 === "days" ? 일수 : null,
      p_seats: 정원, p_deadline: 마감,
      p_contact_name: 담당, p_contact_phone: 전화, p_contact_email: 메일
    }, function (code) { return "링크를 만들었습니다 — " + 코드표시(code) + "  [주소 복사]로 선생님께 보내세요."; })
      .then(function (res) {
        if ($("admLinkCreate")) $("admLinkCreate").disabled = false;
        if (res) { 새링크열림 = false; 링크읽기(); }            // 만들었으면 양식을 접는다 — 목록에 새 링크가 보인다
      });
  }

  /* 링크 수정 저장 (2026-09-29 — 원빈 "참여 마감일을 1주 연장하고 싶다")
     ⚠ 서버(admin_link_update)도 같은 것을 막는다. 여기서 먼저 보는 것은 왕복 없이 바로 알려 주려고.
     ⚠ 「이미 참여한 사람도 같이 바꾸기」 는 수업 중인 학생들의 기간이 바뀌는 일이라 인원·날짜를 보여 주고 확인받는다. */
  function 링크수정저장() {
    var l = null;
    for (var i = 0; i < 링크들.length; i++) if (링크들[i].id === 수정중링크) l = 링크들[i];
    if (!l) return;
    var 제목 = ($("admLinkEdTitle").value || "").trim();
    var 정원 = parseInt($("admLinkEdSeats").value, 10);
    var 마감 = $("admLinkEdDeadline").value || null;            // "YYYY-MM-DD" · 비우면 마감 없음
    var 까지 = $("admLinkEdUntil") ? ($("admLinkEdUntil").value || null) : null;
    var 일수 = $("admLinkEdDays") ? parseInt($("admLinkEdDays").value, 10) : null;
    // 방식 — 참여 0명이면 양식에 고르기가 있다(그 값), 아니면 지금 방식 그대로
    var 고른 = document.querySelector('input[name="admLinkEdMode"]:checked');
    var 방식 = 고른 ? 고른.value : l.pro_mode;
    // 「같이 바꾸기」 는 날짜를 **실제로 바꿨을 때만** 뜻이 있다 — 안 바꿨으면 보내지 않는다
    //  (서버도 같은 규칙이다. 안 바꾼 날짜로 덮으면 관리자가 따로 늘려 준 사람의 기간이 줄 수 있다)
    var 날짜바뀜 = 방식 === "until" && l.pro_mode === "until" && 까지 !== 날짜칸(l.pro_until);
    var 같이 = 날짜바뀜 && !!($("admLinkEdApply") && $("admLinkEdApply").checked);
    var 담당 = ($("admLinkEdContactName").value || "").trim();
    var 전화 = ($("admLinkEdContactPhone").value || "").trim();
    var 메일 = ($("admLinkEdContactEmail").value || "").trim();
    if (!제목) { msg("참여 화면에 보이는 이름을 적어 주세요.", "err"); return; }
    if (!(정원 >= 1 && 정원 <= 1000)) { msg("정원은 1~1000 사이여야 합니다.", "err"); return; }
    if (정원 < (l.used || 0)) { msg("정원은 이미 참여한 " + l.used + "명보다 적을 수 없습니다.", "err"); return; }
    if (방식 !== l.pro_mode && (l.used || 0) > 0) { msg("이미 참여한 사람이 있어 이용 기간의 방식은 바꿀 수 없습니다 — 새 링크를 만드세요.", "err"); return; }
    if (방식 === "until" && !까지) { msg("Pro 를 언제까지 줄지 날짜를 고르세요.", "err"); return; }
    if (방식 === "days" && !(일수 >= 1 && 일수 <= 3650)) { msg("제공 일수는 1~3650 사이여야 합니다.", "err"); return; }
    if (!담당 || !전화 || !메일) { msg("담당자 · 연락처 · 이메일을 모두 적어 주세요.", "err"); return; }
    if (!메일모양(메일)) { msg("담당자 이메일 형식이 올바르지 않습니다.", "err"); return; }
    if (같이 && (l.used || 0) > 0 &&
        !window.confirm("이 링크로 이미 참여한 " + l.used + "명의 제공 종료일을 " + 까지 + " (한국 시각 그날 끝)로 바꿉니다.\n줄어드는 경우도 그대로 적용됩니다.\n\n계속할까요?")) return;
    var btn = $("admLinkEdSave"); if (btn) btn.disabled = true;
    부르기("admin_link_update", {
      p_id: l.id, p_title: 제목, p_seats: 정원, p_deadline: 마감,
      p_mode: 방식,
      p_pro_until: 방식 === "until" ? 까지 : null,
      p_pro_days: 방식 === "days" ? 일수 : null,
      p_apply_joined: 같이,
      p_contact_name: 담당, p_contact_phone: 전화, p_contact_email: 메일
    }, function (r) {
      var n = r && r.applied ? r.applied : 0;
      return "링크를 고쳤습니다 — " + 제목 + (n ? " · 이미 참여한 " + n + "명의 기간도 바꿨습니다" : "");
    }).then(function (res) {
      if ($("admLinkEdSave")) $("admLinkEdSave").disabled = false;
      if (!res) return;
      수정중링크 = null;
      링크읽기();
      // 이미 참여한 사람의 기간을 바꿨으면 왼쪽 명단의 「제공 ~날짜」 와 머리줄 인원도 새로 읽는다
      if (res.data && res.data.applied) 알리기({ select: 폴더 && 폴더.id, reload: 폴더 && 폴더.id });
    });
  }

  function 주소복사(code) {
    var 주소 = 링크주소(code);
    function 손으로() { window.prompt("아래 주소를 복사해 선생님께 보내세요.", 주소); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(주소).then(function () { msg("주소를 복사했습니다 — " + 주소); }, 손으로);
        return;
      }
    } catch (e) { /* 아래로 */ }
    손으로();
  }

  function 멈춤(lid, 멈추기) {
    if (멈추기 && !window.confirm("이 링크로 새로 참여하는 것을 막습니다.\n이미 참여한 사람은 그대로입니다.\n\n계속할까요?")) return;
    부르기("admin_link_stop", { p_id: lid, p_stop: 멈추기 }, 멈추기 ? "링크를 멈췄습니다." : "링크를 다시 열었습니다.")
      .then(function (res) { if (res) 링크읽기(); });
  }

  // ── 이벤트 ────────────────────────────────────────────────────────────────
  /* 칸 안의 단추는 그릴 때마다 새로 생기므로 상위(#admFolPanel)에 한 번만 위임한다 */
  function bind() {
    if (묶었나) return;
    var d = $("admFolPanel"); if (!d) return;
    묶었나 = true;
    d.addEventListener("click", function (e) {
      var t = e.target; var id = t.id;
      if (id === "admFolEdit") { 이름수정중 = true; return 그리기(); }
      if (id === "admFolEditCancel") { 이름수정중 = false; return 그리기(); }
      if (id === "admFolSave") return 폴더저장();
      if (id === "admFolDelete") return 폴더삭제();
      if (id === "admFolGrantSet") return 전체기간(false);
      if (id === "admFolGrantEnd") return 전체기간(true);
      if (id === "admLinkNewToggle") { 새링크열림 = !새링크열림; return 그리기(); }
      if (id === "admLinkCreate") return 링크만들기();
      if (id === "admLinkEdSave") return 링크수정저장();
      var act = t.dataset && t.dataset.act;
      if (act === "copy") return 주소복사(t.dataset.code);
      if (act === "stop") return 멈춤(t.dataset.lid, t.dataset.stop === "1");
      // [수정] · 수정 양식의 [취소] — 같은 링크를 다시 누르면 닫는다(한 번에 한 링크만 편다)
      if (act === "edit") { 수정중링크 = 수정중링크 === t.dataset.lid ? null : t.dataset.lid; return 그리기(); }
    });
    // 「Pro 안 줌」 을 고르면 바로 아래 경고를 보인다 — 모르고 Pro 없는 링크를 만드는 일을 막는다(9/29 원빈이 실제로 그랬다)
    d.addEventListener("change", function (e) {
      var t = e.target; if (!t || t.type !== "radio") return;
      var 경고 = t.name === "admLinkMode" ? $("admLinkNoneWarn") : t.name === "admLinkEdMode" ? $("admLinkEdNoneWarn") : null;
      if (경고) 경고.hidden = t.value !== "none";
    });
  }

  /* 폴더 이름만 바꾼다 — 계정란의 폴더 머리줄 더블클릭(admin-members.js)이 부른다 (2026-09-29 원빈)
     ⚠ admin_folder_save 는 이름과 메모를 **함께** 적는다. 메모를 비워 보내면 메모가 지워지므로 지금 메모를 같이 보낸다.
     돌려주는 값: 성공이면 true */
  function rename(f, 새이름) {
    새이름 = String(새이름 || "").trim();
    if (!f || !새이름 || 새이름 === f.name) return Promise.resolve(false);
    return 부르기("admin_folder_save", { p_id: f.id, p_name: 새이름, p_memo: f.memo || null }, "폴더 이름을 바꿨습니다 — " + 새이름)
      .then(function (res) { return !!res; });
  }

  WE.adminFolders = {
    show: show,
    hide: hide,
    current: current,
    create: create,
    rename: rename,
    링크주소: 링크주소,
    /* 검사용 이음매 — 로그인·DB 를 흉내 낸 뒤 화면을 그리게 한다 (admin-members.js 와 같은 목적) */
    _테스트_bind: bind,
    _테스트_링크심기: function (목록) { 링크들 = 목록 || []; 링크오류 = null; 그리기(); }
  };
})();

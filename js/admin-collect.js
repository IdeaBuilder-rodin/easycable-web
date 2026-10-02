/* admin-collect.js — 관리자 페이지 「사용자 부품」 탭 (2026-09-14 · 09-15 2차 · 10-01 로그 절약 · 10-02 서버 집계)

   무엇 — 에디터가 자동으로 보내온 사용자 라이브러리 부품(collect_parts · Storage user-libraries)을 본다.
     왼쪽  : **사람 목록** — 로그인한 기기는 이메일로 합치고(한 계정이 PC 여러 대), 로그인 안 한 기기는 기기 하나가 한 사람(10-02).
     가운데: 에디터 라이브러리 창과 같은 줄(.lib-item — 이름·스펙) + 기기 수 배지. 「전체」 는 같은 부품(이름+스펙)끼리 묶는다.
     오른쪽: 고른 부품의 **작업본** — 우리 부품을 등록할 때처럼 **이미지 편집(배경 제거)·부품 정보 편집·단자 편집**을
              여기서 바로 하고, [일괄 등록으로 보내기](게시) 또는 [에디터에 배치](내 화면)로 넘긴다.
              작업본은 화면 안에서만 바뀐다 — 사용자가 보낸 원본 행은 읽기 전용(RLS)이라 건드릴 수 없다.
   같은 부품 — **이름+스펙**(겹친 공백·앞뒤 공백·대소문자 무시 — 10-02 고원빈. 9/14 의 「내용(rev)이 완전히 같은 것만」 을 바꿨다).
              규칙은 서버 한 곳(SQL collect_parts.ident)에만 있다. 사람마다 다른 그림·단자는 상세 「보낸 사람」 에서 하나씩 본다(pick).
   공용 출처 — publicId 가 있는 부품은 우리 카탈로그에서 가져온 것 → 기본 숨김(참고 대상이 아니다). 10-02 부터 서버가 새로 받지도 않는다.
   새 부품   — Supabase Realtime 으로 "▲ 새 부품 N개" 로 붙는다(목록이 튀지 않게, 누르면 처음부터 다시 읽는다).
   읽기      — 관리자만(RLS + 함수 안 확인). 이미지는 비공개 버킷이라 서명 URL(1시간)로 본다.
   에디터에 배치 — 관리자 페이지에는 캔버스가 없다. 작업본을 localStorage(we_admin_inbox)에 넣고 app.html 을 열면
              에디터가 시작할 때 라이브러리에 넣고 캔버스에 놓는다(js/app.js applyAdminInbox). 같은 브라우저에서만 된다.
   숨기기(09-15) — 볼 필요 없는 부품·사람을 목록에서 치운다. **행을 지우지 않고 hidden_at 만 찍는다**(RPC collect_hide).
              지우면 되살아난다(에디터는 "마지막에 보낸 rev" 만 기억한다). hidden_at 은 수집 함수가 안 건드려 다시 와도 계속 숨김.
              통계(CSV·엑셀·순위·머리 숫자)는 숨긴 것도 **포함**(고원빈: 1년 모아 통계). 「숨긴 것 보기」로 다시 보고 복원.
              이 파일에서 표에 직접 쓰는 코드는 없다 — 쓰기는 RPC 뿐(verify_admincollect 가 본다).
   삭제(09-15) — 왼쪽 목록에서 고른 사람 항목 안 [삭제]. 시험 기기용 — 통계에서도 사라지고 못 되돌린다(confirm).
              Storage 이미지 → RPC collect_delete_device(행, cascade) 순. 그 브라우저가 다시 오면 기기 행이 새로 생긴다.

   로그·전송량(2026-10-01·02) — 10/01 Supabase 로그의 약 79% 가 이 탭이었다(들어갈 때마다 그림 약 490장을 한 장씩 서명·전부 내려받음).
     ① **목록은 글자만.** 그림은 「그림 보기」를 켰을 때만(기본 꺼짐) — 켜면 처음 30장, 내릴 때마다 10장. 서명은 그 줄들을 한 번에
        (createSignedUrls) · <img loading="lazy">.
     ② 줄을 누르거나 ↑↓ 로 옮기면 상세에 **그 부품 그림 1장**. 빠르게 넘기면 멈춘 것만 받는다(0.2초 기다림).
     ③ part_data(단자·링크·단가 …)는 고를 때만 읽는다(loadPartData).
   서버 집계(2026-10-02, SQL _ai/sql/2026-10-02_사용자부품_집계.sql · 설계 _ai/제안_부품수집_개선_2026-10-02.md 4판 §5·§11)
     예전엔 collect_parts 를 **최근 1,000행만** 받아 여기서 묶었다 → 10/02 머리 숫자가 「부품 1000」, 오래된 부품은 목록·순위·CSV 어디에도 없었다.
     이제 묶기·세기는 서버 RPC(collect_groups · collect_people · collect_summary · collect_members · collect_export·_agg)가 한다.
     ④ 가운데 목록은 묶인 줄을 **100줄씩** 받아 두고, 화면엔 30줄 + 끝이 보일 때마다 10줄씩 그린다. 받아 둔 게 떨어지면 다음 100줄.
        (요청 수 = 로그 줄 수라 10줄마다 받지 않는다)
     ⑤ 페이지는 keyset(이전 페이지 마지막 줄의 cursor) + 첫 페이지 시각(snapshot) — 중간에 행이 들어와도 중복·누락 없게.
        「최근 고친 순」 은 기존 행 수정으로 순서가 바뀔 수 있어 **키로 중복을 거른다**(같은 줄을 두 번 안 그림).
     ⑥ 검색은 글자를 칠 때마다 묻지 않고 0.4초 조용해지면 묻는다.
   ⚠ 이 파일은 에디터에 실리지 않는다(관리자 페이지만). 수집하는 쪽은 js/libsync.js · supabase/functions/library-sync. */
var WE = window.WE || {};
window.WE = WE;

WE.adminCollect = (function () {
  "use strict";
  var BUCKET = "user-libraries", INBOX_KEY = "we_admin_inbox";
  var GPAGE = 100, PPAGE = 200;    // 서버에서 한 번에 받는 줄 수 — 가운데 묶음 100 · 왼쪽 사람 200 (머리말 ④)
  // ── 서버에서 받은 것 ──
  var summary = null;              // collect_summary — 머리 숫자 · 순위
  var people = [], peopleMore = false, peopleCursor = null, peopleTotal = 0, peopleParts = 0, peoplePub = 0;
  var hiddenDevices = {};          // device_id → true — 기기째 숨긴 것(collect_summary.hidden_devices — 실시간 「새 부품」 거름용)
  var groups = [];                 // 가운데 목록 — 받아 둔 묶음들(서버 순서 그대로)
  var groupsMore = false, groupsCursor = null, groupsTotal = 0, snapshot = null, listVersion = 0, groupsLoading = null;
  // ── 화면 상태 ──
  var userFilter = "";             // "" = 전체, 아니면 사람 키(로그인 계정 "acct:이메일", 아니면 device_id)
  var pick = {};                   // 묶음 key → 상세에서 고른 구성원(행 키 device|part). 없으면 서버 대표(그림 있는 최근 것)
  var detailTimer = null, searchTimer = null;
  var selectedKey = null, checked = {}, pending = [], channel = null, entered = false;
  var urlCache = {};               // image_path → 서명 URL
  var signing = {};                // image_path → 서명 받는 중인 Promise — 다시 그려도 같은 그림을 두 번 서명하지 않게
  var failed = {};                 // image_path → 서버가 "그 파일 없음" 이라 한 것. 「새로 읽기」 전까지 다시 묻지 않는다
  var FIRST = 30, MORE = 10;       // 처음 그리는 줄 수 · 끝이 보일 때마다 더 그리는 줄 수
  var shown = FIRST, drawn = 0, moreObs = null;
  var workLoading = {}, membersLoading = {};
  var work = {};                   // key → 작업본 { name, spec, image(data:), width, height, terminals, queue, … }
  var editingKey = null;           // 단자 편집기가 열려 있는 작업본

  var $ = function (id) { return document.getElementById(id); };
  function client() { return WE.auth && WE.auth._client ? WE.auth._client() : null; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ago(iso) {
    var t = iso ? new Date(iso).getTime() : NaN;
    if (!isFinite(t)) return "";                                    // 서버가 '-infinity'(시각 없음)를 줄 수 있다
    var d = (Date.now() - t) / 1000;
    if (d < 60) return "방금"; if (d < 3600) return Math.floor(d / 60) + "분 전"; if (d < 86400) return Math.floor(d / 3600) + "시간 전";
    return Math.floor(d / 86400) + "일 전";
  }
  function showHidden() { var el = $("admColHidden"); return !!(el && el.checked); }
  function withPublic() { var el = $("admColPublic"); return !!(el && el.checked); }
  function showThumbs() { var el = $("admColThumbs"); return !!(el && el.checked); }
  function grouped() { var el = $("admColGroup"); return userFilter === "" && !!(el && el.checked); }
  function rowKey(r) { return r.device_id + "|" + r.part_id; }
  function firstAt(r) { return r.created_at || r.updated_at || ""; }
  function who(r) { return (r && r.user_email) || ("기기 " + String(r && r.device_id).slice(0, 8)); }
  function rpc(name, args) {
    var c = client(); if (!c || !c.rpc) return Promise.reject(new Error("로그인이 필요합니다"));
    return c.rpc(name, args).then(function (res) { if (res && res.error) throw res.error; return res ? res.data : null; });
  }
  function msgOf(e) { return (e && e.message) || String(e); }

  // ── 사람 ───────────────────────────────────────────────────────────
  function personEntry(key) { for (var i = 0; i < people.length; i++) if (people[i].key === key) return people[i]; return null; }
  function personOfDevice(deviceId) {
    for (var i = 0; i < people.length; i++) if ((people[i].device_ids || []).indexOf(String(deviceId)) >= 0) return people[i].key;
    return String(deviceId);
  }
  function personLabel(p) { return (p && p.email) || ("기기 " + String((p && p.device_ids && p.device_ids[0]) || (p && p.key) || "").slice(0, 8)); }

  // ── 읽기 ────────────────────────────────────────────────────────────
  function loadSummary() {
    return rpc("collect_summary", {}).then(function (d) {
      summary = d || {};
      // 기기째 숨긴 기기 — 실시간 「▲ 새 부품」 거름용(숨긴 사람은 사람 목록에 안 나와 거기서 못 얻는다)
      hiddenDevices = {}; (summary.hidden_devices || []).forEach(function (id) { hiddenDevices[id] = true; });
    });
  }
  function loadPeople(reset) {
    if (reset) { people = []; peopleCursor = null; peopleMore = false; }
    return rpc("collect_people", { p_with_public: withPublic(), p_with_hidden: showHidden(), p_keep: userFilter || null, p_q: null,
                                   p_after: peopleCursor, p_limit: PPAGE }).then(function (d) {
      d = d || {}; var rows = d.rows || [];
      people = people.concat(rows);
      peopleTotal = d.total || 0; peopleParts = d.total_parts || 0; peoplePub = d.total_pub || 0;
      if (rows.length) peopleCursor = rows[rows.length - 1].cursor;
      peopleMore = rows.length === PPAGE && people.length < peopleTotal;
    });
  }
  function toGroup(x) {
    var rep = x.rep || {};
    return { key: x.key, rep: rep, memberCount: x.members || 1, devices: x.devices || 1, first: x.first_at, latest: x.latest_at,
             hidden: !!x.all_hidden, cursor: x.cursor, memberRows: null, memberMore: false };
  }
  function loadGroups(reset) {
    if (reset) { groups = []; groupsCursor = null; groupsMore = false; snapshot = null; listVersion++; groupsLoading = null; }
    var ver = listVersion;
    var args = { p_person: userFilter || null, p_grouped: grouped(), p_q: ($("admColSearch").value || "").trim() || null,
                 p_sort: $("admColSort").value || "first", p_with_public: withPublic(), p_with_hidden: showHidden(),
                 p_snapshot: snapshot, p_after: groupsCursor, p_limit: GPAGE };
    return rpc("collect_groups", args).then(function (d) {
      if (ver !== listVersion) return false;                         // 그 사이 거르기가 바뀌었다 — 이 응답은 버린다
      d = d || {}; var rows = d.rows || [];
      if (d.snapshot) snapshot = d.snapshot;                         // 이 목록은 이 시각 기준으로 끝까지 넘긴다(머리말 ⑤)
      groupsTotal = d.total || 0;
      var seen = {}; groups.forEach(function (g) { seen[g.key] = 1; });
      rows.forEach(function (x) { if (!seen[x.key]) { seen[x.key] = 1; groups.push(toGroup(x)); } });   // 키로 중복 거름
      if (rows.length) groupsCursor = rows[rows.length - 1].cursor;
      groupsMore = rows.length === GPAGE && groups.length < groupsTotal;
      return true;
    });
  }
  function load() {
    if (!client()) return Promise.resolve(false);
    $("admColStats").textContent = "읽는 중…";
    처음부터(); pending = []; renderNew();
    return Promise.all([loadSummary(), loadPeople(true), loadGroups(true)]).then(function () {
      syncGroupToggle(); renderUsers(); render(); renderRank(); renderStats();
      return true;
    }).catch(function (e) {
      $("admColStats").textContent = "읽지 못했습니다: " + msgOf(e);
      return false;
    });
  }
  // 거르기(검색·정렬·묶기·사람)가 바뀌면 가운데 목록만 처음부터
  function reloadGroups() {
    처음부터(); syncGroupToggle();
    return loadGroups(true).then(function (ok) { if (ok !== false) { render(); if (selectedKey && !current()) { selectedKey = null; renderDetail(); } } })
      .catch(function (e) { $("admColEmpty").hidden = false; $("admColEmpty").textContent = "읽지 못했습니다: " + msgOf(e); });
  }
  // 숨기기·복원·삭제 뒤 — 서버와 같게 다시(머리 숫자·사람·목록). 고른 줄이 남아 있으면 그대로
  function refreshAll() {
    처음부터();
    return Promise.all([loadSummary(), loadPeople(true), loadGroups(true)]).then(function () {
      syncGroupToggle(); renderUsers(); render(); renderRank(); renderStats(); renderDetail();
    }).catch(function (e) { $("admColStats").textContent = "읽지 못했습니다: " + msgOf(e); });
  }

  /* part_data — 목록에서는 빼고 필요할 때만 읽는다 (2026-10-01).
     읽은 것은 행 객체에 붙여 둔다(r.part_data). 서버에 그 행이 없으면(그 사이 사용자가 지움) null — 빈 값으로 다룬다.
     읽기 자체가 실패하면(네트워크) 실패로 돌려 화면이 알린다 — 빈 작업본으로 조용히 바꿔치지 않는다. */
  function needPd(r) { return !!r && r.part_data === undefined; }
  function uniq(list, k) { var s = {}, out = []; list.forEach(function (r) { if (!s[r[k]]) { s[r[k]] = 1; out.push(r[k]); } }); return out; }
  function loadPartData(list) {
    var need = list.filter(needPd);
    if (!need.length) return Promise.resolve();
    var c = client(); if (!c) return Promise.reject(new Error("로그인이 필요합니다"));
    // 한 번에 최대 40행씩(주소 길이 — 기기 id 를 수백 개 늘어놓지 않는다)
    var 묶음 = []; for (var i = 0; i < need.length; i += 40) 묶음.push(need.slice(i, i + 40));
    return Promise.all(묶음.map(function (part) {
      return c.from("collect_parts").select("device_id,part_id,part_data")
        .in("device_id", uniq(part, "device_id")).in("part_id", uniq(part, "part_id")).then(function (res) {
          if (res && res.error) throw res.error;
          var map = {};
          ((res && res.data) || []).forEach(function (x) { map[x.device_id + "|" + x.part_id] = x.part_data; });
          part.forEach(function (r) { var p = map[rowKey(r)]; r.part_data = p === undefined ? null : p; });
        });
    }));
  }

  // ── 왼쪽: 사람 목록 ─────────────────────────────────────────────────
  /* 개수는 **가운데에 보이는 기준**(숨김·공용 거름을 따른다 — 9/15 「47개인데 20개만 보이던」 원인 이후 원칙). 공용 수는 옆에 「(공용 N)」.
     숨김은 기기마다 적혀 있다 → 사람의 기기가 **전부** 숨김일 때 그 사람이 숨김. */
  function renderUsers() {
    var box = $("admColUsers"); if (!box) return;
    var wp = withPublic();
    function 개수(n, pub) { return n + "개" + (pub && !wp ? " <i>(공용 " + pub + ")</i>" : ""); }
    // 항목은 <div role="button"> — 안에 [숨기기] [삭제] 단추를 넣어야 해서(<button> 안에 <button> 은 안 된다). 키보드는 아래 keydown 이 받는다.
    var html = '<div role="button" tabindex="0" class="adm-col-user' + (userFilter === "" ? " on" : "") + '" data-user=""><b>전체</b><span>' + peopleTotal + "명 · " + 개수(peopleParts, peoplePub) + "</span></div>";
    people.forEach(function (p) {
      var on = userFilter === p.key, hid = !!p.all_hidden, acct = String(p.key).indexOf("acct:") === 0, n = p.n_devices || (p.device_ids || []).length;
      // 통째로 숨긴 사람은 「숨긴 것 보기」 때만 — 지금 고른 사람이면 남긴다(서버도 같은 규칙, p_keep). 고른 사람을 바꾸면 여기서 바로 거른다
      if (hid && !on && !showHidden()) return;
      html += '<div role="button" tabindex="0" class="adm-col-user' + (on ? " on" : "") + (hid ? " is-hidden" : "") + '" data-user="' + esc(p.key) + '" title="' + esc((p.device_ids || []).join(", ")) + '">' +
        "<b>" + esc(personLabel(p)) + (hid ? ' <em class="adm-col-hidden-tag">숨김</em>' : "") + "</b>" +
        "<span>" + 개수(p.n_parts || 0, p.n_pub || 0) + " · " + esc(ago(p.latest)) + (n > 1 ? " · 기기 " + n + "대" : "") + (acct ? "" : " · 로그인 안 함") + "</span>" +
        // 고른 사람에게만 단추 — 숨기기(복원)는 되돌릴 수 있고, 삭제는 못 되돌린다(confirm). 그 사람의 기기 전부에 적용
        (on ? '<span class="adm-col-user-acts">' +
                '<button type="button" data-devact="' + (hid ? "unhide" : "hide") + '" title="목록에서만 치웁니다. 통계에는 남고 되돌릴 수 있습니다">' + (hid ? "복원" : "숨기기") + "</button>" +
                '<button type="button" class="danger" data-devact="delete" title="서버에서 완전히 지웁니다(부품·이미지 포함, 통계에서도 사라짐). 시험 기기용">삭제</button>' +
              "</span>" : "") +
        "</div>";
    });
    // 사람이 많으면 200명씩 — 「N명 더 보기」
    if (peopleMore) html += '<button type="button" class="adm-col-users-more" data-users-more>' + (peopleTotal - people.length) + "명 더 보기</button>";
    box.innerHTML = html;
  }
  function syncGroupToggle() { var el = $("admColGroup"); if (el) el.disabled = userFilter !== ""; }   // 한 사람 안에서는 묶을 게 없다

  /* 그림 서명 — 여러 장을 한 번에 (2026-10-01). 서명 중인 것은 signing 에 두어 다시 그려도 또 묻지 않는다.
     서버가 "그 파일 없음" 이라 한 것은 failed 에 적어 「새로 읽기」 전까지 다시 묻지 않는다. 네트워크 실패는 다음에 다시. */
  function signPaths(paths) {
    var c = client(), seen = {}, todo = [];
    paths.forEach(function (p) { if (p && !seen[p] && !urlCache[p] && !signing[p] && !failed[p]) { seen[p] = 1; todo.push(p); } });
    if (!todo.length || !c || !c.storage) return;
    var all = c.storage.from(BUCKET).createSignedUrls(todo, 3600).then(function (res) {
      if (res && res.error) throw res.error;
      var map = {};
      // 응답은 보낸 순서대로 [{ path, signedUrl, error }] — path 가 비어 있으면 순서로 맞춘다
      ((res && res.data) || []).forEach(function (x, i) { if (x && x.signedUrl) map[x.path || todo[i]] = x.signedUrl; });
      return map;
    }).catch(function () { return null; });
    todo.forEach(function (p) {
      signing[p] = all.then(function (map) {
        delete signing[p];
        if (!map) return null;                                  // 네트워크 실패 — 다음에 다시
        if (map[p]) urlCache[p] = map[p]; else failed[p] = true;
        return map[p] || null;
      });
    });
  }
  function urlFor(p) { return urlCache[p] ? Promise.resolve(urlCache[p]) : (signing[p] || Promise.resolve(null)); }
  function thumbUrl(r) {
    if (!r.has_image || !r.image_path) return Promise.resolve(null);
    signPaths([r.image_path]);
    return urlFor(r.image_path);
  }

  // ── 가운데 목록 — 30줄 그리고 끝이 보일 때마다 10줄씩. 받아 둔 게 떨어지면 다음 100줄(머리말 ④) ──
  function 처음부터() {
    shown = FIRST;
    var wrap = $("admColList") && $("admColList").closest(".adm-col-list-wrap"); if (wrap) wrap.scrollTop = 0;
  }
  function render() {
    var box = $("admColList"); box.innerHTML = "";
    var em = $("admColEmpty");
    em.hidden = groups.length > 0;
    if (!groups.length) em.textContent = "아직 모인 부품이 없습니다. 에디터에서 라이브러리에 부품을 추가하면 30초 뒤 여기에 나타납니다.";
    // 고른 줄이 그릴 범위 밖이면 거기까지 그린다 — 눌러 둔 줄이 다시 그릴 때 사라지면 안 된다
    for (var i = 0; i < groups.length; i++) if (groups[i].key === selectedKey) { while (shown <= i) shown += MORE; break; }
    drawn = 0;
    appendRange(0, Math.min(shown, groups.length));
    renderSendButton();
  }
  function itemMeta(g) {
    var r = g.rep;
    // 「처음 3일 전」 — 이 부품(묶음)이 처음 나타난 때. 그 뒤 고쳐서 다시 왔으면 「· 최근 2시간 전」
    var t = "처음 " + ago(g.first) + (g.latest && g.first && new Date(g.latest) - new Date(g.first) > 60000 ? " · 최근 " + ago(g.latest) : "");
    return "단자 " + (r.terminal_count || 0) + " · " + t + (userFilter ? "" : " · " + who(r) + (g.memberCount > 1 ? " 외" : ""));
  }
  function appendRange(from, to) {
    var box = $("admColList"), waiting = [], thumbs = showThumbs();
    for (var i = from; i < to; i++) {
      var g = groups[i], r = g.rep, el = document.createElement("div"), w = work[g.key];
      el.className = "lib-item" + (g.key === selectedKey ? " on" : "") + (r.public_id ? " is-public" : "") + (g.hidden ? " is-hidden" : "");
      el.setAttribute("role", "listitem"); el.dataset.key = g.key;
      el.innerHTML =
        '<input type="checkbox" data-check="' + esc(g.key) + '"' + (checked[g.key] ? " checked" : "") + ' title="선택 — 일괄 등록으로 보내기 · 숨기기" />' +
        // loading="lazy" — 주소가 붙어도 화면 가까이 올 때까지 브라우저가 내려받지 않는다
        (thumbs ? '<div class="lib-thumb-wrap"><img class="lib-thumb" alt="" loading="lazy" decoding="async" /></div>' : "") +
        '<div class="lib-info"><div class="lib-name">' + esc((w && w.name) || r.name || "(이름 없음)") + (w && w.dirty ? ' <em class="adm-col-edited">편집함</em>' : "") + (g.hidden ? ' <em class="adm-col-hidden-tag">숨김</em>' : "") + "</div>" +
          '<div class="lib-meta">' + esc((w && w.spec) || r.spec || "—") + "</div>" +
          '<div class="adm-col-meta">' + esc(itemMeta(g)) + "</div></div>" +
        (userFilter ? "" : '<span class="adm-col-count' + (g.devices > 1 ? " many" : "") + '">' + g.devices + "기기</span>");
      box.appendChild(el);
      if (!thumbs) continue;
      var img = el.querySelector("img");
      if (w && w.image) img.src = w.image;                                   // 작업본에서 고친 그림
      else if (r.has_image && r.image_path) {
        if (urlCache[r.image_path]) img.src = urlCache[r.image_path];        // 이미 서명받은 것 — 같은 주소라 브라우저가 다시 안 받는다
        else waiting.push({ path: r.image_path, img: img });
      }
    }
    // 이번에 붙인 줄의 그림을 한 번에 서명한다(그림 보기 켰을 때만 — 꺼져 있으면 waiting 이 비어 아무 요청도 안 나간다)
    signPaths(waiting.map(function (x) { return x.path; }));
    waiting.forEach(function (x) { urlFor(x.path).then(function (u) { if (u) x.img.src = u; }); });
    drawn = to;
    renderMore();
  }
  function showMore() {
    if (drawn < groups.length) {
      shown = drawn + MORE;
      appendRange(drawn, Math.min(shown, groups.length));
      return;
    }
    // 받아 둔 줄을 다 그렸다 — 서버에 더 있으면 다음 100줄
    if (!groupsMore || groupsLoading) return;
    var ver = listVersion;
    groupsLoading = loadGroups(false).then(function () {
      groupsLoading = null;
      if (ver === listVersion && drawn < groups.length) showMore(); else renderMore();
    }, function (e) { groupsLoading = null; renderMore(); console.warn("[사용자 부품] 다음 줄 읽기 실패:", msgOf(e)); });
  }
  // 목록 끝 — 「30 / 75개 표시 · 10개 더 보기」. 보이면 저절로 붙고, 눌러도 붙는다(키보드)
  function renderMore() {
    var more = $("admColMore"); if (!more) return;
    var left = Math.max(groupsTotal, groups.length) - drawn;
    if (moreObs) moreObs.disconnect();
    more.hidden = left <= 0 || (drawn >= groups.length && !groupsMore);
    if (more.hidden) return;
    more.textContent = drawn + " / " + Math.max(groupsTotal, groups.length) + "개 표시 · " + Math.min(MORE, left) + "개 더 보기";
    if (!window.IntersectionObserver) return;
    if (!moreObs) moreObs = new IntersectionObserver(function (es) {
      for (var i = 0; i < es.length; i++) if (es[i].isIntersecting) { showMore(); return; }
    }, { root: more.closest(".adm-col-list-wrap"), rootMargin: "0px 0px 300px 0px" });
    // 다시 observe 하면 지금 상태로 한 번 알려 준다 — 붙인 뒤에도 끝이 여전히 보이면 이어서 더 붙는다
    moreObs.observe(more);
  }
  // 대상 묶음 — 체크한 것, 없으면 고른 것. 일괄 등록·숨기기가 같은 규칙을 쓴다
  function targets() {
    var keys = Object.keys(checked).filter(function (k) { return checked[k]; });
    if (!keys.length && selectedKey) keys = [selectedKey];
    return groups.filter(function (g) { return keys.indexOf(g.key) >= 0; });
  }
  function renderSendButton() {
    var n = Object.keys(checked).filter(function (k) { return checked[k]; }).length;
    var b = $("admColSend"); b.disabled = !(n || selectedKey);
    b.textContent = n ? "일괄 등록으로 보내기 (" + n + ")" : "일괄 등록으로 보내기";
    // 숨기기 단추 — 대상이 전부 숨긴 것이면 「복원」, 아니면 「숨기기」
    var h = $("admColHide"); if (!h) return;
    var ts = targets(), allHidden = ts.length > 0 && ts.every(function (g) { return g.hidden; });
    h.disabled = ts.length === 0;
    h.textContent = (allHidden ? "복원" : "숨기기") + (n ? " (" + n + ")" : "");
  }
  function renderStats() {
    var s = summary || {}, pub = s.public_parts || 0, hid = s.hidden || 0;
    // 부품 수는 숨긴 것도 포함한 전체(통계 기준). 「오늘 +N · 7일 +N」 은 그 기간에 **처음** 들어온 것(10-02)
    $("admColStats").textContent = "기기 " + (s.devices || 0) + " (로그인 " + (s.linked || 0) + ") · 부품 " + (s.parts || 0) +
      (pub && !withPublic() ? " (공용 출처 " + pub + " 숨김)" : "") + (hid ? " · 숨김 " + hid : "") +
      " · 오늘 +" + (s.today || 0) + " · 7일 +" + (s.week || 0);
  }
  // 순위·통계는 숨긴 것도 센다 — 숨김은 "지금 볼 필요 없음" 이지 "없던 일" 이 아니다(고원빈: 1년 모아 통계)
  function renderRank() {
    $("admColRank").innerHTML = ((summary && summary.rank) || []).map(function (x) {
      return "<li><b>" + esc(x.name) + "</b>" + (x.spec ? " <span class='muted'>" + esc(x.spec) + "</span>" : "") + " — " + x.devices + "기기</li>";
    }).join("");
  }
  function renderNew() {
    var b = $("admColNew"); b.hidden = pending.length === 0; b.querySelector("b").textContent = pending.length;
  }

  // ── 오른쪽: 작업본 ────────────────────────────────────────────────────
  /* 묶음의 구성원(보낸 사람들) — 누를 때 그 묶음 것만 서버에서(처음 50명). 대표(rep)를 구성원 목록 속 같은 행으로 맞춰
     part_data 를 한 번만 읽게 한다. 고른 사람(pick)이 있으면 그 행이 대표. */
  function loadMembers(g) {
    if (g.memberRows) return Promise.resolve(g.memberRows);
    if (g.memberCount <= 1) { g.memberRows = [g.rep]; return Promise.resolve(g.memberRows); }
    if (membersLoading[g.key]) return membersLoading[g.key];
    return (membersLoading[g.key] = rpc("collect_members", { p_keys: [g.key], p_grouped: grouped(), p_person: userFilter || null,
                                                            p_with_public: withPublic(), p_with_hidden: showHidden(), p_after: null, p_limit: 50 })
      .then(function (d) {
        delete membersLoading[g.key];
        var rows = (d && d.rows) || [], 원하는 = pick[g.key] || rowKey(g.rep);
        g.memberRows = rows.length ? rows : [g.rep];
        g.memberMore = !!(d && d.more);
        g.memberRows.forEach(function (m) { if (rowKey(m) === 원하는) g.rep = m; });
        return g.memberRows;
      }, function (e) { delete membersLoading[g.key]; throw e; }));
  }
  /* 고른 부품의 작업본을 만든다(없으면). 이미지는 서명 URL 로 받아 data: 로 바꿔 둔다 — 편집기·배치 모두 data: 가 필요하다. */
  function ensureWork(g) {
    if (work[g.key]) return Promise.resolve(work[g.key]);
    if (workLoading[g.key]) return workLoading[g.key];
    // 목록에는 part_data 가 없다 — 이 부품 것만 먼저 읽는다(2026-10-01). 실패하면 그대로 실패(화면이 알린다)
    if (needPd(g.rep)) {
      return (workLoading[g.key] = loadPartData([g.rep]).then(
        function () { delete workLoading[g.key]; return ensureWork(g); },
        function (e) { delete workLoading[g.key]; throw e; }));
    }
    var r = g.rep, p = r.part_data || {};
    var w = {
      key: g.key, dirty: false,
      name: p.name || r.name || "", spec: p.spec || r.spec || "",
      image: "", width: p.defaultWidth || 0, height: p.defaultHeight || 0,
      terminals: JSON.parse(JSON.stringify(p.terminals || [])),
      queue: JSON.parse(JSON.stringify(p.terminalPlacementQueue || [])), queueVersion: p.terminalPlacementQueueVersion,
      link: p.link || "", linkKr: p.linkKr || "", linkPref: p.linkPref === "global" ? "global" : "kr",
      price: p.price != null ? String(p.price) : "", priceKr: p.priceKr != null ? String(p.priceKr) : "",
      datasheets: (p.datasheets || []).filter(function (d) { return d && d.type === "link"; }),
      role: p.role || "load", volt: p.volt || "", current: p.current || "", power: p.power || ""
    };
    work[g.key] = w;
    return thumbUrl(r).then(function (u) { return u ? 그림받기(u).catch(function () { return ""; }) : ""; })
      .then(function (dataUrl) { w.image = dataUrl || ""; return w; });
  }
  function 그림받기(url) {
    if (url.indexOf("data:") === 0) return Promise.resolve(url);
    return fetch(url).then(function (r) { if (!r.ok) throw new Error("이미지"); return r.blob(); })
      .then(function (b) { return new Promise(function (ok, no) { var fr = new FileReader(); fr.onload = function () { ok(fr.result); }; fr.onerror = function () { no(new Error("읽기")); }; fr.readAsDataURL(b); }); });
  }
  function current() { for (var i = 0; i < groups.length; i++) if (groups[i].key === selectedKey) return groups[i]; return null; }

  // 끝나는 약속을 돌려준다 — 보낸 사람·부품 정보를 읽고 그리기까지(검사·연달아 부르는 쪽이 기다릴 수 있게)
  function renderDetail() {
    var box = $("admColDetail");
    var g = current();
    if (!g) { box.innerHTML = '<div class="adm-col-empty">가운데에서 부품을 고르면 여기서 이미지·정보·단자를 고쳐 게시하거나 에디터에 배치할 수 있습니다.</div>'; return Promise.resolve(); }
    box.innerHTML = '<div class="adm-col-empty">불러오는 중…</div>';
    return loadMembers(g).then(function () { return ensureWork(g); }).then(function (w) {
      if (current() !== g) return;                      // 그 사이 다른 걸 골랐다
      var terms = w.terminals || [];
      var svg = terms.map(function (t) {
        var x = (Number(t.rx) || 0) * 100, y = (Number(t.ry) || 0) * 100;
        return '<circle cx="' + x + '%" cy="' + y + '%" r="5" fill="' + esc(t.color || "#1e88e5") + '" stroke="#fff" stroke-width="1.5"/>' +
               '<text x="' + x + '%" y="' + y + '%" dx="8" dy="4" font-size="11" fill="#111" stroke="#fff" stroke-width="3" paint-order="stroke">' + esc(t.name || "") + "</text>";
      }).join("");
      /* 보낸 사람 — 묶음(이름+스펙)의 구성원 하나하나. 사람마다 그림·단자가 다를 수 있어 눌러서 그 사람 것으로 바꿔 본다(pick, 그림 1장).
         구성원이 하나면 글자만. 많으면 20명까지 보이고 「외 N」 */
      var LIMIT = 20, members = (g.memberRows || [g.rep]).slice(0, LIMIT), sources, 나머지 = g.memberCount - members.length;
      if (g.memberCount > 1) {
        sources = members.map(function (m) {
          var on = rowKey(m) === rowKey(g.rep);
          return '<button type="button" class="adm-col-member' + (on ? " on" : "") + '" data-member="' + esc(rowKey(m)) + '"' + (on ? ' aria-current="true"' : "") +
            ' title="이 사람이 올린 그림·단자로 바꿔 봅니다">' + esc(who(m) + " (" + ago(firstAt(m)) + " · 단자 " + (m.terminal_count || 0) + ")") + "</button>";
        }).join('<span class="adm-col-member-sep"> · </span>') + (나머지 > 0 ? " 외 " + 나머지 : "");
      } else sources = esc(who(g.rep) + " (" + ago(firstAt(g.rep)) + ")");
      var 기기째숨김 = !!(g.rep.is_hidden && !g.rep.hidden_at);
      function field(k, label, ph) { return '<label class="adm-col-f"><span>' + label + '</span><input type="text" data-w="' + k + '" value="' + esc(w[k]) + '" placeholder="' + esc(ph || "") + '" /></label>'; }
      box.innerHTML =
        '<div class="adm-col-figure">' + (w.image ? '<img alt="" src="' + w.image + '" />' : '<div class="adm-col-noimg">이미지 없음</div>') + '<svg xmlns="http://www.w3.org/2000/svg">' + svg + "</svg></div>" +
        '<div class="adm-col-tools">' +
          '<button type="button" class="adm-edit-btn" data-act="image"' + (w.image ? "" : " disabled") + '>이미지 편집…</button>' +
          '<button type="button" class="adm-edit-btn" data-act="terminals"' + (w.image ? "" : " disabled") + '>단자 편집…</button>' +
          (w.dirty ? '<button type="button" class="adm-edit-btn" data-act="reset" title="사용자가 보낸 원본으로 되돌립니다">원본으로</button>' : "") +
        "</div>" +
        '<div class="adm-col-form">' +
          field("name", "이름") + field("spec", "스펙", "예: SZH-EK002") +
          '<div class="adm-col-buy"><span class="adm-col-f-title">구매 링크 · 단가 <em>체크한 쪽이 BOM에</em></span>' +
            '<label class="adm-col-buy-item"><input type="radio" name="admColPref" value="global"' + (w.linkPref === "global" ? " checked" : "") + ' /> <span class="buy-link-tag">해외</span>' + '<input type="text" data-w="link" value="' + esc(w.link) + '" placeholder="https://…" /><input type="text" data-w="price" value="' + esc(w.price) + '" placeholder="단가" class="adm-col-price" /></label>' +
            '<label class="adm-col-buy-item"><input type="radio" name="admColPref" value="kr"' + (w.linkPref === "kr" ? " checked" : "") + ' /> <span class="buy-link-tag">국내</span>' + '<input type="text" data-w="linkKr" value="' + esc(w.linkKr) + '" placeholder="https://…" /><input type="text" data-w="priceKr" value="' + esc(w.priceKr) + '" placeholder="단가(원)" class="adm-col-price" /></label>' +
          "</div>" +
          '<div class="adm-col-terms">' + terms.map(function (t) { return "<span><i style='background:" + esc(t.color || "#1e88e5") + "'></i>" + esc(t.name || "") + "</span>"; }).join("") + (terms.length ? "" : "<span class='muted'>단자 없음</span>") + "</div>" +
          "<div class='adm-col-sources'>" + (w.width && w.height ? w.width + " × " + w.height + " · " : "") + g.devices + "기기: " + sources + (g.rep.public_id ? " · 공용 출처 " + esc(g.rep.public_id) : "") + "</div>" +
        "</div>" +
        '<p class="adm-col-note">여기서 고치는 것은 <b>작업본</b>입니다 — 사용자의 라이브러리와 서버에 모인 원본은 바뀌지 않습니다.</p>' +
        (g.hidden ? '<p class="adm-col-note"><em class="adm-col-hidden-tag">숨김</em> 목록에서 치운 부품입니다. 통계에는 남아 있습니다.' + (기기째숨김 ? " (기기째 숨김 — 왼쪽 「이 기기 복원」으로 되돌립니다)" : "") + "</p>" : "") +
        '<div class="adm-col-actions">' +
          '<button type="button" class="adm-batch-publish-all" data-act="batch">일괄 등록으로 보내기</button>' +
          '<button type="button" class="adm-edit-btn" data-act="place" title="에디터를 열어 내 라이브러리에 넣고 캔버스에 놓습니다 (같은 브라우저)">에디터에 배치</button>' +
          // 부품 자체를 숨긴 것만 여기서 복원한다. 기기째 숨긴 건 부품 행이 안 바뀌어 여기서 복원해도 소용없다 → 단추를 안 그린다
          (기기째숨김 ? "" :
            '<button type="button" class="adm-edit-btn" data-act="' + (g.hidden ? "unhide" : "hide") + '" title="행을 지우지 않고 목록에서만 치웁니다. 통계에는 남습니다">' + (g.hidden ? "복원" : "숨기기") + "</button>") +
        "</div>";
    }).catch(function (e) {
      // 구성원·part_data 를 못 읽었다(네트워크 등) — 빈 칸으로 그리지 않고 알린다. 다시 고르면 다시 읽는다
      if (current() !== g) return;
      box.innerHTML = '<div class="adm-col-empty">부품 정보를 읽지 못했습니다: ' + esc(msgOf(e)) + "</div>";
    });
  }
  function onDetailInput(e) {
    var g = current(), w = g && work[g.key]; if (!w) return;
    var inp = e.target.closest("[data-w]");
    if (inp) { w[inp.dataset.w] = inp.value; w.dirty = true; if (inp.dataset.w === "name" || inp.dataset.w === "spec") renderListText(g.key, w); return; }
    var radio = e.target.closest("input[name=admColPref]");
    if (radio) { w.linkPref = radio.value; w.dirty = true; }
  }
  function renderListText(key, w) {
    var el = document.querySelector('#admColList .lib-item[data-key="' + CSS.escape(key) + '"]'); if (!el) return;
    el.querySelector(".lib-name").innerHTML = esc(w.name || "(이름 없음)") + ' <em class="adm-col-edited">편집함</em>';
    el.querySelector(".lib-meta").textContent = w.spec || "—";
  }

  // 이미지 편집 — 에디터·일괄 등록과 같은 bgremove 모달. 결과(data:, 크기)를 작업본에 넣고 다시 그린다.
  function editImage() {
    var g = current(), w = g && work[g.key]; if (!w || !w.image || !WE.bgremove) return;
    WE.bgremove.open(w.image, function (url, tf, size) {
      w.image = url; if (size && size.width) { w.width = size.width; w.height = size.height; }
      w.dirty = true; render(); renderDetail();
    }, { width: w.width, height: w.height });
  }
  // 단자 편집 — 에디터·일괄 등록과 같은 termeditor. 저장 훅(WE.app.afterTerminalEdit)을 감싸 내 작업본만 받는다.
  // ⚠ 단자 편집기의 부품 id 는 "collect_" + 묶음 key — 묶음 key 는 서버 ident(공백·\u001f 가 든 글자)일 수 있어 그대로 쓰지 않고 해시로
  function fnv(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  function editorId(key) { return "collect_" + fnv(String(key)); }
  function editTerminals() {
    var g = current(), w = g && work[g.key]; if (!w || !w.image || !WE.termeditor) return;
    editingKey = g.key;
    WE.termeditor.open({
      id: editorId(g.key), name: w.name || "부품", image: w.image, width: w.width || 160, height: w.height || 120,
      terminals: w.terminals.map(function (t) { var c = JSON.parse(JSON.stringify(t)); if (!c.id) c.id = WE.model.nextId("t"); return c; }),
      terminalPlacementQueue: JSON.parse(JSON.stringify(w.queue || [])), terminalPlacementQueueVersion: w.queueVersion
    });
  }
  var prevAfter = WE.app && WE.app.afterTerminalEdit;
  WE.app = WE.app || {};
  WE.app.afterTerminalEdit = function (cmp) {
    if (editingKey && cmp && cmp.id === editorId(editingKey)) {
      var w = work[editingKey]; editingKey = null;
      if (w) { w.terminals = JSON.parse(JSON.stringify(cmp.terminals || [])); w.queue = JSON.parse(JSON.stringify(cmp.terminalPlacementQueue || [])); w.queueVersion = cmp.terminalPlacementQueueVersion; w.dirty = true; }
      renderDetail();
    } else if (prevAfter) prevAfter(cmp);
  };
  function resetWork() { var g = current(); if (g) { delete work[g.key]; render(); renderDetail(); } }

  // 작업본 → 일괄 등록/에디터로 넘길 부품 모양
  function toPart(w) {
    return {
      name: w.name, spec: w.spec, image: w.image, width: w.width, height: w.height,
      terminals: w.terminals, terminalPlacementQueue: w.queue, terminalPlacementQueueVersion: w.queueVersion,
      link: w.link, linkKr: w.linkKr, linkPref: w.linkPref, price: w.price, priceKr: w.priceKr, datasheets: w.datasheets,
      role: w.role, volt: w.volt, current: w.current, power: w.power
    };
  }

  // ── 일괄 등록으로 보내기 ──────────────────────────────────────────────
  function sendToBatch() {
    var ts = targets();
    if (!ts.length || !WE.adminBatch || !WE.adminBatch.addFromParts) return Promise.resolve(0);
    $("admColSend").disabled = true; $("admColSend").textContent = "보내는 중…";
    // 고른 부품들의 part_data 를 먼저 한 번에 읽는다 — 하나씩 읽으면 체크한 수만큼 요청이 나간다
    return loadPartData(ts.map(function (g) { return g.rep; })).then(function () {
      return Promise.all(ts.map(ensureWork));
    }).then(function (ws) {
      var n = WE.adminBatch.addFromParts(ws.map(toPart));
      checked = {}; renderSendButton();
      WE.adminBatch.setMode("batch");
      return n;
    }).catch(function () { renderSendButton(); return 0; });
  }

  // ── 숨기기 / 복원 (2026-09-15) — 표에 직접 쓰지 않고 RPC collect_hide 하나로. 관리자인지는 함수 안에서 다시 본다 ──
  /* 대상 묶음의 **구성원 전부**를 서버에서 받아(1,000개씩 끝까지 — 설계 §11 2-6) 기기별로 모아 기기마다 한 번씩 부른다.
     구성원은 목록과 같은 거름(사람·공용·숨김)을 따른다 — 목록에서 안 보이는 행까지 숨기지 않게. 끝나면 서버와 같게 다시 읽는다. */
  function memberRowsOf(ts) {
    var keys = ts.map(function (g) { return g.key; }), out = [];
    function page(after) {
      return rpc("collect_members", { p_keys: keys, p_grouped: grouped(), p_person: userFilter || null, p_with_public: withPublic(),
                                      p_with_hidden: showHidden(), p_after: after, p_limit: 1000 }).then(function (d) {
        var rows = (d && d.rows) || []; out = out.concat(rows);
        if (d && d.more && rows.length) return page({ device_id: rows[rows.length - 1].device_id, part_id: rows[rows.length - 1].part_id });
        return out;
      });
    }
    return page(null);
  }
  function hideParts(ts, hide) {
    var c = client(); if (!c || !c.rpc || !ts.length) return Promise.resolve(0);
    var b = $("admColHide"); if (b) { b.disabled = true; b.textContent = hide ? "숨기는 중…" : "복원 중…"; }
    return memberRowsOf(ts).then(function (rows) {
      var byDev = {};
      rows.forEach(function (m) { (byDev[m.device_id] = byDev[m.device_id] || []).push(m.part_id); });
      return Promise.all(Object.keys(byDev).map(function (dev) {
        return rpc("collect_hide", { p_device: dev, p_parts: byDev[dev], p_hide: hide }).then(function (n) { return Number(n) || 0; });
      }));
    }).then(function (ns) {
      checked = {};
      if (hide && !showHidden()) selectedKey = null;          // 숨긴 것은 목록에서 사라지므로 선택도 푼다
      ts.forEach(function (g) { delete work[g.key]; });
      return refreshAll().then(function () { return ns.reduce(function (a, n) { return a + n; }, 0); });
    }).catch(function (e) {
      alert((hide ? "숨기지" : "복원하지") + " 못했습니다: " + msgOf(e));
      renderSendButton();
      return 0;
    });
  }
  function toggleHideTargets() {
    var ts = targets(); if (!ts.length) return Promise.resolve(0);
    var allHidden = ts.every(function (g) { return g.hidden; });
    return hideParts(ts, !allHidden);
  }
  /* 사람(기기 여럿일 수 있음): p_parts 를 null 로 주면 collect_devices.hidden_at 이 바뀐다. 부품 행은 그대로 —
     그래서 복원하면 개별로 숨긴 것만 남는다. 숨김은 기기마다 적힌다 → 그 사람의 기기마다 한 번씩. */
  function hidePerson(key, hide) {
    var p = personEntry(key), ids = (p && p.device_ids) || [];
    if (!client() || !ids.length) return Promise.resolve(0);
    setDevActs(key, true);
    return Promise.all(ids.map(function (id) {
      return rpc("collect_hide", { p_device: id, p_parts: null, p_hide: hide }).then(function (n) { return Number(n) || 0; });
    })).then(function (ns) {
      checked = {}; selectedKey = null;
      return refreshAll().then(function () { return ns.reduce(function (a, n) { return a + n; }, 0); });
    }).catch(function (e) {
      alert("기기를 " + (hide ? "숨기지" : "복원하지") + " 못했습니다: " + msgOf(e));
      return refreshAll().then(function () { return 0; });
    });
  }
  // 고른 사람 항목의 [숨기기][삭제] 를 잠깐 잠근다(서버 왕복 중 두 번 누르지 않게)
  function setDevActs(key, busy) {
    var el = document.querySelector('#admColUsers .adm-col-user[data-user="' + CSS.escape(key) + '"]'); if (!el) return;
    el.querySelectorAll(".adm-col-user-acts button").forEach(function (b) { b.disabled = busy; });
  }

  // ── 삭제 (2026-09-15) — 시험 기기용. 서버에서 완전히 지운다 ──────────────────────────────
  /* 순서: confirm → 기기마다 ① Storage 의 이미지(user-libraries/{기기}/…)를 관리자 토큰으로 지운다(SQL 로 storage.objects 를 지우면
     실제 파일이 남는다) → ② RPC collect_delete_device — collect_devices 행 삭제, collect_parts 는 cascade.
     ①이 실패하면 그 기기는 아무것도 안 지우고 알린다. ②가 실패하면 이미지는 이미 없어진 상태라 "행이 남았다" 고 알린다.
     ⚠ 되살아남: 그 브라우저가 에디터를 다시 열면 기기 행이 새로 생긴다 — 그래서 다시 안 올 시험 기기용(confirm 문구).
     사람 단위(2026-10-02): 그 사람의 기기를 **차례로** 지운다. 중간에 실패하면 멈추고 앞에서 지운 기기 수를 함께 알린다. */
  function deletePerson(key) {
    var p = personEntry(key), ids = (p && p.device_ids) || [], c = client();
    if (!c || !c.rpc || !c.storage || !ids.length) return Promise.resolve(false);
    var label = personLabel(p) + (ids.length > 1 ? " (기기 " + ids.length + "대)" : "");
    if (!confirm("'" + label + "' 와 부품 " + (p.n_all || 0) + "개를 서버에서 완전히 지웁니다.\n통계에서도 사라지며 되돌릴 수 없습니다.\n\n시험 기기에만 쓰세요 — 실제 사용자 기기는 「숨기기」를 쓰면 통계가 남습니다.")) return Promise.resolve(false);
    setDevActs(key, true);
    var 지운수 = 0;
    return ids.reduce(function (pr, id) {
      return pr.then(function () { return 기기지우기(c, id).then(function () { 지운수++; }); });
    }, Promise.resolve()).then(function () {
      if (userFilter === key) userFilter = "";
      checked = {}; selectedKey = null;
      return refreshAll().then(function () { return true; });
    }).catch(function (e) {
      var msg = msgOf(e), 앞 = 지운수 ? "기기 " + 지운수 + "대는 지웠습니다. " : "";
      alert(앞 + (e && e.이미지지움 != null ? "이미지 " + e.이미지지움 + "개는 지웠지만 기기 행은 지우지 못했습니다: " + msg + "\n다시 「삭제」를 누르면 행만 다시 지웁니다."
                                             : "기기를 지우지 못했습니다(이 기기는 아무것도 안 지웠습니다): " + msg));
      if (지운수) return refreshAll().then(function () { return false; });
      setDevActs(key, false);
      return false;
    });
  }
  function 기기지우기(c, deviceId) {
    var store = c.storage.from(BUCKET), 폴더 = deviceId;
    // ① 이미지 — 폴더를 훑어 있는 것 전부(행에 없는 옛 파일까지). list 는 한 번에 최대 1000개, 기기 하나 라이브러리엔 충분하다
    return store.list(폴더, { limit: 1000 }).then(function (res) {
      if (res && res.error) throw res.error;
      var names = ((res && res.data) || []).map(function (o) { return o && o.name; }).filter(Boolean).map(function (n) { return 폴더 + "/" + n; });
      if (!names.length) return 0;
      return store.remove(names).then(function (r) { if (r && r.error) throw r.error; return names.length; });
    }).then(function (imgN) {
      // ② 행
      return c.rpc("collect_delete_device", { p_device: deviceId }).then(function (res) {
        if (res && res.error) throw Object.assign(new Error(res.error.message || "삭제 실패"), { 이미지지움: imgN });
        Object.keys(urlCache).forEach(function (p) { if (p.indexOf(폴더 + "/") === 0) delete urlCache[p]; });
        Object.keys(failed).forEach(function (p) { if (p.indexOf(폴더 + "/") === 0) delete failed[p]; });
      });
    });
  }

  // ── 에디터에 배치 — 작업본을 우편함(localStorage)에 넣고 에디터를 연다 ──
  function placeInEditor() {
    var g = current(); if (!g) return Promise.resolve(false);
    return loadMembers(g).then(function () { return ensureWork(g); }).then(function (w) {
      var part = toPart(w); part.defaultWidth = w.width; part.defaultHeight = w.height;
      try { localStorage.setItem(INBOX_KEY, JSON.stringify({ at: Date.now(), parts: [part] })); }
      catch (e) { alert("이미지가 커서 넘기지 못했습니다. 먼저 이미지 편집에서 줄여 주세요."); return false; }
      window.open("app.html", "_blank");
      return true;
    }).catch(function (e) { alert("부품 정보를 읽지 못했습니다: " + msgOf(e)); return false; });
  }

  // ── 통계 내보내기 — "어떤 부품을 많이 쓰나" 를 엑셀·CSV 로 (2026-09-15 고원빈: 스토어·어필리에이트 판단용) ──
  /* 표 ① 부품별: 이름+스펙(서버 ident)으로 묶어 기기 수·로그인 사용자 수·등록 수·링크·단가·최근 시각.
     표 ② 원본: 행 하나가 기기 하나의 부품 하나(누가 무엇을 언제). 엑셀은 두 표를 시트 둘로, CSV 는 ①만(원본은 안 받는다).
     공용 출처 부품은 「공용 출처 포함」이 켜져 있을 때만 들어간다. 숨긴 것은 **들어간다**(원본 표에 「숨김」 칸).
     서버에서 1,000개씩 끝까지 받는다(keyset) · 시작 시각 이전에 처음 들어온 행만(중간에 들어온 행 때문에 중복·누락 없게). */
  var AGG_HEAD = ["이름", "스펙", "기기 수", "로그인 사용자 수", "등록 수", "국내 링크", "해외 링크", "국내 단가", "해외 단가", "최근 등록"];
  var RAW_HEAD = ["이메일", "기기 ID", "부품 ID", "이름", "스펙", "단자 수", "국내 링크", "해외 링크", "국내 단가", "해외 단가", "공용 출처", "등록 시각", "숨김"];
  function statsTables(withRaw) {
    var snap = new Date().toISOString(), aggs = [], raws = [];
    function pageAgg(after) {
      return rpc("collect_export_agg", { p_snapshot: snap, p_with_public: withPublic(), p_after: after, p_limit: 1000 }).then(function (d) {
        var rows = (d && d.rows) || []; aggs = aggs.concat(rows);
        return d && d.more && rows.length ? pageAgg({ ident: rows[rows.length - 1].ident }) : null;
      });
    }
    function pageRaw(after) {
      return rpc("collect_export", { p_snapshot: snap, p_with_public: withPublic(), p_after: after, p_limit: 1000 }).then(function (d) {
        var rows = (d && d.rows) || []; raws = raws.concat(rows);
        return d && d.more && rows.length ? pageRaw({ device_id: rows[rows.length - 1].device_id, part_id: rows[rows.length - 1].part_id }) : null;
      });
    }
    return Promise.all([pageAgg(null), withRaw ? pageRaw(null) : null]).then(function () {
      var agg = aggs.map(function (a) { return [a.name || "", a.spec || "", a.devices || 0, a.users || 0, a.n || 0, a.link_kr || "", a.link || "", a.price_kr || "", a.price || "", a.latest || ""]; });
      agg.sort(function (a, b) { return b[2] - a[2] || b[4] - a[4] || String(a[0]).localeCompare(String(b[0]), "ko"); });
      var raw = raws.map(function (r) {
        return [r.user_email || "", r.device_id, r.part_id, r.name || "", r.spec || "", r.terminal_count || 0, r.link_kr || "", r.link || "", r.price_kr || "", r.price || "", r.public_id || "", r.updated_at, r.is_hidden ? "숨김" : ""];
      });
      return { agg: { head: AGG_HEAD, rows: agg }, raw: { head: RAW_HEAD, rows: raw } };
    });
  }
  // CSV 칸 — app.js 의 csvCell 과 같은 규칙(+ - = @ 로 시작하면 앞에 공백: 엑셀이 수식으로 오해하지 않게)
  function csvCell(v) {
    if (typeof v === "number") return String(v);
    v = (v == null ? "" : String(v));
    if (/^[=+\-@\t\r]/.test(v)) v = " " + v;
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function exportStats(kind) {
    var xlsx = kind === "xlsx" && WE.xlsx;
    return statsTables(!!xlsx).then(function (t) { writeStats(xlsx ? "xlsx" : "csv", t); },
      function (e) { alert("통계를 만들지 못했습니다: " + msgOf(e)); });
  }
  function writeStats(kind, t) {
    var stamp = new Date().toISOString().slice(0, 10);
    if (kind === "xlsx") {
      WE.xlsx.download("사용자부품_통계_" + stamp + ".xlsx", [
        { name: "부품별", headRows: 1, rows: [t.agg.head].concat(t.agg.rows) },
        { name: "원본", headRows: 1, rows: [t.raw.head].concat(t.raw.rows) }
      ]);
      return;
    }
    var lines = [t.agg.head.map(csvCell).join(",")];
    t.agg.rows.forEach(function (r) { lines.push(r.map(csvCell).join(",")); });
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = "사용자부품_통계_" + stamp + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ── 실시간 ──────────────────────────────────────────────────────────
  // 새로 온 행은 「▲ 새 부품 N개」 로만 알린다(목록이 튀지 않게). 숨긴 행·기기째 숨긴 기기가 보내는 것·지운 것은 안 센다
  function 새부품인가(r) { return !!r && !r.deleted_at && !r.hidden_at && !hiddenDevices[r.device_id]; }
  function subscribe() {
    var c = client(); if (!c || !c.channel || channel) return;
    try {
      channel = c.channel("collect_parts_admin")
        .on("postgres_changes", { event: "*", schema: "public", table: "collect_parts" }, function (payload) {
          var r = payload && payload.new; if (!새부품인가(r)) return;
          pending.push(r); renderNew();
        }).subscribe();
    } catch (e) { channel = null; }
  }
  // 누르면 처음부터 다시 읽는다 — 새 줄이 어디에 끼는지는 서버 정렬이 정한다
  function applyPending() { pending = []; renderNew(); return load(); }

  // ── 진입·이벤트 ──────────────────────────────────────────────────────
  function enter() {
    if (!$("admCollect")) return;
    load().then(function () { subscribe(); if (!entered) { entered = true; renderDetail(); } });
  }

  // ── 줄 고르기 · 보낸 사람 바꾸기 ─────────────────────────────────────
  function indexOfKey(key) { for (var i = 0; i < groups.length; i++) if (groups[i].key === key) return i; return -1; }
  /* 목록 전체를 다시 그리지 않고 표시만 옮긴다(↑↓ 로 빠르게 넘길 때 무겁지 않게).
     상세(= 그 부품 그림 1장)는 클릭이면 바로, 키보드면 200ms 조용해진 뒤 **마지막 것만**. */
  function select(key, viaKey) {
    selectedKey = key;
    var i = indexOfKey(key);
    if (i >= drawn) { shown = drawn; while (shown <= i) shown += MORE; appendRange(drawn, Math.min(shown, groups.length)); }
    var box = $("admColList");
    Array.prototype.forEach.call(box.querySelectorAll(".lib-item.on"), function (el) { el.classList.remove("on"); });
    var el = box.querySelector('.lib-item[data-key="' + CSS.escape(key) + '"]');
    if (el) { el.classList.add("on"); if (viaKey && el.scrollIntoView) el.scrollIntoView({ block: "nearest" }); }
    renderSendButton();
    if (detailTimer) { clearTimeout(detailTimer); detailTimer = null; }
    if (!viaKey) { renderDetail(); return; }
    $("admColDetail").innerHTML = '<div class="adm-col-empty">불러오는 중…</div>';
    detailTimer = setTimeout(function () { detailTimer = null; renderDetail(); }, 200);
  }
  // 상세 「보낸 사람」 에서 다른 사람을 고르면 그 사람이 올린 그림·단자로 바꿔 보여 준다. 고친 작업본이 있으면 먼저 묻는다
  function switchMember(mk) {
    var g = current(); if (!g || rowKey(g.rep) === mk) return;
    var w = work[g.key];
    if (w && w.dirty && !confirm("고친 작업본이 사라집니다. 이 사람이 올린 것으로 바꿀까요?")) return;
    var m = (g.memberRows || []).filter(function (x) { return rowKey(x) === mk; })[0]; if (!m) return;
    delete work[g.key]; pick[g.key] = mk; g.rep = m;
    render(); renderDetail();
  }
  // 거르기 바뀜 — 사람 목록 개수도 거름을 따르므로 같이(공용·숨김일 때만)
  function onFilterChange(withPeople) {
    if (!withPeople) return reloadGroups();
    return Promise.all([reloadGroups(), loadPeople(true).then(renderUsers)]).then(function () { renderStats(); })
      .catch(function (e) { console.warn("[사용자 부품] 사람 목록 읽기 실패:", msgOf(e)); });
  }
  function pickUser(id) {
    userFilter = id; selectedKey = null; checked = {}; renderUsers(); renderDetail();
    return reloadGroups();
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!$("admCollect")) return;
    // 검색은 글자마다 묻지 않고 0.4초 조용해지면(머리말 ⑥ — 요청 수 = 로그)
    $("admColSearch").addEventListener("input", function () {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { searchTimer = null; reloadGroups(); }, 400);
    });
    $("admColSort").addEventListener("change", function () { onFilterChange(false); });
    $("admColGroup").addEventListener("change", function () { onFilterChange(false); });
    $("admColPublic").addEventListener("change", function () { onFilterChange(true); });
    $("admColHidden").addEventListener("change", function () { onFilterChange(true); });
    $("admColCsv").addEventListener("click", function () { exportStats("csv"); });
    $("admColXlsx").addEventListener("click", function () { exportStats("xlsx"); });
    $("admColRefresh").addEventListener("click", function () { urlCache = {}; failed = {}; load(); });
    // 「더 보기」 — admin.html 이 옛것(캐시)이라 없을 수 있다. 없으면 처음 30줄만 보이고 오류는 안 낸다
    if ($("admColMore")) $("admColMore").addEventListener("click", showMore);
    // 「그림 보기」(기본 꺼짐) — 켜면 처음 30줄부터 그림을 붙인다(한 번에 최대 30장). 끄면 펼친 줄은 그대로 두고 그림만 뗀다
    if ($("admColThumbs")) $("admColThumbs").addEventListener("change", function () { if (showThumbs()) 처음부터(); render(); });
    $("admColNew").addEventListener("click", applyPending);
    $("admColSend").addEventListener("click", sendToBatch);
    $("admColHide").addEventListener("click", toggleHideTargets);
    $("admColUsers").addEventListener("click", function (e) {
      if (e.target.closest("[data-users-more]")) { loadPeople(false).then(renderUsers); return; }
      // 항목 안의 [숨기기][복원][삭제] — 항목 클릭(사람 고르기)으로 번지지 않게 먼저 받는다. 그 사람의 기기 전부에 적용
      var a = e.target.closest("[data-devact]");
      if (a) {
        var id = a.closest("[data-user]").dataset.user;
        if (a.dataset.devact === "delete") deletePerson(id); else hidePerson(id, a.dataset.devact === "hide");
        return;
      }
      var b = e.target.closest("[data-user]"); if (!b) return;
      pickUser(b.dataset.user);
    });
    // 항목이 <div role=button> 이라 Enter/Space 를 직접 받는다(<button> 이었을 때와 같게)
    $("admColUsers").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var b = e.target.closest("[data-user]"); if (!b || e.target.closest("[data-devact]")) return;
      e.preventDefault(); pickUser(b.dataset.user);
    });
    $("admColList").addEventListener("click", function (e) {
      var cb = e.target.closest("input[data-check]");
      if (cb) { checked[cb.dataset.check] = cb.checked; renderSendButton(); return; }
      var item = e.target.closest(".lib-item"); if (!item) return;
      select(item.dataset.key, false);
      // 목록에 초점을 줘서 바로 ↑↓ 로 넘길 수 있게(목록 칸 #admColList 는 tabindex=0)
      try { $("admColList").focus({ preventScroll: true }); } catch (err) { /* 옛 브라우저 */ }
    });
    // ↑↓ — 고른 줄을 옮기고 상세에 그 부품 그림 1장. 끝 줄 너머면 더 그리고, 받아 둔 게 떨어지면 다음 100줄을 받아 이어 간다
    $("admColList").addEventListener("keydown", function (e) {
      if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || !groups.length) return;
      e.preventDefault();
      var i = indexOfKey(selectedKey);
      var n = i < 0 ? 0 : i + (e.key === "ArrowDown" ? 1 : -1);
      if (n >= groups.length && groupsMore && !groupsLoading) {
        var ver = listVersion;
        groupsLoading = loadGroups(false).then(function () { groupsLoading = null; if (ver === listVersion && n < groups.length) select(groups[n].key, true); },
                                               function () { groupsLoading = null; });
        return;
      }
      n = Math.max(0, Math.min(groups.length - 1, n));
      if (groups[n].key !== selectedKey) select(groups[n].key, true);
    });
    $("admColDetail").addEventListener("input", onDetailInput);
    $("admColDetail").addEventListener("change", onDetailInput);
    $("admColDetail").addEventListener("click", function (e) {
      var mb = e.target.closest("[data-member]"); if (mb) { switchMember(mb.dataset.member); return; }
      var b = e.target.closest("[data-act]"); if (!b) return;
      if (b.dataset.act === "image") editImage();
      else if (b.dataset.act === "terminals") editTerminals();
      else if (b.dataset.act === "reset") resetWork();
      else if (b.dataset.act === "batch") { checked = {}; sendToBatch(); }
      else if (b.dataset.act === "place") placeInEditor();
      else if (b.dataset.act === "hide" || b.dataset.act === "unhide") { var g = current(); if (g) hideParts([g], b.dataset.act === "hide"); }
    });
    renderDetail();
  });

  return {
    enter: enter,
    // 검사용 — 서버는 검사가 가짜로 바꿔 끼운다(tests/fixtures/admincollect_fake.js). 다시 읽기는 load 그대로
    // 새 행을 심었을 때 — 예전 _테스트_심기 처럼 작업본·고른 것·체크를 비우고 다시 읽는다(앞 검사 단계의 작업본이 섞이지 않게)
    _테스트_다시읽기: function () { work = {}; pick = {}; checked = {}; selectedKey = null; return load(); },
    _테스트_묶음: function () { return groups.map(function (g) { return { key: g.key, name: g.rep.name, devices: g.devices, members: g.memberCount, rep: rowKey(g.rep), first: g.first }; }); },
    // 사람 고르기 — 기기 id 를 주면 그 기기의 사람(로그인 계정이면 계정 전체)으로 바꿔 고른다
    _테스트_사용자: function (id) { return pickUser(!id ? "" : personOfDevice(id)); },
    _테스트_사람: personOfDevice,
    _테스트_고르기: function (key) { selectedKey = key; render(); return renderDetail(); },
    _테스트_작업본: function (key) { return work[key] ? JSON.parse(JSON.stringify(work[key])) : null; },
    _테스트_단자저장: function (cmp) { WE.app.afterTerminalEdit(cmp); },
    _테스트_편집중키: function () { return editingKey; },
    _테스트_편집기id: editorId,
    _테스트_체크: function (key, on) { checked[key] = !!on; renderSendButton(); },
    _테스트_보내기: sendToBatch,
    _테스트_배치: placeInEditor,
    _테스트_실시간: function (row) { if (!새부품인가(row)) return; pending.push(row); renderNew(); },   // 구독 콜백과 같은 거름
    _테스트_통계준비: function () { return statsTables(true); },   // 내보내기와 같은 길 — 서버에서 끝까지 받아 표를 만든다(파일은 안 받는다)
    _테스트_새부품적용: applyPending,
    _테스트_숨기기: toggleHideTargets,                 // 체크한(없으면 고른) 부품을 숨기거나 복원 — 서버는 가짜
    // 기기 id 를 주면 그 기기의 사람 단위로(계정이면 그 계정의 기기 전부) — 왼쪽 목록 단추와 같은 길
    _테스트_기기숨기기: function (id, hide) { return hidePerson(personOfDevice(id), hide); },
    _테스트_기기삭제: function (id) { return deletePerson(personOfDevice(id)); },   // confirm 은 검사가 window.confirm 을 바꿔 끼운다
    INBOX_KEY: INBOX_KEY
  };
})();

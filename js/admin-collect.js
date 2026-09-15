/* admin-collect.js — 관리자 페이지 「사용자 부품」 탭 (2026-09-14 · 09-15 2차)

   무엇 — 에디터가 자동으로 보내온 사용자 라이브러리 부품(collect_parts · Storage user-libraries)을 본다.
     왼쪽  : **사용자(기기) 목록** — "몇 명이 어떤 부품을 쓰나" 는 사람 단위로 봐야 보인다(고원빈, 09-15).
              「전체」를 고르면 내용이 완전히 같은 부품끼리 묶어 기기 수를 센다.
     가운데: 에디터 라이브러리 창과 같은 줄(.lib-item — 썸네일·이름·스펙) + 기기 수 배지.
     오른쪽: 고른 부품의 **작업본** — 우리 부품을 등록할 때처럼 **이미지 편집(배경 제거)·부품 정보 편집·단자 편집**을
              여기서 바로 하고, [일괄 등록으로 보내기](게시) 또는 [에디터에 배치](내 화면)로 넘긴다.
              작업본은 화면 안에서만 바뀐다 — 사용자가 보낸 원본 행은 읽기 전용(RLS)이라 건드릴 수 없다.
   같은 부품 — rev(내용 해시)가 같은 것만. 내용이 하나라도 다르면 다른 부품(고원빈, 09-14).
   공용 출처 — publicId 가 있는 부품은 우리 카탈로그에서 가져온 것 → 기본 숨김(참고 대상이 아니다).
   새 부품   — Supabase Realtime 으로 "▲ 새 부품 N개" 로 붙는다(목록이 튀지 않게, 누르면 펼침).
   읽기      — 관리자만(RLS). 이미지는 비공개 버킷이라 서명 URL(1시간)로 본다.
   에디터에 배치 — 관리자 페이지에는 캔버스가 없다. 작업본을 localStorage(we_admin_inbox)에 넣고 app.html 을 열면
              에디터가 시작할 때 라이브러리에 넣고 캔버스에 놓는다(js/app.js applyAdminInbox). 같은 브라우저에서만 된다.
   숨기기(09-15 3차) — 볼 필요 없는 부품·기기를 목록에서 치운다. **행을 지우지 않고 hidden_at 만 찍는다**(RPC collect_hide).
              지우면 되살아난다: 에디터(libsync.js)는 "마지막에 보낸 rev" 를 기억해 두고 바뀐 것만 보내므로, 서버에서 지운 뒤
              그 사람이 그 부품을 고치거나 브라우저를 초기화하면 다시 온다. hidden_at 은 함수가 안 건드려 다시 와도 계속 숨김.
              기기 숨김(collect_devices.hidden_at)은 그 기기의 부품 전부 + **앞으로 올 것**까지 목록에서 뺀다(시험 기기용).
              통계(CSV·엑셀·순위·머리 숫자)는 숨긴 것도 **포함**(고원빈: 1년 모아 통계). 「숨긴 것 보기」로 다시 보고 복원.
              이 파일에서 표에 직접 쓰는 코드는 여전히 없다 — 쓰기는 RPC 하나뿐(verify_admincollect 가 본다).
   ⚠ 이 파일은 에디터에 실리지 않는다(관리자 페이지만). 수집하는 쪽은 js/libsync.js. */
var WE = window.WE || {};
window.WE = WE;

WE.adminCollect = (function () {
  "use strict";
  var BUCKET = "user-libraries", PAGE = 1000, INBOX_KEY = "we_admin_inbox";
  var rows = [];            // collect_parts 행(삭제 안 된 것 — 숨긴 것은 들어 있다, hidden_at 으로 가른다)
  var devices = {};         // device_id → { user_email, last_sync_at, parts_count, hidden_at }
  var groups = [];          // 가운데 목록 항목 — 전체 보기: rev 마다 하나 / 사용자 보기: 행마다 하나
  var userFilter = "";      // "" = 전체, 아니면 device_id
  var selectedKey = null, checked = {}, pending = [], channel = null, entered = false;
  var urlCache = {};        // image_path → 서명 URL
  var work = {};            // key → 작업본 { name, spec, image(data:), width, height, terminals, queue, queueVersion, link, linkKr, linkPref, price, priceKr, datasheets, role, volt, current, power }
  var editingKey = null;    // 단자 편집기가 열려 있는 작업본

  var $ = function (id) { return document.getElementById(id); };
  function client() { return WE.auth && WE.auth._client ? WE.auth._client() : null; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ago(iso) {
    if (!iso) return "";
    var d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 60) return "방금"; if (d < 3600) return Math.floor(d / 60) + "분 전"; if (d < 86400) return Math.floor(d / 3600) + "시간 전";
    return Math.floor(d / 86400) + "일 전";
  }
  function who(deviceId) { var d = devices[deviceId] || {}; return d.user_email || ("기기 " + String(deviceId).slice(0, 8)); }
  // 숨긴 행인가 — 부품 자체를 숨겼거나, 그 기기를 통째로 숨겼거나. 목록·왼쪽 개수는 이걸로 거르고 통계는 안 거른다.
  function devHidden(deviceId) { var d = devices[deviceId]; return !!(d && d.hidden_at); }
  function isHidden(r) { return !!(r.hidden_at || devHidden(r.device_id)); }
  function showHidden() { var el = $("admColHidden"); return !!(el && el.checked); }
  // 목록에 보이는 행인가 — 「숨긴 것 보기」가 꺼져 있으면 숨긴 것은 없는 셈
  function visible(r) { return showHidden() || !isHidden(r); }

  // ── 읽기 ────────────────────────────────────────────────────────────
  function load() {
    var c = client(); if (!c) return Promise.resolve(false);
    $("admColStats").textContent = "읽는 중…";
    return Promise.all([
      c.from("collect_parts").select("device_id,part_id,rev,part_data,name,spec,has_image,image_path,terminal_count,public_id,updated_at,hidden_at")
        .is("deleted_at", null).order("updated_at", { ascending: false }).limit(PAGE),
      c.from("collect_devices").select("device_id,user_email,last_sync_at,parts_count,hidden_at")
    ]).then(function (res) {
      if (res[0].error) throw res[0].error;
      rows = res[0].data || [];
      devices = {};
      ((res[1] && res[1].data) || []).forEach(function (d) { devices[d.device_id] = d; });
      rows.forEach(function (r) { if (!devices[r.device_id]) devices[r.device_id] = { device_id: r.device_id }; });
      pending = []; renderNew();
      renderUsers(); build(); render(); renderRank(); renderStats();
      return true;
    }).catch(function (e) {
      $("admColStats").textContent = "읽지 못했습니다: " + ((e && e.message) || e);
      return false;
    });
  }

  // ── 왼쪽: 사용자(기기) 목록 ──────────────────────────────────────────
  /* ⚠ 개수는 **가운데에 보이는 기준**으로 센다. 「공용 출처 포함」이 꺼져 있으면(기본) 공용 부품에서 가져온 것은
     목록에 안 나오는데, 예전엔 여기서 전부 세어 "47개" 인데 목록엔 20개도 안 보이는 일이 있었다(2026-09-15 고원빈).
     숨긴 공용 수는 옆에 "(공용 N)" 으로 적어 어디로 갔는지 보이게 한다. */
  function renderUsers() {
    var box = $("admColUsers"); if (!box) return;
    var withPublic = $("admColPublic").checked, withHidden = showHidden();
    var counts = {}, pubs = {}, latest = {}, total = 0, totalPub = 0;
    rows.forEach(function (r) {
      if (!latest[r.device_id] || r.updated_at > latest[r.device_id]) latest[r.device_id] = r.updated_at;
      if (!visible(r)) return;                                  // 숨긴 것은 개수에서도 뺀다 (보이는 기준으로 센다는 원칙)
      if (r.public_id) { pubs[r.device_id] = (pubs[r.device_id] || 0) + 1; totalPub++; if (!withPublic) return; }
      counts[r.device_id] = (counts[r.device_id] || 0) + 1; total++;
    });
    // 기기째 숨긴 것은 「숨긴 것 보기」가 켜졌을 때만 목록에 나온다. 단, 지금 고른 기기라면 남긴다(복원 단추를 눌러야 하니까)
    var ids = Object.keys(devices).filter(function (id) { return withHidden || !devHidden(id) || id === userFilter; })
      .sort(function (a, b) { return (latest[b] || "") < (latest[a] || "") ? -1 : 1; });
    function 개수(n, pub) { return n + "개" + (pub && !withPublic ? " <i>(공용 " + pub + ")</i>" : ""); }
    var html = '<button type="button" class="adm-col-user' + (userFilter === "" ? " on" : "") + '" data-user=""><b>전체</b><span>' + ids.length + "명 · " + 개수(total, totalPub) + "</span></button>";
    ids.forEach(function (id) {
      var d = devices[id] || {};
      html += '<button type="button" class="adm-col-user' + (userFilter === id ? " on" : "") + (d.hidden_at ? " is-hidden" : "") + '" data-user="' + esc(id) + '" title="' + esc(id) + '">' +
        "<b>" + esc(d.user_email || "기기 " + id.slice(0, 8)) + (d.hidden_at ? ' <em class="adm-col-hidden-tag">숨김</em>' : "") + "</b>" +
        "<span>" + 개수(counts[id] || 0, pubs[id] || 0) + " · " + esc(ago(latest[id] || d.last_sync_at)) + (d.user_email ? "" : " · 로그인 안 함") + "</span></button>";
    });
    box.innerHTML = html;
    renderHideDevButton();
  }
  // 「이 기기 숨기기 / 복원」 — 왼쪽에서 기기를 골랐을 때만 보인다
  function renderHideDevButton() {
    var b = $("admColHideDev"); if (!b) return;
    b.hidden = !userFilter;
    if (userFilter) b.textContent = devHidden(userFilter) ? "이 기기 복원" : "이 기기 숨기기";
  }

  // ── 가운데: 묶기 ──────────────────────────────────────────────────────
  function build() {
    var q = ($("admColSearch").value || "").trim().toLowerCase();
    var group = userFilter === "" && $("admColGroup").checked, withPublic = $("admColPublic").checked;
    var map = {}, list = [];
    rows.forEach(function (r) {
      if (userFilter && r.device_id !== userFilter) return;
      if (!visible(r)) return;                              // 숨긴 것 — 「숨긴 것 보기」가 꺼져 있으면 묶기 전에 뺀다(기기 수도 안 센다)
      if (!withPublic && r.public_id) return;
      if (q && (String(r.name || "") + " " + String(r.spec || "")).toLowerCase().indexOf(q) < 0) return;
      var key = group ? r.rev : (r.device_id + "|" + r.part_id);
      var g = map[key];
      if (!g) { g = map[key] = { key: key, rep: r, members: [], deviceSet: {}, latest: r.updated_at }; list.push(g); }
      g.members.push(r); g.deviceSet[r.device_id] = 1;
      if (r.updated_at > g.latest) g.latest = r.updated_at;
      if (!g.rep.has_image && r.has_image) g.rep = r;     // 대표는 이미지 있는 쪽
    });
    // 묶음이 숨긴 것인가 — 구성원이 **전부** 숨긴 것일 때만. 한 기기라도 안 숨겼으면 보통 줄이다
    list.forEach(function (g) { g.devices = Object.keys(g.deviceSet).length; g.hidden = g.members.every(isHidden); });
    var sort = $("admColSort").value;
    list.sort(function (a, b) {
      if (sort === "devices") return b.devices - a.devices || (b.latest < a.latest ? -1 : 1);
      if (sort === "name") return String(a.rep.name).localeCompare(String(b.rep.name), "ko");
      return b.latest < a.latest ? -1 : 1;
    });
    groups = list;
    $("admColGroup").disabled = userFilter !== "";   // 한 사람 안에서는 묶을 게 없다
  }

  function thumbUrl(r) {
    if (!r.has_image || !r.image_path) return Promise.resolve(null);
    if (urlCache[r.image_path]) return Promise.resolve(urlCache[r.image_path]);
    var c = client(); if (!c) return Promise.resolve(null);
    return c.storage.from(BUCKET).createSignedUrl(r.image_path, 3600).then(function (res) {
      var u = res && res.data && res.data.signedUrl; if (u) urlCache[r.image_path] = u; return u || null;
    }).catch(function () { return null; });
  }
  function render() {
    var box = $("admColList"); box.innerHTML = "";
    $("admColEmpty").hidden = groups.length > 0;
    groups.forEach(function (g) {
      var r = g.rep, el = document.createElement("div"), w = work[g.key];
      el.className = "lib-item" + (g.key === selectedKey ? " on" : "") + (r.public_id ? " is-public" : "") + (g.hidden ? " is-hidden" : "");
      el.setAttribute("role", "listitem"); el.dataset.key = g.key;
      el.innerHTML =
        '<input type="checkbox" data-check="' + esc(g.key) + '"' + (checked[g.key] ? " checked" : "") + ' title="선택 — 일괄 등록으로 보내기 · 숨기기" />' +
        '<div class="lib-thumb-wrap"><img class="lib-thumb" alt="" /></div>' +
        '<div class="lib-info"><div class="lib-name">' + esc((w && w.name) || r.name || "(이름 없음)") + (w && w.dirty ? ' <em class="adm-col-edited">편집함</em>' : "") + (g.hidden ? ' <em class="adm-col-hidden-tag">숨김</em>' : "") + "</div>" +
          '<div class="lib-meta">' + esc((w && w.spec) || r.spec || "—") + "</div>" +
          '<div class="adm-col-meta">단자 ' + (r.terminal_count || 0) + " · " + esc(ago(g.latest)) + (userFilter ? "" : " · " + esc(who(r.device_id)) + (g.members.length > 1 ? " 외" : "")) + "</div></div>" +
        (userFilter ? "" : '<span class="adm-col-count' + (g.devices > 1 ? " many" : "") + '">' + g.devices + "기기</span>");
      box.appendChild(el);
      var src = w && w.image ? Promise.resolve(w.image) : thumbUrl(r);
      src.then(function (u) { var img = el.querySelector("img"); if (u && img) img.src = u; });
    });
    renderSendButton();
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
    // 숨기기 단추 — 대상이 전부 숨긴 것이면 「복원」, 아니면 「숨기기」. 섞여 있으면 숨기기(안 숨긴 것만 숨는 게 아니라 전부 숨긴다)
    var h = $("admColHide"); if (!h) return;
    var ts = targets(), allHidden = ts.length > 0 && ts.every(function (g) { return g.hidden; });
    h.disabled = ts.length === 0;
    h.textContent = (allHidden ? "복원" : "숨기기") + (n ? " (" + n + ")" : "");
  }
  function renderStats() {
    var devN = Object.keys(devices).length, linked = Object.keys(devices).filter(function (k) { return devices[k].user_email; }).length;
    var now = Date.now(), today = 0, week = 0, hid = 0;
    rows.forEach(function (r) { var d = now - new Date(r.updated_at).getTime(); if (d < 86400000) today++; if (d < 7 * 86400000) week++; if (isHidden(r)) hid++; });
    var pub = rows.filter(function (r) { return r.public_id; }).length;
    // 부품 수는 숨긴 것도 포함한 전체(통계 기준). 숨긴 게 있으면 몇 개인지 옆에 적는다 — 어디로 갔는지 보이게
    $("admColStats").textContent = "기기 " + devN + " (로그인 " + linked + ") · 부품 " + rows.length + (pub && !$("admColPublic").checked ? " (공용 출처 " + pub + " 숨김)" : "") + (hid ? " · 숨김 " + hid : "") + " · 오늘 +" + today + " · 7일 +" + week;
  }
  // 순위·통계는 숨긴 것도 센다 — 숨김은 "지금 볼 필요 없음" 이지 "없던 일" 이 아니다(고원빈: 1년 모아 통계)
  function renderRank() {
    var map = {};
    rows.forEach(function (r) {
      if (r.public_id) return;
      var k = (r.name || "") + " " + (r.spec || "");
      (map[k] = map[k] || { name: r.name, spec: r.spec, devs: {} }).devs[r.device_id] = 1;
    });
    var list = Object.keys(map).map(function (k) { var v = map[k]; return { name: v.name, spec: v.spec, n: Object.keys(v.devs).length }; });
    list.sort(function (a, b) { return b.n - a.n || String(a.name).localeCompare(String(b.name), "ko"); });
    $("admColRank").innerHTML = list.slice(0, 30).map(function (x) {
      return "<li><b>" + esc(x.name) + "</b>" + (x.spec ? " <span class='muted'>" + esc(x.spec) + "</span>" : "") + " — " + x.n + "기기</li>";
    }).join("");
  }
  function renderNew() {
    var b = $("admColNew"); b.hidden = pending.length === 0; b.querySelector("b").textContent = pending.length;
  }

  // ── 오른쪽: 작업본 ────────────────────────────────────────────────────
  /* 고른 부품의 작업본을 만든다(없으면). 이미지는 서명 URL 로 받아 data: 로 바꿔 둔다 — 편집기·배치 모두 data: 가 필요하다. */
  function ensureWork(g) {
    if (work[g.key]) return Promise.resolve(work[g.key]);
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
  function current() { return groups.filter(function (x) { return x.key === selectedKey; })[0] || null; }

  function renderDetail() {
    var box = $("admColDetail");
    var g = current();
    if (!g) { box.innerHTML = '<div class="adm-col-empty">가운데에서 부품을 고르면 여기서 이미지·정보·단자를 고쳐 게시하거나 에디터에 배치할 수 있습니다.</div>'; return; }
    box.innerHTML = '<div class="adm-col-empty">불러오는 중…</div>';
    ensureWork(g).then(function (w) {
      if (current() !== g) return;                      // 그 사이 다른 걸 골랐다
      var terms = w.terminals || [];
      var svg = terms.map(function (t) {
        var x = (Number(t.rx) || 0) * 100, y = (Number(t.ry) || 0) * 100;
        return '<circle cx="' + x + '%" cy="' + y + '%" r="5" fill="' + esc(t.color || "#1e88e5") + '" stroke="#fff" stroke-width="1.5"/>' +
               '<text x="' + x + '%" y="' + y + '%" dx="8" dy="4" font-size="11" fill="#111" stroke="#fff" stroke-width="3" paint-order="stroke">' + esc(t.name || "") + "</text>";
      }).join("");
      var sources = []; g.members.forEach(function (m) { var s = who(m.device_id) + " (" + ago(m.updated_at) + ")"; if (sources.indexOf(s) < 0) sources.push(s); });
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
          "<div class='adm-col-sources'>" + (w.width && w.height ? w.width + " × " + w.height + " · " : "") + g.devices + "기기: " + esc(sources.join(", ")) + (g.rep.public_id ? " · 공용 출처 " + esc(g.rep.public_id) : "") + "</div>" +
        "</div>" +
        '<p class="adm-col-note">여기서 고치는 것은 <b>작업본</b>입니다 — 사용자의 라이브러리와 서버에 모인 원본은 바뀌지 않습니다.</p>' +
        (g.hidden ? '<p class="adm-col-note"><em class="adm-col-hidden-tag">숨김</em> 목록에서 치운 부품입니다. 통계에는 남아 있습니다.' + (devHidden(g.rep.device_id) && !g.rep.hidden_at ? " (기기째 숨김 — 왼쪽 「이 기기 복원」으로 되돌립니다)" : "") + "</p>" : "") +
        '<div class="adm-col-actions">' +
          '<button type="button" class="adm-batch-publish-all" data-act="batch">일괄 등록으로 보내기</button>' +
          '<button type="button" class="adm-edit-btn" data-act="place" title="에디터를 열어 내 라이브러리에 넣고 캔버스에 놓습니다 (같은 브라우저)">에디터에 배치</button>' +
          // 부품 자체를 숨긴 것만 여기서 복원한다. 기기째 숨긴 건 부품 행이 안 바뀌어 여기서 복원해도 소용없다 → 단추를 안 그린다
          (devHidden(g.rep.device_id) && !g.rep.hidden_at ? "" :
            '<button type="button" class="adm-edit-btn" data-act="' + (g.hidden ? "unhide" : "hide") + '" title="행을 지우지 않고 목록에서만 치웁니다. 통계에는 남습니다">' + (g.hidden ? "복원" : "숨기기") + "</button>") +
        "</div>";
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
  function editTerminals() {
    var g = current(), w = g && work[g.key]; if (!w || !w.image || !WE.termeditor) return;
    editingKey = g.key;
    WE.termeditor.open({
      id: "collect_" + g.key, name: w.name || "부품", image: w.image, width: w.width || 160, height: w.height || 120,
      terminals: w.terminals.map(function (t) { var c = JSON.parse(JSON.stringify(t)); if (!c.id) c.id = WE.model.nextId("t"); return c; }),
      terminalPlacementQueue: JSON.parse(JSON.stringify(w.queue || [])), terminalPlacementQueueVersion: w.queueVersion
    });
  }
  var prevAfter = WE.app && WE.app.afterTerminalEdit;
  WE.app = WE.app || {};
  WE.app.afterTerminalEdit = function (cmp) {
    if (editingKey && cmp && cmp.id === "collect_" + editingKey) {
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
    return Promise.all(ts.map(ensureWork)).then(function (ws) {
      var n = WE.adminBatch.addFromParts(ws.map(toPart));
      checked = {}; renderSendButton();
      WE.adminBatch.setMode("batch");
      return n;
    }).catch(function () { renderSendButton(); return 0; });
  }

  // ── 숨기기 / 복원 (2026-09-15) — 표에 직접 쓰지 않고 RPC collect_hide 하나로. 관리자인지는 함수 안에서 다시 본다 ──
  /* 부품: 대상 묶음의 구성원(행)을 기기별로 모아 기기마다 한 번씩 부른다(「전체」보기의 묶음은 여러 기기 행을 품는다).
     성공하면 서버를 다시 읽지 않고 같은 행 객체의 hidden_at 만 바꿔 다시 그린다 — members 는 rows 의 객체를 그대로 가리킨다. */
  function refreshAll() { renderUsers(); build(); render(); renderRank(); renderStats(); renderDetail(); }
  function hideParts(ts, hide) {
    var c = client(); if (!c || !c.rpc || !ts.length) return Promise.resolve(0);
    var byDev = {};
    ts.forEach(function (g) { g.members.forEach(function (m) { (byDev[m.device_id] = byDev[m.device_id] || []).push(m.part_id); }); });
    var b = $("admColHide"); if (b) { b.disabled = true; b.textContent = hide ? "숨기는 중…" : "복원 중…"; }
    return Promise.all(Object.keys(byDev).map(function (dev) {
      return c.rpc("collect_hide", { p_device: dev, p_parts: byDev[dev], p_hide: hide }).then(function (res) {
        if (res && res.error) throw res.error;
        return Number(res && res.data) || 0;
      });
    })).then(function (ns) {
      var at = hide ? new Date().toISOString() : null;
      ts.forEach(function (g) { g.members.forEach(function (m) { m.hidden_at = at; }); });
      checked = {};
      if (hide && !showHidden()) selectedKey = null;          // 숨긴 것은 목록에서 사라지므로 선택도 푼다
      refreshAll();
      return ns.reduce(function (a, n) { return a + n; }, 0);
    }).catch(function (e) {
      alert((hide ? "숨기지" : "복원하지") + " 못했습니다: " + ((e && e.message) || e));
      renderSendButton();
      return 0;
    });
  }
  function toggleHideTargets() {
    var ts = targets(); if (!ts.length) return Promise.resolve(0);
    var allHidden = ts.every(function (g) { return g.hidden; });
    return hideParts(ts, !allHidden);
  }
  /* 기기: p_parts 를 null 로 주면 collect_devices.hidden_at 이 바뀐다. 부품 행은 그대로 — 그래서 복원하면 개별로 숨긴 것만 남는다. */
  function hideDevice(deviceId, hide) {
    var c = client(); if (!c || !c.rpc || !deviceId) return Promise.resolve(0);
    var b = $("admColHideDev"); if (b) b.disabled = true;
    return c.rpc("collect_hide", { p_device: deviceId, p_parts: null, p_hide: hide }).then(function (res) {
      if (res && res.error) throw res.error;
      (devices[deviceId] = devices[deviceId] || { device_id: deviceId }).hidden_at = hide ? new Date().toISOString() : null;
      checked = {}; selectedKey = null;
      refreshAll();
      return Number(res && res.data) || 0;
    }).catch(function (e) {
      alert("기기를 " + (hide ? "숨기지" : "복원하지") + " 못했습니다: " + ((e && e.message) || e));
      return 0;
    }).then(function (n) { if (b) b.disabled = false; return n; });
  }

  // ── 에디터에 배치 — 작업본을 우편함(localStorage)에 넣고 에디터를 연다 ──
  function placeInEditor() {
    var g = current(); if (!g) return Promise.resolve(false);
    return ensureWork(g).then(function (w) {
      var part = toPart(w); part.defaultWidth = w.width; part.defaultHeight = w.height;
      try { localStorage.setItem(INBOX_KEY, JSON.stringify({ at: Date.now(), parts: [part] })); }
      catch (e) { alert("이미지가 커서 넘기지 못했습니다. 먼저 이미지 편집에서 줄여 주세요."); return false; }
      window.open("app.html", "_blank");
      return true;
    });
  }

  // ── 통계 내보내기 — "어떤 부품을 많이 쓰나" 를 엑셀·CSV 로 (2026-09-15 고원빈: 스토어·어필리에이트 판단용) ──
  /* 표 ① 부품별: 이름+스펙으로 묶어 기기 수·로그인 사용자 수·등록 수·링크·단가·최근 시각.
     표 ② 원본: 행 하나가 기기 하나의 부품 하나(누가 무엇을 언제). 엑셀은 두 표를 시트 둘로, CSV 는 ①만.
     공용 출처 부품은 「공용 출처 포함」이 켜져 있을 때만 들어간다 — 우리 것은 통계 대상이 아니다.
     숨긴 것은 **들어간다**(「숨긴 것 보기」와 무관). 원본 표에 「숨김」 칸으로 표시만 한다. */
  function statsRows() {
    var withPublic = $("admColPublic").checked;
    var map = {}, raw = [];
    rows.forEach(function (r) {
      if (r.public_id && !withPublic) return;
      var p = r.part_data || {}, d = devices[r.device_id] || {};
      var k = (r.name || "") + "\u0000" + (r.spec || "");
      var g = map[k] = map[k] || { name: r.name || "", spec: r.spec || "", devs: {}, users: {}, n: 0, linkKr: "", link: "", priceKr: "", price: "", latest: "" };
      g.devs[r.device_id] = 1; if (d.user_email) g.users[d.user_email] = 1; g.n++;
      if (!g.linkKr && p.linkKr) g.linkKr = p.linkKr; if (!g.link && p.link) g.link = p.link;
      if (!g.priceKr && p.priceKr) g.priceKr = p.priceKr; if (!g.price && p.price) g.price = p.price;
      if (r.updated_at > g.latest) g.latest = r.updated_at;
      raw.push([d.user_email || "", r.device_id, r.part_id, r.name || "", r.spec || "", r.terminal_count || 0, p.linkKr || "", p.link || "", p.priceKr || "", p.price || "", r.public_id || "", r.updated_at, isHidden(r) ? "숨김" : ""]);
    });
    var agg = Object.keys(map).map(function (k) { var g = map[k]; return [g.name, g.spec, Object.keys(g.devs).length, Object.keys(g.users).length, g.n, g.linkKr, g.link, g.priceKr, g.price, g.latest]; });
    agg.sort(function (a, b) { return b[2] - a[2] || b[4] - a[4] || String(a[0]).localeCompare(String(b[0]), "ko"); });
    return {
      agg: { head: ["이름", "스펙", "기기 수", "로그인 사용자 수", "등록 수", "국내 링크", "해외 링크", "국내 단가", "해외 단가", "최근 등록"], rows: agg },
      raw: { head: ["이메일", "기기 ID", "부품 ID", "이름", "스펙", "단자 수", "국내 링크", "해외 링크", "국내 단가", "해외 단가", "공용 출처", "등록 시각", "숨김"], rows: raw }
    };
  }
  // CSV 칸 — app.js 의 csvCell 과 같은 규칙(+ - = @ 로 시작하면 앞에 공백: 엑셀이 수식으로 오해하지 않게)
  function csvCell(v) {
    if (typeof v === "number") return String(v);
    v = (v == null ? "" : String(v));
    if (/^[=+\-@\t\r]/.test(v)) v = " " + v;
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function exportStats(kind) {
    var t = statsRows(), stamp = new Date().toISOString().slice(0, 10);
    if (kind === "xlsx" && WE.xlsx) {
      WE.xlsx.download("사용자부품_통계_" + stamp + ".xlsx", [
        { name: "부품별", headRows: 1, rows: [t.agg.head].concat(t.agg.rows) },
        { name: "원본", headRows: 1, rows: [t.raw.head].concat(t.raw.rows) }
      ]);
      return;
    }
    var lines = [t.agg.head.map(csvCell).join(",")];
    t.agg.rows.forEach(function (r) { lines.push(r.map(csvCell).join(",")); });
    var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = "사용자부품_통계_" + stamp + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ── 실시간 ──────────────────────────────────────────────────────────
  function subscribe() {
    var c = client(); if (!c || !c.channel || channel) return;
    try {
      channel = c.channel("collect_parts_admin")
        .on("postgres_changes", { event: "*", schema: "public", table: "collect_parts" }, function (payload) {
          var r = payload && payload.new; if (!r || r.deleted_at) return;
          // 숨긴 것은 "새 부품" 이 아니다 — 내가 방금 숨긴 행의 UPDATE 도 여기로 오고, 숨긴 기기가 계속 보내는 것도 온다
          if (isHidden(r)) return;
          pending.push(r); renderNew();
        }).subscribe();
    } catch (e) { channel = null; }
  }
  function applyPending() {
    pending.forEach(function (r) {
      var i = rows.findIndex(function (x) { return x.device_id === r.device_id && x.part_id === r.part_id; });
      if (i >= 0) rows[i] = r; else rows.unshift(r);
      if (!devices[r.device_id]) devices[r.device_id] = { device_id: r.device_id };
    });
    pending = []; renderNew(); renderUsers(); build(); render(); renderRank(); renderStats();
  }

  // ── 진입·이벤트 ──────────────────────────────────────────────────────
  function enter() {
    if (!$("admCollect")) return;
    load().then(function () { subscribe(); if (!entered) { entered = true; renderDetail(); } });
  }
  document.addEventListener("DOMContentLoaded", function () {
    if (!$("admCollect")) return;
    ["admColSearch", "admColSort", "admColGroup", "admColPublic", "admColHidden"].forEach(function (id) {
      $(id).addEventListener("input", function () { build(); render(); });
      $(id).addEventListener("change", function () { renderUsers(); build(); render(); renderStats(); });
    });
    $("admColCsv").addEventListener("click", function () { exportStats("csv"); });
    $("admColXlsx").addEventListener("click", function () { exportStats("xlsx"); });
    $("admColRefresh").addEventListener("click", function () { urlCache = {}; load(); });
    $("admColNew").addEventListener("click", applyPending);
    $("admColSend").addEventListener("click", sendToBatch);
    $("admColHide").addEventListener("click", toggleHideTargets);
    $("admColHideDev").addEventListener("click", function () { if (userFilter) hideDevice(userFilter, !devHidden(userFilter)); });
    $("admColUsers").addEventListener("click", function (e) {
      var b = e.target.closest("[data-user]"); if (!b) return;
      userFilter = b.dataset.user; selectedKey = null; checked = {};
      renderUsers(); build(); render(); renderDetail();
    });
    $("admColList").addEventListener("click", function (e) {
      var cb = e.target.closest("input[data-check]");
      if (cb) { checked[cb.dataset.check] = cb.checked; renderSendButton(); return; }
      var item = e.target.closest(".lib-item"); if (!item) return;
      selectedKey = item.dataset.key; render(); renderDetail();
    });
    $("admColDetail").addEventListener("input", onDetailInput);
    $("admColDetail").addEventListener("change", onDetailInput);
    $("admColDetail").addEventListener("click", function (e) {
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
    // 검사용 — 서버 대신 행을 심고 화면을 그린다
    _테스트_심기: function (parts, devs) { rows = parts || []; devices = {}; (devs || []).forEach(function (d) { devices[d.device_id] = d; }); rows.forEach(function (r) { if (!devices[r.device_id]) devices[r.device_id] = { device_id: r.device_id }; }); work = {}; renderUsers(); build(); render(); renderRank(); renderStats(); renderDetail(); },
    _테스트_묶음: function () { return groups.map(function (g) { return { key: g.key, name: g.rep.name, devices: g.devices, members: g.members.length }; }); },
    _테스트_사용자: function (id) { userFilter = id || ""; selectedKey = null; renderUsers(); build(); render(); renderDetail(); },
    _테스트_고르기: function (key) { selectedKey = key; render(); return current() ? ensureWork(current()).then(function () { renderDetail(); }) : Promise.resolve(); },
    _테스트_작업본: function (key) { return work[key] ? JSON.parse(JSON.stringify(work[key])) : null; },
    _테스트_단자저장: function (cmp) { WE.app.afterTerminalEdit(cmp); },
    _테스트_편집중키: function () { return editingKey; },
    _테스트_체크: function (key, on) { checked[key] = !!on; renderSendButton(); },
    _테스트_보내기: sendToBatch,
    _테스트_배치: placeInEditor,
    _테스트_실시간: function (row) { if (isHidden(row)) return; pending.push(row); renderNew(); },   // 구독 콜백과 같은 거름
    _테스트_통계: statsRows,
    _테스트_새부품적용: applyPending,
    _테스트_숨기기: toggleHideTargets,                 // 체크한(없으면 고른) 부품을 숨기거나 복원 — 서버는 가짜 rpc
    _테스트_기기숨기기: function (id, hide) { return hideDevice(id, hide); },
    _테스트_행: function () { return rows.map(function (r) { return { device_id: r.device_id, part_id: r.part_id, hidden_at: r.hidden_at || null }; }); },
    INBOX_KEY: INBOX_KEY
  };
})();

// categories.js — 공용 부품 분류(2단계 트리). 에디터와 관리자 페이지가 함께 쓴다.
//
// 구조: 대분류(parent 없음) → 소분류. 깊이는 2단계까지(DB 트리거가 강제한다).
//   · **부품은 소분류에만 붙는다.** 대분류는 "묶어서 보는" 용도다 —
//     대분류를 고르면 그 아래 소분류의 부품이 모두 보인다.
//   · 부품은 분류를 **id** 로 가리킨다. 「센서모듈」이 아두이노 밑에도 ESP32 밑에도
//     있을 수 있어서 이름으로는 구분되지 않는다.
//
// ⚠ 폴백이 핵심이다. DB를 못 읽어도(로그인 전·오프라인·표 없음) 앱은 지금까지처럼 동작해야 한다.
//   실패하면 예전 6개를 대분류로 만든 목록을 돌려준다. 분류가 안 보여서
//   공용 부품 창이 통째로 비어 보이는 일은 없어야 한다.
var WE = window.WE || {};
window.WE = WE;

WE.categories = (function () {
  "use strict";

  var FALLBACK = ["MCU", "센서", "전원", "통신", "릴레이", "기타"];
  var ALL = "전체";          // 분류가 아니라 '전부 보기' 필터. DB에 넣지 않는다.

  var cache = null;          // [{id, name, sortOrder, parentId}]
  var loading = null;
  // 폴백으로 떨어진 이유를 기억한다.
  // 폴백 자체는 에디터에 맞지만(사용자 창이 안 깨져야 한다), 관리자 페이지에서는
  // "왜 목록이 예전 것인지"를 반드시 알려야 한다 — 안 그러면 화면이 멀쩡해 보이는데
  // 추가·수정만 조용히 실패한다. (2026-08-30 실제로 그렇게 막혔다)
  var fellBack = false, lastError = "";

  function client() { return WE.auth && WE.auth._client ? WE.auth._client() : null; }
  function fallbackList() {
    return FALLBACK.map(function (n, i) {
      return { id: "fb:" + n, name: n, sortOrder: (i + 1) * 10, parentId: null };
    });
  }

  // 목록을 가져온다. 실패하면 폴백. 절대 reject 하지 않는다 —
  // 호출부가 분류를 못 그려 화면이 비는 것보다, 예전 목록이라도 보이는 편이 낫다.
  function load(force) {
    if (cache && !force) return Promise.resolve(cache);
    if (loading && !force) return loading;
    var c = client();
    if (!c) { cache = fallbackList(); fellBack = true; lastError = "로그인/연결이 없습니다"; return Promise.resolve(cache); }
    loading = c.from("public_categories").select("id,name,sort_order,parent_id")
      .order("sort_order", { ascending: true }).order("name", { ascending: true })
      .then(function (res) {
        if (res.error || !res.data || !res.data.length) {
          cache = fallbackList(); fellBack = true;
          lastError = res.error ? (res.error.message || String(res.error)) : "분류 표가 비어 있습니다";
          return cache;
        }
        cache = res.data.map(function (r) {
          return { id: r.id, name: r.name, sortOrder: Number(r.sort_order) || 0, parentId: r.parent_id || null };
        });
        fellBack = false; lastError = "";
        return cache;
      })
      .catch(function (e) {
        cache = fallbackList(); fellBack = true;
        lastError = (e && e.message) || "분류 목록을 읽지 못했습니다";
        return cache;
      })
      .then(function (v) { loading = null; return v; });
    return loading;
  }

  function all() { return cache || fallbackList(); }
  function roots() { return all().filter(function (c) { return !c.parentId; }); }
  function childrenOf(parentId) { return all().filter(function (c) { return c.parentId === parentId; }); }
  function get(id) { return all().filter(function (c) { return c.id === id; })[0] || null; }
  function isRoot(id) { var c = get(id); return !!c && !c.parentId; }

  // 대분류를 고르면 그 아래 소분류까지 포함해 거른다. 소분류면 자기 자신만.
  function idsFor(id) {
    if (!id || id === ALL) return null;                 // null = 전부
    var kids = childrenOf(id).map(function (c) { return c.id; });
    return kids.length ? [id].concat(kids) : [id];
  }
  // 화면에 뿌릴 트리 — [{...대분류, children:[소분류]}]
  function tree() {
    return roots().map(function (r) {
      var node = { id: r.id, name: r.name, sortOrder: r.sortOrder, parentId: null };
      node.children = childrenOf(r.id);
      return node;
    });
  }
  // "아두이노 › 센서모듈" 처럼 보여줄 때
  function pathOf(id) {
    var c = get(id); if (!c) return "";
    if (!c.parentId) return c.name;
    var p = get(c.parentId);
    return (p ? p.name + " › " : "") + c.name;
  }

  function isLoaded() { return !!cache; }
  function invalidate() { cache = null; }

  // ---- 관리자 전용 (RLS가 실제로 막는다. 여기 검사는 안내용일 뿐이다) ----
  function add(name, sortOrder, parentId) {
    var c = client(); if (!c) return Promise.reject(new Error("연결이 없습니다"));
    name = String(name || "").trim();
    if (!name) return Promise.reject(new Error("분류 이름을 입력하세요"));
    if (name === ALL) return Promise.reject(new Error("'" + ALL + "'는 분류 이름으로 쓸 수 없습니다"));
    return c.from("public_categories").insert({ name: name, sort_order: sortOrder, parent_id: parentId || null })
      .then(function (res) { if (res.error) throw res.error; invalidate(); });
  }
  function rename(id, newName) {
    var c = client(); if (!c) return Promise.reject(new Error("연결이 없습니다"));
    newName = String(newName || "").trim();
    if (!newName) return Promise.reject(new Error("분류 이름을 입력하세요"));
    return c.rpc("rename_public_category", { target_id: id, new_name: newName })
      .then(function (res) { if (res.error) throw res.error; invalidate(); });
  }
  // ⚠ 분류를 지워도 부품은 안 지운다. 소분류를 지우면 그 부품은 '미분류'로 간다(개수를 돌려준다).
  //    대분류는 하위 소분류가 남아 있으면 DB 가 거부한다.
  function remove(id) {
    var c = client(); if (!c) return Promise.reject(new Error("연결이 없습니다"));
    return c.rpc("delete_public_category", { target_id: id })
      .then(function (res) { if (res.error) throw res.error; invalidate(); return Number(res.data) || 0; });
  }
  // 순서 저장 — 같은 부모 안에서 10, 20, 30… 을 다시 매긴다(사이에 끼울 자리를 남긴다)
  function reorder(orderedIds) {
    var c = client(); if (!c) return Promise.reject(new Error("연결이 없습니다"));
    return Promise.all(orderedIds.map(function (id, i) {
      return c.from("public_categories").update({ sort_order: (i + 1) * 10 })
        .eq("id", id).then(function (res) { if (res.error) throw res.error; });
    })).then(function () { invalidate(); });
  }
  // 부품을 다른 소분류로 옮긴다. null 이면 미분류로 뺀다.
  function movePart(publicKey, categoryId) {
    var c = client(); if (!c) return Promise.reject(new Error("연결이 없습니다"));
    return c.rpc("move_public_component", { part_key: publicKey, to_category_id: categoryId || null })
      .then(function (res) { if (res.error) throw res.error; });
  }

  // 검사용 이음매 — 분류 목록을 직접 심는다. DB 없이 트리 계산을 잴 수 있어야 한다.
  // (auth.js 의 _테스트_상태 와 같은 목적이다. 앱 코드에서는 쓰지 않는다)
  function _테스트_주입(rows) { cache = rows ? rows.slice() : null; fellBack = false; lastError = ""; }

  return {
    ALL: ALL,
    load: load, all: all, roots: roots, childrenOf: childrenOf, get: get, isRoot: isRoot,
    // 지금 보고 있는 목록이 진짜 DB 것인가, 아니면 폴백인가
    usingFallback: function () { return fellBack; },
    lastError: function () { return lastError; },
    _테스트_주입: _테스트_주입,
    idsFor: idsFor, tree: tree, pathOf: pathOf, isLoaded: isLoaded, invalidate: invalidate,
    add: add, rename: rename, remove: remove, reorder: reorder, movePart: movePart
  };
})();

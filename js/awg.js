// awg.js — AWG 전선규격표 + 전류→규격 추천
var WE = window.WE || {};
window.WE = WE;

WE.awg = (function () {
  // { awg, dia(mm), area(mm²), ohm(Ω/m), amp(허용전류 A, 범위는 하한값) } — 굵은 것 → 얇은 것 순
  var TABLE = [
    { awg: "4/0", dia: 11.7, area: 107, ohm: 0.000161, amp: 280 },
    { awg: "3/0", dia: 10.4, area: 85, ohm: 0.000203, amp: 240 },
    { awg: "2/0", dia: 9.26, area: 67.4, ohm: 0.000256, amp: 223 },
    { awg: "1/0", dia: 8.25, area: 53.5, ohm: 0.000323, amp: 175 },
    { awg: "1", dia: 7.35, area: 42.4, ohm: 0.000407, amp: 165 },
    { awg: "2", dia: 6.54, area: 33.6, ohm: 0.000513, amp: 130 },
    { awg: "3", dia: 5.83, area: 26.7, ohm: 0.000647, amp: 125 },
    { awg: "4", dia: 5.19, area: 21.1, ohm: 0.000815, amp: 98 },
    { awg: "5", dia: 4.62, area: 16.8, ohm: 0.00103, amp: 94 },
    { awg: "6", dia: 4.11, area: 13.3, ohm: 0.0013, amp: 72 },
    { awg: "7", dia: 3.66, area: 10.5, ohm: 0.00163, amp: 70 },
    { awg: "8", dia: 3.26, area: 8.36, ohm: 0.00206, amp: 55 },
    { awg: "9", dia: 2.91, area: 6.63, ohm: 0.0026, amp: 55 },
    { awg: "10", dia: 2.59, area: 5.26, ohm: 0.00328, amp: 40 },
    { awg: "11", dia: 2.3, area: 4.17, ohm: 0.00413, amp: 38 },
    { awg: "12", dia: 2.05, area: 3.31, ohm: 0.00521, amp: 28 },
    { awg: "13", dia: 1.83, area: 2.62, ohm: 0.00657, amp: 28 },
    { awg: "14", dia: 1.63, area: 2.08, ohm: 0.00829, amp: 18 },
    { awg: "15", dia: 1.45, area: 1.65, ohm: 0.0104, amp: 19 },
    { awg: "16", dia: 1.29, area: 1.31, ohm: 0.0132, amp: 12 },
    { awg: "17", dia: 1.15, area: 1.04, ohm: 0.0166, amp: 16 },
    { awg: "18", dia: 1.02, area: 0.823, ohm: 0.021, amp: 7 },
    { awg: "19", dia: 0.912, area: 0.653, ohm: 0.0264, amp: 5.5 },
    { awg: "20", dia: 0.812, area: 0.518, ohm: 0.0333, amp: 4.5 },
    { awg: "21", dia: 0.723, area: 0.41, ohm: 0.042, amp: 3.8 },
    { awg: "22", dia: 0.644, area: 0.326, ohm: 0.053, amp: 3.0 },
    { awg: "23", dia: 0.573, area: 0.258, ohm: 0.0668, amp: 2.2 },
    { awg: "24", dia: 0.511, area: 0.205, ohm: 0.0842, amp: 0.588 },
    { awg: "25", dia: 0.455, area: 0.162, ohm: 0.106, amp: 0.477 },
    { awg: "26", dia: 0.405, area: 0.129, ohm: 0.134, amp: 0.378 },
    { awg: "27", dia: 0.361, area: 0.102, ohm: 0.169, amp: 0.288 },
    { awg: "28", dia: 0.321, area: 0.081, ohm: 0.213, amp: 0.25 },
    { awg: "29", dia: 0.286, area: 0.0642, ohm: 0.268, amp: 0.212 },
    { awg: "30", dia: 0.255, area: 0.0509, ohm: 0.339, amp: 0.147 },
    { awg: "31", dia: 0.227, area: 0.0404, ohm: 0.427, amp: 0.12 },
    { awg: "32", dia: 0.202, area: 0.032, ohm: 0.538, amp: 0.093 },
    { awg: "33", dia: 0.18, area: 0.0254, ohm: 0.679, amp: 0.075 },
    { awg: "34", dia: 0.16, area: 0.0201, ohm: 0.856, amp: 0.06 },
    { awg: "35", dia: 0.143, area: 0.016, ohm: 1.08, amp: 0.045 },
    { awg: "36", dia: 0.127, area: 0.0127, ohm: 1.36, amp: 0.04 },
    { awg: "37", dia: 0.113, area: 0.01, ohm: 1.72, amp: 0.028 },
    { awg: "38", dia: 0.101, area: 0.00797, ohm: 2.16, amp: 0.024 },
    { awg: "39", dia: 0.0897, area: 0.00632, ohm: 2.73, amp: 0.019 },
    { awg: "40", dia: 0.0799, area: 0.00501, ohm: 3.44, amp: 0.015 }
  ];
  // 허용전류를 단조 증가(굵을수록 ≥)로 보정 — 표 원본의 범위 하한이 뒤죽박죽인 부분 방지
  (function () {
    var run = 0;
    for (var i = TABLE.length - 1; i >= 0; i--) { run = Math.max(run, TABLE[i].amp); TABLE[i].ampEff = run; }
  })();
  /* ⚠ 위 TABLE 의 amp/ampEff 는 **출처가 없는 옛 값**이다 — 22AWG 3.0A → 24AWG 0.588A 로 5배 꺾이고
       23·25AWG 처럼 잘 안 파는 규격까지 추천했다. 2026-10-04 부터 추천은 아래 CABLES(제조사 표)로 한다.
       TABLE 은 지름·단면적·저항·선 두께(widthPx)·「미지정」 의 AWG 목록에만 계속 쓴다. 지우지 않는 이유:
       recommend() 를 부르는 옛 코드가 남아 있어도 돌아가게. */

  var MARGIN = 1.25;   // 안전 여유율 — NEC 연속부하 125% 와 같은 값(조사 _ai/기록/2026-10-04_조사_전선종류_허용전류.md [24])

  // (옛) 전류(A)에 맞는 가장 얇은(번호 큰) 규격 반환. 초과하면 가장 굵은 것. — 새 코드는 recommendCable 을 쓴다
  function recommend(currentA, margin) {
    var req = (currentA || 0) * (margin || MARGIN);
    for (var i = TABLE.length - 1; i >= 0; i--) if (TABLE[i].ampEff >= req) return TABLE[i];
    return TABLE[0];
  }

  /* ---- 전선 종류(제조사 · UL 스타일) 별 허용전류 (2026-10-04 고원빈) ----
     같은 AWG22 라도 UL1007 은 6.8A, UL1015 는 9.9A 다 — 절연 등급(80°C / 105°C)이 달라서.
     그래서 「AWG 만」 으로는 허용전류를 말할 수 없다. 팔레트에서 종류를 고르면 규격 목록·허용전류·추천이 그 종류를 따른다.

     값: 대영전선 카탈로그(UL E139338) **연선(Stranded)** 표 그대로 — 고원빈이 10/04 에 준 데이터시트 두 장.
       · 연선을 쓰는 이유: 하네스는 연선이다(단선 Solid 값은 조금 다르다 — 22AWG 6.8 = 같음, 18AWG 12.3/13.0).
       · UL1015 18AWG 는 구성이 셋(16/0.254 · 34/0.18 · 41/0.16 → 17.0 · 17.1 · 17.0) — 낮은 17.0 을 쓴다.
       · 기준(각주): 주위 40°C · 도체 최고 80°C(UL1007) / 105°C(UL1015) · **1가닥 공중**.
         다발로 묶으면 절반 이하까지 줄어든다(조사 §3) — 화면에는 말풍선으로만 알린다.
     ⚠ 값을 바꾸면 tests/verify_cable.mjs 가 FAIL 한다(카탈로그와 한 글자씩 대조). 일부러 그렇게 했다.
     새 제조사·종류는 여기에 한 덩어리를 더하면 팔레트 드롭다운에 제조사 묶음으로 저절로 나온다. */
  var CABLES = [
    { id: "dy-ul1007", maker: "대영전선", name: "UL1007", rating: "300V 80°C",
      basis: "주위 40°C · 최고 80°C · 1가닥 공중", src: "대영전선 카탈로그 E139338 · 연선(Stranded)",
      amp: { "30": 2.3, "28": 3.0, "26": 3.9, "24": 5.2, "22": 6.8, "20": 9.0, "18": 12.3, "16": 16.4 } },
    { id: "dy-ul1015", maker: "대영전선", name: "UL1015", rating: "600V 105°C",
      basis: "주위 40°C · 최고 105°C · 1가닥 공중", src: "대영전선 카탈로그 E139338 · 연선(Stranded)",
      amp: { "28": 4.4, "26": 5.8, "24": 7.5, "22": 9.9, "20": 12.8, "18": 17.0, "16": 22.7, "14": 30.1, "12": 40.4, "10": 55.1 } }
  ];
  var CUSTOM = "custom";            // 직접 입력 — 이름 · AWG · 허용전류(선택)를 사용자가 적는다(PLC 등, 고원빈 「기타는 필수」)
  var DEFAULT_CABLE = "dy-ul1007";  // 종류를 안 고른 배선의 추천 기준 — 가장 흔한 배선(2026-10-04 고원빈)

  function cable(id) {
    for (var i = 0; i < CABLES.length; i++) if (CABLES[i].id === id) return CABLES[i];
    return null;
  }
  // 그 종류가 파는 AWG 만, 굵은 것 → 얇은 것(TABLE 순서). 미지정·직접 입력은 TABLE 전체.
  function cableAwgs(id) {
    var c = cable(id);
    return TABLE.filter(function (e) { return !c || c.amp[e.awg] != null; }).map(function (e) { return e.awg; });
  }
  // 그 배선(또는 팔레트 항목)의 허용전류(A). 모르면 null — 미지정은 null 이다(기준 표는 추천할 때만 빌린다).
  function cableAmp(o) {
    if (!o || !o.cable) return null;
    if (o.cable === CUSTOM) { var a = +o.cableAmp; return a > 0 ? a : null; }
    var c = cable(o.cable);
    var v = c ? c.amp[o.awg] : null;
    return v != null ? v : null;
  }
  /* 전류에 맞는 **그 종류 안에서** 가장 얇은 규격. 여유 ×MARGIN.
       미지정("") → DEFAULT_CABLE 표로 계산하고 isDefault 를 붙인다(화면에 「UL1007 기준」).
       직접 입력 → null(표가 없어 추천할 수 없다 — 허용전류와 비교만 한다).
       그 종류에서 가장 굵은 것으로도 모자라면 {over:true} — 다른 종류로 몰래 넘어가지 않는다. */
  function recommendCable(currentA, id, margin) {
    if (id === CUSTOM) return null;
    var isDefault = !id;
    var c = cable(isDefault ? DEFAULT_CABLE : id);
    if (!c) return null;
    var req = (currentA || 0) * (margin || MARGIN);
    var list = cableAwgs(c.id);
    for (var i = list.length - 1; i >= 0; i--) {
      if (!exceeds(req, c.amp[list[i]])) return { awg: list[i], amp: c.amp[list[i]], cable: c.id, isDefault: isDefault, need: req };
    }
    return { over: true, awg: "", amp: 0, cable: c.id, isDefault: isDefault, need: req };
  }
  /* 필요 전류(여유 포함)가 허용전류를 「넘는가」 — **0.1A 단위로 내려서** 본다 (2026-10-04 고원빈).
       「6.81~6.89A 는 22AWG(6.8A) 를 그대로 써도 문제없다. 0.1 단위가 넘어가면 그때 다음 굵기」
         예) 허용 6.8A: 필요 6.8125 → 6.8 → 통과 · 6.8875 → 6.8 → 통과 · 6.9 → 6.9 → 넘음
       카탈로그 값이 소수 한 자리라 그보다 잘게 따지는 건 의미가 없다. 추천(recommendCable)과 직접 입력의 「초과」 표시가 같이 쓴다.
       1e-9: 4.72 × 1.25 = 5.8999999999999995 처럼 컴퓨터 소수 오차로 0.1 아래로 떨어지는 것을 막는다
             (없으면 5.8 로 내려가 UL1015 26AWG(5.8A)를 통과시킨다 — verify_cable 이 잡는다). */
  function exceeds(need, amp) {
    return Math.floor(need * 10 + 1e-9) / 10 > amp;
  }
  /* 결선표 · 인쇄의 규격 칸 표기 — **한 곳에만** 둔다(화면과 인쇄가 따로 만들면 한쪽만 고쳐진다).
       미지정   → "AWG22"         (2026-09-13 형식 그대로 — 옛 도면은 글자 하나 안 바뀐다)
       카탈로그 → "UL1007 AWG22"
       직접 입력 → "UL1569 AWG20" (이름이 비면 "AWG20")
                  규격을 직접 적었으면 그 글자 → "KIV 1.5sq" (2026-10-05 — cableSize) */
  function cableLabel(o) {
    if (!o) return "";
    var g = o.awg ? "AWG" + o.awg : "";
    var n = "";
    if (o.cable === CUSTOM) {
      n = String(o.cableName || "").trim();
      var s = String(o.cableSize || "").trim();
      if (s) g = s;   // 직접 적은 규격은 단위까지 글자에 들어 있다(1.5sq) — 「AWG」 를 붙이지 않는다
    }
    else if (o.cable) { var c = cable(o.cable); n = c ? c.name : ""; }
    return (n && g) ? n + " " + g : (n || g);
  }
  // CSV · 엑셀 「전선 종류」 열 — 제조사까지("대영전선 UL1007"). 직접 입력은 이름, 미지정은 빈칸.
  function cableKind(o) {
    if (!o || !o.cable) return "";
    if (o.cable === CUSTOM) return String(o.cableName || "").trim();
    var c = cable(o.cable);
    return c ? (WE.i18n ? WE.i18n.t(c.maker) : c.maker) + " " + c.name : "";
  }
  /* 종류 칸(cable · cableName · cableAmp · cableSize)을 옮긴다 — 팔레트 항목 → 그리는 펜 → 배선 이 모두 이걸 쓴다.
     **값이 있을 때만 칸을 만든다**: 옛 도면처럼 칸이 없는 상태가 「미지정」 이고, 빈 칸을 줄줄이 달지 않는다.
     직접 입력이 아니면 이름·허용·직접 규격은 안 옮긴다(카탈로그로 바꾼 뒤 옛 값이 몰래 남지 않게).
     cableSize = 직접 적은 규격(2026-10-05 고원빈 「규격 이외의 것이 있을 수도」 — 예 1.5sq). 직접 입력 전선에서만 쓴다. */
  function copyCable(dst, src) {
    if (!dst) return dst;
    delete dst.cable; delete dst.cableName; delete dst.cableAmp; delete dst.cableSize;
    if (src && src.cable && (src.cable === CUSTOM || cable(src.cable))) {
      dst.cable = src.cable;
      if (src.cable === CUSTOM) {
        var n = String(src.cableName || "").trim();
        if (n) dst.cableName = n;
        var a = +src.cableAmp;
        if (a > 0) dst.cableAmp = a;
        var s = String(src.cableSize || "").trim();
        if (s) dst.cableSize = s;
      }
    }
    return dst;
  }
  function get(awg) {
    for (var i = 0; i < TABLE.length; i++) if (TABLE[i].awg === awg) return TABLE[i];
    return null;
  }
  // 규격 → 화면 배선 px 두께(단면적 기반, 2~12px)
  function widthPx(entry) {
    if (!entry) return 2;
    return Math.max(2, Math.min(12, Math.round(2 + Math.sqrt(entry.area) * 1.3)));
  }

  return { TABLE: TABLE, MARGIN: MARGIN, recommend: recommend, get: get, widthPx: widthPx,
           CABLES: CABLES, CUSTOM: CUSTOM, DEFAULT_CABLE: DEFAULT_CABLE,
           cable: cable, cableAwgs: cableAwgs, cableAmp: cableAmp, recommendCable: recommendCable,
           cableLabel: cableLabel, cableKind: cableKind, copyCable: copyCable, exceeds: exceeds };
})();

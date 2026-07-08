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

  var MARGIN = 1.25;   // 안전 여유율

  // 전류(A)에 맞는 가장 얇은(번호 큰) 규격 반환. 초과하면 가장 굵은 것.
  function recommend(currentA, margin) {
    var req = (currentA || 0) * (margin || MARGIN);
    for (var i = TABLE.length - 1; i >= 0; i--) if (TABLE[i].ampEff >= req) return TABLE[i];
    return TABLE[0];
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

  return { TABLE: TABLE, MARGIN: MARGIN, recommend: recommend, get: get, widthPx: widthPx };
})();

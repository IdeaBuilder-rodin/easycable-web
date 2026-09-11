/* ─────────────────────────────────────────────────────────────────────
   xlsx.js — 진짜 엑셀 파일(.xlsx) 만들기

   왜 직접 만드는가 (2026-09-06)
     Pro 특전에 "BOM CSV·Excel 내보내기" 를 넣기로 했다.
     쉬운 길이 둘 있었는데 둘 다 버렸다.

     ① CSV 파일에 .xls 확장자만 붙이기
        → 엑셀이 "파일 형식이 확장자와 일치하지 않습니다" 경고를 띄운다.
          돈을 낸 사람이 처음 받는 파일이 경고창이면 고장난 것으로 읽힌다.
     ② 라이브러리(SheetJS 등) 가져오기
        → 이 프로젝트는 빌드 도구가 없고 file:// 로도 열려야 한다.
          CDN 을 물면 오프라인에서 안 되고, 배포 CSP 도 손봐야 한다.

     .xlsx 는 XML 몇 장을 ZIP 으로 묶은 것뿐이라 직접 만드는 편이 싸다.
     압축은 안 한다(ZIP 의 '저장' 방식) — 표 몇 백 줄이라 용량이 문제되지 않고,
     압축을 넣으면 여기서 deflate 를 구현해야 한다.

   쓰는 법
     WE.xlsx.download("파일.xlsx", [{ name: "BOM", rows: [[...], ...], headRows: 1 }])

     rows 의 칸에 숫자를 넣으면 **엑셀에서 숫자로** 들어간다(합계·정렬이 된다).
     문자열로 넣으면 문자로 들어간다 — 부품명·규격처럼 계산 대상이 아닌 값이다.
   ───────────────────────────────────────────────────────────────────── */
var WE = window.WE || {};
window.WE = WE;

WE.xlsx = (function () {

  /* ── CRC32 — ZIP 이 칸마다 요구한다 ──────────────────────────────── */
  var _표 = null;
  function crcTable() {
    if (_표) return _표;
    _표 = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      _표[n] = c >>> 0;
    }
    return _표;
  }
  function crc32(buf) {
    var t = crcTable(), c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str) { return new TextEncoder().encode(str); }

  /* XML 에 그대로 넣으면 안 되는 글자.

     ⚠ 제어문자를 반드시 턴다 — 엑셀은 제어문자가 든 XML 을 "손상된 파일" 로 보고
        **아예 열지 않는다.** 부품명·규격에 이상한 문자가 섞여 들어오는 경우가 실제로 있다
        (사용자가 데이터시트에서 붙여넣기로 넣는다).

     탭·줄바꿈은 남긴다 — 셀 안 줄바꿈은 정상적인 값이다.
     정규식 리터럴에 날 제어문자를 박으면 소스 파일이 깨져 보이므로 코드로 만든다. */
  var 제어문자 = (function () {
    var 목록 = "";
    for (var i = 0; i <= 0x1F; i++) {
      if (i === 9 || i === 10 || i === 13) continue;   // 탭·줄바꿈은 살린다
      목록 += String.fromCharCode(i);
    }
    return new RegExp("[" + 목록 + "]", "g");
  })();

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
      .replace(제어문자, "");
  }

  /* 0 → A, 25 → Z, 26 → AA … 엑셀 열 이름 */
  function colName(i) {
    var s = "";
    for (i = i + 1; i > 0;) { var r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = (i - r - 1) / 26; }
    return s;
  }

  /* ── ZIP ('저장' 방식 · 압축 없음) ───────────────────────────────── */
  function zip(files) {
    var now = new Date();
    var 시각 = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
    var 날짜 = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

    var 조각 = [], 중앙 = [], offset = 0;

    files.forEach(function (f) {
      var 이름 = utf8(f.name), 내용 = utf8(f.data), c = crc32(내용);

      var lh = new Uint8Array(30 + 이름.length);
      var lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);   // 지역 헤더 서명
      lv.setUint16(4, 20, true);           // 필요 버전
      lv.setUint16(6, 0x0800, true);       // 플래그: 파일명이 UTF-8
      lv.setUint16(8, 0, true);            // 압축 방식 0 = 저장
      lv.setUint16(10, 시각, true);
      lv.setUint16(12, 날짜, true);
      lv.setUint32(14, c, true);
      lv.setUint32(18, 내용.length, true); // 압축 크기 = 원본 크기
      lv.setUint32(22, 내용.length, true);
      lv.setUint16(26, 이름.length, true);
      lv.setUint16(28, 0, true);
      lh.set(이름, 30);
      조각.push(lh, 내용);

      var ch = new Uint8Array(46 + 이름.length);
      var cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);   // 중앙 디렉터리 서명
      cv.setUint16(4, 20, true);           // 만든 버전
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 시각, true);
      cv.setUint16(14, 날짜, true);
      cv.setUint32(16, c, true);
      cv.setUint32(20, 내용.length, true);
      cv.setUint32(24, 내용.length, true);
      cv.setUint16(28, 이름.length, true);
      cv.setUint32(42, offset, true);      // 이 파일의 지역 헤더 위치
      ch.set(이름, 46);
      중앙.push(ch);

      offset += lh.length + 내용.length;
    });

    var 중앙크기 = 중앙.reduce(function (a, b) { return a + b.length; }, 0);
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, 중앙크기, true);
    ev.setUint32(16, offset, true);

    return new Blob(조각.concat(중앙, [end]), { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  /* ── 시트 XML ────────────────────────────────────────────────────── */
  function sheetXml(rows, headRows) {
    var 폭 = [];   // 열 너비 — 글자 수로 어림한다. 안 주면 전부 잘려 보인다
    rows.forEach(function (r) {
      (r || []).forEach(function (v, i) {
        var n = String(v == null ? "" : v).length;
        // 한글은 폭이 대략 두 배다
        var 한글 = (String(v == null ? "" : v).match(/[ㄱ-힝]/g) || []).length;
        n += 한글;
        if (!(폭[i] >= n)) 폭[i] = n;
      });
    });

    var out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';

    if (폭.length) {
      out += "<cols>";
      폭.forEach(function (n, i) {
        out += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' +
               Math.min(60, Math.max(6, n + 2)) + '" customWidth="1"/>';
      });
      out += "</cols>";
    }

    out += "<sheetData>";
    rows.forEach(function (row, r) {
      out += '<row r="' + (r + 1) + '">';
      (row || []).forEach(function (v, c) {
        if (v == null || v === "") return;   // 빈 칸은 아예 안 적는다(파일이 작아진다)
        var ref = colName(c) + (r + 1);
        var 굵게 = r < (headRows || 0) ? ' s="1"' : "";
        if (typeof v === "number" && isFinite(v)) {
          out += '<c r="' + ref + '"' + 굵게 + '><v>' + v + "</v></c>";
        } else {
          // inlineStr: sharedStrings.xml 을 따로 안 만들어도 되는 방식.
          // 표가 수천 줄이면 용량이 늘지만, 우리 표는 많아야 몇 백 줄이다.
          out += '<c r="' + ref + '"' + 굵게 + ' t="inlineStr"><is><t xml:space="preserve">' +
                 esc(v) + "</t></is></c>";
        }
      });
      out += "</row>";
    });
    out += "</sheetData></worksheet>";
    return out;
  }

  /* 서식 — 0번은 보통, 1번은 굵게(머리줄용). 딱 이 둘만 쓴다. */
  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font>' +
    '<font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts>' +
    '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
    // 기본 서식(Normal)을 명시한다 — 없으면 읽는 쪽이 "기본 스타일이 없는 통합문서" 로 경고한다
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>";

  /* 시트 이름에 쓸 수 없는 글자가 있다. 넣으면 엑셀이 파일을 안 연다. */
  function 시트이름(s, i) {
    s = String(s || ("Sheet" + (i + 1))).replace(/[\\\/\?\*\[\]:]/g, " ").slice(0, 31);
    return s.trim() || ("Sheet" + (i + 1));
  }

  /* sheets = [{ name, rows, headRows }] */
  function build(sheets) {
    sheets = sheets && sheets.length ? sheets : [{ name: "Sheet1", rows: [] }];

    var files = [
      { name: "[Content_Types].xml",
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          sheets.map(function (s, i) {
            return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ' +
                   'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
          }).join("") +
          "</Types>" },
      { name: "_rels/.rels",
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Target="xl/workbook.xml" ' +
          'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/>' +
          "</Relationships>" },
      { name: "xl/workbook.xml",
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
          sheets.map(function (s, i) {
            return '<sheet name="' + esc(시트이름(s.name, i)) + '" sheetId="' + (i + 1) +
                   '" r:id="rId' + (i + 1) + '"/>';
          }).join("") +
          "</sheets></workbook>" },
      { name: "xl/_rels/workbook.xml.rels",
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          sheets.map(function (s, i) {
            return '<Relationship Id="rId' + (i + 1) + '" Target="worksheets/sheet' + (i + 1) + '.xml" ' +
                   'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>';
          }).join("") +
          '<Relationship Id="rIdStyles" Target="styles.xml" ' +
          'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"/>' +
          "</Relationships>" },
      { name: "xl/styles.xml", data: STYLES }
    ];

    sheets.forEach(function (s, i) {
      files.push({ name: "xl/worksheets/sheet" + (i + 1) + ".xml",
                   data: sheetXml(s.rows || [], s.headRows || 0) });
    });

    return zip(files);
  }

  function download(filename, sheets) {
    var url = URL.createObjectURL(build(sheets));
    var a = document.createElement("a");
    a.href = url;
    a.download = /\.xlsx$/i.test(filename) ? filename : filename + ".xlsx";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  return { build: build, download: download, _colName: colName, _esc: esc };
})();

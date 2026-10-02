/* ─────────────────────────────────────────────────────────────────────
 *  invite-mail — 참여 링크 안내 메일 틀 (2026-09-30)
 *
 *  ★ 왜 만들었나
 *    기관(학교·기업) 문의가 오면 참여 링크 주소를 글 한 줄로 보내던 것을,
 *    보기 좋은 안내 메일로 보내고 싶었다(고원빈 9/30 — 밤부랩 웰컴 메일을 참고).
 *    처음엔 _ai/양식/참여안내_메일.html 에 값을 손으로 적었는데, 관리자 화면의 링크 정보로
 *    **바로 만들어지게** 이 파일로 옮겼다. 관리자 화면(js/admin-folders.js)의 [안내 메일] 이 부른다.
 *
 *  ★ 메일 앱의 제약 — 이 틀이 웹페이지처럼 생기지 않은 이유
 *    · Gmail·네이버 메일은 <style>·<script> 를 대부분 버린다 → 표(table) + 칸마다 직접 쓴 style 로 짰다.
 *    · 대표 이미지는 없앴다(9/30 고원빈 — 색감으로만). 이미지를 막는 학교·회사 메일에서도 그대로 보인다.
 *    · 메일 안에서는 「누르면 복사」 버튼을 만들 수 없다(스크립트가 지워진다 — 메일 속 버튼은 전부 링크다).
 *      그래서 버튼은 **[참여하기]**(참여 화면으로 가는 링크)이고, 주소는 **글자로** 두어 드래그해 복사한다
 *      (9/30 고원빈 결정. 참고한 밤부랩 메일도 쿠폰 코드는 글자, 버튼은 상점 링크다).
 *
 *  ★ 받는 사람이 학교일 수도 회사일 수도 있다 — 「학생」「선생님」 같은 말을 쓰지 않는다(9/30 고원빈).
 *
 *  ⚠ 관리자가 적은 글(링크 제목)은 전부 esc() 를 거친다. 메일 HTML 로 그대로 붙여넣어지기 때문이다.
 * ───────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  window.WE = window.WE || {};

  var 문의메일 = "easycableinfo@gmail.com";
  var 글꼴 = "'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',sans-serif";
  // 사이트 색(landing.css --primary 계열)을 그대로 쓴다 — 메일을 열었을 때 사이트와 같은 곳에서 온 것처럼 보이게
  var 파랑 = "#1e88e5", 진파랑 = "#1565c0", 연파랑 = "#e8f1fc", 바탕 = "#eef4fb";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* 날짜는 한국 시각으로 읽는다 — 서버는 「그날 23:59:59(한국)」 로 저장한다.
     ⚠ toISOString 으로 자르면 한국 시각 00~09시 값이 하루 앞 날짜가 된다(admin-folders.js 날짜칸 과 같은 이유) */
  function 날짜(v) {
    if (!v) return null;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  // 2026.12.31 — 쿠폰 칸처럼 좁은 자리용
  function 점날짜(v) {
    var d = 날짜(v); if (!d) return "";
    return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }).split("-").join(".");
  }
  // 2026년 10월 31일 — 문장 안에서 읽기 좋게
  function 긴날짜(v) {
    var d = 날짜(v); if (!d) return "";
    return d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" });
  }

  /* 쿠폰 왼쪽 아래 줄 — 링크의 Pro 제공 방식에 따라.
     「분류만(none)」 링크는 관리자 화면에서 [안내 메일] 단추를 아예 안 보인다(메일이 「Pro 무료」 라고 말하므로) */
  function 기간글(l) {
    if (l.pro_mode === "until") return 점날짜(l.pro_until) + " 까지";
    if (l.pro_mode === "days") return "참여일부터 " + l.pro_days + "일";
    return "";
  }
  function 마감글(l) {
    var 정원 = "정원 " + l.seats + "명";
    return l.join_deadline ? "참여 마감: " + 긴날짜(l.join_deadline) + " (" + 정원 + ")" : 정원;
  }

  /* 주소를 보여 주는 모양 — https:// 를 떼고, 「/」 와 「?」 에서만 줄이 바뀌게 <wbr> 을 넣는다.
     코드(ABCD1234) 가운데서 끊기면 옮겨 적다 틀린다 */
  function 주소보기(u) {
    var s = String(u || "");
    if (s.indexOf("https://") === 0) s = s.slice(8);
    else if (s.indexOf("http://") === 0) s = s.slice(7);
    var 빗금 = s.indexOf("/"), 물음 = s.indexOf("?");
    if (빗금 < 0 || 물음 < 빗금) return esc(s);
    return esc(s.slice(0, 빗금 + 1)) + "<wbr />" + esc(s.slice(빗금 + 1, 물음)) + "<wbr />" + esc(s.slice(물음));
  }

  /* l        admin_links 의 한 줄 (title · seats · pro_mode · pro_until · pro_days · join_deadline)
     참여주소  join.html?j=코드 (함께 이용할 사람들이 여는 곳 — 카드의 글자와 [참여하기] 가 같이 쓴다)
     돌려주는 값  { html: 메일에 붙일 조각, text: 글자만 붙는 곳을 위한 평문 } */
  function build(l, 참여주소) {
    var 제목 = esc(l.title);
    var html =
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + 바탕 + ';">' +
      '<tr><td align="center" style="padding:36px 16px 40px;">' +
      // word-break:keep-all — 한국어가 「준비했습니 / 다」 처럼 글자 중간에서 끊기지 않게. 안쪽 칸이 모두 물려받는다
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;font-family:' + 글꼴 + ';color:#1a1a1a;word-break:keep-all;">' +

        // 로고 — 랜딩 머리글과 같은 조합(아이콘 + 「이지케이블」). SVG 는 Gmail 이 안 보여 줘서 PNG 아이콘
        '<tr><td align="center" style="padding:0 0 22px;">' +
          // 아이콘 PNG 는 흰 바탕이라 연한 파랑 위에서 네모가 도드라진다 → 모서리를 둥글려 앱 아이콘처럼 보이게
          '<img src="https://easycable.co.kr/assets/icon-180.png" width="32" height="32" alt="" style="vertical-align:middle;border:0;border-radius:8px;" />' +
          '<span style="font-size:21px;font-weight:800;letter-spacing:-0.4px;vertical-align:middle;margin-left:6px;">이지케이블</span>' +
        '</td></tr>' +

        '<tr><td style="background:#ffffff;border-radius:18px;border-top:6px solid ' + 파랑 + ';">' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +

          // 머리 칸 — 대표 이미지 대신 연한 파랑 바탕으로 색을 준다(9/30 고원빈 「색감으로 무난하게」).
          // 제목은 「참여 링크 안내」 — 처음엔 「안녕하세요,」 를 여기 크게 뒀는데 인사만 떨어져 보여서
          // 인사는 본문 첫 문장으로 내리고 이 메일이 무엇인지를 크게 보인다(9/30 고원빈)
          '<tr><td style="background:' + 연파랑 + ';border-radius:12px 12px 0 0;padding:28px 32px 24px;">' +
            '<div style="font-size:26px;font-weight:800;letter-spacing:-0.6px;color:#1a1a1a;">참여 링크 안내</div>' +
          '</td></tr>' +

          '<tr><td style="padding:28px 32px 32px;">' +
            '<div style="font-size:16px;line-height:1.65;color:#333;margin:0 0 18px;">안녕하세요,<br />이지케이블을 찾아 주셔서 감사합니다.</div>' +
            '<div style="font-size:16px;line-height:1.65;color:#333;margin:0 0 26px;">' +
              '요청하신 <b style="color:#1a1a1a;">' + 제목 + '</b> 참여 링크를 준비했습니다. ' +
              '아래 주소로 참여하면 이용 기간 동안 Pro 기능을 무료로 사용할 수 있습니다.' +
            '</div>' +

            // 혜택 카드 — 밤부랩 쿠폰 자리. 왼쪽 = 무엇을 주는지, 오른쪽 = 참여 주소.
            // 흰 점선은 쿠폰 절취선 느낌(border 는 메일 앱이 거의 다 지원한다). nowrap — 「Pro 무 / 료」 쪼개짐 방지
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:12px;background:#f3f5f8;">' +
            '<tr>' +
              '<td width="38%" align="center" valign="middle" style="background:' + 파랑 + ';color:#ffffff;border-radius:12px 0 0 12px;border-right:3px dotted #ffffff;padding:20px 10px;">' +
                '<div style="font-size:20px;font-weight:800;letter-spacing:-0.3px;white-space:nowrap;">Pro 무료</div>' +
                '<div style="font-size:13px;margin-top:4px;white-space:nowrap;">' + esc(기간글(l)) + '</div>' +
              '</td>' +
              '<td valign="middle" style="padding:16px 18px;">' +
                '<div style="font-size:14px;font-weight:700;color:' + 파랑 + ';margin:0 0 6px;">참여 주소</div>' +
                // 링크를 걸지 않고 글자로 둔다 — 여기는 드래그(휴대폰은 길게 눌러)해 **복사하는 자리**다.
                // 링크면 끌다가 눌려서 열려 버린다. 열고 싶은 사람은 아래 [참여하기] 를 누른다
                '<div style="font-size:13.5px;line-height:1.5;color:#1a1a1a;overflow-wrap:anywhere;">' + 주소보기(참여주소) + '</div>' +
              '</td>' +
            '</tr>' +
            '</table>' +

            '<div style="font-size:13.5px;color:#666;text-align:center;margin:14px 0 28px;">주소를 복사해 함께 이용하실 분들께 공유해 주세요.</div>' +

            // 버튼 하나 — 참여 화면으로 가는 링크. 메일째 전달받은 분도 이 버튼으로 바로 참여한다
            '<div style="text-align:center;margin:0 0 30px;">' +
              '<a href="' + esc(참여주소) + '" target="_blank" rel="noopener" style="display:inline-block;background:' + 진파랑 + ';color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;padding:16px 64px;border-radius:999px;">참여하기</a>' +
            '</div>' +

            // 주의사항 — 학교든 회사든 공통으로 맞는 것만 (로그인 방법·도면 저장 줄은 9/30 고원빈이 뺐다)
            '<div style="background:#f4f5f7;border-radius:10px;padding:16px 18px;font-size:12.5px;line-height:1.75;color:#555;">' +
              '*' + esc(마감글(l)) + '<br />' +
              '*한 계정은 한 번에 한 곳의 참여 링크만 이용할 수 있습니다.<br />' +
              '*문의: <a href="mailto:' + 문의메일 + '" style="color:#555;">' + 문의메일 + '</a>' +
            '</div>' +
          '</td></tr>' +
          '</table>' +
        '</td></tr>' +

        '<tr><td align="center" style="padding:22px 0 0;font-size:12px;line-height:1.7;color:#8a8f98;">' +
          '부품 사진을 올리고 단자를 이으면, 그게 배선도가 됩니다.<br />' +
          '이지케이블 · <a href="https://easycable.co.kr" style="color:#8a8f98;">easycable.co.kr</a>' +
        '</td></tr>' +

      '</table>' +
      '</td></tr>' +
      '</table>';

    // 평문 — 글자만 받는 곳(일부 메일 앱의 텍스트 모드·메모장)에 붙일 때 쓰인다
    var text = [
      "안녕하세요,",
      "이지케이블을 찾아 주셔서 감사합니다.",
      "",
      "요청하신 " + (l.title || "") + " 참여 링크를 준비했습니다.",
      "아래 주소로 참여하면 이용 기간 동안 Pro 기능을 무료로 사용할 수 있습니다.",
      "",
      "참여 주소: " + 참여주소,
      "Pro 무료 · " + 기간글(l),
      "",
      "주소를 복사해 함께 이용하실 분들께 공유해 주세요.",
      "",
      "*" + 마감글(l),
      "*한 계정은 한 번에 한 곳의 참여 링크만 이용할 수 있습니다.",
      "*문의: " + 문의메일,
      "",
      "이지케이블 · easycable.co.kr"
    ].join("\n");

    return { html: html, text: text };
  }

  WE.inviteMail = { build: build };
})();

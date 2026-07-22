// i18n.js — 다국어 지원 (사전 방식, 한글 원문을 키로 사용)
// - 언어 감지: localStorage(we_lang) → navigator.language (ko면 한국어, 그 외 영어)
// - HTML: DOM 로드 시 텍스트 노드 + title/placeholder 속성을 일괄 치환 (원본 마크업은 한국어 유지)
// - JS 동적 문구: WE.i18n.t("한글") 로 감싸면 현재 언어로 반환
// - 언어 추가: MAPS에 사전 객체 하나 더 (예: MAPS.ja = {...})
var WE = window.WE || {};
window.WE = WE;

WE.i18n = (function () {
  "use strict";

  var EN = {
    // ===== 상단 바 =====
    "메뉴": "Menu",
    "프로젝트 이름 (저장 파일명·PDF 제목)": "Project name (file name & PDF title)",
    "프로젝트를 파일로 저장 (Ctrl+S)": "Save project to file (Ctrl+S)",
    "프로젝트 + 사용된 부품을 한 파일로 내보내기 (받는 사람은 파일 하나로 열림)": "Export project + used parts as one file (recipient opens a single file)",
    "정식 출시·새 기능 소식을 이메일로 받기": "Get launch & feature news by email",
    "의견·버그 제보 보내기": "Send feedback or bug reports",
    "저장": "Save",
    "🔗 공유": "🔗 Share",
    "🔔 출시 알림": "🔔 Updates",
    "💬 피드백": "💬 Feedback",

    // ===== ☰ 메뉴 =====
    "새 프로젝트 (현재 작업 비움)": "New project (clears current work)",
    "새 작업": "New",
    "프로젝트 파일 열기": "Open a project file",
    "열기": "Open",
    "프로젝트를 파일로 저장": "Save project to file",
    "프로젝트 + 사용된 부품을 한 파일로 내보내기": "Export project + used parts as one file",
    "공유": "Share",
    "PDF 또는 이미지로 내보내기": "Export as PDF or image",
    "내보내기": "Export",
    "PDF로 인쇄": "Print to PDF",
    "PDF 문서": "PDF document",
    "배선도를 PNG 이미지로 저장 (카페·블로그·메신저 공유용)": "Save diagram as PNG image (for forums, blogs, messengers)",
    "이미지 (PNG)": "Image (PNG)",
    "예제 배선도를 열어봅니다": "Open an example wiring diagram",
    "샘플 프로젝트": "Sample project",
    "자동 보관된 이전 스냅샷으로 되돌립니다": "Restore an auto-saved earlier snapshot",
    "이전 버전 복구": "Restore version",
    "설정": "Settings",
    "단축키 도움말": "Keyboard shortcuts",
    "개인정보처리방침": "Privacy Policy",

    // ===== 툴바 =====
    "선택/이동": "Select / Move",
    "▣ 선택": "▣ Select",
    "단자끼리 배선": "Wire between terminals",
    "╱ 배선": "╱ Wire",
    "주석 텍스트 추가": "Add text annotation",
    "T 텍스트": "T Text",
    "새 배선 색상": "New wire color",
    "배선색": "Wire color",
    "선 두께": "Line width",
    "배선 모양": "Wire shape",
    "직각": "Right-angle",
    "직선": "Straight",
    "팔레트 관리": "Manage palette",
    "그리드": "Grid",
    "스냅": "Snap",
    "배선마다 W1, W2… 번호를 도면에 표시": "Show W1, W2… numbers on each wire",
    "배선번호": "Wire No.",
    "실행 취소 (Ctrl+Z) / 다시 실행 (Ctrl+Shift+Z)": "Undo (Ctrl+Z) / Redo (Ctrl+Shift+Z)",
    "실행 취소 (Ctrl+Z)": "Undo (Ctrl+Z)",
    "다시 실행 (Ctrl+Shift+Z)": "Redo (Ctrl+Shift+Z)",
    "Ctrl+휠로 확대/축소 · 스페이스/휠클릭 드래그로 이동": "Ctrl+wheel to zoom · Space / middle-drag to pan",
    "축소": "Zoom out",
    "화면에 맞춤": "Fit to screen",
    "확대": "Zoom in",

    // ===== 좌측 라이브러리 =====
    "부품을 추가해 시작하세요.": "Add a part to get started.",
    "부품 라이브러리": "Part Library",
    "＋ 부품 추가 (이미지)": "＋ Add Part (image)",
    "🔍 부품 검색 (이름·스펙)": "🔍 Search parts (name, spec)",
    "라이브러리 전체를 .json 파일로 저장 (다른 PC·브라우저로 옮길 때)": "Save entire library as .json (to move to another PC/browser)",
    "⤓ 저장": "⤓ Save",
    ".json 라이브러리 파일을 불러와 추가": "Import a .json library file",
    "⤒ 불러오기": "⤒ Import",
    "드래그로 너비 조절": "Drag to resize",
    "저장된 레이아웃 불러오기": "Load a saved layout",
    "레이아웃…": "Layouts…",
    "선택한 레이아웃 삭제": "Delete selected layout",
    "삭제": "Delete",

    // ===== BOM / 배선 리스트 =====
    "배선 리스트(번호·색·AWG·출발→도착) CSV": "Wire list (No., color, AWG, from→to) CSV",
    "⤓ 배선 리스트": "⤓ Wire list",
    "표에 어떤 열을 보이게 할지 선택합니다": "Choose which columns to show",
    "표시할 열 선택": "Choose columns",
    "열 추가": "Add column",
    "행 추가": "Add row",
    "번호·색·AWG·출발→도착 CSV로 내보내기": "Export No., color, AWG, from→to as CSV",
    "스펙": "Spec",
    "단가": "Unit price",
    "합계": "Total",
    "구매링크": "Buy link",
    "데이터시트": "Datasheet",
    "자재 명세서 (BOM)": "Bill of Materials (BOM)",
    "배선 리스트": "Wire List",
    "📐 배선도": "📐 Diagram",
    "🔌 배선 리스트": "🔌 Wire List",

    // ===== 속성 패널 =====
    "속성": "Properties",
    "선택된 대상이 없습니다.": "Nothing selected.",
    "맨 위 정렬": "Align top",
    "왼쪽 정렬": "Align left",
    "세로 가운데 정렬": "Align vertical center",
    "가로 가운데 정렬": "Align horizontal center",
    "맨 아래 정렬": "Align bottom",
    "오른쪽 정렬": "Align right",
    "가로 균등 간격": "Distribute horizontally",
    "세로 균등 간격": "Distribute vertically",
    "맨 위": "Top",
    "왼쪽": "Left",
    "가운데": "Center",
    "맨 아래": "Bottom",
    "오른쪽": "Right",
    "가로 균등": "H-distribute",
    "세로 균등": "V-distribute",
    "Ctrl+클릭으로 부품 추가 선택. 빈 곳 클릭으로 해제.": "Ctrl+click to add to selection. Click empty space to deselect.",
    "텍스트": "Text",
    "색상": "Color",
    "크기": "Size",
    "굵게": "Bold",
    "주석 삭제": "Delete annotation",
    "두께": "Width",
    "겹침 허용(회피 안 함)": "Allow overlap (no avoidance)",
    "번호 표시": "Show number",
    "위치 초기화": "Reset position",
    "예: W17 (비우면 자동)": "e.g. W17 (blank = auto)",
    "드래그로 옮긴 라벨 위치를 자동 배치로 되돌림": "Reset dragged label back to auto placement",
    "번호 라벨을 드래그하면 위치를 직접 옮길 수 있습니다.": "Drag the number label to reposition it.",
    "배선 규격 (AWG)": "Wire gauge (AWG)",
    "전류(A)": "Current (A)",
    "비우면 신호선": "Blank = signal wire",
    "부하로 계산": "From load",
    "구간 전압 V": "Segment voltage V",
    "예: 6, 12": "e.g. 6, 12",
    "합산 → 전류 적용": "Sum → apply current",
    "정렬 (다중 선택)": "Align (multi-select)",
    "⌈ 구간 정렬": "⌈ Segment align",
    "간격": "Spacing",
    "처음 클릭한 배선의 클릭한 구간에 맞춤(세로/가로 자동)": "Align to the clicked segment of the first-clicked wire (auto V/H)",
    "선택한 세로선들을 좌우로 균등하게 벌림": "Evenly space the selected vertical lines left-right",
    "선택한 가로선들을 위아래로 균등하게 벌림": "Evenly space the selected horizontal lines top-bottom",
    "세로선 균등": "V-lines",
    "가로선 균등": "H-lines",
    "기준=처음 클릭한 배선. 각 배선에서": "Reference = first-clicked wire. On each wire,",
    "맞출 구간을 클릭": "click the segment to align",
    "해 선택(굵게 표시). 균등은 3개↑.": "to select it (shown bold). Distribute needs 3+.",
    "배선 삭제": "Delete wire",
    "이름": "Name",
    "너비": "Width",
    "높이": "Height",
    "비율 고정(가로세로)": "Lock aspect ratio",
    "회전°": "Rotation°",
    "90° 회전": "Rotate 90°",
    "단자": "Terminals",
    "🔍 단자 배치 편집…": "🔍 Edit terminal layout…",
    "단자 이름 숨기기 (도면에서)": "Hide terminal names (on diagram)",
    "이미지 편집…": "Edit image…",
    "복제": "Duplicate",
    "전기 정보": "Electrical info",
    "· 라이브러리": "· Library",
    "전력 / 배터리 요약": "Power / Battery Summary",
    "? 단축키 도움말": "? Keyboard shortcuts",

    // ===== 부품 우클릭 메뉴 =====
    "단자 배치 편집…": "Edit terminal layout…",
    "라이브러리에 저장": "Save to library",
    "복제 (Ctrl+D)": "Duplicate (Ctrl+D)",

    // ===== 부품 정보 모달 =====
    "부품 정보 (BOM · 전력)": "Part Info (BOM · Power)",
    "예: 2.1채널 D급 앰프": "e.g. 2.1ch Class-D amplifier",
    "스펙/설명": "Spec / description",
    "구매 링크": "Buy link",
    "단가(원)": "Unit price (₩)",
    "예: 12000": "e.g. 12000",
    "역할": "Role",
    "부하(소비)": "Load (consumer)",
    "배터리(소스)": "Battery (source)",
    "변환기": "Converter",
    "전압 V": "Voltage V",
    "전류 A": "Current A",
    "전력 W": "Power W",
    "V·A·W 중 2개만 넣으면 나머지는 자동 계산됩니다.": "Enter any 2 of V·A·W and the third is calculated.",
    "용량 Ah": "Capacity Ah",
    "가용용량 DoD %": "Usable capacity DoD %",
    "시간당 가동시간 (분/시간, 최대 60)": "Duty time (min/hour, max 60)",
    "60 = 상시": "60 = always on",
    "효율 %": "Efficiency %",
    "데이터시트 (PDF·이미지)": "Datasheets (PDF, images)",
    "＋ 파일 추가": "＋ Add file",
    "취소": "Cancel",
    "확인": "OK",
    "맞춤": "Fit",
    "최대화/복원": "Maximize / restore",
    "⤓ 다운로드": "⤓ Download",
    "↗ 새 탭": "↗ New tab",
    "⛶ 최대화": "⛶ Maximize",
    "닫기": "Close",

    // ===== 설정 모달 =====
    "일반": "General",
    "표시": "Display",
    "단축키": "Shortcuts",
    "자동 임시저장 사용": "Enable auto-save",
    "저장 주기(초)": "Interval (sec)",
    "자동 임시저장은 이 브라우저에 작업을 주기적으로 저장해 새로고침 시 복구합니다. 꺼두면 직접 '저장'으로만 보관됩니다.": "Auto-save periodically stores your work in this browser and restores it after a refresh. If off, only manual Save keeps your work.",
    "부품 이름표": "Part labels",
    "글자 크기(px)": "Font size (px)",
    "배경 사각블럭 (배선·배경과 겹쳐도 잘 보이게)": "Background box (stays readable over wires/background)",
    "칸을 클릭하고 원하는 키를 누르세요. (Backspace로 해제)": "Click a field and press a key. (Backspace to clear)",
    "선택 모드": "Select mode",
    "배선 모드": "Wire mode",
    "텍스트 모드": "Text mode",
    "배선 모드로 전환할 때마다 마우스 위치 근처에 배선색 팝업이 자동으로 뜹니다.": "Whenever you switch to wire mode, a wire-color popup appears near the cursor.",

    // ===== 팔레트 모달 =====
    "배선 색상 팔레트": "Wire Color Palette",
    "색상 + 의미를 등록하면 배선색으로 쓰고, 나중에 PDF 범례에도 나옵니다.": "Register a color + meaning to use as wire colors — they also appear in the PDF legend.",
    "＋ 추가": "＋ Add",

    // ===== 단자 배치 편집 =====
    "단자 배치": "Terminal Layout",
    "이미지 클릭으로 단자 추가": "Click image to add terminals",
    "＋ 배치 모드": "＋ Place mode",
    "▣ 선택 모드": "▣ Select mode",
    "배치할 단자": "Terminal to place",
    "프리셋 관리…": "Manage presets…",
    "드래그로 단자 다중선택": "Drag to multi-select terminals",
    "이미지 클릭=단자 추가 · 드래그=이동 ·": "Click image = add terminal · Drag = move ·",
    "Ctrl+클릭=다중선택": "Ctrl+click = multi-select",
    "(여러 개 함께 드래그) · Delete=삭제 · 휠=확대": "(drag several together) · Delete = remove · Wheel = zoom",
    "같은 X로(수직 한 줄)": "Same X (vertical line)",
    "같은 Y로(수평 한 줄)": "Same Y (horizontal line)",
    "세로 균등 간격(3개↑)": "Distribute vertically (3+)",
    "가로 균등 간격(3개↑)": "Distribute horizontally (3+)",
    "세로정렬": "V-align",
    "가로정렬": "H-align",
    "라벨 방향(선택한 단자, 자동판정 애매할 때)": "Label side (selected terminals, when auto is ambiguous)",
    "위로 고정": "Pin to top",
    "왼쪽으로 고정": "Pin to left",
    "자동 배치로 되돌림": "Back to auto placement",
    "오른쪽으로 고정": "Pin to right",
    "아래로 고정": "Pin to bottom",
    "↑ 위": "↑ Top",
    "← 왼쪽": "← Left",
    "자동": "Auto",
    "→ 오른쪽": "→ Right",
    "↓ 아래": "↓ Bottom",
    "완료": "Done",
    "예: 오디오 R": "e.g. Audio R",
    "예: MISO": "e.g. MISO",

    // ===== 단자 프리셋 =====
    "단자 프리셋 관리": "Terminal Preset Manager",
    "자주 쓰는 단자(라벨+색상)를 등록하면 다음에도 재사용됩니다. 브라우저에 저장돼요.": "Register frequently used terminals (label + color) to reuse later. Stored in this browser.",
    // ===== 이미지 편집 (배경 제거·자르기·회전) =====
    "이미지 편집": "Edit Image",
    "이미지를 확인하고 필요하면 배경 제거·자르기·회전으로 다듬은 뒤 배치하세요.": "Check the image, and if needed clean it up with background removal, crop or rotation before placing.",
    "배경 제거": "Remove background",
    "배경 제거·자르기·회전 등 모든 편집을 원본 상태로 되돌립니다": "Reset all edits (removal, crop, rotation) back to the original",
    "Ctrl+휠: 확대/축소 · 휠클릭(가운데버튼) 드래그: 화면 이동": "Ctrl+wheel: zoom · Middle-button drag: pan",
    "켜면 배경(부품 주변)이 자동으로 투명하게 지워집니다": "When on, the background around the part is automatically erased to transparent",
    "켜면 사각형 테두리를 지정해 그 안쪽만 남기고 잘라냅니다": "When on, draw a rectangle to crop to its inside",
    "왼쪽 90° 회전": "Rotate 90° left",
    "오른쪽 90° 회전": "Rotate 90° right",
    "↺ 초기화": "↺ Reset",
    "자르기(테두리)": "Crop (border)",
    "배치 크기": "Placed size",
    "도면에 배치될 부품 크기(px). 한쪽을 바꾸면 비율에 맞춰 다른 쪽도 바뀝니다.": "Part size on the diagram (px). Changing one side adjusts the other to keep the ratio.",
    "파란 사각형의 모서리를 드래그해 크기 조절, 안쪽을 드래그해 이동. 사각형 안만 남깁니다.": "Drag the blue rectangle's corners to resize, inside to move. Only the inside is kept.",
    "적용해서 배치": "Apply & place",

    // ===== 웰컴 모달 =====
    "이지케이블 — 쉬운 배선도 에디터 (EasyCable)": "EasyCable — Easy Wiring Diagram Editor",
    "🔌 이지케이블": "🔌 EasyCable",
    "이미지로 부품을 올리고, 단자를 찍고, 선을 이어": "Upload part images, place terminals, connect wires —",
    "배선도를 가장 쉽게": "the easiest way",
    "그리는 도구입니다.": "to draw wiring diagrams.",
    "좌측": "On the left,",
    "부품 라이브러리 ＋ 부품 추가": "Part Library → ＋ Add Part",
    "— 부품 사진을 올리면 배경 제거까지": "— upload a part photo, background removal included",
    "부품의": "Use the part's",
    "⋯ 메뉴 → 단자 배치": "⋯ menu → Terminal Layout",
    "로 단자를 찍고": "to place terminals",
    "모드로 단자끼리 클릭 연결 —": "mode: click terminals to connect —",
    "BOM·배선 리스트·PDF는 자동": "BOM, wire list & PDF are automatic",
    "현재": "Currently",
    "베타 테스트 중": "in beta",
    "입니다. 작업물은 이 브라우저에 자동 저장됩니다.": ". Your work is saved automatically in this browser.",
    "의견은 언제든": "Feedback is welcome anytime via",
    "피드백": "Feedback",
    "으로 남겨주세요.": ".",
    "시작하기": "Get Started",
    "24시간 동안 보지 않기": "Don't show for 24 hours",
    "이용 시": "By using this service, you agree to the",
    "에 동의한 것으로 간주됩니다.": ".",

    // ===== 이전 버전 복구 =====
    "🕘 이전 버전 복구": "🕘 Restore Version",
    "이 브라우저에 5분 간격으로 자동 보관된 최근 스냅샷입니다 (최대 3개).": "Recent snapshots auto-saved in this browser every 5 minutes (up to 3).",

    // ===== 도움말 =====
    "계속 추가될 예정입니다. 단축키는 ⚙ 설정에서 변경할 수 있습니다.": "More coming soon. Shortcuts can be changed in ⚙ Settings.",

    // ===== 피드백 =====
    "의견이나 버그를 자유롭게 적어주세요. 바로 전달됩니다.": "Write any feedback or bug report — it goes straight to us.",
    "예: 이런 기능이 있으면 좋겠어요 / 이 부분이 잘 안 돼요…": "e.g. I'd love this feature / This part doesn't work well…",
    "보내기": "Send",

    // ===== 출시 알림 =====
    "🔔 출시 소식 받기": "🔔 Get Launch Updates",
    "정식 출시·새 기능 소식을 이메일로 가장 먼저 알려드릴게요.": "Be the first to hear about launch & new features.",
    "(스팸 없이 큰 소식만)": "(No spam — big news only)",
    "예: myname@gmail.com": "e.g. myname@gmail.com",
    "알림 받기": "Notify me",
    "나중에 볼게요": "Maybe later",
    "입력하신 이메일은 소식 안내에만 사용됩니다.": "Your email is used only for these updates.",

    // ===== JS 동적 문구 =====
    "이지케이블 배선도": "EasyCable Diagram",

    // --- 샘플 프로젝트 데이터 (로드 시 치환) ---
    "샘플 배선도": "Sample Wiring Diagram",
    "배터리 12.6V 10Ah": "Battery 12.6V 10Ah",
    "스텝다운모듈": "Step-down module",
    "Micro SD 카드 모듈": "Micro SD card module",

    // --- 라이브러리 (library.js / app.js) ---
    "이미 '": "The part '",
    "' 부품이 라이브러리에 있습니다.\n\n": "' is already in the library.\n\n",
    "[확인] 기존 부품 덮어쓰기\n[취소] 새 부품으로 추가": "[OK] Overwrite existing part\n[Cancel] Add as a new part",
    "덮어썼습니다: ": "Overwritten: ",
    "새 부품으로 추가: ": "Added as new part: ",
    "라이브러리에 저장: ": "Saved to library: ",
    "부품라이브러리.ezclib": "part-library.ezclib",
    "라이브러리 불러오기: 새 부품 ": "Library imported: new ",
    "개": "",
    " · 기존 부품 ": " · updated ",
    "개 갱신": "",
    " · 배치 부품 ": " · reconnected ",
    "개 재연결": "",
    "가져오기 실패: ": "Import failed: ",
    "’ 부품을 라이브러리에서 삭제할까요?": "’ — remove this part from the library?",
    "등록된 부품이 없습니다.": "No parts yet.",
    "' 검색 결과가 없습니다.": "' — no results.",
    "클릭: 캔버스에 배치 · 드래그: 순서 변경": "Click: place on canvas · Drag: reorder",
    "즐겨찾기 해제": "Unfavorite",
    "즐겨찾기": "Favorite",
    "구매 링크 있음": "Has buy link",
    "정보/구매링크 편집": "Edit info / buy link",
    "부품": "Part",

    // --- 라이브러리 폴더 ---
    "클릭: 캔버스에 배치 · 드래그: 순서 변경/폴더 이동": "Click: place on canvas · Drag: reorder / move to folder",
    "새 폴더 만들기 (부품 분류용)": "New folder (organize parts)",
    "새 폴더 이름 (예: 센서류, MCU)": "New folder name (e.g. Sensors, MCU)",
    "새 폴더": "New folder",
    "폴더 이름": "Folder name",
    "폴더 이름 변경": "Rename folder",
    "클릭: 접기/펼치기 · 드래그: 순서 변경": "Click: collapse/expand · Drag: reorder",
    "하위 폴더 추가": "Add subfolder",
    "하위 폴더 이름 (예: 온도센서)": "Subfolder name (e.g. Temperature sensors)",
    "폴더 삭제 (부품은 남음)": "Delete folder (parts are kept)",
    "’ 폴더를 삭제할까요?\n(부품은 삭제되지 않고 상위/미분류로 이동합니다)": "’ — delete this folder?\n(Parts are not deleted; they move to the parent folder / Unfiled)",
    "최근 사용": "Recent",
    "표시 개수 줄이기 (0이면 목록 숨김)": "Show fewer (0 hides the list)",
    "표시 개수 늘리기": "Show more",
    "⚠️ 부품은 이 브라우저에만 저장됩니다": "⚠️ Parts are saved only in this browser",
    "방문기록을 지우거나 다른 PC에서 열면 사라져요.": "They disappear if you clear browsing data or open on another PC.",
    "파일로 백업해 두면 안전합니다.": "Backing up to a file keeps them safe.",
    "나중에 하기": "Later",
    "⤓ 지금 파일로 백업": "⤓ Back up to a file now",
    "미분류": "Unfiled",
    "(미분류)": "(Unfiled)",
    "비어 있음 — 부품을 끌어다 놓으세요": "Empty — drag parts here",
    "폴더": "Folder",

    // --- 데이터시트 뷰어 ---
    "<span class='muted'>첨부된 파일 없음</span>": "<span class='muted'>No files attached</span>",
    "'>보기</button>": "'>View</button>",
    "' title='삭제'>×</button></div>": "' title='Delete'>×</button></div>",
    "파일이 너무 큽니다(20MB 초과): ": "File too large (over 20MB): ",
    "<p class='muted'>미리보기를 지원하지 않는 형식입니다. 다운로드해서 확인하세요.</p>": "<p class='muted'>Preview not supported for this format. Download to view.</p>",
    "🗗 축소": "🗗 Restore",

    // --- BOM / 배선 리스트 표 ---
    "<tr><td class='muted' style='border:none'>배선이 없습니다.</td></tr>": "<tr><td class='muted' style='border:none'>No wires.</td></tr>",
    "<thead><tr><th>번호</th><th>색</th><th>AWG</th><th>전류(A)</th><th>출발</th><th>도착</th></tr></thead><tbody>": "<thead><tr><th>No.</th><th>Color</th><th>AWG</th><th>Current (A)</th><th>From</th><th>To</th></tr></thead><tbody>",
    "부품명": "Part",
    "수량": "Qty",
    " (더블클릭: 수정)'>": " (double-click: edit)'>",
    "<span class='bom-link-plain' title='더블클릭: 수정'>": "<span class='bom-link-plain' title='Double-click: edit'>",
    "<span class='bom-link-empty' title='더블클릭: 링크 입력'>—</span>": "<span class='bom-link-empty' title='Double-click: add link'>—</span>",
    " title='라이브러리 기본단가 ₩": " title='Library default price ₩",
    " → 이 배선도에서 수정됨 (비우면 기본값 복귀)'": " → edited in this diagram (blank = back to default)'",
    "' title='데이터시트 보기'>📎 ": "' title='View datasheets'>📎 ",
    "' title='데이터시트 첨부'>＋</button></td>": "' title='Attach datasheet'>＋</button></td>",
    "<span class='col-resize' title='드래그로 너비 조절'></span>": "<span class='col-resize' title='Drag to resize'></span>",
    "' title='더블클릭: 열 이름 변경'>": "' title='Double-click: rename column'>",
    "' title='열 삭제'>×</button>": "' title='Delete column'>×</button>",
    "<td class='bom-gutter'><span class='row-grip' draggable='true' title='드래그로 행 이동'>⠿</span>": "<td class='bom-gutter'><span class='row-grip' draggable='true' title='Drag to move row'>⠿</span>",
    "<button class='row-del' title='행 삭제'>×</button>": "<button class='row-del' title='Delete row'>×</button>",
    "<td>합계</td>": "<td>Total</td>",
    "열 ": "Col ",
    "열 이름": "Column name",
    "<option value=''>레이아웃…</option>": "<option value=''>Layouts…</option>",
    "이 레이아웃을 저장할 이름": "Name for this layout",
    "레이아웃 저장: ": "Layout saved: ",
    "삭제할 레이아웃을 목록에서 먼저 고르세요.": "Pick a layout from the list first.",
    "부품 목록 (BOM)": "Bill of Materials (BOM)",
    "<tr><th>번호</th><th>색</th><th>AWG</th><th>출발</th><th>도착</th></tr>": "<tr><th>No.</th><th>Color</th><th>AWG</th><th>From</th><th>To</th></tr>",
    "번호": "No.",
    "출발 부품": "From part",
    "출발 단자": "From terminal",
    "도착 부품": "To part",
    "도착 단자": "To terminal",
    "_배선리스트.csv": "_wirelist.csv",
    "배선 리스트 내보내기: ": "Wire list exported: ",

    // --- 전력/배터리 요약 ---
    "가동 ": "Duty ",
    "분/시간": "min/hour",
    " 분/시간": " min/hour",
    "분": " min",
    "일 (": " days (",
    "시간)": " hours)",
    "시간 (": " hours (",
    "일)": " days)",
    "총 소비전력(평균)": "Total consumption (avg)",
    "변환효율(평균)": "Conversion efficiency (avg)",
    "배터리 소비": "Battery draw",
    "하루 소비 에너지": "Daily energy use",
    " Wh/일": " Wh/day",
    "배터리 가용용량": "Usable battery capacity",
    "배터리 지속": "Battery runtime",
    "<p class=\"muted\">부품 정보(✎)에 역할·전압·전류(부하는 하루 가동시간)를 입력하면 소비전력과 배터리 지속시간이 계산됩니다.</p>": "<p class=\"muted\">Enter role, voltage & current in Part Info (✎) — plus daily duty time for loads — to calculate consumption and battery runtime.</p>",
    "<div class=\"pw-row\"><span>총 소비전력(평균)</span><b class=\"pw-big\">": "<div class=\"pw-row\"><span>Total consumption (avg)</span><b class=\"pw-big\">",
    "<div class=\"pw-row\"><span>변환효율(평균)</span><b>": "<div class=\"pw-row\"><span>Conversion efficiency (avg)</span><b>",
    "<div class=\"pw-row\"><span>배터리 소비</span><b>": "<div class=\"pw-row\"><span>Battery draw</span><b>",
    "<div class=\"pw-row\"><span>하루 소비</span><b>": "<div class=\"pw-row\"><span>Daily use</span><b>",
    " Wh/일</b></div>": " Wh/day</b></div>",
    "<div class=\"pw-row\"><span>배터리 가용용량</span><b>": "<div class=\"pw-row\"><span>Usable battery capacity</span><b>",
    "<div class=\"pw-runtime\"><span>배터리 지속</span><br><b class=\"pw-big\">": "<div class=\"pw-runtime\"><span>Battery runtime</span><br><b class=\"pw-big\">",
    "<p class=\"muted\" style=\"margin-top:6px\">배터리 역할 부품을 넣으면 지속시간이 계산됩니다.</p>": "<p class=\"muted\" style=\"margin-top:6px\">Add a battery-role part to calculate runtime.</p>",
    "부하": "Load",
    "전압": "Voltage",
    "전류": "Current",
    "전력": "Power",
    "용량": "Capacity",
    "가동": "Duty",
    "효율": "Efficiency",
    "<span class='muted'>전기값 미입력 — ⚙ 부품 정보에서 입력</span>": "<span class='muted'>No electrical values — enter in ⚙ Part Info</span>",

    // --- 모드/힌트/도움말 ---
    "현재 작업을 비우고 새 프로젝트를 시작할까요?\n(저장 안 한 내용은 사라집니다)": "Clear current work and start a new project?\n(Unsaved changes will be lost)",
    "단자를 클릭하고 다른 단자를 클릭하면 배선이 이어집니다.": "Click a terminal, then another, to connect a wire.",
    "캔버스를 클릭해 텍스트를 추가하세요. (더블클릭으로 편집)": "Click the canvas to add text. (Double-click to edit)",
    "배선 모드 (진입 시 배선색 팝업 자동 표시)": "Wire mode (color popup appears on entry)",
    "실행 취소 / 다시 실행": "Undo / Redo",
    "부품 복제": "Duplicate part",
    "화면 이동(팬)": "Pan view",
    "Space 드래그 · 휠클릭 드래그": "Space-drag · middle-click drag",
    "확대 / 축소": "Zoom in / out",
    "Ctrl+휠": "Ctrl+wheel",
    "선택 항목 삭제": "Delete selection",
    "즉시 저장": "Save now",
    "파일 열기": "Open file",
    "이 도움말": "This help",
    "색": "Color",

    // --- AWG/정렬 힌트 ---
    "합산할 부하를 선택하세요.": "Select loads to sum.",
    "구간 전압(V)을 입력하세요.": "Enter the segment voltage (V).",
    "부하 ": "Loads ",
    "개 = ": " = ",
    "권장 AWG ": "Recommended AWG ",
    "mm · 허용 ": "mm · rated ",
    "A (여유 ×": "A (margin ×",
    "신호선(기본 두께). 전류를 입력하면 규격을 자동 계산합니다.": "Signal wire (default width). Enter current to auto-calculate gauge.",
    "<span class='muted'>전력이 입력된 부하 부품이 없습니다.</span>": "<span class='muted'>No load parts with power entered.</span>",
    "세로선": "Vertical",
    "가로선": "Horizontal",
    " 정렬: ": " aligned: ",
    " · 간격 ": " · gap ",
    "균등 배치는 배선 3개 이상 선택하세요.": "Select 3+ wires to distribute.",
    "균등 배치할 ": "Not enough ",
    "세로": "vertical",
    "가로": "horizontal",
    " 구간이 부족합니다.": " segments to distribute.",
    " 균등 배치: ": " distributed: ",
    "배선이 없습니다.": "No wires.",

    // --- 선택 상태 ---
    "부품 ": "Parts ",
    "개 선택됨": " selected",
    "배선 ": "Wires ",
    "개 선택됨 (색·두께 일괄 변경)": " selected (bulk color/width edit)",

    // --- 출시 알림 / 피드백 ---
    "완성됐어요! 🎉 정식 출시·새 기능 소식을 이메일로 가장 먼저 알려드릴까요?<br />(스팸 없이 큰 소식만)": "Nice work! 🎉 Want to be the first to hear about launch & new features?<br />(No spam — big news only)",
    "정식 출시·새 기능 소식을 이메일로 가장 먼저 알려드릴게요.<br />(스팸 없이 큰 소식만)": "Be the first to hear about launch & new features.<br />(No spam — big news only)",
    "올바른 이메일 주소를 입력해주세요.": "Please enter a valid email address.",
    "감사합니다!": "Thank you!",
    "등록 중…": "Signing up…",
    "[이지케이블] 출시 알림 신청": "[EasyCable] Launch notification signup",
    "이지케이블 출시알림": "EasyCable launch notifications",
    "출시 알림 신청 이메일: ": "Signup email: ",
    "등록됐습니다. 소식이 있을 때 알려드릴게요. 감사합니다! 🙌": "You're on the list! We'll let you know when there's news. Thanks! 🙌",
    "등록 실패: ": "Signup failed: ",
    "잠시 후 다시 시도해주세요.": "Please try again in a moment.",
    "네트워크 오류로 등록하지 못했습니다.": "Network error — signup failed.",
    "잠시 후 다시 보내주세요. (": "Please wait before sending again. (",
    "초)": "s)",
    "오늘은 더 보낼 수 없습니다. 급하시면 ": "Daily limit reached. If urgent, email ",
    " 으로 보내주세요.": ".",
    "[이지케이블] 피드백": "[EasyCable] Feedback",
    "\">메일로 보내기</a>": "\">Send by email</a>",
    "내용을 입력해주세요.": "Please write something first.",
    "전달됐습니다. 감사합니다!": "Sent. Thank you!",
    "보내는 중…": "Sending…",
    "이지케이블 피드백": "EasyCable feedback",
    "전송 실패: ": "Send failed: ",
    "다시 시도해주세요.": "Please try again.",
    "네트워크 오류로 전송하지 못했습니다.": "Network error — could not send.",
    "(없음)": "(none)",

    // --- 내보내기 / 저장 / 히스토리 ---
    "내보낼 내용이 없습니다. 부품을 먼저 배치하세요.": "Nothing to export. Place a part first.",
    "이미지 생성에 실패했습니다.": "Failed to generate the image.",
    "배선도": "Wiring Diagram",
    "이미지 저장 완료 (PNG)": "Image saved (PNG)",
    "<p class='muted'>아직 보관된 스냅샷이 없습니다. 작업을 시작하면 5분 간격으로 자동 보관됩니다.</p>": "<p class='muted'>No snapshots yet. Once you start working, one is kept every 5 minutes.</p>",
    " (부품 ": " (parts ",
    " · 배선 ": " · wires ",
    "'>복구</button></div>": "'>Restore</button></div>",
    " 시점으로 되돌릴까요?\n(지금 화면의 작업은 사라집니다)": " — restore to this point?\n(Current work on screen will be lost)",
    "스냅샷을 읽을 수 없습니다: ": "Cannot read snapshot: ",
    "복구 완료: ": "Restored: ",
    " 시점": "",
    "현재 작업을 비우고 샘플 프로젝트를 열까요?\n(저장 안 한 내용은 사라집니다)": "Clear current work and open the sample project?\n(Unsaved changes will be lost)",
    "샘플 프로젝트가 아직 준비되지 않았습니다.": "The sample project isn't available yet.",
    "💾 저장됨 ": "💾 Saved ",
    "(이름 없음)": "(unnamed)",
    "이지케이블 프로젝트": "EasyCable project",
    "저장됨: ": "Saved: ",
    "_공유.ezc": "_share.ezc",
    "공유 파일 저장: ": "Share file saved: ",
    "개 포함)": " included)",
    "열기 완료: ": "Opened: ",
    " · 새 부품 ": " · new parts ",
    "개를 라이브러리에 추가": " added to library",
    "파일을 읽을 수 없습니다: ": "Cannot read file: ",

    // --- 기본 팔레트 / 단자 ---
    "+ (전원)": "+ (Power)",
    "중성": "Neutral",
    "신호": "Signal",
    "통신 (I2C 등)": "Comm (I2C etc.)",
    "새 단자": "New terminal",
    "(기본 T#)": "(default T#)",
    "단자 없음. 이미지를 클릭해 추가하세요.": "No terminals. Click the image to add.",
    "프리셋…": "Presets…",

    // --- 배선 라벨(수축튜브) ---
    "배선을 클릭해 라벨(수축튜브) 부착": "Click a wire to attach a label (shrink tube)",
    "▭ 라벨": "▭ Label",
    "라벨": "Label",
    "예: W1, B1, C1…": "e.g. W1, B1, C1…",
    "이 배선의 라벨 제거": "Remove this wire's label",
    "라벨 제거": "Remove label",
    "▭ 라벨 모드에서 배선을 클릭해 부착. 라벨은 드래그로 이동, 더블클릭으로 수정합니다.": "Attach in ▭ Label mode by clicking a wire. Drag to move, double-click to edit.",
    "라벨을 붙일 배선을 클릭하세요. 번호는 자동으로 매겨집니다. (더블클릭: 수정)": "Click a wire to attach a label. Numbers are assigned automatically. (Double-click: edit)",
    "라벨 문구 (비우면 라벨 삭제)": "Label text (blank = remove label)",
    "라벨 모드": "Label mode"
  };

  var MAPS = { en: EN };

  var META_DESC = {
    en: "Draw wiring diagrams the easy way: upload part images, place terminals, connect wires. Auto BOM, wire list & PDF. Free during beta."
  };

  // ---- 언어 결정 ----
  function detect() {
    var saved = null;
    try { saved = localStorage.getItem("we_lang"); } catch (e) { /* 무시 */ }
    if (saved && (saved === "ko" || MAPS[saved])) return saved;
    var nav = (navigator.language || "ko").toLowerCase();
    return nav.indexOf("ko") === 0 ? "ko" : "en";
  }
  var _lang = detect();

  // ---- 번역 함수 (JS 동적 문구용) ----
  function t(ko) {
    if (_lang === "ko") return ko;
    var map = MAPS[_lang];
    return (map && map[ko]) || ko;
  }

  // ---- DOM 일괄 치환 ----
  var ATTRS = ["title", "placeholder", "aria-label"];
  function translateDom(root) {
    if (_lang === "ko") return;
    var map = MAPS[_lang];
    if (!map) return;
    // 텍스트 노드: 앞뒤 공백은 유지하고 내용만 교체
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var raw = node.nodeValue;
      var key = raw.replace(/\s+/g, " ").trim();
      if (key && map[key] !== undefined) {
        node.nodeValue = raw.replace(key === raw.trim() ? raw.trim() : key, map[key]);
      }
    }
    // 속성
    var els = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (var i = 0; i < els.length; i++) {
      for (var a = 0; a < ATTRS.length; a++) {
        var v = els[i].getAttribute(ATTRS[a]);
        if (v && map[v] !== undefined) els[i].setAttribute(ATTRS[a], map[v]);
      }
    }
  }

  // ---- 언어 전환 (저장 후 새로고침 — 상태가 단순하고 확실함) ----
  function setLang(lang) {
    try { localStorage.setItem("we_lang", lang); } catch (e) { /* 무시 */ }
    location.reload();
  }

  // ---- 부팅: 문서 전체 번역 + 메타 + 토글 바인딩 ----
  function boot() {
    document.documentElement.lang = _lang;
    if (_lang !== "ko") {
      translateDom(document.body);
      var titleKey = "이지케이블 — 쉬운 배선도 에디터 (EasyCable)";
      if (MAPS[_lang][titleKey]) document.title = MAPS[_lang][titleKey];
      var md = document.querySelector('meta[name="description"]');
      if (md && META_DESC[_lang]) md.setAttribute("content", META_DESC[_lang]);
    }
    // 🌐 언어 메뉴 (data-setlang 버튼)
    var btns = document.querySelectorAll("[data-setlang]");
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        var l = b.getAttribute("data-setlang");
        if (l === _lang) b.classList.add("lang-active");
        b.addEventListener("click", function () { if (l !== _lang) setLang(l); });
      })(btns[i]);
    }
  }
  document.addEventListener("DOMContentLoaded", boot);

  return { t: t, lang: function () { return _lang; }, setLang: setLang, translateDom: translateDom };
})();

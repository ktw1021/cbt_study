# CBT 빈칸 학습 앱

로스쿨·자격시험용 **긴 원문 빈칸 학습** 로컬 웹 앱입니다.  
Anki처럼 **폴더/카드**를 관리하되, 학습 화면은 앞·뒤 카드 뒤집기가 아니라 **왼쪽 원문 + 오른쪽 빈칸 입력** 방식입니다.

서버·백엔드·로그인 없이 **브라우저만**으로 동작하며, 데이터는 **IndexedDB**에 저장되고 **JSON**으로 백업/복원할 수 있습니다.

---

## 실행 방법

### 방법 1 — 로컬 서버 (권장)

ES 모듈 특성상 아래처럼 간단히 서버를 띄운 뒤 브라우저에서 엽니다.

```bash
cd cbt_blank_study_app
npx --yes serve .
```

브라우저에서 `http://localhost:3000` (또는 표시된 주소) 접속.

### 방법 2 — VS Code Live Server

`index.html` 우클릭 → **Open with Live Server**

### 방법 3 — Python

```bash
cd cbt_blank_study_app
python -m http.server 8080
```

`http://localhost:8080` 접속.

---

## 주요 기능

| 영역 | 기능 |
|------|------|
| **사용자** | 유저1/유저2처럼 로컬 다중 사용자, 추가·이름변경·삭제 |
| **폴더** | Anki식 무한 계층 트리, 접기/펼치기, 카드 수 표시, CRUD |
| **카드** | 제목·폴더·원문·메모·플래그·회독수 관리 |
| **빈칸** | Ctrl+D 수동 생성, 해제, 원문 순서 자동 재번호, 자동 빈칸(후보 확인) |
| **학습** | 좌우 분리·독립 스크롤, 빈칸 클릭 상호 이동, 9가지 학습 큐 |
| **채점** | Levenshtein 유사도, 슬라이더 조절, 빈칸별 수동 정답/오답 |
| **백업** | 전체/유저/폴더 JSON 내보내기, 가져오기(병합·덮어쓰기) |
| **Undo** | Ctrl+Alt+Z (텍스트 Ctrl+Z와 분리) |

---

## 간단 사용법

1. **카드제작** → 원문 입력 → 텍스트 드래그 → **Ctrl+D** → 정답 확인 → **저장**
2. **카드관리** → 폴더 선택 / 카드 드래그로 폴더 이동
3. **학습모드** → 학습 방식 선택 → **학습 시작** → 답 입력 → **자동 채점**
4. 좌측 **전체/유저/폴더 내보내기**로 JSON 백업

### 단축키

- `Ctrl+D` — 선택 영역 빈칸 만들기
- `Ctrl+Alt+Z` — 앱 상태 되돌리기
- `Ctrl+1~7` — 플래그 색상 / `Ctrl+0` — 플래그 해제
- `Enter` (학습 중 입력창) — 자동 채점

### 샘플 데이터

첫 실행 시 민법 샘플 카드 2개가 포함됩니다. 상단 **샘플 데이터 → 삭제** 버튼으로 제거할 수 있습니다.

---

## 폴더 구조

```
cbt_blank_study_app/
├── index.html              # 앱 셸 (HTML만, 로직 없음)
├── README.md               # 이 문서
├── css/
│   ├── variables.css       # CSS 변수 (색·그림자)
│   ├── layout.css          # 그리드·사이드바·학습 레이아웃
│   └── components.css      # 버튼·패널·트리·모달 등 UI 컴포넌트
└── js/
    ├── main.js             # 진입점, 이벤트 위임, 초기화
    ├── config.js           # 상수 (DB명, UNDO 한도, 불용어)
    ├── core/
    │   ├── store.js        # 런타임 상태 (data + UI 세션)
    │   └── storage.js      # IndexedDB load/save
    ├── domain/
    │   ├── migrate.js      # 기본 상태·샘플·데이터 마이그레이션
    │   ├── blank.js        # 빈칸 토큰 동기화·자동 빈칸 로직
    │   └── queries.js      # User/Folder/Card 조회·필터·학습 큐
    ├── services/
    │   ├── undo.js         # 스냅샷 기반 되돌리기
    │   ├── grading.js      # 유사도·정답 판정
    │   └── import-export.js # JSON 내보내기/가져오기
    ├── ui/
    │   ├── router.js       # 화면 섹션 전환
    │   ├── render.js       # renderAll 오케스트레이터
    │   ├── sidebar.js      # 사용자·통계·선택 카드
    │   ├── manage.js       # 폴더 트리·카드 목록·상세
    │   ├── create.js       # 카드 제작 폼·미리보기
    │   ├── study.js        # 학습 화면·채점 UI
    │   ├── modal.js        # 자동 빈칸 후보 모달
    │   └── prompt.js       # 원문 HTML 렌더 (빈칸 배지)
    ├── app/
    │   └── actions.js      # 사용자 액션 (저장·채점·CRUD 등)
    └── utils/
        ├── text.js         # uid, escapeHtml, normalize, shuffle
        └── dom.js          # selectionRange 등 DOM 헬퍼
```

### 파일 역할 요약

- **`index.html`** — 마크업과 `data-action` 속성만. 이벤트는 `main.js`가 위임 처리.
- **`core/`** — 저장소(store)와 IndexedDB. UI와 분리된 데이터 계층.
- **`domain/`** — 순수 비즈니스 규칙 (빈칸 번호 재정렬, 폴더 쿼리 등).
- **`services/`** — undo, 채점, import/export처럼 횡단 관심사.
- **`ui/`** — DOM 렌더링만. 상태 변경은 `app/actions.js`가 담당.
- **`app/actions.js`** — 버튼·단축키 → domain/service 호출 → persist → render.

---

## 데이터

- **저장소:** IndexedDB `cbt_blank_study_v1`
- **백업:** JSON 파일 (전체 / 현재 유저 / 선택 폴더)
- **모델:** User, Folder, Card, Blank (카드별 `rounds`, `flagColor`, `memo` 등)

루트의 `cbt_blank_study_app.html`(단일 파일 버전)은 이전 프로토타입이며, **이 폴더 버전이 정식 구조**입니다.

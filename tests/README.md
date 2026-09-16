# 회귀 검사

실제 버그의 재발을 확인하는 테스트와 공용 도구만 보관한다. 앱 실행·정적 배포에는 필요 없지만, 수정 후 기존 동작을 확인하기 위해 Git에서 관리한다. 스크린샷·실행 로그는 OS 임시 폴더에 저장한다.

```powershell
node tests/all.mjs --unit # 모델·저장 호환 검사
node tests/all.mjs        # 전체, 순차 실행
```

Node.js 22 이상. 브라우저 검사는 `playwright-core`와 Edge/Chromium이 필요하다. 앱의 런타임 의존성에는 추가하지 않는다. 환경에 이미 설치된 도구를 사용하며, 자동 설치하지 않는다.

- `CBT_PLAYWRIGHT_CORE`: `playwright-core` 패키지 폴더(그 안에 `index.mjs`).
- `CBT_BROWSER_EXE`: 사용할 브라우저 실행 파일. Windows에서는 설치된 Edge/Chrome을 자동 탐색한다.
- 기본 로컬 서버와 다른 포트·임시 브라우저 프로필·합성 계정으로 검사한다. 실제 DB나 `env.alph`를 읽지 않는다. 일부 포트를 공유하므로 전체 실행은 순차로 한다.

## 검사 범위

| 실행 파일 | 확인할 동작 |
|---|---|
| `*.test.mjs` | 서식·각주 좌표, 줄바꿈, 빈칸 메타, 가져오기, 구버전 세션의 계정 분리 |
| `run.mjs` | 빈칸 이동 목록, 카드 단일·Shift·Ctrl 선택과 폴더 드래그, Undo, 터치 |
| `account-switch.mjs` | 계정 목록·PIN·취소·전환, 계정별 학습 진행 |
| `editor-browser.mjs` | 제작·수정·서식·각주·메모·저장·학습 복귀 전체 흐름 |
| `editor-linebreak.mjs`, `editor-ux.mjs` | 입력·삭제 시 줄바꿈, 툴바·툴팁·탭·좁은 화면 |
| `align-footnote-ui.mjs`, `complex-editor-ui.mjs` | 정렬 반복, 칩·서식·빈 문단 조합, 각주 위치·번호, 저장·복원 |
| `footnote-interaction.mjs` | 각주 옆 키보드 이동·삭제 확인, hover 내용·양방향 강조 |
| `release-browser.mjs` | 정렬된 문단의 빈칸 변환, 가져온 각주 id, 서비스워커·버전 갱신·패치 목록 |

`navigation-ui.mjs`와 `lib/`는 공용 fixture·관측·서버 도구다. 단독 실행을 별도 검사 통과로 세지 않는다.

자동 검사 통과가 모든 브라우저·OS에서의 무결함을 보장하지는 않는다. 운영 전에는 실제 한글 IME, 긴 카드, 실제 staging의 업데이트도 확인한다.

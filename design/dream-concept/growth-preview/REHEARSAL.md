# 달빛 성장 시안

Stageshow의 `device-pair`에서 두 장면을 한 화면에 비교하는 구성을 가져왔다. 넓은 보드는 같은 전투 장면의 충전과 레벨업 상태를 나란히 보여준다. 모바일에서는 전투와 강화 선택을 탭으로 전환한다. 320px와 390px 각각 실제 게임을 캡처해 사용했다. 기존 경험치바는 캡처 중 화면에서 숨겼다.

타이머 아래의 금빛 획과 달 숫자는 경험치와 레벨의 예시 상태다. 크림색 카드에는 이름 → 그림 → 설명 → 별을 배치했다. 별 1·3·5단계를 비교할 수 있도록 섞었다. 시안의 전투는 정지 장면이다.

## 확인 기록

- ‘달빛이 스민 띠’는 같은 320px 전투 캡처에서 20%·50%·90%를 비교하는 별도 시안이다. 18px 청록색 띠 안에 8px 금빛 채움과 레벨 숫자를 놓고 상단 HUD와 8px 간격을 뒀다. 상단 180px 크롭은 경험치 비교용이며 전체 390px 화면도 보존했다. 992px·320px 정지 검사를 통과했다. [비교 보드](../../../artifacts/moonlight-strip-study-board.png) · [390px 전체 화면](../../../artifacts/moonlight-strip-study-mobile-390.png)
- 카드 정렬은 실제 게임과 미리보기 모두 제목·그림·설명·별을 같은 행 기준으로 잡았다. 투명 그림의 윤곽을 잘라 공통 크기로 그리고, 설명은 첫 줄부터 정렬한다. 실제 후보 1·2·3장과 8종 강화 조합의 확인 결과는 [성장 UI 검증](../../PROGRESSION_IMPLEMENTATION.md)에 기록했다.
- 4차 시안은 경험치 트랙과 레벨 숫자 자리를 연속된 외곽선으로 연결했다. 오른쪽 끝만 부드럽게 넓히고 크림빛 숫자를 안에 놓았다. 390px·320px의 충전과 선택 상태, 두 정지 검사를 통과했다.
- 3차 시안은 탕탕특공대 전투 HUD의 가로 배치를 참고해 경험치 줄을 좌우 12px 여백까지 늘렸다. 트랙 너비는 390px 화면에서 338px, 320px 화면에서 268px이며, 레벨 숫자는 오른쪽 끝에 놓았다. 68% 충전과 100% 완료 화면, 824px 비교 보드와 320px 정지 검사를 확인했다. [2차 시안](../../../artifacts/moonlight-growth-board-v2.png) · [320px 전투](../../../artifacts/moonlight-growth-combat-320.png)
- 2차 시안은 별 다섯 자리를 독립된 SVG로 그리고, 황금색과 회갈색 실루엣으로 채운 별과 남은 별을 구분했다. 390px에서는 15px, 320px에서는 13px 아이콘을 쓴다. 경험치 트랙은 158×8px로 넓히고 둥근 채움 끝과 밝은 트랙 테두리를 사용했다. [탕탕특공대 선택 캡처](../../../artifacts/survivorio-choice-reference-review.png) · [1차 시안](../../../artifacts/moonlight-growth-board-v1.png)
- 2차 시안의 빌드와 824px·320px 정지 검사가 통과했다. 두 모바일 너비에서 카드별 별 5개와 채움 3·1·5개, 가로 넘침, 320px 터치 탭 전환을 확인했다.
- 824px 비교 보드와 320px 선택 화면에서 Stageshow `--still --gate` 검사를 통과했다. 보드 하단을 화면 끝에 맞췄고, 320px 그림 칸은 카드의 안쪽 여백을 확보했다.
- Chromium에서 390×844와 320×568 터치 뷰포트의 전환을 확인했다. 세 카드와 별이 화면에 들어갔고, 가로 넘침과 페이지 오류는 없었다. 확인 범위는 정지 시안과 미리보기 탭이다.
- `node design/dream-concept/growth-preview/build-preview.mjs`로 미리보기를 `dist/growth-preview/`에 만든다. 게임과 같은 로컬 테스트 서버에서 `growth-preview/growth-preview.html`을 연다.

[비교 보드](../../../artifacts/moonlight-growth-board.png) · [390px 전투](../../../artifacts/moonlight-growth-combat-390.png) · [390px 선택](../../../artifacts/moonlight-growth-choice-390.png) · [320px 선택](../../../artifacts/moonlight-growth-choice-320.png)

## 그림 자산

내장 imagegen으로 기존 플레이어의 붓결을 참조해 투명 그림 아틀라스를 제작했다. [그림 아틀라스](dream-shards.png) · [참조 플레이어](../../../public/art/moonlight/player.png)

> Create one transparent 3-column game art atlas, landscape 3:1 aspect ratio, for a Korean cozy dream survival game. Reference image is style only, no characters. Render exactly three separate equally sized isolated objects on real transparent background, with very generous gutters: (left third, center x=1/6) a tiny twig sword with round wooden blade angled up right and a muted coral cloth grip; (middle third, center x=1/2) a broad teal-green leaf angled up right with two small painted wind strokes; (right third, center x=5/6) a faceted warm golden moonstone with a faint cream facet, a simple round diamond shape. Objects centered vertically, each stays entirely inside its own equal-width third and has good clear margin. Muted gouache, soft gently irregular edges, flat distinct silhouettes, subtle painted paper texture, match the cozy hand-painted game character. Designed to read when reduced to 52px. No lines of text, letters, numbers, people, cards, sparkles, border, scenic backgrounds or shadows on ground.

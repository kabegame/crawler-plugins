# anihonet 애니메이션 벽지 - 플러그인 안내

[anihonetwallpaper.com](https://anihonetwallpaper.com)에서 벽지를 가져와 다운로드 큐에 넣습니다. **랭킹**과 **작품 제목 목록(애니·게임)** 두 가지 모드를 지원하며, 호환을 위해 기본값은 **랭킹**입니다.

## 수집 모드（crawl_mode）

| 값 | 설명 |
|----|------|
| **ranking**（기본） | 기간별 랭킹 목록 → 각 작품 상세에서 다운로드 |
| **anime_game** | [작품 제목 목록](https://anihonetwallpaper.com/anime-game-wallpaper)에서 행 선택 → 테마 목록 → 작품 상세 → 원본 링크 |

**anime_game**에서는 **anime_game_rows**로 あ/か/さ… 행(페이지 `h3`의 `id`: a, ka, sa, …)을 선택합니다.

## 랭킹 모드

1. **시작/끝 페이지**와 **랭킹 기간**으로 랭킹 URL을 엽니다(예: `ranking-daily-imgpc/1`).
2. 목록 페이지의 모든 `<a href>`를 순서대로 방문합니다(내비 링크가 포함될 수 있음).
3. 상세에서는 **`a.button:not(.add)`**의 `href`를 다운로드 버튼으로 사용(클래스 토큰 `add`는 제외, `add-dl`과 구분).

**진행률(작업 전체 100%)**: **목록 페이지 균등 → 페이지당 링크 균등 → 상세의 이미지당 균등**. 건너뛴 뒤에도 해당 이미지 분량이 반영됩니다. `a`가 0이면 해당 페이지 분량을 한 번에, 버튼이 0이면 해당 작품 분량을 한 번에 반영합니다.

## 작품 목록 모드

1. 인덱스 페이지에서 선택한 행의 테마 `<a href>`를 파싱합니다.
2. **테마 목록**에서는 **`.itiran:last-of-type > a`**의 `href`로 상세 진입(브라우저 `$$('.itiran:last-of-type > a')`와 동일 취지).
3. 상세에서는 원본에 **`a.button.add-dl`**을 사용합니다.

**진행률(작업 전체 100%)**: **테마(목록 항목) 균등 → 테마 내 작품 균등 → 작품 내 이미지 균등**. 필터로 건너뛰어도 이미지 분량은 소비됩니다.

## 벽지 유형과 필터

- **wallpaper_type**: `imgpc`는 데스크톱만, `sp`는 모바일만. 이미지 URL **파일명**에 `Android` 포함 여부(대소문자 무시)로 판별.
- **원본**: URL에 **`resize`**가 포함되면 썸네일로 보고 **다운로드하지 않음**.

## 설정 요약

| 키 | 내용 | 표시 |
|----|------|------|
| **crawl_mode** | `ranking` / `anime_game` | 항상 |
| **anime_game_rows** | 행 다중 선택 | anime_game만 |
| **start_page / end_page** | 1–5 | ranking만 |
| **ranking_period** | daily / weekly / monthly / annual | ranking만 |
| **wallpaper_type** | imgpc / sp | 항상 |

## 팁

- 휴대폰 벽지만: 벽지 유형 「휴대폰」.
- 데스크톱만: 「데스크톱」.
- 목록 모드는 양이 커질 수 있으므로 행을 좁히세요. `[anihonet]` 로그로 페이지와 시도 내역을 확인할 수 있습니다.

楽しんで～
![image](./image.jpg)

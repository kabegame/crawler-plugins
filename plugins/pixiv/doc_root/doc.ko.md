# Pixiv 크롤러 - 플러그인 안내

이 플러그인은 Pixiv에서 일러스트를 가져옵니다. 랭킹, 북마크, 작가 작품, 키워드 검색 네 가지 모드를 지원합니다.

## HTTP 헤더 설정 (필수)

Pixiv API는 인증과 Referer가 필요합니다. **Cookie는 「고급 설정 → HTTP 헤더」에서 설정하세요.** 플러그인 변수로 주입되지 않습니다.

### Cookie 얻는 방법

#### 방법 1: 브라우저에서 복사

1. 브라우저에서 [pixiv.net](https://www.pixiv.net) **로그인** (미가입 시 가입)

![home](./images/home.png)

2. 개발자 도구(F12) 열기 → 네트워크 탭으로 이동 (이미지의 빨간 상자)

![console](./images/console.png)

3. 이미지 순서대로 cookie 복사

![cookie](./images/cookie.png)

4. Kabegame 실행
5. cookie가 필요한 설정에서 HTTP 헤더 추가

![header](./images/header-config.png)

#### 방법 2: Kabegame 서프 페이지에서 복사 (더 쉬움, PC만)

1. Kabegame 실행 후 서프 탭으로 이동

![kabegame-surf](./images/kabegame-surf.png)

2. 플러그인 빠른 입장 → Pixiv 선택 → 「서프 시작」 클릭. Pixiv 창이 열리면 로그인

![surf-pixiv](./images/surf-pixiv.png)

3. 로그인 후 「사이트 cookie 보기」(창 닫지 말 것) 클릭 후 표시된 cookie 복사

![cookie-dialog](./images/cookie-dialog.png)

4. 준비 완료.

### 사용자 ID 얻기 (본인 또는 작가)

Pixiv에서 해당 사용자 프로필을 열면, URL 중간 또는 끝의 숫자가 사용자 ID입니다.

![user](./images/user.png)

### Cookie가 필요한 경우

| 모드 | Cookie |
|------|--------|
| 랭킹(비 R18) | 선택 |
| 랭킹(R18) | 필수 |
| 북마크 | 필수 |
| 작가 작품(비 R18) | 선택 |
| 작가 작품(R18) | 필수 |
| 키워드 검색(비 R18) | 선택 |
| 키워드 검색(R18) | 필수 |

## 크롤 타입

- **랭킹**: 일/주/월 랭킹으로 지정 날짜 작품 다운로드
- **북마크**: 공개 북마크 다운로드
- **작가 작품**: 지정 작가의 공개 작품 다운로드
- **키워드 검색**: 키워드로 검색 후 다운로드

## 설정 항목

선택한 모드에 따라 항목이 바뀝니다.

- **랭킹**: 랭킹 유형, 콘텐츠 유형, 시작일(YYYYMMDD), 날짜 범위, 최대 다운로드 수
- **북마크**: 사용자 UID, 최대 다운로드 수
- **작가**: 사용자 UID, 작가 UID, 최대 다운로드 수
- **키워드**: 검색 키워드, 검색 모드(세이프/R18/전체), 정렬(날짜/인기), 최대 다운로드 수. **잘 쓰면 원하는 것만 정확히 받을 수 있습니다**

## 주의사항

- 403이 나오면 cookie를 다시 받아보세요. 가끔만 나오면 rate limit일 수 있으니 작업을 몇 번 더 실행하거나, 서프 페이지에서 수동 다운로드하세요.
- Cookie 만료 후에는 다시 받아야 합니다.
- 키워드는 고급 검색 문법 지원 (예: `(Lucy OR 边缘行者) AND 5000users`)
- **인기순**은 Pixiv Premium이 필요합니다. Premium이 아니면 「날짜순」을 사용하세요.
- 최대 다운로드 수를 적당히 설정해 Pixiv 부하를 줄여주세요.

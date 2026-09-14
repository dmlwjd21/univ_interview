# 대입 면접 아카이브 · Vercel 실시간 검색

학생이 어떤 대학이든 대학·학과·전형을 입력하면 서버가 OpenAI Responses API의 Web Search로 공식 입학처 → 교육청·공공포털 → 공개 후기 순서로 조사합니다. 전년도 입결을 별도로 검색하고, 출처가 연결된 JSON을 화면에 표시합니다. Google Spreadsheet나 Apps Script는 사용하지 않습니다.

## 실행 코드

- 서버 진입점: api/search.js
- **실제 OpenAI HTTP 호출: lib/research.js의 researchWeb() → https://api.openai.com/v1/responses**
- 입력·CORS·비용 제한·캐시 처리: lib/search-handler.js
- 엄격한 JSON 응답 스키마와 검증: lib/research-schema.js
- 교체 가능한 캐시: lib/cache.js
- 화면: index.html, assets/app.js, assets/style.css
- Vercel 설정: vercel.json
- 로컬 개발 서버와 정적 빌드: scripts/dev-server.js, scripts/build.js

기본 모델은 정확히 gpt-5.6-terra이며 OPENAI_MODEL이 있으면 해당 값을 사용합니다. 모델을 자동으로 다른 모델로 바꾸지 않습니다. API 호출은 web_search 도구, external_web_access: true, tool_choice: required, strict JSON Schema 출력을 사용합니다. 실제 검색 도구 실행이 없는 응답, 불완전한 응답, 검색 결과·인용에 없는 URL은 성공으로 처리하거나 캐시하지 않습니다. 이 검증이 원문 내용의 완전한 정확성을 보장하지는 않으므로 화면에 원문 링크를 함께 표시합니다.

## 환경변수

| 변수 | 필수 | 용도 |
| --- | --- | --- |
| OPENAI_API_KEY | 예 | 서버에서만 사용하는 OpenAI API 키 |
| OPENAI_MODEL | 아니요 | 미설정 시 gpt-5.6-terra |
| ALLOWED_ORIGINS | 아니요 | 다른 프론트엔드 도메인을 허용할 때 정확한 Origin을 쉼표로 구분. 기본값은 동일 출처만 허용 |
| PORT | 아니요 | 로컬 개발 서버 포트. 기본값 3000 |

.env.local은 로컬 개발에만 사용합니다. 키를 HTML, JavaScript 브라우저 파일, JSON 데이터, GitHub Actions 로그에 넣지 마세요. .env와 .env.*는 .gitignore에서 제외합니다. 빌드 출력에는 index.html과 assets의 브라우저 파일 두 개만 복사하며 환경변수나 서버 파일을 복사하지 않습니다.

## Vercel 배포

1. GitHub 저장소를 Vercel에서 Import합니다.
2. Framework Preset은 Other, Root Directory는 이 저장소 루트를 사용합니다.
3. Node.js 22.x를 선택합니다. vercel.json에 Build Command와 Output Directory가 각각 node scripts/build.js, public으로 설정돼 있습니다. api/search.js는 별도 Node.js 서버리스 함수로 처리됩니다.
4. Project Settings → Environment Variables에 OPENAI_API_KEY를 등록합니다. 필요하면 OPENAI_MODEL을 추가합니다. 테스트할 Preview 환경에도 키를 별도로 적용하세요.
5. Deploy합니다. 키를 배포 후 추가했다면 Redeploy합니다.
6. 배포 URL에서 실제 검색하고 Network 탭의 POST /api/search가 200인지 확인합니다. 동일 조건 재검색 시 X-Search-Cache: HIT 또는 COALESCED가 표시될 수 있습니다.

함수 최대 실행 시간은 240초, OpenAI 호출 제한 시간은 210초입니다. 프로젝트 실행 시간 설정이 이를 지원해야 합니다. 사용 중인 플랜/Fluid compute 설정에서 제한을 확인하세요.

GitHub Pages와 Python 정적 HTTP 서버는 /api/search를 실행할 수 없습니다. 실시간 검색은 Vercel 또는 아래 Node 개발 서버에서 실행해야 합니다.

## 로컬 실행과 테스트

Node.js 22.x에서 실행합니다. 런타임 외 설치할 npm 의존성은 없습니다.

    npm run check
    npm test
    npm run build
    npm run dev

개발 서버는 http://localhost:3000 이며, npm run dev는 .env.local이 있으면 읽습니다. OPENAI_API_KEY가 없으면 화면은 열리고 검색 API는 안전한 503 오류를 반환합니다.

배포 API를 직접 확인할 때는 다음 JSON을 application/json으로 POST /api/search에 보냅니다.

    {
      "schoolType": "4년제",
      "university": "검색할 대학명",
      "major": "검색할 모집단위",
      "admissionTrack": "검색할 전형명"
    }

테스트는 외부 유료 호출 없이 Responses 요청 형식, Web Search 실행 여부, 원문 URL 연결, 모호한 입결 처리, 30일 만료, 중복 요청 병합, 실패 캐시 금지, CORS·입력 검증, 프론트엔드 로딩·오류·HTML 이스케이프를 검증합니다. 실제 API 키/모델 접근 권한과 검색 결과 품질은 Vercel 배포 후 별도로 확인해야 합니다.

## 응답과 연도 기준

최상위 응답은 university, major, admissionTrack, searchedAt, interviewOverview, questions, trends, reviews, tips, admissionResults, sources입니다.

- questions: 연도별 year, note, items. 각 항목에 question, interviewType, questionCategory, sourceType, sourceName, sourceUrl이 있습니다.
- admissionResults: year, status와 공개된 capacity, applicants, competitionRate, additionalAdmits, additionalRank, registeredAverage, cut50, cut70, studentRecordGrade, convertedScore, calculationBasis, sourceName, sourceUrl, sourceType, notes를 저장합니다. 미확인 값은 null입니다. 0은 실제 공개된 0인 경우 보존합니다.
- reviews: 분위기, 면접관 수, 시간, 질문·꼬리질문 특징, 준비 팁을 짧게 요약합니다.
- sources: title, url, sourceType(A/B/C), year. 원문 링크는 카드와 출처 목록에서 클릭할 수 있습니다.
- trends: 확인된 질문 유형이 2개 이상 학년도에 존재할 때 서버가 계산합니다.

한국 시간 기준 3월부터 다음 입학 학년도를 준비 대상으로 삼고, 그 직전 학년도 입결과 직전 5개 입학 학년도 면접을 조사합니다. 예를 들어 2026년 9월에는 2027학년도 준비, 2026학년도 입결, 2022~2026학년도 기출입니다. searchedAt은 모델이 아닌 서버가 설정합니다.

자료가 없다는 이유로 면접 미실시를 단정하지 않습니다. 미실시 표시는 해당 학년도 대학 공식 자료가 명시한 경우에만 허용됩니다. 캠퍼스·학과·전형이 모호하면 조사 결과에서 불확실성을 확인하세요.

## 캐시와 비용

메모리 캐시는 최대 100건, TTL은 30일입니다. 키에는 학교 유형·대학·학과·전형·모델·학년도·스키마 버전이 포함됩니다. 같은 인스턴스에서 진행 중인 동일 요청도 합쳐 한 번만 호출합니다. 결과에 최초 조사일과 캐시 만료 시각을 표시합니다.

Vercel 인스턴스 재시작, 새 배포, 다중 인스턴스에서는 메모리가 공유·보존되지 않으므로 30일 보관을 보장하지 않습니다. 영구 캐시로 바꾸려면 lib/cache.js의 비동기 get(key), set(key, value, ttlMs), delete(key) 계약을 구현해 createSearchHandler에 주입하세요. get은 { value, expiresAt } 또는 null을 반환합니다. 분산 중복 요청 방지는 별도 잠금도 필요합니다.

미캐시 요청은 인스턴스별 IP당 시간당 10회, 동시 조사 4개로 제한합니다. 이 제한과 CORS는 인증이나 전역 비용 상한을 대신하지 않습니다. 공개 운영 시 Vercel Firewall 등의 전역 제한과 OpenAI 프로젝트 예산 설정을 함께 적용하세요.

## 기존 데이터와 자동 갱신

data/의 부산대학교 자료는 이전 버전의 원문 대조 전 예시로만 남아 있습니다. 실시간 화면과 API는 이 데이터를 로드하지 않으며 public 빌드에도 포함하지 않습니다. 검색 실패 시 예시를 실제 결과처럼 보여주지 않습니다. 특정 대학용 분기는 없습니다.

scripts/update_data.py와 .github/workflows/update-data.yml은 기존 정적 데이터 수집 작업입니다. 실시간 검색과는 독립적이며 필요할 때 별도로 운영할 수 있습니다.

## GitHub push 전 확인

- .env, .env.local, API 키가 변경 목록에 포함되지 않았는지 확인합니다. 이전에 추적한 비밀 파일은 .gitignore만으로 제거되지 않습니다.
- npm run check, npm test, npm run build를 실행합니다.
- public/, .vercel/, node_modules/는 커밋하지 않습니다.
- Vercel Production/Preview 환경에 API 키와 사용할 모델의 접근 권한이 준비됐는지 확인합니다.
- 실시간 검색은 GitHub Pages에서 동작하지 않는다는 점과 메모리 캐시의 한계를 확인합니다.

참고: [OpenAI Web Search](https://developers.openai.com/api/docs/guides/tools-web-search), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js).


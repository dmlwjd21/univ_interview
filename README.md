# 대입 면접 아카이브 · 단계별 실시간 검색

학생이 대학·학과·전형을 입력하면 Vercel 서버리스 함수가 OpenAI Responses API의 Web Search로 조사합니다. 기본 자료를 먼저 보여주고, 5개년 기출과 공개 후기를 별도 함수에서 병렬로 찾습니다. 어떤 단계가 실패해도 이미 표시한 다른 단계의 결과는 유지합니다.

## 검색 단계

| API | 내용 | 기본 모델 |
| --- | --- | --- |
| `POST /api/search-overview` | 공식 입학처 도메인, 최신 모집요강·면접 방식·최신 기출·전년도 입결 | `gpt-5.6-luna` |
| `POST /api/search-questions` | 최근 5개년 공식·교육청 기출, 반복 주제 | `gpt-5.6-luna` |
| `POST /api/search-reviews` | 공개 교육청·블로그·카페 후기 요약과 준비 팁 | `gpt-5.6-terra` |

요청 본문은 세 API 모두 같습니다.

```json
{"schoolType":"4년제","university":"서울대학교","major":"정치외교학부","admissionTrack":"일반전형"}
```

프론트엔드는 첫 응답을 즉시 렌더링하고, 나머지 두 API에 `Promise.allSettled`로 병렬 요청합니다. 각 호출은 서버에서 53초, 브라우저에서 58초 제한을 두고 Vercel 함수는 최대 60초로 설정했습니다. 외부 Web Search 소요 시간은 매번 달라 10~30초를 보장할 수 없습니다. 첫 결과 최악의 대기 시간은 약 1분이고, 추가 단계는 그 뒤 병렬로 진행됩니다.

입학처 공식 URL은 첫 검색 때 웹에서 찾고 30일 캐시에 저장합니다. 이후 같은 대학 검색은 해당 도메인에 집중합니다. 검색 단계별 결과 캐시 키는 학교 유형·대학·학과·전형·모델·학년도·단계를 포함하고 TTL은 30일입니다. 기본 캐시는 메모리여서 Vercel 인스턴스 간 공유나 재시작 후 보존이 보장되지 않습니다. Upstash Redis를 연결하고 아래 REST 환경변수를 설정하면 `lib/cache.js`가 별도 패키지 없이 공유 캐시를 사용합니다. Redis 장애 시 검색은 메모리 캐시로 계속 동작합니다.

출처 URL은 Web Search 실행 결과 또는 URL 인용에서 확인합니다. 확인되지 않은 출처·질문·후기만 제외하며 나머지 단계와 항목은 반환합니다. 입결은 공식 대학 입학처를 우선 조사하고, 같은 학과·전형의 공식 수치가 없을 때만 어디가·전문대학포털을 보조로 사용합니다. 공개되지 않은 수치는 `null`이며 계산하거나 추정하지 않습니다. 자료가 없다고 면접이 없다는 뜻은 아닙니다.

## 환경변수와 배포

| 이름 | 용도 |
| --- | --- |
| `OPENAI_API_KEY` | 필수. 서버에서만 읽음 |
| `OPENAI_MODEL_FAST` | 기본 검색·기출 모델, 기본값 `gpt-5.6-luna` |
| `OPENAI_MODEL_ANALYSIS` | 후기 요약 모델, 기본값 `gpt-5.6-terra` |
| `ALLOWED_ORIGINS` | 선택. 별도 프론트엔드 Origin 허용 목록 |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | 선택. 30일 공유 캐시. Vercel의 구형 `KV_REST_API_URL`, `KV_REST_API_TOKEN`도 지원 |

Vercel에 이 저장소를 Import하고 Framework Preset `Other`, Root Directory 저장소 루트, Node.js 22.x를 선택합니다. `vercel.json`이 빌드와 함수 제한을 설정합니다. Vercel Project Settings → Environment Variables에 `OPENAI_API_KEY`를 등록한 뒤 배포 또는 Redeploy하세요. 반복 검색 비용을 줄이려면 Vercel Marketplace에서 Upstash Redis를 연결하고 REST URL·토큰 변수를 설정하세요. API 키를 브라우저 코드나 Git에 넣지 마세요. `.env`, `.env.local`, `.env.*`는 `.gitignore`에 포함돼 있습니다. 이 앱은 서버리스 API가 필요하므로 GitHub Pages 단독 배포에서는 실시간 검색이 실행되지 않습니다.

## 검사

Node.js 22.x:

```sh
npm run check
npm test
npm run build
npm run dev
npm run test:live:snu
```

단위 테스트는 서울대학교·정치외교학부·일반전형을 회귀 사례로 사용해 검색 프롬프트, Web Search 요청, 부분 URL 실패, 30일 캐시와 프론트엔드 단계별 렌더링을 검증합니다. `test:live:snu`는 실제 OpenAI 유료 검색을 2회 호출하는 선택적 통합 검사이므로 API 키가 있을 때만 실행합니다. 별도 실제 웹 검색에서는 [2027 수시모집 안내](https://admission.snu.ac.kr/undergraduate/early/guide), [2026 면접 및 구술고사 문항](https://admission.snu.ac.kr/materials/downloads/samples?bbsidx=167141&md=v), [전형결과·선발현황](https://admission.snu.ac.kr/materials/stats/result), [면접 안내](https://snuarori.snu.ac.kr/interview/guide)가 확인되었습니다. 현재 로컬에 API 키가 없으면 실제 OpenAI Responses 경로 검사는 배포 후 같은 사례로 실행해야 합니다.

이전 `data/`의 부산대학교 샘플은 정적 갱신 작업의 예시로만 남아 있습니다. 실시간 검색 화면은 그 파일을 로드하지 않으며 부산대학교를 특별 취급하지 않습니다.

참고: [OpenAI Web Search](https://developers.openai.com/api/docs/guides/tools-web-search), [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Vercel Functions](https://vercel.com/docs/functions).

#!/usr/bin/env bash
# 공공데이터포털은 활용신청 승인 직후 게이트웨이 반영에 1~2시간이 걸린다.
# 서비스가 살아나는 즉시 입결을 받아 오도록 주기적으로 두드린다.
set -u
cd "$(dirname "$0")/../.."
set -a; . ./.env.local; set +a

for i in $(seq 1 24); do   # 10분 간격 × 24 = 4시간
  BODY=$(curl -s -m 30 "${DATA_GO_KR_ENDPOINT}?serviceKey=${DATA_GO_KR_KEY}&pageNo=1&numOfRows=1&svyYr=2025" || true)
  if ! printf '%s' "$BODY" | grep -q "NO_OPENAPI_SERVICE_ERROR"; then
    echo "[$(date +%H:%M)] 서비스 응답 확인 — 수집 시작"
    printf '%s\n' "$BODY" | head -c 1500
    echo
    node scripts/collect/admission-results.mjs
    exit 0
  fi
  echo "[$(date +%H:%M)] 아직 반영 안 됨 (시도 $i/24)"
  sleep 600
done
echo "4시간 동안 반영되지 않았습니다. 활용신청 상태를 확인해 주세요."
exit 1

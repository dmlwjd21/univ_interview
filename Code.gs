/**
 * 구글 시트 → 깃허브 연결기
 *
 * 자동 수집이 놓친 문항(전문대, 교육청 자료집, 학생 후기)을
 * 선생님과 학생이 시트에 적으면 이 스크립트가 깃허브에 올린다.
 * 앱은 data/contributed.json 을 읽어 자동 수집분과 함께 보여준다.
 *
 * ── 처음 한 번만 설정 ──
 * 1. 구글 시트를 만들고 확장 프로그램 → Apps Script 에 이 코드를 붙인다.
 * 2. 프로젝트 설정 → 스크립트 속성에 아래 셋을 넣는다.
 *      GITHUB_TOKEN   깃허브 토큰 (Contents 읽기/쓰기 권한)
 *      GITHUB_REPO    아이디/저장소이름     예) hongkildong/interview-archive
 *      GITHUB_BRANCH  main
 * 3. 시트 상단 메뉴 '면접 자료' → '시트 형식 만들기' 를 누른다.
 * 4. 자료를 채운 뒤 '깃허브로 올리기' 를 누른다.
 */

const SHEETS = {
  문항: ['대학', '학년도', '전형', '모집단위', '계열', '면접방법',
        '질문 (한 줄에 하나, 꼬리질문은 | 로 연결)', '유의사항', '출처'],
  후기: ['대학', '학년도', '모집단위', '후기 요약', '출처'],
  입시결과: ['대학', '학년도', '전형', '모집단위', '모집인원', '경쟁률', '충원율', '교과70%컷', '출처'],
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('면접 자료')
    .addItem('시트 형식 만들기', 'setupSheets')
    .addItem('깃허브로 올리기', 'pushToGithub')
    .addToUi();
}

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (name) {
    let sh = ss.getSheetByName(name) || ss.insertSheet(name);
    const head = SHEETS[name];
    sh.getRange(1, 1, 1, head.length).setValues([head])
      .setFontWeight('bold').setBackground('#eceff4');
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, head.length);
  });
  SpreadsheetApp.getUi().alert('시트 세 개를 만들었습니다. 1행은 지우지 마세요.');
}

/** 시트를 읽어 객체 배열로 바꾼다. */
function readSheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, SHEETS[name].length).getValues();
  return vals.filter(function (r) { return String(r[0]).trim(); });
}

function collectData_() {
  const year = new Date().getMonth() + 1 >= 4
    ? new Date().getFullYear() : new Date().getFullYear() - 1;

  const questions = readSheet_('문항').map(function (r) {
    const qs = String(r[6]).split('\n')
      .map(function (x) { return x.trim(); })
      .filter(String);
    return {
      univ: String(r[0]).trim(),
      year: Number(r[1]) || year,
      adm: String(r[2]).trim(),
      major: String(r[3]).trim(),
      field: String(r[4]).trim(),
      method: String(r[5]).trim(),
      qs: qs,
      note: String(r[7]).trim(),
      src: { k: 'school', t: String(r[8]).trim() || '시트 입력', p: '' },
      contributed: true,
    };
  }).filter(function (q) { return q.qs.length; });

  const tips = readSheet_('후기').map(function (r) {
    return {
      univ: String(r[0]).trim(), year: Number(r[1]) || year,
      major: String(r[2]).trim(), text: String(r[3]).trim(), src: String(r[4]).trim(),
    };
  }).filter(function (t) { return t.text; });

  const results = readSheet_('입시결과').map(function (r) {
    return {
      univ: String(r[0]).trim(), year: Number(r[1]) || year,
      adm: String(r[2]).trim(), major: String(r[3]).trim(),
      cap: String(r[4]), comp: String(r[5]), fill: String(r[6]),
      cut: String(r[7]), src: String(r[8]).trim(),
    };
  });

  return {
    updated: Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ss"),
    questions: questions, tips: tips, results: results,
  };
}

function pushToGithub() {
  const p = PropertiesService.getScriptProperties();
  const token = p.getProperty('GITHUB_TOKEN');
  const repo = p.getProperty('GITHUB_REPO');
  const branch = p.getProperty('GITHUB_BRANCH') || 'main';
  const ui = SpreadsheetApp.getUi();

  if (!token || !repo) {
    ui.alert('스크립트 속성에 GITHUB_TOKEN 과 GITHUB_REPO 를 먼저 넣으세요.');
    return;
  }

  const data = collectData_();
  const path = 'data/contributed.json';
  const api = 'https://api.github.com/repos/' + repo + '/contents/' + path;
  const headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
  };

  // 덮어쓰려면 기존 파일의 sha 가 필요하다. 없으면 새로 만든다.
  let sha = null;
  const cur = UrlFetchApp.fetch(api + '?ref=' + branch,
    { headers: headers, muteHttpExceptions: true });
  if (cur.getResponseCode() === 200) sha = JSON.parse(cur.getContentText()).sha;

  const body = {
    message: '시트에서 자료 올림 ' + data.updated.slice(0, 10),
    content: Utilities.base64Encode(
      JSON.stringify(data, null, 1), Utilities.Charset.UTF_8),
    branch: branch,
  };
  if (sha) body.sha = sha;

  const res = UrlFetchApp.fetch(api, {
    method: 'put', headers: headers, contentType: 'application/json',
    payload: JSON.stringify(body), muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  if (code === 200 || code === 201) {
    ui.alert('올렸습니다.\n\n문항 ' + data.questions.length +
      '건 · 후기 ' + data.tips.length +
      '건 · 입시결과 ' + data.results.length + '건' +
      '\n\n앱을 새로고침하면 바로 보입니다.');
  } else {
    ui.alert('실패 (HTTP ' + code + ')\n\n' + res.getContentText().slice(0, 400));
  }
}

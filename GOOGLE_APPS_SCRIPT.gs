// Google Apps Script Web App for Nexis account signup/login.
// Sheet columns must be: A=이름, B=아이디, C=이메일, D=비번.

const SHEET_NAME = '시트1';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = String(body.action || '').trim();

    if (action === 'register') {
      return json(registerAccount(body));
    }

    if (action === 'login') {
      return json(loginAccount(body));
    }

    return json({ ok: false, code: 'unknown_action', error: '알 수 없는 요청입니다.' });
  } catch (error) {
    return json({ ok: false, code: 'server_error', error: error.message });
  }
}

function registerAccount(body) {
  const sheet = getAccountSheet();
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const id = String(body.id || email.split('@')[0] || '').trim();

  if (!name || !email || !password) {
    return { ok: false, code: 'missing_fields', error: '이름, 이메일, 비밀번호를 모두 입력해 주세요.' };
  }

  if (findAccountByEmail(sheet, email)) {
    return { ok: false, code: 'duplicate_email', error: '이미 등록된 이메일 주소입니다.' };
  }

  sheet.appendRow([name, id, email, password]);
  return {
    ok: true,
    user: { name, id, email }
  };
}

function loginAccount(body) {
  const sheet = getAccountSheet();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const account = findAccountByEmail(sheet, email);

  if (!account || account.password !== password) {
    return { ok: false, code: 'invalid_credentials', error: '사용자 정보가 틀렸습니다.' };
  }

  return {
    ok: true,
    user: {
      name: account.name,
      id: account.id,
      email: account.email
    }
  };
}

function getAccountSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.getSheets()[0];
  const headers = sheet.getRange(1, 1, 1, 4).getValues()[0];
  const expectedHeaders = ['이름', '아이디', '이메일', '비번'];

  if (headers.join('') !== expectedHeaders.join('')) {
    sheet.getRange(1, 1, 1, 4).setValues([expectedHeaders]);
  }

  return sheet;
}

function findAccountByEmail(sheet, email) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  for (const row of rows) {
    const account = {
      name: String(row[0] || '').trim(),
      id: String(row[1] || '').trim(),
      email: String(row[2] || '').trim().toLowerCase(),
      password: String(row[3] || '')
    };

    if (account.email === email) {
      return account;
    }
  }

  return null;
}

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

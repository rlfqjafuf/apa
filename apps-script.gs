// Google Apps Script Web App for Nexis account signup/login and API key lookup.
// Account sheet columns must be: A=이름, B=아이디, C=이메일, D=비번.
// API key sheet must be named "키" and store the OpenAI API key in A2.

const SHEET_NAME = '시트1';
const KEY_SHEET_NAME = '키';
const KEY_CELL = 'A2';

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

    if (action === 'getOpenAiKey') {
      return json(getOpenAiKey(body));
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

  const existing = findAccountByEmail(sheet, email);
  if (existing) {
    sheet.getRange(existing.rowIndex, 1, 1, 4).setValues([[name, id, email, password]]);
    return {
      ok: true,
      updated: true,
      user: { name, id, email }
    };
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

function getOpenAiKey(body) {
  const configuredSecret = PropertiesService.getScriptProperties().getProperty('GOOGLE_APPS_SCRIPT_SECRET') || '';
  const requestSecret = String(body.secret || '');

  if (configuredSecret && requestSecret !== configuredSecret) {
    return { ok: false, code: 'invalid_secret', error: 'API 키 요청 권한이 없습니다.' };
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(KEY_SHEET_NAME);
  if (!sheet) {
    return { ok: false, code: 'missing_key_sheet', error: '키 시트를 찾지 못했습니다.' };
  }

  const apiKey = String(sheet.getRange(KEY_CELL).getValue() || '').trim();
  if (!apiKey) {
    return { ok: false, code: 'missing_api_key', error: '키 시트 A2에 API 키가 없습니다.' };
  }

  return { ok: true, apiKey };
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
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const account = {
      name: String(row[0] || '').trim(),
      id: String(row[1] || '').trim(),
      email: String(row[2] || '').trim().toLowerCase(),
      password: String(row[3] || ''),
      rowIndex: index + 2
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

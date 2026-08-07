function normalizedId(value) {
  return String(value || "").trim();
}

export function suiteAgentIds(suite = {}) {
  const fallback = normalizedId(suite.defaultAgentId);
  const ids = new Set();
  if (fallback) ids.add(fallback);
  for (const testCase of suite.cases || []) {
    const agentId = normalizedId(testCase.agentId) || fallback;
    if (agentId) ids.add(agentId);
  }
  return [...ids];
}

export function suiteAgentId(suite = {}) {
  const ids = suiteAgentIds(suite);
  return ids.length === 1 ? ids[0] : null;
}

export function assertConnectionSuiteScope(connection, suiteId, label = "テストスイート") {
  const expected = normalizedId(suiteId);
  const actual = normalizedId(connection?.suiteId);
  if (!expected) {
    throw Object.assign(new Error(`${label}を指定してください。`), { status: 400 });
  }
  if (!actual) {
    throw Object.assign(new Error("Google Sheets接続にテストスイートが紐づいていません。再接続してください。"), { status: 409 });
  }
  if (actual !== expected) {
    throw Object.assign(
      new Error(`${label} (${expected}) とGoogle Sheets接続のテストスイート (${actual}) が一致しません。`),
      { status: 409 }
    );
  }
  return expected;
}

export function assertSuiteAgentScope(suite, agentId, label = "テストスイート") {
  const expected = normalizedId(agentId);
  const ids = suiteAgentIds(suite);
  if (!expected) throw Object.assign(new Error("Google Sheets接続にData Agentが紐づいていません。"), { status: 409 });
  if (!ids.length) {
    throw Object.assign(new Error(`${label}にData Agentが設定されていません。`), { status: 400 });
  }
  if (ids.length !== 1 || ids[0] !== expected) {
    throw Object.assign(
      new Error(`${label}のData Agent (${ids.join(", ")}) とGoogle Sheets接続のData Agent (${expected}) が一致しません。`),
      { status: 409 }
    );
  }
  return expected;
}

export function suitesForAgent(suites = [], agentId) {
  const expected = normalizedId(agentId);
  return suites.filter((suite) => suiteAgentId(suite) === expected);
}

export function reportAgentId(report = {}) {
  const snapshotId = suiteAgentId(report.suiteSnapshot || {});
  if (snapshotId) return snapshotId;
  const ids = new Set((report.caseRuns || []).map((item) => normalizedId(item.agentId)).filter(Boolean));
  return ids.size === 1 ? [...ids][0] : null;
}

export function assertReportAgentScope(report, agentId) {
  const expected = normalizedId(agentId);
  const actual = reportAgentId(report);
  if (!expected) throw Object.assign(new Error("Google Sheets接続にData Agentが紐づいていません。"), { status: 409 });
  if (!actual) {
    throw Object.assign(new Error("評価レポートのData Agentを一意に特定できません。"), { status: 400 });
  }
  if (actual !== expected) {
    throw Object.assign(
      new Error(`評価レポートのData Agent (${actual}) とGoogle Sheets接続のData Agent (${expected}) が一致しません。`),
      { status: 409 }
    );
  }
  return actual;
}

export function selectSheetConnectionBinding(connections = [], agentId, spreadsheetId) {
  const owner = normalizedId(agentId);
  const sheetId = normalizedId(spreadsheetId);
  const byAgent = connections.find((connection) => normalizedId(connection.agentId) === owner);
  const bySpreadsheet = connections.find((connection) => normalizedId(connection.spreadsheetId) === sheetId);
  if (bySpreadsheet?.agentId && normalizedId(bySpreadsheet.agentId) !== owner) {
    throw Object.assign(new Error("このGoogleスプレッドシートは別のData Agentに紐づいています。"), { status: 409 });
  }
  if (byAgent && bySpreadsheet && byAgent.id !== bySpreadsheet.id) {
    throw Object.assign(new Error("Data Agentまたはスプレッドシートに重複した接続があります。接続設定を確認してください。"), { status: 409 });
  }
  return byAgent || bySpreadsheet || null;
}

export function selectSuiteSheetConnectionBinding(connections = [], suiteId, spreadsheetId) {
  const owner = normalizedId(suiteId);
  const sheetId = normalizedId(spreadsheetId);
  const suiteMatches = connections.filter((connection) => normalizedId(connection.suiteId) === owner);
  const spreadsheetMatches = connections.filter((connection) => normalizedId(connection.spreadsheetId) === sheetId);
  if (suiteMatches.length > 1 || spreadsheetMatches.length > 1) {
    throw Object.assign(new Error("テストスイートまたはスプレッドシートに重複した接続があります。接続設定を確認してください。"), { status: 409 });
  }
  const [bySuite] = suiteMatches;
  const [bySpreadsheet] = spreadsheetMatches;
  if (bySpreadsheet?.suiteId && normalizedId(bySpreadsheet.suiteId) !== owner) {
    throw Object.assign(new Error("このGoogleスプレッドシートは別のテストスイートに紐づいています。"), { status: 409 });
  }
  if (bySuite && bySpreadsheet && bySuite.id !== bySpreadsheet.id) {
    throw Object.assign(new Error("テストスイートまたはスプレッドシートに重複した接続があります。接続設定を確認してください。"), { status: 409 });
  }
  return bySuite || bySpreadsheet || null;
}

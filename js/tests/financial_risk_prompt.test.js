const assert = require('assert');
const {
  PROMPT_TEMPLATES,
  parseAndValidateAiJson
} = require('../config.js');

// 測試對象：C001（信用卡釣魚網站詐騙與 OTP 驗證扣款爭議，評議結果為請求無理由）
// 案卷來源：docs/C001_案卷.md
const C001_CASE_DATA = {
  case_id: 'C001',
  applicant: null,
  case_type: '銀行業 - 信用卡',
  dispute_item: '信用卡釣魚網站詐騙與OTP驗證扣款爭議',
  dispute_amount: {value: 18423, currency: 'TWD'},
  received_date: '2026-03-20',
  case_status: '請求無理由',
  confirmed_facts: ['持卡人點擊假冒財政部釣魚連結並輸入信用卡資訊及OTP驗證碼，致遭刷卡消費。'],
  related_regulations: ['金融消費者保護法第13條', '金融消費者保護法第27條', '金融消費者保護法第29條'],
  source: '評議書(114評005851)',
  text_context: null
};

function buildValidC001Response() {
  return {
    schema_version: '1.0',
    feature: 'financial_risk_estimation',
    status: 'success',
    data: {
      settlement_estimate: {
        min: 34104, max: 96350, currency: 'TWD',
        estimate_type: 'verified_estimate',
        basis: '同態樣信用卡盜刷評議結果 C002、C009、C025、C035、C037'
      },
      regulatory_fine_estimate: {min: 300000, max: 10000000, currency: 'TWD', estimate_type: 'verified_estimate', basis: '同 most_likely_range'},
      regulatory_assessment: {
        trigger_status: 'potential',
        trigger_reason: '持卡人已依警語提示仍輸入OTP，發卡機構是否已充分揭露風險尚待確認',
        possible_violations: [
          {law: '金融消費者保護法', article: '第27條', reason: '金融服務業對金融商品或服務之風險揭露義務', source_id: 'C001-law-27'}
        ],
        statutory_fine_range: {min: 300000, max: 10000000, currency: 'TWD', basis: '金融消費者保護法第27條所定裁罰級距'},
        comparable_penalty_range: {min: 300000, max: 1500000, currency: 'TWD', case_count: 3, basis: '主管機關就同法條裁罰案例（含文號）'},
        risk_scenario: 'medium',
        risk_scenario_reason: '單一客訴、無重複性證據，但涉及揭露義務爭議',
        most_likely_range: {min: 300000, max: 1500000, currency: 'TWD', basis: '3 件同法條、相近違規態樣正式裁罰案例'},
        missing_evidence: []
      },
      confidence: 0.6,
      methodology: '依同態樣評議結果與同法條裁罰案例估算',
      missing_inputs: [],
      assumptions: [],
      precedents: [{title: '評議書(115評000102)', reference_no: 'C002'}]
    },
    citations: [],
    warnings: []
  };
}

async function runTests() {
  console.log('Running financial risk prompt/contract tests (C001)...');

  // Test 1: financialRisk 提示詞必須把 C001 的案件事實帶入【可用輸入】
  const prompt = PROMPT_TEMPLATES.financialRisk(C001_CASE_DATA);
  assert.ok(prompt.includes('"case_id": "C001"'), 'Prompt should embed C001 case_id in input JSON');
  assert.ok(prompt.includes('18423'), 'Prompt should embed C001 dispute amount');
  assert.ok(prompt.includes('此次任務類型為 financial_risk_estimation'), 'Prompt should declare the correct feature');
  console.log('✓ Test 1 Passed: prompt embeds C001 case data');

  // Test 2: 提示詞必須要求主動查詢同態樣案件，不能單憑本案欄位就判定資料不足
  assert.ok(prompt.includes('必須主動'), 'Prompt should require active lookup before declaring insufficient data');
  assert.ok(prompt.includes('同態樣評議結果'), 'Prompt should allow comparable adjudication outcomes as basis');
  console.log('✓ Test 2 Passed: prompt requires active comparable-case search');

  // Test 3: 提示詞必須要求 statutory_fine_range 綁定 possible_violations 實際列出的條號，不得援引未列出的條文
  assert.ok(prompt.includes('possible_violations 所列') || prompt.includes('possible_violations 未列出'), 'Prompt should tie statutory_fine_range to the articles actually listed in possible_violations');
  console.log('✓ Test 3 Passed: prompt ties statutory fine range to cited articles');

  // Test 4: 一個完整、通過契約驗證的 C001 回應應該成功解析
  const validResponse = buildValidC001Response();
  const parsed = parseAndValidateAiJson(JSON.stringify(validResponse), 'financial_risk_estimation');
  assert.strictEqual(parsed.data.regulatory_assessment.possible_violations[0].article, '第27條', 'Should preserve cited article');
  assert.strictEqual(parsed.data.settlement_estimate.min, 34104, 'Should preserve settlement min');
  console.log('✓ Test 4 Passed: valid C001 response passes contract validation');

  // Test 5: 缺少 regulatory_assessment 必要欄位時必須被拒絕，不能靜默通過
  const missingFieldResponse = buildValidC001Response();
  delete missingFieldResponse.data.regulatory_assessment.statutory_fine_range;
  assert.throws(
    () => parseAndValidateAiJson(JSON.stringify(missingFieldResponse), 'financial_risk_estimation'),
    /監理評估 JSON 缺少欄位/,
    'Should reject response missing statutory_fine_range'
  );
  console.log('✓ Test 5 Passed: missing regulatory field is rejected');

  // Test 6: feature 名稱不符（例如聊天室殘留前一輪 case_lookup 的回覆）必須被拒絕
  const wrongFeatureResponse = buildValidC001Response();
  wrongFeatureResponse.feature = 'case_lookup';
  assert.throws(
    () => parseAndValidateAiJson(JSON.stringify(wrongFeatureResponse), 'financial_risk_estimation'),
    /AI JSON feature 不符/,
    'Should reject mismatched feature name'
  );
  console.log('✓ Test 6 Passed: mismatched feature name is rejected');

  // Test 7: 模型漏加引號的常見錯誤（例如 basis 欄位使用未加引號的中文佔位字）仍可被寬鬆解析修復
  const raw = JSON.stringify(validResponse).replace('"金融消費者保護法第27條所定裁罰級距"', '待補');
  const repaired = parseAndValidateAiJson(raw, 'financial_risk_estimation');
  assert.strictEqual(repaired.data.regulatory_assessment.statutory_fine_range.basis, '待補', 'Should repair bare placeholder value into a quoted string');
  console.log('✓ Test 7 Passed: bare placeholder value auto-repaired');

  // Test 8: most_likely_range 缺值卻沒有列出 missing_evidence 必須被拒絕，
  // 這正是「目前最可能區間：資料不足，暫不顯示」＋「Chat 未提供具體證據缺口」
  // 同時出現在畫面上的根因——模型宣稱缺資料卻未說明缺什麼，不該被靜默接受。
  const noRangeNoEvidence = buildValidC001Response();
  noRangeNoEvidence.status = 'insufficient_data';
  noRangeNoEvidence.data.regulatory_assessment.most_likely_range = {min: null, max: null, currency: 'TWD', basis: null};
  noRangeNoEvidence.data.regulatory_assessment.missing_evidence = [];
  assert.throws(
    () => parseAndValidateAiJson(JSON.stringify(noRangeNoEvidence), 'financial_risk_estimation'),
    /missing_evidence 不得為空/,
    'Should reject a null most_likely_range with no stated missing_evidence'
  );
  console.log('✓ Test 8 Passed: empty most_likely_range without missing_evidence is rejected');

  // Test 9: 只要缺值的同時有具體列出缺什麼證據，仍應允許通過（合法的資料不足案例）
  const noRangeWithEvidence = buildValidC001Response();
  noRangeWithEvidence.status = 'insufficient_data';
  noRangeWithEvidence.data.regulatory_assessment.most_likely_range = {min: null, max: null, currency: 'TWD', basis: null};
  noRangeWithEvidence.data.regulatory_assessment.missing_evidence = ['查無 3 件以上同法條、相近違規態樣之正式裁罰案例'];
  const acceptedInsufficient = parseAndValidateAiJson(JSON.stringify(noRangeWithEvidence), 'financial_risk_estimation');
  assert.strictEqual(acceptedInsufficient.data.regulatory_assessment.missing_evidence.length, 1, 'Should accept null range when missing_evidence explains why');
  console.log('✓ Test 9 Passed: null most_likely_range with stated missing_evidence is accepted');

  // Test 10: C009（申請人請求部分有理由，爭議金額 35,280，但無確認之實際給付金額）—
  // 提示詞必須允許以爭議金額作為上限情境估計，並要求標明依據。
  const c009Prompt = PROMPT_TEMPLATES.financialRisk({
    case_id: 'C009', case_type: '信用卡', dispute_item: '信用卡自動扣繳失敗爭議',
    dispute_amount: {value: 35280, currency: 'TWD'}, case_status: '申請人請求部分有理由'
  });
  assert.ok(c009Prompt.includes('disputed_amount_upper_bound'), 'Prompt should describe the disputed-amount upper-bound tier');
  assert.ok(c009Prompt.includes('對申請人有利'), 'Prompt should gate the upper-bound tier on a favorable ruling');
  console.log('✓ Test 10 Passed: prompt describes the disputed-amount upper-bound fallback tier');

  // Test 11: disputed_amount_upper_bound 必須附上 basis 說明，不能只給數字不給說明
  const upperBoundNoBasis = buildValidC001Response();
  upperBoundNoBasis.data.settlement_estimate = {min: null, max: 35280, currency: 'TWD', estimate_type: 'disputed_amount_upper_bound', basis: ''};
  assert.throws(
    () => parseAndValidateAiJson(JSON.stringify(upperBoundNoBasis), 'financial_risk_estimation'),
    /disputed_amount_upper_bound.*basis/,
    'Should reject disputed_amount_upper_bound without a basis explanation'
  );
  console.log('✓ Test 11 Passed: disputed_amount_upper_bound without basis is rejected');

  // Test 12: disputed_amount_upper_bound 附上 basis 時應正常通過
  const upperBoundWithBasis = buildValidC001Response();
  upperBoundWithBasis.data.settlement_estimate = {
    min: null, max: 35280, currency: 'TWD', estimate_type: 'disputed_amount_upper_bound',
    basis: '以 C009 本案爭議金額 35,280 元推估上限，非確認之實際給付金額'
  };
  const acceptedUpperBound = parseAndValidateAiJson(JSON.stringify(upperBoundWithBasis), 'financial_risk_estimation');
  assert.strictEqual(acceptedUpperBound.data.settlement_estimate.max, 35280, 'Should accept disputed_amount_upper_bound with a basis explanation');
  console.log('✓ Test 12 Passed: disputed_amount_upper_bound with basis is accepted');

  // Test 13: 這是一個活體測試中實際觀察到的幻覺——模型把 C009 的評議書(115評000214)
  // （消費爭議評議結果）誤標成 comparable_penalty_range 的正式主管機關裁罰案例。評議書
  // 和裁罰案例是完全不同性質的資料，絕不能混用，否則使用者會誤以為主管機關真的開罰過。
  const hallucinatedPenalty = buildValidC001Response();
  hallucinatedPenalty.data.regulatory_assessment.comparable_penalty_range = {
    min: 35280, max: 35280, currency: 'TWD', case_count: 1,
    basis: '[評議書(115評000214)]：信用卡自動扣繳失敗爭議，裁罰金額35280元。'
  };
  assert.throws(
    () => parseAndValidateAiJson(JSON.stringify(hallucinatedPenalty), 'financial_risk_estimation'),
    /評議書（消費爭議評議結果）而非正式裁罰案例/,
    'Should reject comparable_penalty_range whose basis is actually an ombudsman case, not a regulator penalty'
  );
  console.log('✓ Test 13 Passed: ombudsman case mislabeled as a regulatory penalty precedent is rejected');

  // Test 14: 同樣的守則也套用在 statutory_fine_range，避免把評議書內容當成法定罰鍰級距依據
  const hallucinatedStatutory = buildValidC001Response();
  hallucinatedStatutory.data.regulatory_assessment.statutory_fine_range = {
    min: 35280, max: 35280, currency: 'TWD',
    basis: '依評議書(115評000214)所載金額推估法定罰鍰級距。'
  };
  assert.throws(
    () => parseAndValidateAiJson(JSON.stringify(hallucinatedStatutory), 'financial_risk_estimation'),
    /評議書（消費爭議評議結果）而非正式裁罰案例/,
    'Should reject statutory_fine_range whose basis is actually an ombudsman case'
  );
  console.log('✓ Test 14 Passed: ombudsman case mislabeled as statutory fine basis is rejected');

  // Test 15: C001 本身的評議結果是「請求無理由」（全部駁回）——這是已確定的事實，
  // 提示詞必須要求把這個情況填為 min:0,max:0（case_outcome_confirmed），而不是留白。
  assert.ok(prompt.includes('case_outcome_confirmed'), 'Prompt should describe the confirmed-case-outcome tier (min:0/max:0 for a denied claim)');
  assert.ok(prompt.includes('請求無理由'), 'Prompt should explicitly tie a fully-denied claim to a confirmed $0 outcome');
  console.log('✓ Test 15 Passed: prompt describes the case_outcome_confirmed tier for denied claims');

  // Test 16: trigger_status=not_identified（已查明本案不構成違規，是明確結論）時，
  // most_likely_range 為 null 且 missing_evidence 為空陣列必須被接受——這不是資料不足，
  // 是「查過了，沒有違規」。這正是 C001 顯示「資料不足」而非「已確認無曝險」的根因。
  const noViolationConfirmed = buildValidC001Response();
  noViolationConfirmed.data.regulatory_assessment.trigger_status = 'not_identified';
  noViolationConfirmed.data.regulatory_assessment.trigger_reason = '已查明本案持卡人重大過失，發卡機構無違反金融消費者保護法之具體事實。';
  noViolationConfirmed.data.regulatory_assessment.possible_violations = [];
  noViolationConfirmed.data.regulatory_assessment.statutory_fine_range = {min: null, max: null, currency: 'TWD', basis: null};
  noViolationConfirmed.data.regulatory_assessment.comparable_penalty_range = {min: null, max: null, currency: 'TWD', case_count: 0, basis: null};
  noViolationConfirmed.data.regulatory_assessment.most_likely_range = {min: null, max: null, currency: 'TWD', basis: null};
  noViolationConfirmed.data.regulatory_assessment.missing_evidence = [];
  noViolationConfirmed.data.settlement_estimate = {min: 0, max: 0, currency: 'TWD', estimate_type: 'case_outcome_confirmed', basis: '本案評議結果為請求無理由，未獲賠付，非資料不足'};
  const acceptedNoViolation = parseAndValidateAiJson(JSON.stringify(noViolationConfirmed), 'financial_risk_estimation');
  assert.strictEqual(acceptedNoViolation.data.settlement_estimate.min, 0, 'Confirmed $0 outcome should pass through as 0, not null');
  assert.strictEqual(acceptedNoViolation.data.regulatory_assessment.missing_evidence.length, 0, 'not_identified with empty missing_evidence should be accepted, not rejected');
  console.log('✓ Test 16 Passed: not_identified conclusion with $0 confirmed outcome is accepted, not treated as insufficient data');

  // Test 17: 活體測試中觀察到的第二種幻覺變形——模型只寫出評議書文號（如
  // 「115評001286」），沒有附上「評議書」這個詞，繞過了 Test 13/14 的關鍵字檢查。
  // 必須直接偵測文號格式（民國年+評+流水號），不能只靠字面上的「評議書」三個字。
  const hallucinatedBareNumber = buildValidC001Response();
  hallucinatedBareNumber.data.regulatory_assessment.comparable_penalty_range = {
    min: 15890, max: 96350, currency: 'TWD', case_count: 5,
    basis: '[依同態樣案件裁罰金額：115評001286（15890元）、115評000512（96350元）]'
  };
  assert.throws(
    () => parseAndValidateAiJson(JSON.stringify(hallucinatedBareNumber), 'financial_risk_estimation'),
    /評議書（消費爭議評議結果）而非正式裁罰案例/,
    'Should reject a bare evaluation-report number cited as a regulatory penalty, even without the literal word 評議書'
  );
  console.log('✓ Test 17 Passed: bare evaluation-report number (no "評議書" literal) is still caught');

  console.log('\nAll 17 tests passed!');
}

runTests().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

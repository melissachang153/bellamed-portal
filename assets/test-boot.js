/* 測試頁：在 common.js 之前執行。用另一組儲存前綴（bellamed.test.），不會碰到正式登入。
 * 測試資料（打卡、申請單、目前登入的測試身分）會一直保留，重新整理也不會不見；按測試列的「重設測試資料」才會清空。 */
(function () {
  window.BM_PREFIX = 'bellamed.test.';
  window.BM_TEST = true;
  try {
    // 正式的管理員登入（測試頁要用它讀取正式資料、發送「（測試）」通知）
    window.TEST_ADMIN_TOKEN = JSON.parse(localStorage.getItem('bellamed.adminToken') || 'null');
  } catch (e) { window.TEST_ADMIN_TOKEN = null; }
  // 清空所有測試資料（重設時用）
  window.TEST_CLEAR = function () {
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('bellamed.test.') === 0) localStorage.removeItem(k); }); } catch (e) { }
  };
})();

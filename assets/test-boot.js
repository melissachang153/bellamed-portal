/* 測試頁：在 common.js 之前執行。用另一組儲存前綴，並在每次開啟時清空，確保從真實資料重新開始 */
(function () {
  window.BM_PREFIX = 'bellamed.test.';
  window.BM_TEST = true;
  try {
    // 正式的管理員登入（測試頁要用它讀取正式資料、發送「（測試）」通知）
    window.TEST_ADMIN_TOKEN = JSON.parse(localStorage.getItem('bellamed.adminToken') || 'null');
    Object.keys(localStorage).forEach(function (k) { if (k.indexOf('bellamed.test.') === 0) localStorage.removeItem(k); });
  } catch (e) { window.TEST_ADMIN_TOKEN = null; }
})();

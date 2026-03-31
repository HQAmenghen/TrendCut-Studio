const { initReviewDatabase } = require('./store');
const { createReviewHandlers } = require('./handlers');

// 初始化数据库
initReviewDatabase();

module.exports = {
  initReviewDatabase,
  createReviewHandlers
};

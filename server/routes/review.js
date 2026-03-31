function registerReviewRoutes(app, handlers) {
  app.get('/api/review/config', handlers.getConfig);
  app.post('/api/review/config', handlers.updateConfig);
  app.post('/api/review/video', handlers.reviewVideo);
  app.post('/api/review/skip', handlers.skipReview);
  app.post('/api/review/regenerate', handlers.regenerateVideo);
  app.get('/api/review/history', handlers.getHistory);
  app.get('/api/review/:reviewId', handlers.getReview);
  app.delete('/api/review/:reviewId', handlers.deleteReview);
}

module.exports = {
  registerReviewRoutes
};

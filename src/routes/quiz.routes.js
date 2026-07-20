'use strict';

const { Router } = require('express');
const { generateQuiz, recordQuiz, submitQuiz, quizHistory, updateQuizQuestions } = require('../controllers/quiz.controller');
const { requireAuth } = require('../middleware/authenticate');
const { quizRateLimit } = require('../middleware/rateLimit');

const router = Router();

router.use(requireAuth);

router.post('/generate', quizRateLimit, generateQuiz);
router.post('/record', recordQuiz);         // no rate limit — COIN already burned on-chain
router.post('/submit', submitQuiz);
router.patch('/:id/questions', updateQuizQuestions);
router.get('/history', quizHistory);

module.exports = router;

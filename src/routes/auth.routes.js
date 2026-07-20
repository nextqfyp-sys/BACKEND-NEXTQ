'use strict';

const { Router } = require('express');
const { signup, login, refresh, logout, logoutAll, me } = require('../controllers/auth.controller');
const { adminLogin, adminCreate } = require('../controllers/adminAuth.controller');
const { requireAuth, requireAdmin } = require('../middleware/authenticate');

const router = Router();

router.post('/signup', signup);
router.post('/login', login);
router.post('/refresh', refresh);           // uses refresh cookie — no requireAuth
router.post('/logout', logout);             // best-effort — no requireAuth required
router.post('/logout-all', requireAuth, logoutAll);
router.get('/me', requireAuth, me);

// Admin / content_moderator credential auth (username + password)
router.post('/admin-login', adminLogin);
router.post('/admin-create', requireAuth, requireAdmin, adminCreate);

module.exports = router;

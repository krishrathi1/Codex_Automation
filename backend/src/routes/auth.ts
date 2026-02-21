import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import * as authService from '../services/auth.service.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import type { CookieOptions } from 'express';

const router = Router();

// httpOnly cookie settings for refresh token
const isProduction = process.env.NODE_ENV === 'production';
const REFRESH_COOKIE_NAME = 'nxrt'; // nexus refresh token
const REFRESH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: isProduction,        // HTTPS only in production
  sameSite: 'strict',          // Prevent CSRF
  path: '/api/auth',           // Only sent to auth endpoints
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

function setRefreshCookie(res: any, token: string) {
  res.cookie(REFRESH_COOKIE_NAME, token, REFRESH_COOKIE_OPTIONS);
}

function clearRefreshCookie(res: any) {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict' as const,
    path: '/api/auth',
  });
}

// Rate limiting for auth endpoints (brute force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 signups per IP per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signup attempts, please try again later' },
});

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string()
    .min(10, 'Password must be at least 10 characters')
    .max(128, 'Password must be at most 128 characters')
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[0-9]/, 'Password must contain a number'),
  name: z.string().min(1).max(100),
  orgName: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

// POST /signup
router.post('/signup', signupLimiter, validate(signupSchema), async (req, res) => {
  try {
    const result = await authService.signup(req.body);
    // Set refresh token as httpOnly cookie — never expose in response body
    setRefreshCookie(res, result.refreshToken);
    const { refreshToken: _rt, ...safeResult } = result;
    res.status(201).json(safeResult);
  } catch (e: any) {
    if (e.message === 'Email already in use') {
      return res.status(409).json({ error: e.message });
    }
    return res.status(500).json({ error: 'Signup failed' });
  }
});

// POST /login
router.post('/login', authLimiter, validate(loginSchema), async (req, res) => {
  try {
    const result = await authService.login(req.body);
    // Set refresh token as httpOnly cookie — never expose in response body
    setRefreshCookie(res, result.refreshToken);
    const { refreshToken: _rt, ...safeResult } = result;
    res.json(safeResult);
  } catch (e: any) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
});

// POST /refresh — reads refresh token from httpOnly cookie
router.post('/refresh', authLimiter, async (req, res) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token' });
    }
    const result = await authService.refresh(refreshToken);
    // Rotate: set new refresh token cookie
    setRefreshCookie(res, result.refreshToken);
    // Only return the new access token in response body
    res.json({ accessToken: result.accessToken });
  } catch (e: any) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

// POST /logout — clears refresh token cookie
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (refreshToken) {
      await authService.logout(refreshToken);
    }
    clearRefreshCookie(res);
    res.json({ ok: true });
  } catch {
    clearRefreshCookie(res);
    return res.status(500).json({ error: 'Logout failed' });
  }
});

// GET /me (requires auth)
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await authService.getMe(req.user!.id);
    res.json(result);
  } catch {
    return res.status(500).json({ error: 'Failed to get user info' });
  }
});

export default router;

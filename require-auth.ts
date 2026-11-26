import type { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebase-admin';

declare global {
  namespace Express { interface Request { user?: { uid: string; email?: string; phoneNumber?: string } } }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.header('authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) return res.status(401).json({ error: 'Authentication required.' });
    const decoded = await adminAuth.verifyIdToken(match[1], true);
    req.user = { uid: decoded.uid, email: decoded.email, phoneNumber: decoded.phone_number };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

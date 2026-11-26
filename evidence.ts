import { Router, type IRouter } from 'express';
import { randomUUID } from 'node:crypto';
import { adminBucket, adminDb } from '../lib/firebase-admin';
import { requireAuth } from '../middlewares/require-auth';
const router: IRouter = Router();
const allowed = new Set(['image/jpeg','image/png','image/webp','video/mp4','video/quicktime']);
router.post('/evidence/upload-url', requireAuth, async (req, res) => {
  try {
    const contentType = typeof req.body?.contentType === 'string' ? req.body.contentType : '';
    const size = Number(req.body?.size || 0);
    if (!allowed.has(contentType)) return res.status(400).json({ error: 'Only JPG, PNG, WEBP, MP4 and MOV evidence is accepted.' });
    if (!Number.isFinite(size) || size <= 0 || size > 25 * 1024 * 1024) return res.status(400).json({ error: 'Each evidence file must be 25 MB or smaller.' });
    const path = `evidence-staging/${req.user!.uid}/${randomUUID()}`;
    const [uploadUrl] = await adminBucket.file(path).getSignedUrl({ version: 'v4', action: 'write', expires: Date.now() + 10 * 60 * 1000, contentType });
    return res.json({ uploadUrl, objectPath: path, contentType });
  } catch (error) { req.log?.error({ error }, 'evidence upload URL failed'); return res.status(500).json({ error: 'Could not prepare secure evidence upload.' }); }
});
router.get('/cases/:caseId/evidence/:index', requireAuth, async (req, res) => {
  try {
    const snap = await adminDb.collection('cases').doc(req.params.caseId).get();
    if (!snap.exists) return res.status(404).json({ error: 'Case not found.' });
    const c = snap.data()!;
    if (c.reporterId !== req.user!.uid && c.accusedId !== req.user!.uid) return res.status(403).json({ error: 'Not a participant in this case.' });
    const path = c.evidence?.[Number(req.params.index)];
    if (typeof path !== 'string') return res.status(404).json({ error: 'Evidence not found.' });
    const [url] = await adminBucket.file(path).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 15 * 60 * 1000 });
    return res.json({ url });
  } catch (error) { req.log?.error({ error }, 'evidence read URL failed'); return res.status(500).json({ error: 'Could not open evidence.' }); }
});
export default router;

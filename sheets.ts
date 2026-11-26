import { Router, type IRouter } from 'express';
import { google } from 'googleapis';
import { adminDb } from '../lib/firebase-admin';
import { requireAuth } from '../middlewares/require-auth';

const router: IRouter = Router();
router.post('/admin/sheets/sync', requireAuth, async (req, res) => {
  const allowed = (process.env.LINEGUARD_ADMIN_UIDS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!allowed.includes(req.user!.uid)) return res.status(403).json({ error: 'Admin access required.' });
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!spreadsheetId) return res.status(503).json({ error: 'Google Sheets spreadsheet ID is not configured.' });
  try {
    const auth = clientEmail && privateKey
      ? new google.auth.JWT({ email: clientEmail, key: privateKey, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
      : new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const sheets = google.sheets({ version: 'v4', auth });
    const snap = await adminDb.collection('cases').orderBy('createdAt', 'desc').limit(500).get();
    const rows = [['Case ID', 'Created', 'Status', 'Reporter UID', 'Accused UID', 'Agreed compensation (INR)', 'Payment status'], ...snap.docs.map(d => {
      const x = d.data(); return [d.id, x.createdAt?.toDate?.()?.toISOString?.() || '', x.status || '', x.reporterId || '', x.accusedId || '', String(x.agreedCompensation ?? ''), x.paymentStatus || ''];
    })];
    await sheets.spreadsheets.values.update({ spreadsheetId, range: 'Cases!A1', valueInputOption: 'RAW', requestBody: { values: rows } });
    return res.json({ synced: snap.size });
  } catch (error) { req.log?.error({ error }, 'sheets sync failed'); return res.status(500).json({ error: 'Could not sync the admin sheet.' }); }
});
export default router;

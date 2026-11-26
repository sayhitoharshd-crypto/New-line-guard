import { Router, type IRouter } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { adminDb, FieldValue } from '../lib/firebase-admin';
import { requireAuth } from '../middlewares/require-auth';

const router: IRouter = Router();
const razorpayKey = process.env.RAZORPAY_KEY_ID;
const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;


router.get('/checkout/:orderId', async (req, res) => {
  const snap = await adminDb.collection('payments').doc(req.params.orderId).get();
  if (!snap.exists || snap.data()?.status !== 'created' || !razorpayKey) return res.status(404).send('Payment order unavailable');
  const p = snap.data()!;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>LineGuard secure payment</title><script src="https://checkout.razorpay.com/v1/checkout.js"></script></head><body style="font-family:Arial;padding:24px;text-align:center"><h2>LineGuard payment</h2><p>Complete your agreed payment securely with Razorpay.</p><button id="pay" style="padding:14px 28px;background:#e83e8c;color:white;border:0;border-radius:10px;font-size:16px">Pay ₹${(p.grossAmountPaise/100).toFixed(2)}</button><p id="status"></p><script>document.getElementById('pay').onclick=function(){var r=new Razorpay({key:${JSON.stringify(razorpayKey)},order_id:${JSON.stringify(req.params.orderId)},amount:${Number(p.grossAmountPaise)},currency:'INR',name:'LineGuard',description:'Agreed case compensation',handler:function(){document.getElementById('status').textContent='Payment submitted. Waiting for secure provider confirmation. You may return to LineGuard.'},modal:{ondismiss:function(){document.getElementById('status').textContent='Checkout closed. Payment status will be verified by LineGuard.'}}});r.open();};</script></body></html>`;
  res.setHeader('Content-Security-Policy', "default-src 'self' https://checkout.razorpay.com; script-src 'self' https://checkout.razorpay.com 'unsafe-inline'; frame-src https://api.razorpay.com https://checkout.razorpay.com; style-src 'self' 'unsafe-inline'");
  return res.type('html').send(html);
});


router.post('/cases/:caseId/payment-order', requireAuth, async (req, res) => {
  try {
    if (!razorpayKey || !razorpaySecret) return res.status(503).json({ error: 'Payments are not configured yet.' });
    const ref = adminDb.collection('cases').doc(req.params.caseId);
    const snap = await ref.get(); if (!snap.exists) return res.status(404).json({ error: 'Case not found.' });
    const c = snap.data()!;
    if (c.accusedId !== req.user!.uid) return res.status(403).json({ error: 'Only the other participant can make the agreed payment.' });
    if (c.status !== 'agreed' || !c.reporterConfirmed || !c.accusedConfirmed || typeof c.agreedCompensation !== 'number') return res.status(409).json({ error: 'Both participants must confirm the same compensation first.' });
    if (c.agreedCompensation <= 0 || c.agreedCompensation > 200) return res.status(400).json({ error: 'Total agreed compensation must be between ₹1 and ₹200; the reporter share is capped at ₹100.' });
    if (c.paymentStatus === 'captured') return res.status(409).json({ error: 'This case has already been paid.' });
    const existing = await adminDb.collection('payments').where('caseId', '==', snap.id).where('status', '==', 'created').limit(1).get();
    if (!existing.empty) return res.status(409).json({ error: 'A payment order is already pending for this case.' });
    const amountPaise = Math.round(c.agreedCompensation * 100);
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${razorpayKey}:${razorpaySecret}`).toString('base64')}` },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: `lg_${snap.id.slice(0, 24)}`, notes: { caseId: snap.id, reporterId: c.reporterId, payerId: c.accusedId } }),
    });
    const order: any = await response.json();
    if (!response.ok || !order.id) return res.status(502).json({ error: 'Payment provider could not create an order.' });
    await adminDb.collection('payments').doc(order.id).create({ orderId: order.id, caseId: snap.id, payerId: c.accusedId, reporterId: c.reporterId, grossAmountPaise: amountPaise, currency: 'INR', status: 'created', createdAt: FieldValue.serverTimestamp() });
    await ref.update({ paymentStatus: 'pending', updatedAt: FieldValue.serverTimestamp() });
    return res.status(201).json({ orderId: order.id, amount: amountPaise, currency: 'INR', keyId: razorpayKey, checkoutUrl: `${process.env.PUBLIC_API_URL?.replace(/\/$/, '')}/api/checkout/${order.id}` });
  } catch (error) { req.log?.error({ error }, 'payment order failed'); return res.status(500).json({ error: 'Could not start payment.' }); }
});

router.post('/webhooks/razorpay', async (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.header('x-razorpay-signature') || '';
  const raw = (req as any).rawBody as Buffer | undefined;
  if (!webhookSecret || !raw || !signature) return res.status(400).json({ error: 'Webhook verification is not configured.' });
  const expected = createHmac('sha256', webhookSecret).update(raw).digest('hex');
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(400).json({ error: 'Invalid webhook signature.' });
  try {
    const event = req.body;
    if (event?.event === 'transfer.processed' || event?.event === 'transfer.failed') {
      const transfer = event?.payload?.transfer?.entity;
      if (!transfer?.id) return res.status(400).json({ error: 'Invalid transfer event.' });
      const match = await adminDb.collection('payments').where('reporterTransferId', '==', transfer.id).limit(1).get();
      if (match.empty) return res.json({ received: true, ignored: true });
      const paymentDoc = match.docs[0];
      const paymentData = paymentDoc.data();
      if (event.event === 'transfer.processed') {
        await paymentDoc.ref.update({ settlementStatus: 'settled', transferProcessedAt: FieldValue.serverTimestamp() });
        await adminDb.collection('cases').doc(paymentData.caseId).update({ status: 'resolved', paymentStatus: 'settled', updatedAt: FieldValue.serverTimestamp() });
      } else {
        await paymentDoc.ref.update({ settlementStatus: 'transfer_failed', settlementError: String(transfer.failure_reason || 'Reporter transfer failed').slice(0, 300) });
      }
      return res.json({ received: true });
    }
    if (event?.event !== 'payment.captured') return res.json({ received: true, ignored: true });
    const payment = event?.payload?.payment?.entity;
    const orderId = payment?.order_id;
    if (!orderId || payment?.status !== 'captured') return res.status(400).json({ error: 'Invalid captured-payment event.' });
    const paymentRef = adminDb.collection('payments').doc(orderId);
    await adminDb.runTransaction(async tx => {
      const p = await tx.get(paymentRef); if (!p.exists) throw new Error('Unknown order.');
      const d = p.data()!;
      if (d.status === 'captured') return;
      if (Number(payment.amount) !== d.grossAmountPaise || payment.currency !== 'INR') throw new Error('Captured amount does not match the order.');
      const caseRef = adminDb.collection('cases').doc(d.caseId);
      const c = await tx.get(caseRef); if (!c.exists) throw new Error('Case not found.');
      const gross = d.grossAmountPaise;
      const lineguardShare = Math.floor(gross / 2);
      const reporterShare = gross - lineguardShare;
      tx.update(paymentRef, { status: 'captured', providerPaymentId: payment.id, capturedAt: FieldValue.serverTimestamp(), lineguardSharePaise: lineguardShare, reporterSharePaise: reporterShare, providerFeePaise: Number.isFinite(payment.fee) ? payment.fee : null, settlementStatus: 'awaiting_transfer' });
      tx.update(caseRef, { paymentStatus: 'captured', status: 'payment_received', paidAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      tx.create(adminDb.collection('caseEvents').doc(), { caseId: d.caseId, actorId: 'payment_webhook', type: 'payment_captured', grossAmountPaise: gross, lineguardSharePaise: lineguardShare, reporterSharePaise: reporterShare, at: FieldValue.serverTimestamp() });
    });
    // Route transfer is executed server-side only after verified capture. The reporter must have an approved Razorpay Linked Account.
    const pSnap = await adminDb.collection('payments').doc(orderId).get();
    const pData = pSnap.data();
    if (pData && pData.settlementStatus === 'awaiting_transfer') {
      const claim = await adminDb.runTransaction(async tx => {
        const latest = await tx.get(paymentRef);
        if (!latest.exists || latest.data()?.settlementStatus !== 'awaiting_transfer') return false;
        tx.update(paymentRef, { settlementStatus: 'transfer_initiated', transferAttemptedAt: FieldValue.serverTimestamp() });
        return true;
      });
      if (claim) {
      const reporterSnap = await adminDb.collection('users').doc(pData.reporterId).get();
      const linkedAccountId = reporterSnap.data()?.razorpayLinkedAccountId;
      if (!linkedAccountId) {
        await adminDb.collection('payments').doc(orderId).update({ settlementStatus: 'blocked_missing_linked_account' });
      } else {
        const transferResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(payment.id)}/transfers`, {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${razorpayKey}:${razorpaySecret}`).toString('base64')}` },
          body: JSON.stringify({ transfers: [{ account: linkedAccountId, amount: pData.reporterSharePaise, currency: 'INR', notes: { caseId: pData.caseId, role: 'reporter_share' } }] }),
        });
        const transferBody: any = await transferResponse.json().catch(() => ({}));
        if (transferResponse.ok && Array.isArray(transferBody.items) && transferBody.items.length) {
          await adminDb.collection('payments').doc(orderId).update({ settlementStatus: 'reporter_transfer_created', reporterTransferId: transferBody.items[0].id });
          if (transferBody.items[0].status === 'processed') {
            await adminDb.collection('payments').doc(orderId).update({ settlementStatus: 'settled', transferProcessedAt: FieldValue.serverTimestamp() });
            await adminDb.collection('cases').doc(pData.caseId).update({ status: 'resolved', paymentStatus: 'settled', updatedAt: FieldValue.serverTimestamp() });
          }
        } else {
          await adminDb.collection('payments').doc(orderId).update({ settlementStatus: 'transfer_failed', settlementError: String(transferBody.error?.description || 'Razorpay transfer could not be created').slice(0, 300) });
          req.log?.error({ orderId, transferBody }, 'reporter transfer failed');
        }
      }
      }
    }
    return res.json({ received: true });
  } catch (error) { req.log?.error({ error }, 'payment webhook failed'); return res.status(500).json({ error: 'Webhook processing failed.' }); }
});

export default router;

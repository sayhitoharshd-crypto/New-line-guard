import { Router, type IRouter } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { adminDb, adminBucket, FieldValue } from '../lib/firebase-admin';
import { requireAuth } from '../middlewares/require-auth';

const router: IRouter = Router();
const clean = (v: unknown, max = 2000) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const isMember = (data: any, uid: string) => data.reporterId === uid || data.accusedId === uid;

router.post('/cases', requireAuth, async (req, res) => {
  try {
    const uid = req.user!.uid;
    const description = clean(req.body?.description, 2000);
    const address = clean(req.body?.location?.address, 300);
    const amount = Number(req.body?.requestedCompensation ?? 0);
    if (description.length < 10) return res.status(400).json({ error: 'Description must be at least 10 characters.' });
    if (!Number.isFinite(amount) || amount < 0 || amount > 200) return res.status(400).json({ error: 'Total compensation must be between ₹0 and ₹200; the reporter share is capped at ₹100.' });
    const incomingEvidence = Array.isArray(req.body?.evidence) ? req.body.evidence.filter((x: unknown) => typeof x === 'string').slice(0, 5) as string[] : [];
    if (incomingEvidence.some(path => !path.startsWith(`evidence-staging/${uid}/`))) return res.status(400).json({ error: 'Evidence upload reference is invalid.' });
    const caseId = randomUUID();
    const evidencePaths: string[] = [];
    for (const sourcePath of incomingEvidence) {
      const source = adminBucket.file(sourcePath);
      const [exists] = await source.exists();
      if (!exists) return res.status(400).json({ error: 'An uploaded evidence file is missing. Please upload it again.' });
      const [metadata] = await source.getMetadata();
      if (Number(metadata.size || 0) > 25 * 1024 * 1024) return res.status(400).json({ error: 'Each evidence file must be 25 MB or smaller.' });
      const destination = `cases/${caseId}/${randomUUID()}`;
      await source.move(destination);
      evidencePaths.push(destination);
    }
    const invitationCode = randomBytes(18).toString('base64url');
    const now = FieldValue.serverTimestamp();
    const record = {
      caseId, reporterId: uid, reporterName: clean(req.body?.reporterName, 80),
      accusedId: null, status: 'awaiting_accused', description, location: { address },
      evidence: evidencePaths,
      evidenceTypes: Array.isArray(req.body?.evidenceTypes) ? req.body.evidenceTypes.slice(0, evidencePaths.length).map((x: unknown) => x === 'video' ? 'video' : 'image') : evidencePaths.map(() => 'image'),
      requestedCompensation: amount, agreedCompensation: null, reporterConfirmed: false,
      accusedConfirmed: false, invitationCodeHash: createHash('sha256').update(invitationCode).digest('hex'),
      paymentStatus: 'not_started', createdAt: now, updatedAt: now,
    };
    await adminDb.collection('cases').doc(caseId).create(record);
    await adminDb.collection('caseEvents').add({ caseId, actorId: uid, type: 'case_created', at: now });
    return res.status(201).json({ caseId, invitationCode, status: record.status });
  } catch (error) {
    req.log?.error({ error }, 'case create failed');
    return res.status(500).json({ error: 'Could not create case.' });
  }
});

router.post('/cases/join', requireAuth, async (req, res) => {
  const code = clean(req.body?.invitationCode, 100);
  if (code.length < 16) return res.status(400).json({ error: 'Invalid invitation code.' });
  const hash = createHash('sha256').update(code).digest('hex');
  const found = await adminDb.collection('cases').where('invitationCodeHash', '==', hash).limit(1).get();
  if (found.empty) return res.status(404).json({ error: 'Invitation not found or expired.' });
  const ref = found.docs[0].ref;
  try {
    const result = await adminDb.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const data = snap.data()!;
      if (data.reporterId === req.user!.uid) throw new Error('The reporter cannot join their own case as the accused party.');
      if (data.accusedId && data.accusedId !== req.user!.uid) throw new Error('This invitation has already been used.');
      if (data.status !== 'awaiting_accused') throw new Error('This case is no longer accepting a participant.');
      tx.update(ref, { accusedId: req.user!.uid, accusedConfirmed: false, status: 'awaiting_confirmation', invitationCodeHash: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
      tx.create(adminDb.collection('caseEvents').doc(), { caseId: snap.id, actorId: req.user!.uid, type: 'accused_joined', at: FieldValue.serverTimestamp() });
      return { caseId: snap.id, status: 'under_review' };
    });
    return res.json(result);
  } catch (e) { return res.status(409).json({ error: e instanceof Error ? e.message : 'Could not join case.' }); }
});

router.get('/cases', requireAuth, async (req, res) => {
  try {
    const uid = req.user!.uid;
    const [asReporter, asAccused] = await Promise.all([
      adminDb.collection('cases').where('reporterId', '==', uid).limit(100).get(),
      adminDb.collection('cases').where('accusedId', '==', uid).limit(100).get(),
    ]);
    const unique = new Map<string, any>();
    [...asReporter.docs, ...asAccused.docs].forEach(d => { const x = d.data(); delete x.invitationCodeHash; unique.set(d.id, { ...x, caseId: d.id }); });
    const cases = await Promise.all([...unique.values()].map(async item => ({ ...item, evidence: await Promise.all((item.evidence || []).map(async (path: string) => { const [url] = await adminBucket.file(path).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 15 * 60 * 1000 }); return url; })) })));
    return res.json({ cases });
  } catch (error) { req.log?.error({ error }, 'case list failed'); return res.status(500).json({ error: 'Could not load cases.' }); }
});

router.get('/cases/:caseId', requireAuth, async (req, res) => {
  const snap = await adminDb.collection('cases').doc(req.params.caseId).get();
  if (!snap.exists || !isMember(snap.data(), req.user!.uid)) return res.status(404).json({ error: 'Case not found.' });
  const data = snap.data()!; delete data.invitationCodeHash;
  const evidence = await Promise.all((data.evidence || []).map(async (path: string) => { const [url] = await adminBucket.file(path).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 15 * 60 * 1000 }); return url; }));
  return res.json({ ...data, evidence, caseId: snap.id });
});

router.post('/cases/:caseId/confirm', requireAuth, async (req, res) => {
  const agreed = Number(req.body?.agreedCompensation);
  if (!Number.isFinite(agreed) || agreed < 1 || agreed > 200) return res.status(400).json({ error: 'Total agreed compensation cannot exceed ₹200; the reporter share is capped at ₹100.' });
  try {
    await adminDb.runTransaction(async tx => {
      const ref = adminDb.collection('cases').doc(req.params.caseId);
      const snap = await tx.get(ref); if (!snap.exists) throw new Error('Case not found.');
      const d = snap.data()!; if (!isMember(d, req.user!.uid)) throw new Error('Not a case participant.');
      if (!d.accusedId) throw new Error('The second participant must join first.');
      if (d.status === 'disputed' || d.status === 'resolved') throw new Error('This case is closed to confirmation.');
      const reporterConfirmed = d.reporterConfirmed || d.reporterId === req.user!.uid;
      const accusedConfirmed = d.accusedConfirmed || d.accusedId === req.user!.uid;
      if (d.agreedCompensation !== null && d.agreedCompensation !== agreed) throw new Error('Both parties must confirm the same amount.');
      const both = reporterConfirmed && accusedConfirmed;
      tx.update(ref, { reporterConfirmed, accusedConfirmed, agreedCompensation: agreed, status: both ? 'agreed' : 'awaiting_confirmation', updatedAt: FieldValue.serverTimestamp() });
      tx.create(adminDb.collection('caseEvents').doc(), { caseId: snap.id, actorId: req.user!.uid, type: 'compensation_confirmed', agreedCompensation: agreed, at: FieldValue.serverTimestamp() });
    });
    return res.json({ ok: true });
  } catch (e) { return res.status(409).json({ error: e instanceof Error ? e.message : 'Confirmation failed.' }); }
});

router.post('/cases/:caseId/apology', requireAuth, async (req, res) => {
  const apologyText = clean(req.body?.apologyText, 1500);
  if (apologyText.length < 10) return res.status(400).json({ error: 'Please write an apology of at least 10 characters.' });
  try {
    await adminDb.runTransaction(async tx => {
      const ref = adminDb.collection('cases').doc(req.params.caseId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('Case not found.');
      const data = snap.data()!;
      if (data.accusedId !== req.user!.uid) throw new Error('Only the accused participant can submit the apology.');
      if (data.status === 'disputed' || data.status === 'resolved') throw new Error('This case is closed to apology changes.');
      if (data.status !== 'agreed' || !data.reporterConfirmed || !data.accusedConfirmed) throw new Error('Both participants must first confirm the same compensation amount.');
      if (data.apologyStatus === 'approved') throw new Error('This apology has already been approved.');
      tx.update(ref, { apologyText, apologyStatus: 'pending_review', apologySubmittedAt: FieldValue.serverTimestamp(), apologyReviewedAt: null, updatedAt: FieldValue.serverTimestamp() });
      tx.create(adminDb.collection('caseEvents').doc(), { caseId: snap.id, actorId: req.user!.uid, type: 'public_apology_submitted', at: FieldValue.serverTimestamp() });
    });
    return res.json({ ok: true, apologyStatus: 'pending_review' });
  } catch (e) { return res.status(409).json({ error: e instanceof Error ? e.message : 'Could not submit apology.' }); }
});

router.post('/cases/:caseId/apology/review', requireAuth, async (req, res) => {
  const decision = req.body?.decision;
  if (!['approve', 'request_changes'].includes(decision)) return res.status(400).json({ error: 'Choose approve or request changes.' });
  try {
    await adminDb.runTransaction(async tx => {
      const ref = adminDb.collection('cases').doc(req.params.caseId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('Case not found.');
      const data = snap.data()!;
      if (data.reporterId !== req.user!.uid) throw new Error('Only the reporter can review this apology.');
      if (data.apologyStatus !== 'pending_review') throw new Error('There is no apology awaiting review.');
      const apologyStatus = decision === 'approve' ? 'approved' : 'changes_requested';
      tx.update(ref, { apologyStatus, apologyReviewedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      tx.create(adminDb.collection('caseEvents').doc(), { caseId: snap.id, actorId: req.user!.uid, type: decision === 'approve' ? 'public_apology_approved' : 'public_apology_changes_requested', at: FieldValue.serverTimestamp() });
    });
    return res.json({ ok: true, apologyStatus: decision === 'approve' ? 'approved' : 'changes_requested' });
  } catch (e) { return res.status(409).json({ error: e instanceof Error ? e.message : 'Could not review apology.' }); }
});

router.post('/cases/:caseId/public-consent', requireAuth, async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'Consent must be true or false.' });
  try {
    const result = await adminDb.runTransaction(async tx => {
      const ref = adminDb.collection('cases').doc(req.params.caseId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('Case not found.');
      const data = snap.data()!;
      if (!isMember(data, req.user!.uid)) throw new Error('Only case participants can change public listing consent.');
      if (data.status === 'disputed' || data.status === 'dismissed') throw new Error('Disputed or dismissed cases cannot be publicly listed.');
      if (data.apologyStatus !== 'approved') throw new Error('The apology must be approved before public listing consent can be given.');
      const field = data.reporterId === req.user!.uid ? 'reporterPublicConsent' : 'accusedPublicConsent';
      tx.update(ref, { [field]: req.body.enabled, updatedAt: FieldValue.serverTimestamp() });
      tx.create(adminDb.collection('caseEvents').doc(), { caseId: snap.id, actorId: req.user!.uid, type: req.body.enabled ? 'public_listing_consent_granted' : 'public_listing_consent_withdrawn', at: FieldValue.serverTimestamp() });
      return { reporterPublicConsent: field === 'reporterPublicConsent' ? req.body.enabled : !!data.reporterPublicConsent, accusedPublicConsent: field === 'accusedPublicConsent' ? req.body.enabled : !!data.accusedPublicConsent };
    });
    return res.json({ ok: true, ...result });
  } catch (e) { return res.status(409).json({ error: e instanceof Error ? e.message : 'Could not update public consent.' }); }
});

// Public read-only Shameboard. Only cases with both participants' explicit consent
// and an approved apology are exposed. No IDs, emails, exact locations, or payment details are returned.
router.get('/public/shameboard', async (_req, res) => {
  try {
    const snapshot = await adminDb.collection('cases').where('reporterPublicConsent', '==', true).limit(200).get();
    const eligible = snapshot.docs.filter(doc => {
      const d = doc.data();
      return d.accusedPublicConsent === true && d.apologyStatus === 'approved' && !!d.apologyText && !['disputed', 'dismissed'].includes(d.status) && !!d.accusedId && d.communityReviewRequired !== true;
    }).sort((a, b) => Number(!!b.data().publicBoardFeatured) - Number(!!a.data().publicBoardFeatured)).slice(0, 60);
    const cases = await Promise.all(eligible.map(async doc => {
      const d = doc.data();
      const [reporterSnap, accusedSnap] = await Promise.all([
        adminDb.collection('users').doc(d.reporterId).get(),
        adminDb.collection('users').doc(d.accusedId).get(),
      ]);
      const reporterName = clean(reporterSnap.data()?.name, 80) || 'Consenting reporter';
      const accusedName = clean(accusedSnap.data()?.name, 80) || 'Consenting participant';
      const evidencePaths: string[] = Array.isArray(d.evidence) ? d.evidence.slice(0, 5) : [];
      const evidence = await Promise.all(evidencePaths.map(async (path: string) => {
        const [url] = await adminBucket.file(path).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 10 * 60 * 1000 });
        return url;
      }));
      return {
        caseId: doc.id, reporterName, accusedName, upvotes: Number(d.upvotes || 0), downvotes: Number(d.downvotes || 0), publicBoardFeatured: !!d.publicBoardFeatured,
        description: clean(d.description, 1500), apologyText: clean(d.apologyText, 1500),
        evidence, evidenceTypes: Array.isArray(d.evidenceTypes) ? d.evidenceTypes.slice(0, evidence.length) : evidence.map(() => 'image'),
        createdAt: d.createdAt?.toDate?.()?.toISOString?.() || null,
      };
    }));
    return res.set('Cache-Control', 'public, max-age=30').json({ cases });
  } catch (error) {
    return res.status(500).json({ error: 'Could not load the public Shameboard.' });
  }
});


router.post('/cases/:caseId/vote', requireAuth, async (req, res) => {
  const vote = req.body?.vote;
  if (vote !== 'up' && vote !== 'down') return res.status(400).json({ error: 'Vote must be up or down.' });
  try {
    const result = await adminDb.runTransaction(async tx => {
      const caseRef = adminDb.collection('cases').doc(req.params.caseId);
      const voteRef = caseRef.collection('votes').doc(req.user!.uid);
      const [caseSnap, voteSnap] = await Promise.all([tx.get(caseRef), tx.get(voteRef)]);
      if (!caseSnap.exists) throw new Error('Case not found.');
      const d = caseSnap.data()!;
      if (isMember(d, req.user!.uid)) throw new Error('Case participants cannot vote on their own case.');
      if (d.reporterPublicConsent !== true || d.accusedPublicConsent !== true || d.apologyStatus !== 'approved' || !d.apologyText || ['disputed', 'dismissed'].includes(d.status)) {
        throw new Error('Only eligible public Shameboard cases can be voted on.');
      }
      const previous = voteSnap.exists ? voteSnap.data()?.vote : null;
      let upvotes = Math.max(0, Number(d.upvotes || 0));
      let downvotes = Math.max(0, Number(d.downvotes || 0));
      if (previous === vote) {
        if (vote === 'up') upvotes = Math.max(0, upvotes - 1);
        else downvotes = Math.max(0, downvotes - 1);
        tx.delete(voteRef);
      } else {
        if (previous === 'up') upvotes = Math.max(0, upvotes - 1);
        if (previous === 'down') downvotes = Math.max(0, downvotes - 1);
        if (vote === 'up') upvotes += 1;
        else downvotes += 1;
        tx.set(voteRef, { vote, updatedAt: FieldValue.serverTimestamp() });
      }
      const downvoteReview = downvotes >= 10 && downvotes > upvotes;
      const featured = !downvoteReview && upvotes >= 10 && upvotes >= downvotes * 2;
      tx.update(caseRef, {
        upvotes, downvotes,
        communityReviewRequired: downvoteReview,
        publicBoardFeatured: featured,
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.create(adminDb.collection('caseEvents').doc(), {
        caseId: caseSnap.id, actorId: req.user!.uid, type: 'case_vote_changed',
        vote: previous === vote ? null : vote, upvotes, downvotes,
        at: FieldValue.serverTimestamp(),
      });
      return { upvotes, downvotes, myVote: previous === vote ? null : vote, communityReviewRequired: downvoteReview, publicBoardFeatured: featured };
    });
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(409).json({ error: e instanceof Error ? e.message : 'Could not record vote.' });
  }
});

router.get('/cases/:caseId/vote', requireAuth, async (req, res) => {
  const caseRef = adminDb.collection('cases').doc(req.params.caseId);
  const [caseSnap, voteSnap] = await Promise.all([
    caseRef.get(),
    caseRef.collection('votes').doc(req.user!.uid).get(),
  ]);
  if (!caseSnap.exists) return res.status(404).json({ error: 'Case not found.' });
  const d = caseSnap.data()!;
  if (isMember(d, req.user!.uid)) return res.status(403).json({ error: 'Case participants cannot vote on their own case.' });
  return res.json({ upvotes: Number(d.upvotes || 0), downvotes: Number(d.downvotes || 0), myVote: voteSnap.exists ? voteSnap.data()?.vote || null : null });
});

router.post('/cases/:caseId/dispute', requireAuth, async (req, res) => {
  const reason = clean(req.body?.reason, 1000);
  if (reason.length < 10) return res.status(400).json({ error: 'Please provide a dispute reason of at least 10 characters.' });
  try {
    await adminDb.runTransaction(async tx => {
      const ref = adminDb.collection('cases').doc(req.params.caseId); const snap = await tx.get(ref);
      if (!snap.exists || !isMember(snap.data(), req.user!.uid)) throw new Error('Case not found.');
      if (['resolved', 'disputed'].includes(snap.data()!.status)) throw new Error('Case is already closed or disputed.');
      tx.update(ref, { status: 'disputed', updatedAt: FieldValue.serverTimestamp() });
      tx.create(adminDb.collection('caseEvents').doc(), { caseId: snap.id, actorId: req.user!.uid, type: 'dispute_opened', reason, at: FieldValue.serverTimestamp() });
    });
    return res.json({ ok: true, status: 'disputed' });
  } catch (e) { return res.status(409).json({ error: e instanceof Error ? e.message : 'Could not open dispute.' }); }
});


// Public discussion is attached to an eligible case; participants and moderators
// can review it through the same case event stream. Comments are plain text only.
router.get('/public/shameboard/:caseId/discussion', async (req, res) => {
  const snap = await adminDb.collection('cases').doc(req.params.caseId).get();
  if (!snap.exists) return res.status(404).json({ error: 'Case not found.' });
  const d = snap.data()!;
  if (d.reporterPublicConsent !== true || d.accusedPublicConsent !== true || d.apologyStatus !== 'approved' || !d.apologyText || ['disputed', 'dismissed'].includes(d.status) || d.communityReviewRequired === true || d.publicModerationStatus === 'hidden') return res.status(404).json({ error: 'Discussion is unavailable for this case.' });
  const snapshot = await adminDb.collection('caseEvents').where('caseId', '==', snap.id).where('type', '==', 'public_comment').orderBy('at', 'asc').limit(100).get();
  return res.json({ comments: snapshot.docs.map(doc => { const x = doc.data(); return { id: doc.id, author: clean(x.authorName, 80) || 'Community member', text: clean(x.text, 500), createdAt: x.at?.toDate?.()?.toISOString?.() || null }; }) });
});

router.post('/cases/:caseId/discussion', requireAuth, async (req, res) => {
  const text = clean(req.body?.text, 500);
  if (text.length < 2) return res.status(400).json({ error: 'Comment must be at least 2 characters.' });
  const ref = adminDb.collection('cases').doc(req.params.caseId);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Case not found.' });
  const d = snap.data()!;
  if (d.reporterPublicConsent !== true || d.accusedPublicConsent !== true || d.apologyStatus !== 'approved' || !d.apologyText || ['disputed', 'dismissed'].includes(d.status) || d.communityReviewRequired === true || d.publicModerationStatus === 'hidden') return res.status(403).json({ error: 'Discussion is unavailable for this case.' });
  if (isMember(d, req.user!.uid)) return res.status(403).json({ error: 'Case participants cannot comment on the public discussion.' });
  const profile = await adminDb.collection('users').doc(req.user!.uid).get();
  const authorName = clean(profile.data()?.name, 80) || 'Community member';
  const comment = { caseId: snap.id, actorId: req.user!.uid, authorName, text, type: 'public_comment', at: FieldValue.serverTimestamp() };
  const created = await adminDb.collection('caseEvents').add(comment);
  return res.status(201).json({ comment: { id: created.id, author: authorName, text } });
});

// Reporting immediately hides a public case pending review; it never auto-deletes it.
router.post('/cases/:caseId/public-report', requireAuth, async (req, res) => {
  const reason = clean(req.body?.reason, 500);
  if (reason.length < 10) return res.status(400).json({ error: 'Please explain the concern in at least 10 characters.' });
  const ref = adminDb.collection('cases').doc(req.params.caseId);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Case not found.' });
  if (isMember(snap.data(), req.user!.uid)) return res.status(403).json({ error: 'Participants should use the appeal process.' });
  await adminDb.runTransaction(async tx => {
    const fresh = await tx.get(ref);
    if (!fresh.exists) throw new Error('Case not found.');
    tx.update(ref, { publicModerationStatus: 'pending_review', communityReviewRequired: true, updatedAt: FieldValue.serverTimestamp() });
    tx.create(adminDb.collection('caseEvents').doc(), { caseId: fresh.id, actorId: req.user!.uid, type: 'public_case_reported', reason, at: FieldValue.serverTimestamp() });
  });
  return res.status(202).json({ ok: true, status: 'pending_review' });
});

// A participant can request a human review; this does not erase the public post.
router.post('/cases/:caseId/appeal', requireAuth, async (req, res) => {
  const reason = clean(req.body?.reason, 1000);
  if (reason.length < 10) return res.status(400).json({ error: 'Please explain the appeal in at least 10 characters.' });
  const ref = adminDb.collection('cases').doc(req.params.caseId);
  const snap = await ref.get();
  if (!snap.exists || !isMember(snap.data(), req.user!.uid)) return res.status(404).json({ error: 'Case not found.' });
  await adminDb.collection('caseEvents').add({ caseId: snap.id, actorId: req.user!.uid, type: 'public_case_appeal', reason, at: FieldValue.serverTimestamp() });
  return res.status(202).json({ ok: true, status: 'appeal_submitted' });
});

export default router;

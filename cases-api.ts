import { firebaseAuth } from '@/lib/firebase';

const API_BASE = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_BASE) throw new Error('LineGuard secure server is not configured. Please try again after the service is deployed.');
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Please sign in again.');
  const token = await user.getIdToken();
  const response = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'The secure service request failed.');
  return body as T;
}

export type ServerCase = {
  caseId: string; reporterId: string; reporterName?: string; accusedId?: string | null;
  description: string; location?: { address?: string }; evidence?: string[]; evidenceTypes?: ("image" | "video")[];
  status: string; createdAt?: any; paymentStatus?: string; reporterConfirmed?: boolean; accusedConfirmed?: boolean;
  agreedCompensation?: number | null; paidAt?: any;
  apologyText?: string; apologyStatus?: 'not_submitted' | 'pending_review' | 'approved' | 'changes_requested';
  apologySubmittedAt?: any; apologyReviewedAt?: any;
  reporterPublicConsent?: boolean; accusedPublicConsent?: boolean;
  upvotes?: number; downvotes?: number; communityReviewRequired?: boolean; publicBoardFeatured?: boolean;
};
export type NewCaseResult = { caseId: string; invitationCode: string; status: string };

export const createSecureCase = (payload: { description: string; reporterName: string; location: { latitude: number; longitude: number; address: string }; evidence: string[]; evidenceTypes?: ("image" | "video")[] }) =>
  request<NewCaseResult>('/cases', { method: 'POST', body: JSON.stringify(payload) });
export const listSecureCases = () => request<{ cases: ServerCase[] }>('/cases');
export const joinSecureCase = (invitationCode: string) => request<{ caseId: string; status: string }>('/cases/join', { method: 'POST', body: JSON.stringify({ invitationCode }) });
export const confirmSecureCase = (caseId: string, agreedCompensation: number) => request<{ ok: boolean }>(`/cases/${encodeURIComponent(caseId)}/confirm`, { method: 'POST', body: JSON.stringify({ agreedCompensation }) });
export const disputeSecureCase = (caseId: string, reason: string) => request<{ ok: boolean }>(`/cases/${encodeURIComponent(caseId)}/dispute`, { method: 'POST', body: JSON.stringify({ reason }) });
export const createSecurePaymentOrder = (caseId: string) => request<{ orderId: string; amount: number; currency: string; keyId: string; checkoutUrl: string }>(`/cases/${encodeURIComponent(caseId)}/payment-order`, { method: 'POST' });
export const getEvidenceUrl = (caseId: string, index: number) => request<{ url: string }>(`/cases/${encodeURIComponent(caseId)}/evidence/${index}`);
export async function uploadEvidenceAsset(uri: string, contentType: string, size?: number): Promise<string> {
  const prepared = await request<{ uploadUrl: string; objectPath: string; contentType: string }>('/evidence/upload-url', { method: 'POST', body: JSON.stringify({ contentType, size: size || 1 }) });
  const fileResponse = await fetch(uri);
  const blob = await fileResponse.blob();
  const uploaded = await fetch(prepared.uploadUrl, { method: 'PUT', headers: { 'content-type': prepared.contentType }, body: blob });
  if (!uploaded.ok) throw new Error('Evidence upload failed. Please retry.');
  return prepared.objectPath;
}

export const submitCaseApology = (caseId: string, apologyText: string) =>
  request<{ ok: boolean; apologyStatus: string }>(`/cases/${encodeURIComponent(caseId)}/apology`, {
    method: 'POST', body: JSON.stringify({ apologyText }),
  });
export const reviewCaseApology = (caseId: string, decision: 'approve' | 'request_changes') =>
  request<{ ok: boolean; apologyStatus: string }>(`/cases/${encodeURIComponent(caseId)}/apology/review`, {
    method: 'POST', body: JSON.stringify({ decision }),
  });


export type PublicShameboardCase = {
  caseId: string;
  reporterName: string;
  accusedName: string;
  description: string;
  apologyText: string;
  evidence: string[];
  evidenceTypes: ("image" | "video")[];
  createdAt?: any;
  paymentStatus?: string;
  upvotes?: number; downvotes?: number; publicBoardFeatured?: boolean;
};

export async function listPublicShameboard(): Promise<{ cases: PublicShameboardCase[] }> {
  if (!API_BASE) throw new Error('LineGuard secure server is not configured.');
  const response = await fetch(`${API_BASE}/api/public/shameboard`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Could not load the public Shameboard.');
  return body as { cases: PublicShameboardCase[] };
}

export const setPublicListingConsent = (caseId: string, enabled: boolean) =>
  request<{ ok: boolean; reporterPublicConsent: boolean; accusedPublicConsent: boolean }>(`/cases/${encodeURIComponent(caseId)}/public-consent`, {
    method: 'POST', body: JSON.stringify({ enabled }),
  });

export type CaseVoteResult = {
  ok?: boolean; upvotes: number; downvotes: number; myVote: 'up' | 'down' | null;
  communityReviewRequired?: boolean; publicBoardFeatured?: boolean;
};
export const voteOnCase = (caseId: string, vote: 'up' | 'down') =>
  request<CaseVoteResult>(`/cases/${encodeURIComponent(caseId)}/vote`, { method: 'POST', body: JSON.stringify({ vote }) });
export const getMyCaseVote = (caseId: string) =>
  request<CaseVoteResult>(`/cases/${encodeURIComponent(caseId)}/vote`);

export type PublicDiscussionComment = { id: string; author: string; text: string; createdAt?: string | null };
export const listPublicDiscussion = (caseId: string) => {
  if (!API_BASE) throw new Error('LineGuard secure server is not configured.');
  return fetch(`${API_BASE}/api/public/shameboard/${encodeURIComponent(caseId)}/discussion`)
    .then(async response => { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Could not load discussion.'); return body as { comments: PublicDiscussionComment[] }; });
};
export const addPublicDiscussionComment = (caseId: string, text: string) =>
  request<{ comment: PublicDiscussionComment }>(`/cases/${encodeURIComponent(caseId)}/discussion`, { method: 'POST', body: JSON.stringify({ text }) });
export const reportPublicCase = (caseId: string, reason: string) =>
  request<{ ok: boolean; status: string }>(`/cases/${encodeURIComponent(caseId)}/public-report`, { method: 'POST', body: JSON.stringify({ reason }) });
export const appealPublicCase = (caseId: string, reason: string) =>
  request<{ ok: boolean; status: string }>(`/cases/${encodeURIComponent(caseId)}/appeal`, { method: 'POST', body: JSON.stringify({ reason }) });

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
} from "@react-native-firebase/auth";
import { doc, getDoc, setDoc, updateDoc } from "@react-native-firebase/firestore";
import { firebaseAuth, firestore } from "@/lib/firebase";
import { createSecureCase, listSecureCases, listPublicShameboard, joinSecureCase as joinCaseApi, type ServerCase } from "@/lib/cases-api";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

// ── Auth Types ──────────────────────────────────────────────────────────────
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  color: string;
  createdAt: string;
}

// ── Report Types ─────────────────────────────────────────────────────────────
export interface ReportLocation {
  latitude: number;
  longitude: number;
  address: string;
}

export interface Payment {
  amount: number;
  apology: string;
  paidAt: string;
  payerName: string;
}

export interface Report {
  id: string;
  accusedId?: string | null;
  reporterId: string;
  reporterName: string;
  reporterColor: string;
  description: string;
  location: ReportLocation;
  mediaUris: string[];
  mediaTypes?: ("image" | "video")[];
  timestamp: string;
  status: "pending" | "guilty" | "dismissed";
  payment?: Payment;
  caseStatus?: string;
  reporterConfirmed?: boolean;
  accusedConfirmed?: boolean;
  agreedCompensation?: number | null;
  paymentStatus?: string;
  apologyText?: string;
  apologyStatus?: 'not_submitted' | 'pending_review' | 'approved' | 'changes_requested';
  reporterPublicConsent?: boolean;
  accusedPublicConsent?: boolean;
  accusedName?: string;
  isPublicListing?: boolean;
  upvotes?: number;
  downvotes?: number;
  publicBoardFeatured?: boolean;
  communityReviewRequired?: boolean;
}

// ── Community Types ───────────────────────────────────────────────────────────
export interface Community {
  id: string;
  name: string;
  description: string;
  category: string;
  color: string;
  creatorId: string;
  memberIds: string[];
  postCount: number;
  createdAt: string;
}

export interface PostComment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  content: string;
  upvotes: number;
  upvotedBy: string[];
  createdAt: string;
}

export interface CommunityPost {
  id: string;
  communityId: string;
  communityName: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  title: string;
  content: string;
  upvotes: number;
  upvotedBy: string[];
  comments: PostComment[];
  createdAt: string;
}

// ── Seeds ─────────────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  "#E63946","#1D8CF8","#2ECE7B","#F4A026","#9B59B6",
  "#E67E22","#16A085","#E91E63","#3498DB","#8BC34A",
];

const generateId = () =>
  Date.now().toString() + Math.random().toString(36).substr(2, 9);

const SEED_REPORTS: Report[] = [];

const SEED_COMMUNITIES: Community[] = [
  { id: "comm1", name: "Indian Railways Queue", description: "Report and discuss queue cutting at railway stations across India. Stand up for your right to wait in line.", category: "Transport", color: "#E63946", creatorId: "system", memberIds: [], postCount: 8, createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() },
  { id: "comm2", name: "Metro Watch India", description: "Keeping metro queues fair in Delhi, Mumbai, Bangalore, Hyderabad and beyond.", category: "Transport", color: "#1D8CF8", creatorId: "system", memberIds: [], postCount: 14, createdAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString() },
  { id: "comm3", name: "Hospital Queue Justice", description: "Healthcare queues matter most. Report unfair cutting at hospitals, clinics, and pharmacies.", category: "Healthcare", color: "#2ECE7B", creatorId: "system", memberIds: [], postCount: 5, createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString() },
  { id: "comm4", name: "Bangalore IT Park Lines", description: "Queue justice for Bangalore's tech parks, cafeterias, and bus stops.", category: "Workplace", color: "#F4A026", creatorId: "system", memberIds: [], postCount: 7, createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() },
];

const SEED_POSTS: CommunityPost[] = [
  {
    id: "post1", communityId: "comm1", communityName: "Indian Railways Queue",
    authorId: "other1", authorName: "Rahul M.", authorColor: "#1D8CF8",
    title: "IRCTC Tatkal window — complete chaos every morning",
    content: "Every single day at New Delhi station, the Tatkal counter becomes a free-for-all. 5 minutes before it opens, people just rush in. The RPF guys just watch. Have filed 3 reports this week already.",
    upvotes: 47, upvotedBy: [],
    comments: [
      { id: "c1", postId: "post1", authorId: "other2", authorName: "Priya K.", authorColor: "#2ECE7B", content: "Same at CST Mumbai. The system is completely broken. We need LineGuard awareness campaigns at stations.", upvotes: 12, upvotedBy: [], createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
      { id: "c2", postId: "post1", authorId: "other3", authorName: "Amit S.", authorColor: "#F4A026", content: "Filed a complaint with railway authorities last month. They sent a form letter back. LineGuard is doing what the railways should.", upvotes: 8, upvotedBy: [], createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
    ],
    createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "post2", communityId: "comm1", communityName: "Indian Railways Queue",
    authorId: "other4", authorName: "Neha R.", authorColor: "#9B59B6",
    title: "How to document a queue incident responsibly",
    content: "Record only what you directly observed, preserve original evidence, avoid sharing private information, and use the dispute process if you are named in a report. Reports are allegations until reviewed.",
    upvotes: 134, upvotedBy: [],
    comments: [
      { id: "c3", postId: "post2", authorId: "other1", authorName: "Rahul M.", authorColor: "#1D8CF8", content: "This is amazing! Screenshots please 🙏", upvotes: 22, upvotedBy: [], createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() },
    ],
    createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "post3", communityId: "comm2", communityName: "Metro Watch India",
    authorId: "other2", authorName: "Priya K.", authorColor: "#2ECE7B",
    title: "Yellow line Delhi Metro — peak hour madness",
    content: "The queue at Rajiv Chowk interchange every evening is like a battlefield. People physically push through. Has anyone successfully reported someone on metro premises?",
    upvotes: 29, upvotedBy: [],
    comments: [
      { id: "c4", postId: "post3", authorId: "other3", authorName: "Amit S.", authorColor: "#F4A026", content: "Yes! Reported twice at Rajiv Chowk. Got a response both times. Key is having video evidence.", upvotes: 15, upvotedBy: [], createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString() },
    ],
    createdAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "post4", communityId: "comm3", communityName: "Hospital Queue Justice",
    authorId: "other3", authorName: "Amit S.", authorColor: "#F4A026",
    title: "AIIMS OPD queue: patients with real emergencies get cut",
    content: "Saw someone in actual pain being made to wait while healthy people with \"connections\" jumped the queue. This is not just rude — it's a matter of life and health.",
    upvotes: 89, upvotedBy: [],
    comments: [],
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

// ── Context Type ──────────────────────────────────────────────────────────────
interface AppContextType {
  // Auth
  authUser: AuthUser | null;
  isAuthenticated: boolean;
  authLoaded: boolean;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;

  updateUser: (name: string) => void;

  // Reports
  reports: Report[];
  myReports: Report[];
  refreshCases: () => Promise<void>;
  joinCase: (invitationCode: string) => Promise<{ caseId: string }>;
  addReport: (report: Omit<Report, "id" | "reporterId" | "reporterName" | "reporterColor" | "timestamp" | "status">) => Promise<{ caseId: string; invitationCode: string }>;
  markGuilty: (reportId: string, amount: number, apology: string, payerName: string) => void;
  dismissReport: (reportId: string) => void;
  getReportById: (id: string) => Report | undefined;
  caseVotesById: Record<string, 'up' | 'down' | null>;
  voteOnCase: (caseId: string, vote: 'up' | 'down') => Promise<void>;
  loadMyCaseVote: (caseId: string) => Promise<void>;

  // Communities
  communities: Community[];
  joinCommunity: (communityId: string) => void;
  leaveCommunity: (communityId: string) => void;
  createCommunity: (name: string, description: string, category: string, color: string) => void;
  isMember: (communityId: string) => boolean;
  getCommunityById: (id: string) => Community | undefined;

  // Posts
  posts: CommunityPost[];
  getPostsByCommunity: (communityId: string) => CommunityPost[];
  getPostById: (id: string) => CommunityPost | undefined;
  createPost: (communityId: string, communityName: string, title: string, content: string) => void;
  upvotePost: (postId: string) => void;
  addComment: (postId: string, content: string) => void;
  upvoteComment: (postId: string, commentId: string) => void;
}

function mapServerCase(item: ServerCase): Report {
  const rawDate = item.createdAt?.toDate?.()?.toISOString?.() || (typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString());
  const status: Report["status"] = item.status === "resolved" ? "guilty" : item.status === "dismissed" ? "dismissed" : "pending";
  return {
    id: item.caseId, accusedId: item.accusedId || null, reporterId: item.reporterId, reporterName: item.reporterName || "LineGuard user",
    reporterColor: AVATAR_COLORS[0], description: item.description || "", location: { latitude: 0, longitude: 0, address: item.location?.address || "" },
    mediaUris: item.evidence || [], mediaTypes: item.evidenceTypes || [], timestamp: rawDate, status, caseStatus: item.status, reporterConfirmed: item.reporterConfirmed, accusedConfirmed: item.accusedConfirmed, agreedCompensation: item.agreedCompensation, paymentStatus: item.paymentStatus, apologyText: item.apologyText, apologyStatus: item.apologyStatus, reporterPublicConsent: item.reporterPublicConsent, accusedPublicConsent: item.accusedPublicConsent,
    upvotes: item.upvotes || 0, downvotes: item.downvotes || 0,
    communityReviewRequired: item.communityReviewRequired, publicBoardFeatured: item.publicBoardFeatured,
    ...(item.paymentStatus === "captured" ? { payment: { amount: Number(item.agreedCompensation || 0), apology: "", paidAt: item.paidAt?.toDate?.()?.toISOString?.() || rawDate, payerName: "Verified payment" } } : {}),
  };
}

function mapPublicCase(item: any): Report {
  const created = typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString();
  return {
    id: item.caseId, reporterId: "public-reporter", accusedId: "public-accused", reporterName: item.reporterName || "Consenting reporter",
    reporterColor: AVATAR_COLORS[0], accusedName: item.accusedName || "Consenting participant",
    description: item.description || "", location: { latitude: 0, longitude: 0, address: "Public listing — exact location hidden" },
    mediaUris: Array.isArray(item.evidence) ? item.evidence : [], mediaTypes: item.evidenceTypes || [], timestamp: created,
    status: "guilty", caseStatus: "agreed", apologyText: item.apologyText, apologyStatus: "approved", isPublicListing: true,
  };
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  // Auth state
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  // App state
  const [reports, setReports] = useState<Report[]>(SEED_REPORTS);
  const [caseVotesById, setCaseVotesById] = useState<Record<string, 'up' | 'down' | null>>({});
  const [communities, setCommunities] = useState<Community[]>(SEED_COMMUNITIES);
  const [posts, setPosts] = useState<CommunityPost[]>(SEED_POSTS);

  // Restore Firebase auth state and load the app's non-sensitive local cache.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
      if (!user) {
        setAuthUser(null);
        setAuthLoaded(true);
        return;
      }
      try {
        const profileRef = doc(firestore, "users", user.uid);
        const profileSnap = await getDoc(profileRef);
        const profile = profileSnap.exists() ? profileSnap.data() : {};
        const fallbackColor = AVATAR_COLORS[0];
        const createdAt = profile.createdAt?.toDate?.()?.toISOString?.() ??
          (typeof profile.createdAt === "string" ? profile.createdAt : new Date().toISOString());
        setAuthUser({
          id: user.uid,
          name: typeof profile.name === "string" ? profile.name : (user.displayName || user.email?.split("@")[0] || "LineGuard user"),
          email: user.email || "",
          color: typeof profile.color === "string" ? profile.color : fallbackColor,
          createdAt,
        });
        try {
          const [result, publicResult] = await Promise.all([listSecureCases(), listPublicShameboard().catch(() => ({ cases: [] }))]);
          const privateCases = result.cases.map(mapServerCase);
          const publicCases = publicResult.cases.map(mapPublicCase);
          const publicById = new Map(publicCases.map(item => [item.id, item]));
          const privateIds = new Set(privateCases.map(item => item.id));
          const mergedPrivate = privateCases.map(item => {
            const publicItem = publicById.get(item.id);
            return publicItem ? { ...item, ...publicItem, reporterId: item.reporterId, accusedId: item.accusedId, reporterPublicConsent: item.reporterPublicConsent, accusedPublicConsent: item.accusedPublicConsent } : item;
          });
          setReports([...mergedPrivate, ...publicCases.filter(item => !privateIds.has(item.id))]);
        } catch (caseError) {
          console.warn("Secure case service is unavailable", caseError);
        }
      } catch (error) {
        console.warn("Could not load LineGuard profile", error);
        setAuthUser({ id: user.uid, name: user.displayName || "LineGuard user", email: user.email || "", color: AVATAR_COLORS[0], createdAt: new Date().toISOString() });
      } finally {
        setAuthLoaded(true);
      }
    });

    (async () => {
      try {
        const [userCommStr, userPostsStr] = await Promise.all([
          AsyncStorage.getItem("lineguard_user_communities"),
          AsyncStorage.getItem("lineguard_user_posts"),
        ]);
        if (userCommStr) {
          const parsed: Community[] = JSON.parse(userCommStr);
          setCommunities([...SEED_COMMUNITIES, ...parsed.filter(c => !SEED_COMMUNITIES.find(s => s.id === c.id))]);
        }
        if (userPostsStr) {
          const parsed: CommunityPost[] = JSON.parse(userPostsStr);
          setPosts(prev => [...prev, ...parsed.filter(p => !prev.find(s => s.id === p.id))]);
        }
      } catch (error) {
        console.warn("Could not restore local LineGuard cache", error);
      }
    })();

    return () => unsubscribe();
  }, []);

  // ── Firebase Authentication ───────────────────────────────────────────────
  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const credential = await createUserWithEmailAndPassword(firebaseAuth, email.trim().toLowerCase(), password);
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    const createdAt = new Date().toISOString();
    await updateProfile(credential.user, { displayName: name.trim() });
    await setDoc(doc(firestore, "users", credential.user.uid), {
      name: name.trim(),
      email: credential.user.email,
      color,
      createdAt,
    });
    setAuthUser({ id: credential.user.uid, name: name.trim(), email: credential.user.email || email.trim().toLowerCase(), color, createdAt });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(firebaseAuth, email.trim().toLowerCase(), password);
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    if (!email.trim()) throw new Error("Enter your email address first.");
    await sendPasswordResetEmail(firebaseAuth, email.trim().toLowerCase());
  }, []);


  const signOut = useCallback(async () => {
    await firebaseSignOut(firebaseAuth);
    setAuthUser(null);
  }, []);

  const updateUser = useCallback(async (name: string) => {
    if (!authUser || !firebaseAuth.currentUser) return;
    const cleanName = name.trim();
    await updateProfile(firebaseAuth.currentUser, { displayName: cleanName });
    await updateDoc(doc(firestore, "users", authUser.id), { name: cleanName });
    setAuthUser({ ...authUser, name: cleanName });
  }, [authUser]);

  // ── Reports ───────────────────────────────────────────────────────────────
  const addReport = useCallback(async (report: Omit<Report, "id" | "reporterId" | "reporterName" | "reporterColor" | "timestamp" | "status">) => {
    if (!authUser) throw new Error("Please sign in before creating a report.");
    const created = await createSecureCase({
      description: report.description,
      reporterName: authUser.name,
      location: report.location,
      evidence: report.mediaUris,
      evidenceTypes: report.mediaTypes || [],
    });
    const refreshed = await listSecureCases();
    const serverItem = refreshed.cases.find(x => x.caseId === created.caseId);
    const item: Report = {
      ...report, mediaUris: serverItem?.evidence || [], mediaTypes: serverItem?.evidenceTypes || report.mediaTypes, id: created.caseId, reporterId: authUser.id, reporterName: authUser.name,
      reporterColor: authUser.color, timestamp: new Date().toISOString(), status: "pending", caseStatus: serverItem?.status, reporterConfirmed: false, accusedConfirmed: false, agreedCompensation: null, paymentStatus: 'not_started',
    };
    setReports(prev => [item, ...prev.filter(x => x.id !== item.id)]);
    return { caseId: created.caseId, invitationCode: created.invitationCode };
  }, [authUser]);

  const markGuilty = useCallback((_reportId: string, _amount: number, _apology: string, _payerName: string) => {
    throw new Error("Payments cannot be marked complete in the app. A verified payment-provider webhook is required.");
  }, []);

  const dismissReport = useCallback((_reportId: string) => {
    throw new Error("Case outcomes must be recorded through the secure review workflow.");
  }, []);

  const getReportById = useCallback((id: string) => reports.find(r => r.id === id), [reports]);
  const loadMyCaseVote = useCallback(async (caseId: string) => {
    try {
      const result = await getMyCaseVote(caseId);
      setCaseVotesById(prev => ({ ...prev, [caseId]: result.myVote }));
      setReports(prev => prev.map(r => r.id === caseId ? { ...r, upvotes: result.upvotes, downvotes: result.downvotes } : r));
    } catch { /* Private cases and participants do not have public voting controls. */ }
  }, []);
  const voteOnCase = useCallback(async (caseId: string, vote: 'up' | 'down') => {
    const result: CaseVoteResult = await voteOnCaseApi(caseId, vote);
    setCaseVotesById(prev => ({ ...prev, [caseId]: result.myVote }));
    setReports(prev => prev.map(r => r.id === caseId ? {
      ...r, upvotes: result.upvotes, downvotes: result.downvotes,
      communityReviewRequired: result.communityReviewRequired,
      publicBoardFeatured: result.publicBoardFeatured,
      isPublicListing: result.communityReviewRequired ? false : r.isPublicListing,
    } : r));
    if (result.communityReviewRequired) {
      // The public board hides this case pending human review; the case record is retained.
      await refreshCases();
    }
  }, []);

  const refreshCases = useCallback(async () => {
    const [result, publicResult] = await Promise.all([listSecureCases(), listPublicShameboard().catch(() => ({ cases: [] }))]);
    const privateCases = result.cases.map(mapServerCase);
    const publicCases = publicResult.cases.map(mapPublicCase);
    const publicById = new Map(publicCases.map(item => [item.id, item]));
    const privateIds = new Set(privateCases.map(item => item.id));
    const mergedPrivate = privateCases.map(item => {
      const publicItem = publicById.get(item.id);
      return publicItem ? { ...item, ...publicItem, reporterId: item.reporterId, accusedId: item.accusedId, reporterPublicConsent: item.reporterPublicConsent, accusedPublicConsent: item.accusedPublicConsent } : item;
    });
    setReports([...mergedPrivate, ...publicCases.filter(item => !privateIds.has(item.id))]);
  }, []);
  const joinCase = useCallback(async (invitationCode: string) => {
    const result = await joinCaseApi(invitationCode.trim());
    await refreshCases();
    return { caseId: result.caseId };
  }, [refreshCases]);
  const myReports = reports.filter(r => r.reporterId === authUser?.id || r.accusedId === authUser?.id);

  // ── Communities ───────────────────────────────────────────────────────────
  const saveUserCommunities = useCallback(async (updated: Community[]) => {
    const userComms = updated.filter(c => !SEED_COMMUNITIES.find(s => s.id === c.id));
    await AsyncStorage.setItem("lineguard_user_communities", JSON.stringify(userComms));
  }, []);

  const joinCommunity = useCallback((communityId: string) => {
    if (!authUser) return;
    setCommunities(prev => {
      const updated = prev.map(c =>
        c.id === communityId && !c.memberIds.includes(authUser.id)
          ? { ...c, memberIds: [...c.memberIds, authUser.id] }
          : c
      );
      saveUserCommunities(updated);
      return updated;
    });
  }, [authUser, saveUserCommunities]);

  const leaveCommunity = useCallback((communityId: string) => {
    if (!authUser) return;
    setCommunities(prev => {
      const updated = prev.map(c =>
        c.id === communityId ? { ...c, memberIds: c.memberIds.filter(id => id !== authUser.id) } : c
      );
      saveUserCommunities(updated);
      return updated;
    });
  }, [authUser, saveUserCommunities]);

  const createCommunity = useCallback((name: string, description: string, category: string, color: string) => {
    if (!authUser) return;
    const newComm: Community = {
      id: generateId(), name, description, category, color,
      creatorId: authUser.id, memberIds: [authUser.id], postCount: 0,
      createdAt: new Date().toISOString(),
    };
    setCommunities(prev => {
      const updated = [newComm, ...prev];
      saveUserCommunities(updated);
      return updated;
    });
  }, [authUser, saveUserCommunities]);

  const isMember = useCallback((communityId: string) => {
    if (!authUser) return false;
    const comm = communities.find(c => c.id === communityId);
    return comm?.memberIds.includes(authUser.id) ?? false;
  }, [authUser, communities]);

  const getCommunityById = useCallback((id: string) => communities.find(c => c.id === id), [communities]);

  // ── Posts ─────────────────────────────────────────────────────────────────
  const saveUserPosts = useCallback(async (updated: CommunityPost[]) => {
    const userPosts = updated.filter(p => !SEED_POSTS.find(s => s.id === p.id));
    await AsyncStorage.setItem("lineguard_user_posts", JSON.stringify(userPosts));
  }, []);

  const getPostsByCommunity = useCallback((communityId: string) =>
    posts.filter(p => p.communityId === communityId).sort((a, b) => b.upvotes - a.upvotes), [posts]);

  const getPostById = useCallback((id: string) => posts.find(p => p.id === id), [posts]);

  const createPost = useCallback((communityId: string, communityName: string, title: string, content: string) => {
    if (!authUser) return;
    const newPost: CommunityPost = {
      id: generateId(), communityId, communityName,
      authorId: authUser.id, authorName: authUser.name, authorColor: authUser.color,
      title, content, upvotes: 0, upvotedBy: [], comments: [],
      createdAt: new Date().toISOString(),
    };
    setPosts(prev => {
      const updated = [newPost, ...prev];
      saveUserPosts(updated);
      return updated;
    });
    setCommunities(prev => prev.map(c => c.id === communityId ? { ...c, postCount: c.postCount + 1 } : c));
  }, [authUser, saveUserPosts]);

  const upvotePost = useCallback((postId: string) => {
    if (!authUser) return;
    setPosts(prev => {
      const updated = prev.map(p => {
        if (p.id !== postId) return p;
        const hasVoted = p.upvotedBy.includes(authUser.id);
        return {
          ...p,
          upvotes: hasVoted ? p.upvotes - 1 : p.upvotes + 1,
          upvotedBy: hasVoted ? p.upvotedBy.filter(id => id !== authUser.id) : [...p.upvotedBy, authUser.id],
        };
      });
      saveUserPosts(updated);
      return updated;
    });
  }, [authUser, saveUserPosts]);

  const addComment = useCallback((postId: string, content: string) => {
    if (!authUser) return;
    const newComment: PostComment = {
      id: generateId(), postId,
      authorId: authUser.id, authorName: authUser.name, authorColor: authUser.color,
      content, upvotes: 0, upvotedBy: [], createdAt: new Date().toISOString(),
    };
    setPosts(prev => {
      const updated = prev.map(p => p.id === postId ? { ...p, comments: [...p.comments, newComment] } : p);
      saveUserPosts(updated);
      return updated;
    });
  }, [authUser, saveUserPosts]);

  const upvoteComment = useCallback((postId: string, commentId: string) => {
    if (!authUser) return;
    setPosts(prev => {
      const updated = prev.map(p => {
        if (p.id !== postId) return p;
        return {
          ...p,
          comments: p.comments.map(c => {
            if (c.id !== commentId) return c;
            const hasVoted = c.upvotedBy.includes(authUser.id);
            return { ...c, upvotes: hasVoted ? c.upvotes - 1 : c.upvotes + 1, upvotedBy: hasVoted ? c.upvotedBy.filter(id => id !== authUser.id) : [...c.upvotedBy, authUser.id] };
          }),
        };
      });
      saveUserPosts(updated);
      return updated;
    });
  }, [authUser, saveUserPosts]);

  return (
    <AppContext.Provider value={{
      authUser, isAuthenticated: !!authUser, authLoaded,
      signUp, signIn, sendPasswordReset, signOut, updateUser,
      reports, myReports, refreshCases, joinCase, addReport, markGuilty, dismissReport, getReportById, caseVotesById, voteOnCase, loadMyCaseVote,
      communities, joinCommunity, leaveCommunity, createCommunity, isMember, getCommunityById,
      posts, getPostsByCommunity, getPostById, createPost, upvotePost, addComment, upvoteComment,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

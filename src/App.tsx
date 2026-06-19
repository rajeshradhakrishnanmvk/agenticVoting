/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, query, orderBy, onSnapshot, doc, setDoc, serverTimestamp, where } from "firebase/firestore";
import { auth, db, handleFirestoreError, OperationType } from "./firebase";
import { Proposal, UserSession, User } from "./types";
import Header from "./components/Header";
import ProposalForm from "./components/ProposalForm";
import ProposalCard from "./components/ProposalCard";
import CommentSection from "./components/CommentSection";
import Leaderboard from "./components/Leaderboard";
import UserProfileModal from "./components/UserProfileModal";
import ChallengesPage from "./components/ChallengesPage";
import { 
  Search, 
  ArrowUpDown, 
  Inbox, 
  Sparkles, 
  Vote as VoteIcon,
  ArrowLeft,
  Flame,
  MessageSquare,
  ExternalLink
} from "lucide-react";

const CATEGORIES = ["All", "Governance", "Technical", "Community", "Treasury", "Events", "Meta"];

export default function App() {
  const [user, setUser] = useState<UserSession | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [userProfile, setUserProfile] = useState<User | null>(null);
  const [viewingProfileId, setViewingProfileId] = useState<string | null>(null);
  
  const [publicProposals, setPublicProposals] = useState<Proposal[]>([]);
  const [draftProposals, setDraftProposals] = useState<Proposal[]>([]);

  // Memoized unified proposals list
  const proposals = useMemo(() => {
    return [...publicProposals, ...draftProposals];
  }, [publicProposals, draftProposals]);

  const [loadingProposals, setLoadingProposals] = useState(true);
  
  // Track personal votes cast by the current user to display up/down markers correctly
  const [userVotes, setUserVotes] = useState<Record<string, "up" | "down">>({});
  
  // Search and Filter parameters
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"highest" | "lowest" | "active" | "newest" | "deliberation">("highest");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  // Real-time comments sync
  const [comments, setComments] = useState<any[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);

  // Focus proposal selector for comments detail page
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  const [isEmbedMode, setIsEmbedMode] = useState(false);

  // Challenge entry prefilling parameters
  const [prefilledChallengeTag, setPrefilledChallengeTag] = useState<string | null>(null);
  const [prefilledChallengeCategory, setPrefilledChallengeCategory] = useState<string | null>(null);
  const [challenges, setChallenges] = useState<any[]>([]);

  // Sync challenges
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "challenges"), (snap) => {
      const list: any[] = [];
      snap.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      setChallenges(list);
    });
    return () => unsub();
  }, []);

  // Dual-mode router: detect deep link and embed paths
  useEffect(() => {
    const handleUrlRouting = () => {
      const pathname = window.location.pathname;
      const proposalMatch = pathname.match(/^\/proposal\/([a-zA-Z0-9_\-]+)$/);
      const embedMatch = pathname.match(/^\/embed\/proposal\/([a-zA-Z0-9_\-]+)$/);

      if (pathname === "/leaderboard") {
        setIsEmbedMode(false);
        setActiveProposalId("leaderboard");
      } else if (pathname === "/challenges") {
        setIsEmbedMode(false);
        setActiveProposalId("challenges");
      } else if (embedMatch) {
        setIsEmbedMode(true);
        setActiveProposalId(embedMatch[1]);
      } else if (proposalMatch) {
        setIsEmbedMode(false);
        setActiveProposalId(proposalMatch[1]);
      } else {
        setIsEmbedMode(false);
        setActiveProposalId(null);
      }
    };

    handleUrlRouting();
    window.addEventListener("popstate", handleUrlRouting);
    return () => window.removeEventListener("popstate", handleUrlRouting);
  }, []);

  const navigateToProposal = (id: string | null) => {
    if (id === "leaderboard") {
      window.history.pushState({}, "", "/leaderboard");
      setActiveProposalId("leaderboard");
    } else if (id === "challenges") {
      window.history.pushState({}, "", "/challenges");
      setActiveProposalId("challenges");
    } else if (id) {
      window.history.pushState({}, "", `/proposal/${id}`);
      setActiveProposalId(id);
    } else {
      window.history.pushState({}, "", "/");
      setActiveProposalId(null);
    }
  };

  // Sync auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (rawUser) => {
      if (rawUser) {
        setUser({
          uid: rawUser.uid,
          displayName: rawUser.displayName,
          email: rawUser.email,
          emailVerified: rawUser.emailVerified,
          photoURL: rawUser.photoURL,
        });
      } else {
        setUser(null);
      }
      setLoadingAuth(false);
    });
    return () => unsub();
  }, []);

  // Sync detailed User Reputation Profile
  useEffect(() => {
    if (!user) {
      setUserProfile(null);
      return;
    }
    const unsub = onSnapshot(
      doc(db, "users", user.uid),
      (docSnap) => {
        if (docSnap.exists()) {
          setUserProfile(docSnap.data() as User);
        } else {
          // Initialize user record
          const initialProfile = {
            userId: user.uid,
            displayName: user.displayName || "Anonymous Member",
            email: user.email || "anonymous@community-voting.com",
            reputation: 0,
            badges: [],
            streak: 0,
            joinedAt: serverTimestamp(),
            lastVotedDate: ""
          };
          setDoc(doc(db, "users", user.uid), initialProfile).catch((err) => {
            console.error("Failed to initialize user document: ", err);
          });
        }
      },
      (error) => {
        console.error("User profile subscription failed: ", error);
        handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
      }
    );
    return () => unsub();
  }, [user]);

  // Check for new proposals since last visit
  useEffect(() => {
    if (!user || !userProfile || publicProposals.length === 0) return;

    const checkNewCategories = async () => {
      const sessionKey = `has_checked_new_proposals_${user.uid}`;
      if (sessionStorage.getItem(sessionKey)) return;
      sessionStorage.setItem(sessionKey, "true");

      const lastVisitTimestamp = userProfile.lastVisit;
      if (!lastVisitTimestamp) {
        try {
          const { updateDoc, doc: fsDoc, serverTimestamp: fsServerTimestamp } = await import("firebase/firestore");
          await updateDoc(fsDoc(db, "users", user.uid), {
            lastVisit: fsServerTimestamp()
          });
        } catch (err) {
          console.error("Failed to initialize lastVisit:", err);
        }
        return;
      }

      const lastVisitDate = typeof lastVisitTimestamp.toDate === "function" 
        ? lastVisitTimestamp.toDate() 
        : new Date(lastVisitTimestamp.seconds * 1000);
      const newCats = new Set<string>();

      publicProposals.forEach((p) => {
        if (!p.createdAt) return;
        const createdAtDate = typeof p.createdAt.toDate === "function" 
          ? p.createdAt.toDate() 
          : new Date(p.createdAt.seconds * 1000);
        if (createdAtDate > lastVisitDate && p.authorId !== user.uid) {
          newCats.add(p.category);
        }
      });

      if (newCats.size > 0) {
        try {
          const { createInAppNotification } = await import("./utils/notifications");
          for (const cat of newCats) {
            await createInAppNotification(
              user.uid,
              "new_proposal",
              null,
              `New proposal in ${cat} since your last visit.`,
              "New Category Proposal"
            );
          }
        } catch (err) {
          console.error("Failed creating new proposal category alert:", err);
        }
      }

      // Update lastVisit to now for subsequent sessions
      try {
        const { updateDoc, doc: fsDoc, serverTimestamp: fsServerTimestamp } = await import("firebase/firestore");
        await updateDoc(fsDoc(db, "users", user.uid), {
          lastVisit: fsServerTimestamp()
        });
      } catch (err) {
        console.error("Failed setting updated lastVisit:", err);
      }
    };

    checkNewCategories();
  }, [user, userProfile, publicProposals]);

  // Fetch proposals in real time
  useEffect(() => {
    setLoadingProposals(true);

    // 1. Subscription to public proposals (all status except draft)
    const qPublic = query(collection(db, "proposals"), where("status", "!=", "draft"));

    const unsubPublic = onSnapshot(
      qPublic,
      (snapshot) => {
        const publicItems: Proposal[] = [];
        snapshot.forEach((docSnap) => {
          publicItems.push({
            id: docSnap.id,
            ...docSnap.data(),
          } as Proposal);
        });
        setPublicProposals(publicItems);
        setLoadingProposals(false);
      },
      (error) => {
        console.error("Proposals feed subscription failed: ", error);
        setLoadingProposals(false);
        handleFirestoreError(error, OperationType.LIST, "proposals");
      }
    );

    // 2. Subscription to user's draft proposals (only if logged in)
    let unsubDrafts = () => {};
    if (user?.uid) {
      const qDrafts = query(
        collection(db, "proposals"),
        where("status", "==", "draft"),
        where("authorId", "==", user.uid)
      );
      unsubDrafts = onSnapshot(
        qDrafts,
        (snapshot) => {
          const draftItems: Proposal[] = [];
          snapshot.forEach((docSnap) => {
            draftItems.push({
              id: docSnap.id,
              ...docSnap.data(),
            } as Proposal);
          });
          setDraftProposals(draftItems);
        },
        (error) => {
          console.error("Proposals draft feed subscription failed: ", error);
          handleFirestoreError(error, OperationType.LIST, "proposals");
        }
      );
    } else {
      setDraftProposals([]);
    }

    return () => {
      unsubPublic();
      unsubDrafts();
    };
  }, [user?.uid]);

  // Fetch comments in real time for deliberation metric counts
  useEffect(() => {
    setLoadingComments(true);
    const unsub = onSnapshot(
      collection(db, "comments"),
      (snapshot) => {
        const items: any[] = [];
        snapshot.forEach((docSnap) => {
          items.push({
            id: docSnap.id,
            ...docSnap.data()
          });
        });
        setComments(items);
        setLoadingComments(false);
      },
      (error) => {
        console.error("Comments global stream error: ", error);
        setLoadingComments(false);
        handleFirestoreError(error, OperationType.LIST, "comments");
      }
    );
    return () => unsub();
  }, []);

  // Precalculating comments count and deliberation score metrics dynamically
  const proposalsWithMetrics = useMemo(() => {
    return proposals.map((p) => {
      const propComments = comments.filter((c) => c.proposalId === p.id);
      const count = propComments.length;
      
      let score = 0;
      if (count > 0) {
        const totalNetVotes = propComments.reduce((sum, c) => sum + (c.upvotes - c.downvotes), 0);
        const avgNetVotes = totalNetVotes / count;
        const avgQuality = Math.max(0.5, avgNetVotes + 1);
        
        const createdAtMillis = p.createdAt?.toMillis ? p.createdAt.toMillis() : Date.now();
        const timeActiveHours = Math.max(0.1, (Date.now() - createdAtMillis) / (1000 * 60 * 60));
        
        score = parseFloat(((count * avgQuality) / timeActiveHours).toFixed(2));
      }
      
      return {
        ...p,
        commentCount: count,
        deliberationScore: score
      };
    });
  }, [proposals, comments]);

  const activeProposal = useMemo(() => {
    if (!activeProposalId) return null;
    return proposalsWithMetrics.find((p) => p.id === activeProposalId) || null;
  }, [activeProposalId, proposalsWithMetrics]);

  const getProposalChallengeInfo = (prop: Proposal | null) => {
    if (!prop || !prop.tags || prop.tags.length === 0) return { entryTitle: undefined, winnerTitle: undefined };
    
    const matchingChallenge = challenges.find((ch: any) => 
      prop.tags!.some((t: string) => t.toLowerCase() === ch.tag?.toLowerCase())
    );

    if (!matchingChallenge) return { entryTitle: undefined, winnerTitle: undefined };

    const isWinner = matchingChallenge.winnerProposalId === prop.id;

    return {
      entryTitle: matchingChallenge.title,
      winnerTitle: isWinner ? matchingChallenge.title : undefined
    };
  };

  // Compute primitive ID strings to avoid re-subscription loop dependencies
  const proposalIdsString = proposals.map((p) => p.id).join(",");

  // Multi-listener synchronization for individual voter statuses
  useEffect(() => {
    if (!user) {
      setUserVotes({});
      return;
    }

    const unsubscribes: (() => void)[] = [];
    const ids = proposalIdsString ? proposalIdsString.split(",") : [];

    ids.forEach((pId) => {
      if (!pId) return;
      
      const voteDocRef = doc(db, "proposals", pId, "votes", user.uid);
      const unsub = onSnapshot(
        voteDocRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            setUserVotes((prev) => ({
              ...prev,
              [pId]: data.voteType,
            }));
          } else {
            setUserVotes((prev) => {
              const updated = { ...prev };
              delete updated[pId];
              return updated;
            });
          }
        },
        (error) => {
          // Ignores restricted paths or offline issues
        }
      );
      unsubscribes.push(unsub);
    });

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [user?.uid, proposalIdsString]);

  // Compute stats metrics dynamically from active stream
  const stats = useMemo(() => {
    const totalCount = proposals.length;
    let totalVotes = 0;
    
    proposals.forEach((p) => {
      totalVotes += (p.upvotesCount || 0) + (p.downvotesCount || 0);
    });

    let topProposalTitle = "No suggestions yet";
    let highestScore = 0;
    if (proposals.length > 0) {
      const sortedByVotes = [...proposals].sort((a, b) => (b.netVotes || 0) - (a.netVotes || 0));
      if (sortedByVotes[0]) {
        topProposalTitle = sortedByVotes[0].title;
        highestScore = sortedByVotes[0].netVotes;
      }
    }

    return {
      totalCount,
      totalVotes,
      topProposalTitle,
      highestScore
    };
  }, [proposals]);

  // Compute popularity & stats metadata by individual categories
  const categoryTrends = useMemo(() => {
    const cats = ["Governance", "Technical", "Community", "Treasury", "Events", "Meta"];
    return cats.map((cat) => {
      const catProps = proposalsWithMetrics.filter((p) => (p.category || "Community") === cat);
      const totalCount = catProps.length;
      const totalScore = catProps.reduce((sum, p) => sum + (p.netVotes || 0), 0);
      
      let leadingProposal = null;
      if (catProps.length > 0) {
        const sorted = [...catProps].sort((a, b) => (b.netVotes || 0) - (a.netVotes || 0));
        leadingProposal = sorted[0];
      }

      return {
        categoryName: cat,
        count: totalCount,
        score: totalScore,
        leader: leadingProposal
      };
    });
  }, [proposalsWithMetrics]);

  // Handle client-side search and high-performance sorting
  const filteredAndSortedProposals = useMemo(() => {
    let items = proposalsWithMetrics.filter((p) => {
      // 1. Is Draft visibility filter (ONLY AUTHOR can see drafts)
      if (p.status === "draft") {
        if (!user || p.authorId !== user.uid) {
          return false;
        }
      }

      // 2. Search filter
      const criteria = searchQuery.toLowerCase().trim();
      const matchesSearch = !criteria || (
        p.title.toLowerCase().includes(criteria) ||
        p.description.toLowerCase().includes(criteria) ||
        p.authorName.toLowerCase().includes(criteria)
      );

      // 3. Category filter
      const matchesCategory = selectedCategory === "All" || (p.category || "Community") === selectedCategory;

      return matchesSearch && matchesCategory;
    });

    items.sort((a, b) => {
      if (sortBy === "highest") {
        return (b.netVotes || 0) - (a.netVotes || 0);
      }
      if (sortBy === "lowest") {
        return (a.netVotes || 0) - (b.netVotes || 0);
      }
      if (sortBy === "active") {
        const votesA = (a.upvotesCount || 0) + (a.downvotesCount || 0);
        const votesB = (b.upvotesCount || 0) + (b.downvotesCount || 0);
        return votesB - votesA;
      }
      if (sortBy === "deliberation") {
        return (b.deliberationScore || 0) - (a.deliberationScore || 0);
      }
      if (sortBy === "newest") {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return timeB - timeA;
      }
      return 0;
    });

    return items;
  }, [proposalsWithMetrics, searchQuery, sortBy, selectedCategory]);

  if (isEmbedMode) {
    return (
      <div className="bg-transparent p-4 min-h-screen flex items-center justify-center font-sans">
        {activeProposal ? (
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
            <ProposalCard
              proposal={activeProposal}
              user={user}
              currentUserVote={userVotes[activeProposal.id] || null}
              isDetail={false}
              isEmbed={true}
            />
            <div className="bg-slate-50 border-t border-slate-100 px-4 py-2 flex items-center justify-between text-[11px] font-mono text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Sentiment Ballot
              </span>
              <a 
                href={`${window.location.protocol}//${window.location.host}/proposal/${activeProposal.id}`} 
                target="_blank" 
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                className="text-indigo-600 hover:text-indigo-800 font-extrabold hover:underline inline-flex items-center gap-1"
              >
                Discuss &amp; Vote on goBodhi
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        ) : (
          <div className="text-center text-xs text-slate-405 font-mono py-12 flex flex-col items-center justify-center gap-2">
            <div className="w-5 h-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
            <span>Fetching interactive ballot...</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-slate-50 min-h-screen text-slate-900 pb-20">
      {/* Navbar segment */}
      <Header user={user} loading={loadingAuth} userProfile={userProfile} />

      {/* Main Container */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 flex flex-col gap-8">
        
        {activeProposalId === "leaderboard" ? (
          /* Leaderboard Page Container View */
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <button
                onClick={() => navigateToProposal(null)}
                className="inline-flex items-center gap-2 text-xs font-black text-slate-600 hover:text-indigo-600 cursor-pointer bg-white border border-slate-200 shadow-3xs py-3 px-5 rounded-2xl hover:border-indigo-300 transition-all uppercase tracking-wider font-mono"
              >
                <ArrowLeft className="w-4 h-4 text-indigo-500 stroke-[2.5]" />
                ← Back to Community Board
              </button>
            </div>

            <Leaderboard user={user} onViewProfile={(userId) => setViewingProfileId(userId)} />
          </div>
        ) : activeProposalId === "challenges" ? (
          /* Challenges Page Container View */
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <button
                onClick={() => navigateToProposal(null)}
                className="inline-flex items-center gap-2 text-xs font-black text-slate-600 hover:text-indigo-600 cursor-pointer bg-white border border-slate-200 shadow-3xs py-3 px-5 rounded-2xl hover:border-indigo-300 transition-all uppercase tracking-wider font-mono"
              >
                <ArrowLeft className="w-4 h-4 text-indigo-500 stroke-[2.5]" />
                ← Back to Community Board
              </button>
            </div>

            <ChallengesPage
              user={user}
              userProfile={userProfile}
              onViewProfile={(userId) => setViewingProfileId(userId)}
              onEnterChallengeWithTag={(tag, category) => {
                setPrefilledChallengeTag(tag);
                setPrefilledChallengeCategory(category);
                navigateToProposal(null);
              }}
            />
          </div>
        ) : activeProposal ? (
          /* Focused Deliberation Page Layout (Detail Page) */
          <div className="flex flex-col gap-6">
            
            {/* Header back navigation Row */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <button
                onClick={() => navigateToProposal(null)}
                className="inline-flex items-center gap-2 text-xs font-black text-slate-600 hover:text-indigo-600 cursor-pointer bg-white border border-slate-200 shadow-3xs py-3 px-5 rounded-2xl hover:border-indigo-300 transition-all uppercase tracking-wider font-mono"
              >
                <ArrowLeft className="w-4 h-4 text-indigo-500 stroke-[2.5]" />
                ← Back to Community Board
              </button>

              <div className="flex items-center gap-2 px-4 py-2 bg-orange-50 border border-orange-100 rounded-2xl text-orange-600 text-xs font-mono font-bold uppercase select-none">
                <Flame className="w-4 h-4 fill-orange-500 text-orange-500 animate-pulse" />
                Active Deliberation Flow
              </div>
            </div>

            {/* Selected focused proposal card */}
            {(() => {
              const chInfo = getProposalChallengeInfo(activeProposal);
              return (
                <ProposalCard
                  proposal={activeProposal}
                  user={user}
                  currentUserVote={userVotes[activeProposal.id] || null}
                  isDetail={true}
                  onViewProfile={(userId) => setViewingProfileId(userId)}
                  challengeEntryTitle={chInfo.entryTitle}
                  challengeWinnerTitle={chInfo.winnerTitle}
                />
              );
            })()}

            {/* Live Threaded comments component section */}
            <CommentSection
              proposalId={activeProposal.id}
              user={user}
              proposalCreatedAt={activeProposal.createdAt}
              proposalAuthorId={activeProposal.authorId}
              onViewProfile={(userId) => setViewingProfileId(userId)}
            />

          </div>
        ) : (
          /* Bento Grid Splitter */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* Left Column Sidebar: Persistent Proposal submission card */}
            <div className="lg:col-span-4 lg:sticky lg:top-28">
              <ProposalForm 
                user={user} 
                prefilledTag={prefilledChallengeTag} 
                prefilledCategory={prefilledChallengeCategory}
                onClearPrefills={() => {
                  setPrefilledChallengeTag(null);
                  setPrefilledChallengeCategory(null);
                }}
              />
            </div>

            {/* Right Column Content region (lg:col-span-8) */}
            <div className="lg:col-span-8 flex flex-col gap-6">
              
              {/* 1. High Impact Stats - Bento block cells */}
              <section className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                
                {/* Stat cell 1 */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 flex flex-col justify-center shadow-sm hover:shadow-md transition-shadow">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 font-mono">Active Proposals</p>
                  <p className="text-3xl font-black text-slate-800 tracking-tight">{stats.totalCount}</p>
                </div>

                {/* Stat cell 2 */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 flex flex-col justify-center shadow-sm hover:shadow-md transition-shadow">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 font-mono">Total Ballots Cast</p>
                  <p className="text-3xl font-black text-slate-800 tracking-tight">{stats.totalVotes}</p>
                </div>

                {/* Stat cell 3: Top suggestion high contrast badge card */}
                <div className="bg-indigo-600 rounded-3xl p-6 flex flex-col justify-center shadow-lg shadow-indigo-100 text-white hover:bg-indigo-700 transition-colors">
                  <p className="text-[10px] font-bold text-white/80 uppercase tracking-widest mb-1.5 font-mono flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-amber-300 fill-amber-300" />
                    Top Choice
                  </p>
                  <p className="text-sm font-extrabold truncate uppercase tracking-tight" title={stats.topProposalTitle}>
                    {stats.topProposalTitle}
                  </p>
                  {stats.highestScore > 0 && (
                    <p className="text-[11px] text-indigo-200 font-mono mt-1">
                      Leading with +{stats.highestScore} net votes
                    </p>
                  )}
                </div>
              </section>

              {/* Trending by Category Bento Section */}
              <section className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-rose-50 text-rose-600 rounded-xl border border-rose-100">
                    <Flame className="w-4 h-4 fill-rose-500 text-rose-500" />
                  </div>
                  <div>
                    <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">Trending by Category</h3>
                    <p className="text-[10px] text-slate-400 font-mono tracking-wide">Popularity, count, and lead proposals per ecosystem branch</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {categoryTrends.map((trend) => {
                    const catName = trend.categoryName;
                    
                    // Colors
                    let borderCol = "hover:border-slate-355 hover:border-slate-300 hover:bg-slate-50/50 border-slate-200";
                    let textCol = "text-slate-650";
                    
                    if (catName === "Governance") {
                      borderCol = "hover:border-indigo-200 hover:bg-indigo-50/5 border-slate-200";
                      textCol = "text-indigo-700 font-bold";
                    } else if (catName === "Technical") {
                      borderCol = "hover:border-blue-200 hover:bg-blue-50/5 border-slate-200";
                      textCol = "text-blue-700 font-bold";
                    } else if (catName === "Community") {
                      borderCol = "hover:border-teal-200 hover:bg-teal-50/5 border-slate-200";
                      textCol = "text-teal-700 font-bold";
                    } else if (catName === "Treasury") {
                      borderCol = "hover:border-emerald-200 hover:bg-emerald-50/5 border-slate-200";
                      textCol = "text-emerald-700 font-bold";
                    } else if (catName === "Events") {
                      borderCol = "hover:border-purple-200 hover:bg-purple-50/5 border-slate-200";
                      textCol = "text-purple-700 font-bold";
                    } else if (catName === "Meta") {
                      borderCol = "hover:border-rose-200 hover:bg-rose-50/5 border-slate-200";
                      textCol = "text-rose-700 font-bold";
                    }

                    const isCurrentFilter = selectedCategory === catName;
                    const containerClasses = `border rounded-2xl p-4 flex flex-col justify-between transition-all cursor-pointer ${borderCol} ${
                      isCurrentFilter ? "ring-2 ring-indigo-500 bg-indigo-50/10 border-transparent scale-102" : "bg-white"
                    }`;

                    return (
                      <div
                        key={catName}
                        onClick={() => setSelectedCategory(catName)}
                        className={containerClasses}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className={`${textCol} text-xs font-black uppercase tracking-wide`}>
                            {catName === "Governance" ? "⚖️ Governance" :
                             catName === "Technical" ? "💻 Technical" :
                             catName === "Community" ? "🤝 Community" :
                             catName === "Treasury" ? "💰 Treasury" :
                             catName === "Events" ? "📅 Events" :
                             catName === "Meta" ? "🌀 Meta" : catName}
                          </span>
                          <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-md">
                            {trend.count}
                          </span>
                        </div>

                        <div className="mt-2.5 space-y-1">
                          <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono font-medium">
                            <span>Score Weight</span>
                            <span className={trend.score >= 0 ? "text-emerald-600 font-bold" : "text-rose-500 font-bold"}>
                              {trend.score > 0 ? `+${trend.score}` : trend.score}
                            </span>
                          </div>

                          <div className="h-0.5 bg-slate-100 rounded-full overflow-hidden mt-1">
                            <div 
                              className={`h-full rounded-full ${
                                catName === "Governance" ? "bg-indigo-500" :
                                catName === "Technical" ? "bg-blue-500" :
                                catName === "Community" ? "bg-teal-500" :
                                catName === "Treasury" ? "bg-emerald-500" :
                                catName === "Events" ? "bg-purple-500" : "bg-rose-500"
                              }`}
                              style={{ width: `${Math.min(100, Math.max(10, trend.count * 15))}%` }}
                            />
                          </div>

                          {trend.leader ? (
                            <p className="text-[9.5px] text-slate-550 truncate font-sans pt-1.5 italic font-medium leading-tight" title={`Top: ${trend.leader.title}`}>
                              Top: <strong className="text-slate-700 not-italic font-semibold">{trend.leader.title}</strong>
                            </p>
                          ) : (
                            <p className="text-[9.5px] text-slate-400 italic font-mono pt-1.5">No drafts yet</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Category Filters Pill Row */}
              <section className="flex flex-col gap-1.5 bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Filter by Category</p>
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none snap-x -mx-4 px-4 sm:mx-0 sm:px-0">
                  {CATEGORIES.map((catName) => {
                    const isSelected = selectedCategory === catName;
                    
                    // Style assignments per category
                    let pillStyle = "bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200/60";
                    let activeStyle = "bg-slate-800 text-white border-slate-800 shadow-3xs";
                    
                    if (catName === "Governance") {
                      pillStyle = "bg-indigo-50 hover:bg-indigo-100/60 text-indigo-700 border-indigo-150/45";
                      activeStyle = "bg-indigo-600 text-white border-indigo-600 shadow-indigo-100 shadow-sm";
                    } else if (catName === "Technical") {
                      pillStyle = "bg-blue-50 hover:bg-blue-100/60 text-blue-700 border-blue-150/45";
                      activeStyle = "bg-blue-600 text-white border-blue-600 shadow-blue-100 shadow-sm";
                    } else if (catName === "Community") {
                      pillStyle = "bg-teal-50 hover:bg-teal-100/60 text-teal-700 border-teal-150/45";
                      activeStyle = "bg-teal-600 text-white border-teal-600 shadow-teal-100 shadow-sm";
                    } else if (catName === "Treasury") {
                      pillStyle = "bg-emerald-50 hover:bg-emerald-100/60 text-emerald-700 border-emerald-150/45";
                      activeStyle = "bg-emerald-600 text-white border-emerald-600 shadow-emerald-100 shadow-sm";
                    } else if (catName === "Events") {
                      pillStyle = "bg-purple-50 hover:bg-purple-100/60 text-purple-700 border-purple-150/45";
                      activeStyle = "bg-purple-600 text-white border-purple-600 shadow-purple-100 shadow-sm";
                    } else if (catName === "Meta") {
                      pillStyle = "bg-rose-50 hover:bg-rose-100/60 text-rose-700 border-rose-150/45";
                      activeStyle = "bg-rose-600 text-white border-rose-600 shadow-rose-100 shadow-sm";
                    }

                    return (
                      <button
                        key={catName}
                        onClick={() => setSelectedCategory(catName)}
                        className={`px-3.5 py-2 border rounded-xl text-xs font-bold cursor-pointer shrink-0 snap-start transition-all ${
                          isSelected ? activeStyle + " rotate-0 scale-102" : pillStyle + " hover:scale-101 active:scale-99"
                        }`}
                      >
                        {catName === "All" ? "🌐 All Fields" : 
                         catName === "Governance" ? "⚖️ Governance" :
                         catName === "Technical" ? "💻 Technical" :
                         catName === "Community" ? "🤝 Community" :
                         catName === "Treasury" ? "💰 Treasury" :
                         catName === "Events" ? "📅 Events" :
                         catName === "Meta" ? "🌀 Meta" : catName}
                      </button>
                    )
                  })}
                </div>
              </section>

              {/* 2. Sorting & Search Filtering Bar */}
              <section className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                    <VoteIcon className="w-4.5 h-4.5" />
                  </div>
                  <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">Trending Proposals</h2>
                </div>
                
                <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
                  {/* Search Box inputs styling strictly matches bento placeholder looks */}
                  <div className="relative w-full sm:w-60">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      id="search-query"
                      type="text"
                      placeholder="Search titles, authors..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-slate-805 placeholder-slate-400 font-sans focus:outline-hidden focus:border-indigo-500 focus:bg-white transition-all shadow-xs"
                    />
                  </div>

                  {/* Sort Option parameters */}
                  <div className="relative w-full sm:w-auto">
                    <select
                      id="sorting"
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="w-full cursor-pointer bg-slate-50 border border-slate-200 text-xs font-sans font-bold text-slate-600 py-2.5 pl-3.5 pr-8 rounded-xl focus:outline-hidden focus:border-indigo-500 hover:bg-slate-100 transition-all appearance-none shadow-xs"
                    >
                      <option value="highest">Hot (Priority Score)</option>
                      <option value="lowest">Lowest Priority Score</option>
                      <option value="active">Active (Most Voted)</option>
                      <option value="deliberation">Deliberation Score 🔥</option>
                      <option value="newest">Newest Suggestions</option>
                    </select>
                    <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>
              </section>

              {/* 3. Realtime Proposals Stream Feed */}
              <section className="space-y-4">
                {loadingProposals ? (
                  /* Loading lists simulation skeletons matching bento borders */
                  <div className="space-y-4">
                    {[1, 2, 3].map((n) => (
                      <div key={n} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 animate-pulse shadow-sm">
                        <div className="flex gap-4 items-center">
                          <div className="w-12 h-16 bg-slate-100 rounded-xl"></div>
                          <div className="flex-1 space-y-2">
                            <div className="h-4 bg-slate-100 rounded-md w-2/3"></div>
                            <div className="h-3 bg-slate-100 rounded-md w-4/5"></div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : filteredAndSortedProposals.length > 0 ? (
                  /* Feed rendering */
                  <div className="space-y-4">
                    {filteredAndSortedProposals.map((proposal: any) => {
                      const chInfo = getProposalChallengeInfo(proposal);
                      return (
                        <ProposalCard
                          key={proposal.id}
                          proposal={proposal}
                          user={user}
                          currentUserVote={userVotes[proposal.id] || null}
                          commentCount={proposal.commentCount}
                          deliberationScore={proposal.deliberationScore}
                          onSelect={() => navigateToProposal(proposal.id)}
                          onViewProfile={(userId) => setViewingProfileId(userId)}
                          challengeEntryTitle={chInfo.entryTitle}
                          challengeWinnerTitle={chInfo.winnerTitle}
                        />
                      );
                    })}
                  </div>
                ) : (
                  /* Styled empty list bento placeholder */
                  <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center flex flex-col items-center justify-center space-y-4 shadow-sm">
                    <div className="p-4 bg-slate-50 text-slate-400 rounded-2xl border border-slate-100">
                      <Inbox className="w-8 h-8" />
                    </div>
                    <div className="space-y-2 max-w-sm">
                      <h4 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider">
                        {searchQuery ? "No matching proposals" : "No proposals currently active"}
                      </h4>
                      <p className="text-xs text-slate-550 font-sans leading-relaxed">
                        {searchQuery
                          ? "Try refining your search terms or select another sort category above."
                          : "Submit a proposal on the left to activate democratized community voting!"}
                      </p>
                    </div>
                  </div>
                )}
              </section>

            </div>
          </div>
        )}
      </main>

      {viewingProfileId && (
        <UserProfileModal
          userId={viewingProfileId}
          onClose={() => setViewingProfileId(null)}
          currentUser={user}
          currentUserProfile={userProfile}
        />
      )}
    </div>
  );
}

import React, { useState, useEffect, useMemo } from "react";
import { 
  collection, 
  query, 
  onSnapshot, 
  orderBy, 
  addDoc, 
  updateDoc, 
  doc, 
  serverTimestamp, 
  Timestamp,
  where
} from "firebase/firestore";
import { db } from "../firebase";
import { Challenge, Proposal, UserSession } from "../types";
import { 
  Trophy, 
  Calendar, 
  Tag, 
  Shield, 
  Plus, 
  X, 
  AlertCircle, 
  ArrowLeft, 
  Loader2, 
  Sparkles, 
  Clock, 
  Vote, 
  ChevronRight, 
  Users,
  Award
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ProposalCard from "./ProposalCard";

interface ChallengesPageProps {
  user: UserSession | null;
  userProfile: any;
  onViewProfile: (userId: string) => void;
  onEnterChallengeWithTag: (tag: string, category: string) => void;
}

export default function ChallengesPage({ 
  user, 
  userProfile, 
  onViewProfile,
  onEnterChallengeWithTag
}: ChallengesPageProps) {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Tab view: "active" | "past"
  const [activeTab, setActiveTab] = useState<"active" | "past">("active");
  const [selectedChallengeId, setSelectedChallengeId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Proposal submissions & votes tracking state
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(true);

  // Sync all challenges
  useEffect(() => {
    const q = query(
      collection(db, "challenges"),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const list: Challenge[] = [];
      snapshot.forEach((snap) => {
        const data = snap.data();
        list.push({
          id: snap.id,
          title: data.title || "",
          description: data.description || "",
          category: data.category || "All",
          startDate: data.startDate,
          endDate: data.endDate,
          prizeDescription: data.prizeDescription || "Community Recognition",
          tag: data.tag || "",
          creatorId: data.creatorId || "",
          creatorName: data.creatorName || "Moderator",
          createdAt: data.createdAt,
          winnerProposalId: data.winnerProposalId || undefined,
        });
      });
      setChallenges(list);
      setLoading(false);
    }, (err) => {
      console.error("Failed fetching challenges from Firestore:", err);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Sync all proposals to match with active tags in memory
  useEffect(() => {
    const q = query(
      collection(db, "proposals"),
      where("status", "in", ["active", "passed", "rejected", "expired"])
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const list: Proposal[] = [];
      snapshot.forEach((snap) => {
        const data = snap.data();
        list.push({
          id: snap.id,
          ...data
        } as Proposal);
      });
      setProposals(list);
      setProposalsLoading(false);
    }, (err) => {
      console.error("Failed syncing proposals for challenge details:", err);
      setProposalsLoading(false);
    });
    return () => unsub();
  }, []);

  // Admin check
  const isAdmin = useMemo(() => {
    if (!user || !user.email) return false;
    const email = user.email.toLowerCase();
    return email === "rajeshmvk@gmail.com" || email.includes("admin") || email.includes("moderator");
  }, [user]);

  // Split Active vs Past Challenges
  const { activeList, pastList } = useMemo(() => {
    const active: Challenge[] = [];
    const past: Challenge[] = [];
    const now = new Date();

    challenges.forEach((ch) => {
      if (!ch.endDate) return;
      const endD = ch.endDate.toDate ? ch.endDate.toDate() : new Date(ch.endDate as any);
      if (endD > now) {
        active.push(ch);
      } else {
        past.push(ch);
      }
    });

    return { activeList: active, pastList: past };
  }, [challenges]);

  // Selected Detail Challenge
  const selectedChallenge = useMemo(() => {
    return challenges.find((c) => c.id === selectedChallengeId) || null;
  }, [challenges, selectedChallengeId]);

  // Filter entered proposals for the selected challenge
  const challengeProposals = useMemo(() => {
    if (!selectedChallenge) return [];
    
    const startD = selectedChallenge.startDate?.toDate ? selectedChallenge.startDate.toDate() : new Date(selectedChallenge.startDate as any);
    const endD = selectedChallenge.endDate?.toDate ? selectedChallenge.endDate.toDate() : new Date(selectedChallenge.endDate as any);
    const cleanTag = selectedChallenge.tag.toLowerCase();

    return proposals.filter((p) => {
      // 1. Tag comparison
      const hasTag = p.tags?.some((t) => t.toLowerCase() === cleanTag);
      if (!hasTag) return false;

      // 2. Category restriction check
      if (selectedChallenge.category !== "All" && p.category !== selectedChallenge.category) {
        return false;
      }

      // 3. Submitted during challenge window check
      const createdAtD = p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt as any);
      return createdAtD >= startD && createdAtD <= endD;
    });
  }, [selectedChallenge, proposals]);

  // Sorted leader ranking for this challenge based on netVotes
  const challengeLeaderboard = useMemo(() => {
    return [...challengeProposals].sort((a, b) => (b.netVotes || 0) - (a.netVotes || 0));
  }, [challengeProposals]);

  // Resolving winner details
  const winnerProposal = useMemo(() => {
    if (!selectedChallenge || !selectedChallenge.winnerProposalId) return null;
    return proposals.find((p) => p.id === selectedChallenge.winnerProposalId) || null;
  }, [selectedChallenge, proposals]);

  // Challenge live countdown hook state
  const Countdown = ({ endDate }: { endDate: any }) => {
    const [text, setText] = useState("");

    useEffect(() => {
      const updateText = () => {
        if (!endDate) {
          setText("No due date");
          return;
        }
        const expDate = endDate.toDate ? endDate.toDate() : new Date(endDate);
        const now = new Date();
        const diffMs = expDate.getTime() - now.getTime();
        if (diffMs <= 0) {
          setText("Voting Ended");
          return;
        }
        
        const totalSecs = Math.floor(diffMs / 1000);
        const totalMins = Math.floor(totalSecs / 60);
        const totalHours = Math.floor(totalMins / 60);
        const days = Math.floor(totalHours / 24);
        
        const rHours = totalHours % 24;
        const rMins = totalMins % 60;
        const rSecs = totalSecs % 60;

        if (days > 0) {
          setText(`${days}d ${rHours}h ${rMins}m remaining`);
        } else if (rHours > 0) {
          setText(`${rHours}h ${rMins}m ${rSecs}s remaining`);
        } else {
          setText(`${rMins}m ${rSecs}s remaining`);
        }
      };

      updateText();
      const interval = setInterval(updateText, 1000);
      return () => clearInterval(interval);
    }, [endDate]);

    return (
      <span className="font-mono text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1 rounded-lg flex items-center gap-1.5 shadow-3xs uppercase tracking-wide">
        <Clock className="w-3.5 h-3.5 animate-pulse text-amber-500" />
        {text}
      </span>
    );
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 p-4 sm:p-0">
      
      {/* 1. Header Back or Panel Overview */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2.5">
            <Trophy className="w-7 h-7 text-yellow-500 fill-yellow-105" />
            Community Challenges
          </h2>
          <p className="text-xs font-mono text-slate-550 mt-1">
            Moderator-led competitive cycles focusing community designs on core milestones
          </p>
        </div>

        {selectedChallenge && (
          <button
            onClick={() => setSelectedChallengeId(null)}
            className="inline-flex items-center gap-2 text-xs font-black text-slate-600 hover:text-indigo-600 cursor-pointer bg-white border border-slate-200 shadow-3xs py-2.5 px-4 rounded-xl hover:border-indigo-200 transition-all uppercase tracking-wider font-mono self-start sm:self-auto"
          >
            <ArrowLeft className="w-4 h-4 text-indigo-505" />
            Back to Challenges List
          </button>
        )}

        {isAdmin && !selectedChallenge && (
          <button
            id="create-challenge-btn"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white text-xs font-bold py-3 px-5 rounded-2xl shadow-md cursor-pointer tracking-wider transition-all transform hover:scale-102"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            NEW CHALLENGE
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-24">
          <Loader2 className="w-10 h-10 animate-spin text-indigo-600" />
        </div>
      ) : selectedChallenge ? (
        /* CHALLENGE DEDICATED DETAIL PAGE VIEW */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Column Detail Sidebar */}
          <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-28">
            <section className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase font-bold tracking-widest font-mono text-slate-400">
                  Challenge Overview
                </span>
                <h3 className="text-xl font-extrabold text-slate-800 tracking-tight leading-snug">
                  {selectedChallenge.title}
                </h3>
              </div>

              <div className="text-xs text-slate-600 leading-relaxed space-y-2 font-sans whitespace-pre-line">
                {selectedChallenge.description}
              </div>

              {/* Challenge Constraint Cards */}
              <div className="grid grid-cols-1 gap-2 pt-2">
                <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-2xl">
                  <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                    <Tag className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-[9.5px] font-mono text-slate-400 font-bold uppercase">Required Tag</p>
                    <p className="text-xs font-bold font-mono text-slate-800">#{selectedChallenge.tag}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-2xl">
                  <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                    <Shield className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-[9.5px] font-mono text-slate-400 font-bold uppercase">Required Category</p>
                    <p className="text-xs font-bold text-slate-850">
                      {selectedChallenge.category === "All" ? "Any (🌐)" : selectedChallenge.category}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-2xl">
                  <div className="p-2 bg-yellow-50 text-yellow-600 rounded-xl">
                    <Award className="w-4 h-4 fill-yellow-50" />
                  </div>
                  <div>
                    <p className="text-[9.5px] font-mono text-slate-400 font-bold uppercase">Prize Offer</p>
                    <p className="text-xs font-bold text-amber-800">{selectedChallenge.prizeDescription}</p>
                  </div>
                </div>
              </div>

              {/* Countdown or Concluded status */}
              <div className="pt-2">
                {(() => {
                  const endD = selectedChallenge.endDate?.toDate 
                    ? selectedChallenge.endDate.toDate() 
                    : new Date(selectedChallenge.endDate as any);
                  return endD > new Date();
                })() ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-[10px] font-mono font-bold text-slate-450 uppercase">Active Countdown</p>
                    <Countdown endDate={selectedChallenge.endDate} />
                    
                    {user && (
                      <button
                        onClick={() => onEnterChallengeWithTag(selectedChallenge.tag, selectedChallenge.category)}
                        className="w-full mt-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black py-3 px-5 rounded-2xl transition-all shadow-md cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <Sparkles className="w-4 h-4 text-yellow-300 fill-yellow-300" />
                        SUBMIT PROPOSAL ENTRY
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="p-3.5 bg-zinc-100 border border-zinc-200 text-zinc-700 rounded-2xl text-xs font-bold text-center uppercase tracking-wider font-mono">
                      🔒 CHALLENGE CONCLUDED
                    </div>

                    {/* Winner Section */}
                    {winnerProposal ? (
                      <div className="bg-yellow-500/10 border-2 border-yellow-400 rounded-3xl p-5 text-center space-y-3 relative overflow-hidden">
                        <div className="absolute top-2 right-2 p-1 text-yellow-500">
                          <Trophy className="w-12 h-12 opacity-10" />
                        </div>
                        <div className="inline-flex p-3 bg-yellow-400 text-white rounded-2xl shadow-md mx-auto">
                          <Trophy className="w-6 h-6 fill-white" />
                        </div>
                        <div>
                          <h4 className="text-xs font-mono font-extrabold text-amber-800 uppercase tracking-wider">
                            Championship Champion
                          </h4>
                          <p className="text-base font-extrabold text-slate-800 leading-snug mt-1">
                            {winnerProposal.title}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-1 font-medium">
                            Designed by: <strong className="text-indigo-600 font-bold">{winnerProposal.authorName}</strong>
                          </p>
                        </div>
                        <div className="text-[11px] bg-yellow-400/20 text-yellow-905 px-3 py-1 rounded-xl inline-block font-bold">
                          🎖️ Prize: {selectedChallenge.prizeDescription}
                        </div>
                      </div>
                    ) : (
                      isAdmin && challengeProposals.length > 0 && (
                        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                          <h4 className="text-xs font-mono font-bold text-slate-500 uppercase">
                            👑 Select Challenge Winner
                          </h4>
                          <p className="text-[10px] text-slate-400 leading-relaxed font-sans">
                            As a moderator, declare the winner. This awards a permanent badge and assigns status.
                          </p>
                          <div className="relative">
                            <select
                              id="winner-selection"
                              onChange={async (e) => {
                                const val = e.target.value;
                                if (!val) return;
                                if (window.confirm("Are you sure you want to declare this proposal as the challenge winner? This awards the custom badge and permanently marks the challenge as settled.")) {
                                  try {
                                    // 1. Update winnerProposalId in Challenge doc
                                    await updateDoc(doc(db, "challenges", selectedChallenge.id), {
                                      winnerProposalId: val
                                    });

                                    // 2. Fetch the authorId of this proposal to award the reputation/badge
                                    const winnerPropObj = proposals.find(p => p.id === val);
                                    if (winnerPropObj) {
                                      const { createInAppNotification } = await import("../utils/notifications");
                                      const { doc: fsDoc, updateDoc: fsUpdateDoc, getDoc } = await import("firebase/firestore");
                                      
                                      // Award reputation if eligible (+25 reputation) and Challenge Winner Badge
                                      const userRef = fsDoc(db, "users", winnerPropObj.authorId);
                                      const userSnap = await getDoc(userRef);
                                      if (userSnap.exists()) {
                                        const userData = userSnap.data();
                                        const currentBadges = userData.badges || [];
                                        const newBadges = [...currentBadges];
                                        const badgeText = `Winner: ${selectedChallenge.title}`;
                                        if (!newBadges.includes("🏆 Challenge Champion") && !newBadges.includes(badgeText)) {
                                          newBadges.push("🏆 Challenge Champion");
                                          newBadges.push(badgeText);
                                        }

                                        await fsUpdateDoc(userRef, {
                                          reputation: (userData.reputation || 0) + 25,
                                          badges: newBadges
                                        });
                                      }

                                      // Send Notification
                                      await createInAppNotification(
                                        winnerPropObj.authorId,
                                        "🎯 Challenge Winner Declared!",
                                        `Your proposal "${winnerPropObj.title}" was elected the official champion of challenge "${selectedChallenge.title}". +25 Reputation awarded!`,
                                        "success",
                                        val
                                      );
                                    }
                                  } catch (err) {
                                    console.error("Failed settling winner:", err);
                                  }
                                }
                              }}
                              className="w-full text-xs font-bold bg-white border border-slate-200 rounded-xl p-2.5 pr-8 cursor-pointer appearance-none text-slate-700"
                            >
                              <option value="">-- Choose Winner --</option>
                              {challengeLeaderboard.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.title} (+{p.netVotes} votes) by {p.authorName}
                                </option>
                              ))}
                            </select>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-[10px]">
                              ▼
                            </div>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Right Column Feed and Leaderboard Tabs */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            
            {/* Split feed vs leaders header panel */}
            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex gap-2">
                  <div className="p-1.5 bg-indigo-50 text-indigo-700 rounded-lg">
                    <Vote className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">
                      Challenge Activities
                    </h3>
                    <p className="text-[10px] text-slate-400 font-mono tracking-wide">
                      Review, vote, and tracks submissions for this loop cycle
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <p className="text-[10px] text-slate-400 font-mono font-bold uppercase">Proposals Count</p>
                  <p className="text-lg font-black text-slate-800">{challengeProposals.length}</p>
                </div>
              </div>

              {challengeProposals.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
                  
                  {/* Entries feed (col-8) */}
                  <div className="md:col-span-8 space-y-4">
                    <h4 className="text-xs font-mono font-bold text-slate-450 uppercase flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                      Submissions Stream
                    </h4>
                    
                    <div className="space-y-4">
                      {challengeProposals.map((proposal) => (
                        <ProposalCard
                          key={proposal.id}
                          proposal={proposal}
                          user={user}
                          currentUserVote={null} // Controlled locally in parent or let card fetch
                          onViewProfile={onViewProfile}
                          challengeEntryTitle={selectedChallenge.title}
                          challengeWinnerTitle={selectedChallenge.winnerProposalId === proposal.id ? selectedChallenge.title : undefined}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Leaders board (col-4) */}
                  <div className="md:col-span-4 space-y-4 bg-slate-50 border border-slate-150 rounded-2xl p-4">
                    <h4 className="text-xs font-mono font-bold text-slate-550 uppercase flex items-center gap-1.5">
                      <Trophy className="w-3.5 h-3.5 text-yellow-500 fill-yellow-50" />
                      Challengers List
                    </h4>

                    <div className="space-y-2.5">
                      {challengeLeaderboard.map((p, index) => {
                        const isLeaderWinner = selectedChallenge.winnerProposalId === p.id;
                        return (
                          <div 
                            key={p.id}
                            className={`flex items-center justify-between p-3 rounded-xl border ${
                              isLeaderWinner 
                                ? "bg-yellow-50 border-yellow-300 shadow-3xs" 
                                : "bg-white border-slate-100 shadow-4xs"
                            }`}
                          >
                            <div className="flex items-center gap-2 max-w-[70%]">
                              <span className={`text-[10px] font-mono font-black ${
                                index === 0 ? "text-yellow-600" : "text-slate-400"
                              }`}>
                                #{index + 1}
                              </span>
                              <div className="truncate">
                                <p className="text-xs font-black text-slate-800 truncate" title={p.title}>
                                  {p.title}
                                </p>
                                <p className="text-[9.5px] text-slate-500 truncate mt-0.5">
                                  by {p.authorName}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                              {isLeaderWinner && (
                                <span className="text-[13.5px]" title="Champion">🏆</span>
                              )}
                              <span className="text-xs font-mono font-extrabold text-slate-700 bg-slate-100 rounded-md px-2 py-0.5">
                                +{p.netVotes}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                </div>
              ) : (
                <div className="bg-slate-50 border border-slate-150 rounded-2xl p-12 text-center flex flex-col items-center justify-center space-y-3">
                  <div className="p-3 bg-white text-slate-400 rounded-xl border border-slate-100">
                    <Trophy className="w-6 h-6 text-slate-400" />
                  </div>
                  <h4 className="text-xs font-mono font-black text-slate-700 uppercase">
                    No entries submitted yet
                  </h4>
                  <p className="text-xs text-slate-500 max-w-sm font-sans">
                    Be the very first community member to write an idea or proposal for #{selectedChallenge.tag}!
                  </p>
                  {user && (
                    <button
                      onClick={() => onEnterChallengeWithTag(selectedChallenge.tag, selectedChallenge.category)}
                      className="mt-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs py-2 px-4 rounded-xl transition-all cursor-pointer border border-indigo-150"
                    >
                      + Publish First Entry
                    </button>
                  )}
                </div>
              )}
            </div>

          </div>

        </div>
      ) : (
        /* GENERAL LIST VIEW (Active tab vs Past archive) */
        <div className="space-y-6">
          <div className="flex border-b border-slate-200">
            <button
              onClick={() => setActiveTab("active")}
              className={`py-3 px-6 text-xs uppercase cursor-pointer py-3.5 tracking-wider font-mono font-black border-b-2 transition-all flex items-center gap-1.5 ${
                activeTab === "active" 
                ? "border-indigo-600 text-indigo-700" 
                : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              <Sparkles className="w-4 h-4 text-indigo-500 animate-pulse" />
              Active Challenges ({activeList.length})
            </button>
            <button
              onClick={() => setActiveTab("past")}
              className={`py-3 px-6 text-xs uppercase cursor-pointer py-3.5 tracking-wider font-mono font-black border-b-2 transition-all flex items-center gap-1.5 ${
                activeTab === "past" 
                ? "border-indigo-600 text-indigo-700" 
                : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              <Clock className="w-4 h-4 text-slate-400" />
              Past Challenges History ({pastList.length})
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {(activeTab === "active" ? activeList : pastList).length > 0 ? (
              (activeTab === "active" ? activeList : pastList).map((ch) => {
                const enteredCount = proposals.filter((p) => {
                  const hasTag = p.tags?.some((t) => t.toLowerCase() === ch.tag.toLowerCase());
                  const hasCat = ch.category === "All" || p.category === ch.category;
                  return hasTag && hasCat;
                }).length;

                return (
                  <div
                    key={ch.id}
                    onClick={() => setSelectedChallengeId(ch.id)}
                    className="group bg-white border border-slate-200 hover:border-indigo-300 rounded-3xl p-6 transition-all shadow-sm hover:shadow-md cursor-pointer relative overflow-hidden flex flex-col justify-between min-h-[190px]"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-3">
                        <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-150 text-[10px] font-mono font-bold uppercase rounded-md tracking-wider">
                          🏷️ #{ch.tag}
                        </span>

                        <span className="text-[10px] font-mono font-black text-slate-400 uppercase">
                          {enteredCount} {enteredCount === 1 ? "entry" : "entries"}
                        </span>
                      </div>

                      <h3 className="text-base font-extrabold text-slate-800 leading-snug group-hover:text-indigo-600 transition-colors">
                        {ch.title}
                      </h3>

                      <p className="text-xs text-slate-500 font-sans mt-2 line-clamp-2">
                        {ch.description}
                      </p>
                    </div>

                    <div className="mt-5 pt-3.5 border-t border-slate-50 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 text-[10px] text-slate-450 font-mono font-bold uppercase">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        Ends: {ch.endDate?.toDate ? ch.endDate.toDate().toLocaleDateString() : new Date(ch.endDate as any).toLocaleDateString()}
                      </div>

                      <span className="text-[10px] font-mono font-black uppercase text-indigo-600 inline-flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                        Explore Details
                        <ChevronRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="col-span-2 bg-white border border-slate-200 rounded-3xl p-16 text-center flex flex-col items-center justify-center space-y-4 shadow-sm">
                <div className="p-4 bg-slate-50 text-slate-450 rounded-2xl border border-slate-100">
                  <Trophy className="w-8 h-8 text-slate-400" />
                </div>
                <div>
                  <h4 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider">
                    {activeTab === "active" ? "No Active Challenges" : "No Past Challenges Archive"}
                  </h4>
                  <p className="text-xs text-slate-500 max-w-sm leading-relaxed mt-1.5 mx-auto">
                    {activeTab === "active"
                    ? "Check back later! Community administrators will configure new challenge loops for specific group tasks."
                    : "There are no ended challenges in the system history."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. Admin Create Challenge Sheet Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl w-full max-w-lg overflow-hidden border border-slate-200 shadow-2xl relative"
            >
              <div className="p-6 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-indigo-600" />
                  <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider">
                    Create Challenge (Admin Mode)
                  </h3>
                </div>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!user) return;
                  
                  const target = e.target as any;
                  const cTitle = target.elements.chTitle.value.trim();
                  const cDesc = target.elements.chDesc.value.trim();
                  const cCat = target.elements.chCategory.value;
                  const cTag = target.elements.chTag.value.trim().replace(/^#/g, "").toLowerCase();
                  const cPrize = target.elements.chPrize.value.trim();
                  const cEndDate = target.elements.chEndDate.value;

                  if (!cTitle || !cDesc || !cTag || !cEndDate) {
                    alert("Please fill out all required fields.");
                    return;
                  }

                  try {
                    const endTimestamp = Timestamp.fromDate(new Date(cEndDate));
                    const startTimestamp = Timestamp.now();

                    await addDoc(collection(db, "challenges"), {
                      title: cTitle,
                      description: cDesc,
                      category: cCat,
                      tag: cTag,
                      prizeDescription: cPrize || "Community Recognition",
                      startDate: startTimestamp,
                      endDate: endTimestamp,
                      creatorId: user.uid,
                      creatorName: user.displayName || "Moderator",
                      createdAt: serverTimestamp()
                    });

                    setShowCreateModal(false);
                  } catch (err) {
                    console.error("Failed creating challenge: ", err);
                    alert("Error saving challenge. Check credentials.");
                  }
                }}
                className="p-6 space-y-4"
              >
                <div>
                  <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase mb-1">
                    Challenge Title
                  </label>
                  <input
                    name="chTitle"
                    type="text"
                    required
                    placeholder="e.g., Green Campus Landscaping Initiative"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase mb-1">
                    Guideline Description
                  </label>
                  <textarea
                    name="chDesc"
                    required
                    rows={3}
                    placeholder="Describe specific bounds, timeline goals, and expectations for entries..."
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase mb-1">
                      Category Restriction
                    </label>
                    <select
                      name="chCategory"
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden"
                    >
                      <option value="All">All CategoriesAllowed</option>
                      <option value="Governance">Governance (⚖️)</option>
                      <option value="Technical">Technical (💻)</option>
                      <option value="Community">Community (🤝)</option>
                      <option value="Treasury">Treasury (💰)</option>
                      <option value="Events">Events (📅)</option>
                      <option value="Meta">Meta (🌀)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase mb-1">
                      Entering Hash-Tag
                    </label>
                    <input
                      name="chTag"
                      type="text"
                      required
                      placeholder="e.g., green-campus"
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase mb-1">
                      Winner Prize Description
                    </label>
                    <input
                      name="chPrize"
                      type="text"
                      placeholder="e.g., Community Recognition Trophy"
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase mb-1">
                      Concludes Date-Time
                    </label>
                    <input
                      name="chEndDate"
                      type="datetime-local"
                      required
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden"
                    />
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="w-1/2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-3 rounded-2xl text-xs transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="w-1/2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-2xl text-xs shadow-md transition-colors cursor-pointer"
                  >
                    Publish Challenge
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}

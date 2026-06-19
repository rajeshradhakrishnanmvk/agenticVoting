import React, { useState, useEffect } from "react";
import { db } from "../firebase";
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp, 
  getDocs 
} from "firebase/firestore";
import { User, UserSession, Delegation } from "../types";
import { 
  X, 
  Award, 
  Flame, 
  Shield, 
  Users, 
  Undo2, 
  Check, 
  ArrowRightLeft, 
  Info, 
  Loader2, 
  Vote, 
  ChevronRight,
  TrendingUp,
  AlertTriangle 
} from "lucide-react";
import { createInAppNotification } from "../utils/notifications";

interface UserProfileModalProps {
  userId: string;
  onClose: () => void;
  currentUser: UserSession | null;
  currentUserProfile: User | null;
}

const CATEGORIES = ["Governance", "Technical", "Community", "Treasury", "Events", "Meta"] as const;

export default function UserProfileModal({ 
  userId, 
  onClose, 
  currentUser, 
  currentUserProfile 
}: UserProfileModalProps) {
  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Real-time delegations state
  const [delegationsFromUser, setDelegationsFromUser] = useState<Delegation[]>([]);
  const [delegationsToUser, setDelegationsToUser] = useState<Delegation[]>([]);
  const [allUsersList, setAllUsersList] = useState<User[]>([]);
  
  const [selectedCategory, setSelectedCategory] = useState<"All" | typeof CATEGORIES[number]>("All");
  const [processingAction, setProcessingAction] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Subscribe to profile user
  useEffect(() => {
    setLoading(true);
    setProfile(null);
    const userRef = doc(db, "users", userId);
    const unsub = onSnapshot(
      userRef,
      (docSnap) => {
        if (docSnap.exists()) {
          setProfile({ id: docSnap.id, ...docSnap.data() } as any as User);
        } else {
          setErrorMessage("User profile not found.");
        }
        setLoading(false);
      },
      (err) => {
        console.error("Failed fetching profile:", err);
        setErrorMessage("Error loading profile details.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [userId]);

  // Subscribe to ALL delegations
  useEffect(() => {
    const q = query(collection(db, "delegations"));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: Delegation[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as Delegation);
        });
        
        // Filter delegations from this profile user to others
        setDelegationsFromUser(list.filter((d) => d.delegatorId === userId));
        
        // Filter delegations to this profile user from others
        setDelegationsToUser(list.filter((d) => d.delegateId === userId));
      },
      (err) => {
        console.error("Error monitoring delegations:", err);
      }
    );

    return () => unsub();
  }, [userId]);

  // Fetch all users to look up reputations for Delegated Power
  useEffect(() => {
    const q = query(collection(db, "users"));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: User[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as any as User);
        });
        setAllUsersList(list);
      },
      (err) => {
        console.error("Error loading user directory:", err);
      }
    );

    return () => unsub();
  }, []);

  // Compute Delegated Power = user reputation + sum of delegators' reputations
  const computeDelegatedPower = () => {
    if (!profile) return 0;
    const baseRep = profile.reputation || 0;
    
    // Find UIDs of users who delegated to this profile
    const delegators = delegationsToUser.map((d) => d.delegatorId);
    
    // Sum their reputations
    const delegatorsRepTotal = allUsersList
      .filter((u) => delegators.includes(u.userId))
      .reduce((acc, u) => acc + (u.reputation || 0), 0);
      
    return baseRep + delegatorsRepTotal;
  };

  const delegatedPower = computeDelegatedPower();

  // Find delegators with reputations for display
  const delegatorDetails = delegationsToUser.map((d) => {
    const foundUser = allUsersList.find((u) => u.userId === d.delegatorId);
    return {
      delegationId: d.id,
      delegatorId: d.delegatorId,
      name: d.delegatorName || foundUser?.displayName || "Anonymous Delegator",
      reputation: foundUser?.reputation || 0,
      category: d.category
    };
  });

  // Unique list of delegators (to prevent double counting if multiple category delegations are active)
  const uniqueDelegatorSummary = delegatorDetails.reduce((acc: any[], current) => {
    const existing = acc.find(item => item.delegatorId === current.delegatorId);
    if (existing) {
      existing.categories = [...existing.categories, current.category];
    } else {
      acc.push({
        delegationId: current.delegationId,
        delegatorId: current.delegatorId,
        name: current.name,
        reputation: current.reputation,
        categories: [current.category]
      });
    }
    return acc;
  }, []);

  // Check existing delegations by current logged in user to this profile
  const getActiveDelegationForCategory = (cat: string) => {
    if (!currentUser) return null;
    return delegationsToUser.find(
      (d) => d.delegatorId === currentUser.uid && (d.category === cat || d.category === "All")
    );
  };

  // Create a delegation
  const handleDelegateVote = async () => {
    if (!currentUser || !currentUserProfile || !profile) return;
    setProcessingAction(true);
    setErrorMessage(null);

    try {
      // Rule checks: Cannot delegate to self
      if (currentUser.uid === profile.userId) {
        throw new Error("You cannot delegate your votes to yourself!");
      }

      // Check current active delegations of the logged-in user
      const q = query(
        collection(db, "delegations"),
        where("delegatorId", "==", currentUser.uid)
      );
      const snap = await getDocs(q);
      const userExistingDelegations: Delegation[] = [];
      snap.forEach((d) => {
        userExistingDelegations.push({ id: d.id, ...d.data() } as Delegation);
      });

      // Clear any conflicting delegation:
      // If we are choosing "All", delete ALL existing delegations by this user.
      // If we are choosing a specific category, delete any existing delegation for "All" or for that specific category.
      const toDelete = userExistingDelegations.filter((d) => {
        if (selectedCategory === "All") return true;
        return d.category === "All" || d.category === selectedCategory;
      });

      for (const delDoc of toDelete) {
        await deleteDoc(doc(db, "delegations", delDoc.id));
      }

      // Save new delegation
      const cleanDelegatorName = currentUserProfile.displayName || currentUser.displayName || "Unknown Contributor";
      const cleanDelegateName = profile.displayName || "Anonymous Delegate";

      const newDelegationData = {
        delegatorId: currentUser.uid,
        delegatorName: cleanDelegatorName,
        delegateId: profile.userId,
        delegateName: cleanDelegateName,
        category: selectedCategory,
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, "delegations"), newDelegationData);

      // Trigger notification for delegate
      await createInAppNotification(
        profile.userId,
        "delegation_received",
        null,
        `${cleanDelegatorName} delegated their "${selectedCategory}" votes to you. Your Delegated Power score has increased!`,
        "Vote Delegation Received"
      );

    } catch (err: any) {
      console.error("Error setting up delegation:", err);
      setErrorMessage(err.message || "Failed to create delegation. Please try again.");
    } finally {
      setProcessingAction(false);
    }
  };

  // Revoke delegation
  const handleRevokeDelegation = async (delegationId: string, delegateId: string, categoryName: string) => {
    if (!currentUser || !currentUserProfile) return;
    setProcessingAction(true);
    setErrorMessage(null);

    try {
      await deleteDoc(doc(db, "delegations", delegationId));

      const cleanDelegatorName = currentUserProfile.displayName || currentUser.displayName || "Unknown Contributor";
      
      // Trigger notification for delegatee
      await createInAppNotification(
        delegateId,
        "delegation_revoked",
        null,
        `${cleanDelegatorName} revoked their "${categoryName}" vote delegation.`,
        "Delegation Revoked"
      );
    } catch (err: any) {
      console.error("Error revoking delegation:", err);
      setErrorMessage(err.message || "Failed to revoke delegation.");
    } finally {
      setProcessingAction(false);
    }
  };

  const getRankEmoji = (rankScore: number) => {
    if (rankScore >= 100) return "👑";
    if (rankScore >= 50) return "🐳";
    if (rankScore >= 20) return "🔥";
    return "🌱";
  };

  const getBadgeEmoji = (badgeName: string) => {
    const map: Record<string, string> = {
      "Founding Member": "🌱",
      "Proposer": "💡",
      "Consensus Builder": "🤝",
      "Thought Leader": "👑",
      "Whale Watcher": "🐳",
      "Devoted": "🔥"
    };
    return map[badgeName] || "🏅";
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full max-h-[92vh] flex flex-col overflow-hidden animate-slide-up">
        
        {/* Header Block */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-850 uppercase tracking-wider">Member Demographics</h3>
              <p className="text-[10px] text-slate-400 font-mono">Liquid Democracy Participant Credentials</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="Close Profile"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Scroll Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
              <p className="text-xs text-slate-405 font-mono">Loading dynamic profile credentials...</p>
            </div>
          ) : errorMessage && !profile ? (
            <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-xl p-4 text-center">
              <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
              <p className="text-xs font-bold">{errorMessage}</p>
            </div>
          ) : profile ? (
            <>
              {/* Profile Card Intro */}
              <div className="flex flex-col sm:flex-row items-center gap-5 bg-gradient-to-br from-indigo-50/40 via-transparent to-transparent p-5 rounded-3xl border border-slate-150/60 relative">
                <div className="relative">
                  <div className="w-20 h-20 rounded-full bg-slate-100 border-2 border-indigo-500 flex items-center justify-center text-indigo-600 font-bold text-3xl shadow-sm">
                    {profile.photoURL ? (
                      <img src={profile.photoURL} alt={profile.displayName} referrerPolicy="no-referrer" className="w-full h-full rounded-full object-cover" />
                    ) : (
                      (profile.displayName || "U").charAt(0).toUpperCase()
                    )}
                  </div>
                  <span className="absolute bottom-0 right-0 p-1.5 bg-white text-slate-800 rounded-full border border-slate-200 text-sm shadow-xs cursor-help" title={`Rank: ${getRankEmoji(profile.reputation || 0)}`}>
                    {getRankEmoji(profile.reputation || 0)}
                  </span>
                </div>

                <div className="flex-1 text-center sm:text-left space-y-1.5">
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                    <h4 className="text-lg font-sans font-extrabold text-slate-850">
                      {profile.displayName || "Anonymous Contributor"}
                    </h4>
                    {currentUser && currentUser.uid === profile.userId && (
                      <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 font-mono text-[9px] rounded-md font-bold uppercase tracking-wider">
                        You
                      </span>
                    )}
                  </div>
                  
                  <p className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">
                    Member UID: <span className="text-slate-500 select-all font-bold">{profile.userId.slice(0, 12)}...</span>
                  </p>

                  <div className="flex flex-wrap justify-center sm:justify-start gap-1">
                    {profile.badges && profile.badges.length > 0 ? (
                      profile.badges.map((b) => (
                        <span 
                          key={b}
                          className="px-2 py-0.5 bg-slate-50 border border-slate-200 text-slate-600 rounded-md text-[10px] font-sans font-bold flex items-center gap-1 cursor-help"
                          title={b}
                        >
                          <span>{getBadgeEmoji(b)}</span>
                          {b}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-400 italic">No badges earned yet</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Stats Module: Reputation & Voting Power */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Real Reputation */}
                <div className="bg-slate-50 border border-slate-200/60 p-4.5 rounded-2xl flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-widest block">Reputation Score</span>
                    <span className="text-2xl font-black text-slate-800">{profile.reputation || 0} <span className="text-xs font-medium text-slate-450">pts</span></span>
                  </div>
                  <div className="p-3 bg-indigo-50 border border-indigo-100/50 text-indigo-600 rounded-xl">
                    <Award className="w-6 h-6" />
                  </div>
                </div>

                {/* Delegated Power */}
                <div className="bg-gradient-to-br from-indigo-50/60 to-purple-50/40 border border-indigo-100 p-4.5 rounded-2xl flex items-center justify-between relative overflow-hidden">
                  <div className="space-y-1 relative z-10">
                    <span className="text-[10px] font-bold text-indigo-550 font-mono uppercase tracking-widest block flex items-center gap-1">
                      Delegated Power
                      <span className="cursor-help text-slate-400" title="Your Reputation + sum of all delegators' reputation values combined in real-time.">
                        <Info className="w-3.5 h-3.5" />
                      </span>
                    </span>
                    <span className="text-2xl font-black text-indigo-700">{delegatedPower} <span className="text-xs font-semibold text-indigo-500">voting weight</span></span>
                  </div>
                  <div className="p-3 bg-white border border-indigo-150 text-indigo-600 rounded-xl relative z-10">
                    <TrendingUp className="w-6 h-6 animate-pulse" />
                  </div>
                </div>
              </div>

              {/* Error warning inside operations */}
              {errorMessage && (
                <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-xl p-3 flex gap-2 items-start text-xs leading-relaxed">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* DELEGATION ACTION CONTROLS */}
              {currentUser && currentUser.uid !== profile.userId && (
                <div className="border border-indigo-100 bg-indigo-50/15 rounded-3xl p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Vote className="w-5 h-5 text-indigo-600" />
                    <div>
                      <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Configure Vote Delegation</h4>
                      <p className="text-[10px] text-slate-400 font-mono">Sub-category delegation cascades or total proxy representation</p>
                    </div>
                  </div>

                  {/* Active delegations info */}
                  {delegationsToUser.some(d => d.delegatorId === currentUser.uid) ? (
                    <div className="bg-indigo-50/50 border border-indigo-100 rounded-2xl p-4 text-xs text-indigo-800 flex flex-col gap-2.5">
                      <div className="flex gap-1.5 items-start">
                        <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold">Active Delegation Active</p>
                          <p className="text-indigo-650 text-[11px] mt-0.5">
                            You've delegated your votes to {profile.displayName || "this member"}:
                          </p>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {delegationsToUser.filter(d => d.delegatorId === currentUser.uid).map(d => (
                              <span key={d.id} className="px-2 py-0.5 bg-indigo-100 border border-indigo-150 text-indigo-700 rounded-md font-mono text-[10px] font-bold">
                                Category: {d.category}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Explicit buttons to revoke */}
                      <div className="flex flex-col gap-1.5 pt-2 border-t border-indigo-100/50">
                        {delegationsToUser.filter(d => d.delegatorId === currentUser.uid).map(d => (
                          <div key={d.id} className="flex items-center justify-between bg-white rounded-xl p-2 px-3 border border-indigo-100/60 shadow-xs">
                            <span className="font-mono text-[10.5px] font-bold text-slate-700">Category: {d.category}</span>
                            <button
                              disabled={processingAction}
                              onClick={() => handleRevokeDelegation(d.id, d.delegateId, d.category)}
                              className="text-[10px] font-extrabold text-rose-600 hover:text-rose-800 transition-colors cursor-pointer flex items-center gap-1 hover:underline"
                            >
                              <Undo2 className="w-3.5 h-3.5" /> Revoke Delegation
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-50 border border-slate-200/50 rounded-2xl p-4 text-xs text-slate-500 italic text-center">
                      No active delegation set to this contributor yet. Configure below to trust them.
                    </div>
                  )}

                  {/* Form to Delegate */}
                  <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-2">
                    <div className="w-full sm:flex-1">
                      <select
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value as any)}
                        disabled={processingAction}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-3 text-xs text-slate-800 font-sans focus:outline-hidden focus:border-indigo-500 transition-all shadow-xs"
                      >
                        <option value="All">All Categories (Standard Cascade)</option>
                        {CATEGORIES.map(cat => (
                          <option key={cat} value={cat}>{cat} Specialist Category</option>
                        ))}
                      </select>
                    </div>

                    <button
                      onClick={handleDelegateVote}
                      disabled={processingAction}
                      className="w-full sm:w-auto shrink-0 bg-slate-900 border border-slate-900 hover:bg-indigo-600 hover:border-indigo-600 text-white text-[11px] font-black uppercase tracking-wider px-5 py-3 rounded-xl transition-all shadow-sm hover:shadow active:scale-98 cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      {processingAction ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          Delegate Votes
                          <ChevronRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono text-center">
                    Delegation can be overridden at any individual proposal ballot by casting an override vote directly.
                  </p>
                </div>
              )}

              {/* LIST OF DELEGATORS ACTIVE UNDER THIS USER */}
              <div className="space-y-3">
                <div className="flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-slate-500" />
                  <span className="text-[10px] font-bold font-mono text-slate-450 uppercase tracking-wider">
                    Delegation Network ({uniqueDelegatorSummary.length} Contributors)
                  </span>
                </div>

                {uniqueDelegatorSummary.length === 0 ? (
                  <div className="text-center py-6 bg-slate-50 rounded-2xl border border-slate-100/70 text-slate-400 text-xs italic">
                    No active delegators are currently projecting voting power onto this member.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[160px] overflow-y-auto">
                    {uniqueDelegatorSummary.map((del) => (
                      <div 
                        key={del.delegatorId}
                        className="flex items-center justify-between p-3 border border-slate-100 rounded-xl bg-slate-50/50 hover:bg-slate-50 transition-all"
                      >
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-slate-800">{del.name}</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {del.categories.map((cat: string) => (
                              <span key={cat} className="px-1.5 py-0.2 bg-indigo-50 border border-indigo-100 text-indigo-700 text-[8.5px] font-mono font-extrabold rounded-sm">
                                {cat}
                              </span>
                            ))}
                          </div>
                        </div>
                        <span className="text-[10.5px] font-mono font-black text-slate-500 bg-slate-100 p-1.5 px-2 rounded-lg">
                          +{del.reputation} rep score
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ACTIVE OUTWARD GOING DELEGATIONS BY THIS PROFILE USER */}
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-1.5">
                  <ArrowRightLeft className="w-4 h-4 text-slate-500" />
                  <span className="text-[10px] font-bold font-mono text-slate-450 uppercase tracking-wider">
                    Active Outgoing Delegations
                  </span>
                </div>

                {delegationsFromUser.length === 0 ? (
                  <div className="text-center py-5 bg-slate-50 rounded-2xl border border-slate-100/70 text-slate-400 text-xs italic">
                    This user directly represents their own ballot with no active outsourced variables.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[160px] overflow-y-auto">
                    {delegationsFromUser.map((del) => (
                      <div 
                        key={del.id}
                        className="flex items-center justify-between p-3 border border-slate-150/60 rounded-xl bg-white hover:bg-slate-50 transition-all"
                      >
                        <div className="flex flex-col gap-0.5">
                          <p className="text-xs font-black text-slate-800 flex items-center gap-1">
                            Delegated <span className="font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-1 rounded-sm text-[9.5px]">{del.category}</span> votes
                          </p>
                          <p className="text-[10.5px] text-slate-500">
                            to: <span className="font-semibold text-slate-700">{del.delegateName}</span>
                          </p>
                        </div>

                        {/* If current user is profile, they can revoke this */}
                        {currentUser && currentUser.uid === userId && (
                          <button
                            disabled={processingAction}
                            onClick={() => handleRevokeDelegation(del.id, del.delegateId, del.category)}
                            className="text-[10px] font-bold text-rose-600 border border-rose-100 bg-rose-50 hover:bg-rose-100 p-1.5 px-2.5 rounded-lg transition-all cursor-pointer"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-xs text-slate-400">
              No profile found.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 text-center text-[10px] font-mono text-slate-400 bg-slate-50/50 shrink-0 select-none">
          goBodhi Liquid Governance Network Protocol • Autonomous delegation routing
        </div>
      </div>
    </div>
  );
}

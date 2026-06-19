import React, { useState, useEffect } from "react";
import { runTransaction, doc, serverTimestamp, deleteDoc, query, collection, where, onSnapshot } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { Proposal, UserSession } from "../types";
import { 
  ChevronUp, 
  ChevronDown, 
  Edit3, 
  Trash2, 
  X, 
  AlertCircle, 
  MessageSquare, 
  Flame,
  Share2,
  Twitter,
  Send,
  Code,
  Copy,
  Check,
  ExternalLink,
  Users,
  Lock,
  Timer,
  User as UserIcon,
  Sparkles as SparklesIcon
} from "lucide-react";
import { motion } from "motion/react";

interface ProposalCardProps {
  key?: string;
  proposal: Proposal;
  user: UserSession | null;
  currentUserVote: "up" | "down" | null;
  commentCount?: number;
  deliberationScore?: number;
  onSelect?: () => void;
  isDetail?: boolean;
  isEmbed?: boolean;
  onViewProfile?: (userId: string) => void;
  challengeEntryTitle?: string;
  challengeWinnerTitle?: string;
}

export default function ProposalCard({ 
  proposal, 
  user, 
  currentUserVote,
  commentCount = 0,
  deliberationScore = 0,
  onSelect,
  isDetail = false,
  isEmbed = false,
  onViewProfile,
  challengeEntryTitle,
  challengeWinnerTitle
}: ProposalCardProps) {
  const currentStatus = proposal.status || "active";

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(proposal.title);
  const [editDescription, setEditDescription] = useState(proposal.description);
  const [editCategory, setEditCategory] = useState<"Governance" | "Technical" | "Community" | "Treasury" | "Events" | "Meta">(proposal.category || "Governance");
  const [editTags, setEditTags] = useState<string[]>(proposal.tags || []);
  const [editTagInput, setEditTagInput] = useState("");
  
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [voteLoading, setVoteLoading] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sharing + Embed modal controls
  const [copied, setCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [showEmbedModal, setShowEmbedModal] = useState(false);

  // Turnout, voters and quorum calculation hooks
  const [totalUsers, setTotalUsers] = useState<number>(20);
  const [voters, setVoters] = useState<{ userId: string; voterName: string; voteType: "up" | "down"; updatedAt?: any }[]>([]);
  const [loadingVoters, setLoadingVoters] = useState(false);
  const [quorumConfig, setQuorumConfig] = useState<{ minVotes: number; memberPercent: number }>({ minVotes: 10, memberPercent: 5 });

  // Liquid Democracy: Get delegations and delegate votes
  const [userDelegations, setUserDelegations] = useState<any[]>([]);
  const [delegateVoteType, setDelegateVoteType] = useState<"up" | "down" | null>(null);
  const [allDelegations, setAllDelegations] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);

  // Listen to current user delegations
  useEffect(() => {
    if (!user) {
      setUserDelegations([]);
      return;
    }
    const q = query(
      collection(db, "delegations"),
      where("delegatorId", "==", user.uid)
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((d) => {
        list.push({ id: d.id, ...d.data() });
      });
      setUserDelegations(list);
    }, (err) => {
      console.error("Error loading user delegations:", err);
    });
    return () => unsub();
  }, [user]);

  // Find delegation covering this category
  const activeDelegation = React.useMemo(() => {
    return userDelegations.find(
      (d) => d.category === "All" || d.category === proposal.category
    );
  }, [userDelegations, proposal.category]);

  // Listen to delegate's vote in real time
  useEffect(() => {
    if (!user || !activeDelegation) {
      setDelegateVoteType(null);
      return;
    }
    const voteRef = doc(db, "proposals", proposal.id, "votes", activeDelegation.delegateId);
    const unsub = onSnapshot(voteRef, (docSnap) => {
      if (docSnap.exists()) {
        setDelegateVoteType(docSnap.data().voteType);
      } else {
        setDelegateVoteType(null);
      }
    }, (err) => {
      console.error("Failed fetching delegate vote:", err);
    });
    return () => unsub();
  }, [user, activeDelegation, proposal.id]);

  // Sync ALL delegations for liquid weights calculation in detail view
  useEffect(() => {
    if (!isDetail) return;
    const qAll = query(collection(db, "delegations"));
    const unsub = onSnapshot(qAll, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((d) => {
        list.push({ id: d.id, ...d.data() });
      });
      setAllDelegations(list);
    }, (err) => {
      console.error("Error loading all delegations for details weight calculation:", err);
    });
    return () => unsub();
  }, [isDetail]);

  // Sync all users to query reputations of participants
  useEffect(() => {
    if (!isDetail) return;
    const unsub = onSnapshot(collection(db, "users"), (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ userId: docSnap.id, ...docSnap.data() });
      });
      setAllUsers(list);
    });
    return () => unsub();
  }, [isDetail]);

  // Dynamic Liquid Power weight calculator per voter
  const getVoterLiquidPower = React.useCallback((voterId: string) => {
    const voterUser = allUsers.find(u => u.userId === voterId);
    const baseRep = voterUser ? (voterUser.reputation || 0) : 0;
    
    // Find allocations to this delegate
    const delegateAllocations = allDelegations.filter(d => 
      d.delegateId === voterId && 
      (d.category === "All" || d.category === proposal.category)
    );
    
    // Filter allocations where the delegator has NOT voted directly on this proposal
    const activeAllocations = delegateAllocations.filter(d => 
      !voters.some(v => v.userId === d.delegatorId)
    );
    
    // Sum delegators base reputations
    const delegatedRepSum = activeAllocations.reduce((sum, d) => {
      const delegatorUser = allUsers.find(u => u.userId === d.delegatorId);
      return sum + (delegatorUser ? (delegatorUser.reputation || 0) : 0);
    }, 0);
    
    return {
      totalPower: baseRep + delegatedRepSum,
      baseRep,
      delegatedRepSum,
      delegators: activeAllocations.map(d => ({
        id: d.delegatorId,
        name: d.delegatorName,
        reputation: allUsers.find(u => u.userId === d.delegatorId)?.reputation || 0
      }))
    };
  }, [allUsers, allDelegations, proposal.category, voters]);

  useEffect(() => {
    const fetchUsersCountAndConfig = async () => {
      try {
        const { collection, getDocs, doc, getDoc } = await import("firebase/firestore");
        
        // 1. Fetch total registered users count
        const usersSnap = await getDocs(collection(db, "users"));
        if (!usersSnap.empty) {
          setTotalUsers(Math.max(1, usersSnap.size));
        }

        // 2. Fetch community quorum configuration (with grace fallback)
        const configSnap = await getDoc(doc(db, "configs", "communityQuorum"));
        if (configSnap.exists()) {
          const data = configSnap.data();
          setQuorumConfig({
            minVotes: data.minVotes !== undefined ? Number(data.minVotes) : 10,
            memberPercent: data.memberPercent !== undefined ? Number(data.memberPercent) : 5
          });
        }
      } catch (err) {
        console.warn("Could not load dynamic community metrics, using safe defaults:", err);
      }
    };
    
    fetchUsersCountAndConfig();
  }, [proposal.id]);

  useEffect(() => {
    if (isDetail && currentStatus !== "draft") {
      const fetchVotersRoll = async () => {
        setLoadingVoters(true);
        try {
          const { collection, getDocs } = await import("firebase/firestore");
          const votesSnap = await getDocs(collection(db, "proposals", proposal.id, "votes"));
          const list = votesSnap.docs.map(docSnap => ({
            userId: docSnap.id,
            ...docSnap.data()
          })) as any[];
          setVoters(list);
        } catch (err) {
          console.error("Failed fetching voters dynamic subcollection:", err);
        } finally {
          setLoadingVoters(false);
        }
      };
      
      fetchVotersRoll();
    }
  }, [proposal.id, isDetail, currentStatus, proposal.upvotesCount, proposal.downvotesCount]);

  const totalVotes = (proposal.upvotesCount || 0) + (proposal.downvotesCount || 0);
  const quorumRequirement = Math.max(quorumConfig.minVotes, Math.ceil((quorumConfig.memberPercent / 100) * totalUsers));

  const getCountdownText = (expiresAt: any) => {
    if (!expiresAt) return "Concluding soon";
    try {
      const expDate = expiresAt.toDate ? expiresAt.toDate() : new Date(expiresAt);
      const now = new Date();
      const diffMs = expDate.getTime() - now.getTime();
      if (diffMs <= 0) return "Voting closed";
      
      const totalSecs = Math.floor(diffMs / 1000);
      const totalMins = Math.floor(totalSecs / 60);
      const totalHours = Math.floor(totalMins / 60);
      const days = Math.floor(totalHours / 24);
      
      const remainingHours = totalHours % 24;
      const remainingMins = totalMins % 60;
      
      if (days > 0) {
        return `${days}d ${remainingHours}h remaining`;
      }
      if (remainingHours > 0) {
        return `${remainingHours}h ${remainingMins}m remaining`;
      }
      return `${remainingMins}m remaining`;
    } catch (e) {
      return "Concluded";
    }
  };

  // Formats relative time (e.g. "Just now", "2 hours ago", "3 days ago")
  const getRelativeTime = (timestamp: any) => {
    if (!timestamp) return "Just now";
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffMins < 1) return "Just now";
      if (diffMins < 60) return `${diffMins} min ago`;
      if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? "hour" : "hours"} ago`;
      if (diffDays < 30) return `${diffDays} ${diffDays === 1 ? "day" : "days"} ago`;
      
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch (e) {
      return "Recently";
    }
  };

  const getCategoryStyles = (categoryName: string) => {
    switch (categoryName) {
      case "Governance":
        return { label: "Governance ⚖️", bg: "bg-indigo-55 bg-indigo-50 border-indigo-200 text-indigo-700" };
      case "Technical":
        return { label: "Technical 💻", bg: "bg-blue-50 border-blue-200 text-blue-700" };
      case "Community":
        return { label: "Community 🤝", bg: "bg-teal-50 border-teal-200 text-teal-700" };
      case "Treasury":
        return { label: "Treasury 💰", bg: "bg-emerald-50 border-emerald-200 text-emerald-700" };
      case "Events":
        return { label: "Events 📅", bg: "bg-purple-50 border-purple-200 text-purple-700" };
      case "Meta":
        return { label: "Meta 🌀", bg: "bg-rose-50 border-rose-200 text-rose-700" };
      default:
        return { label: categoryName || "Suggestion 💡", bg: "bg-slate-50 border-slate-200 text-slate-700" };
    }
  };

  const catStyle = getCategoryStyles(proposal.category || "Community");

  const getStatusStyle = (st: string) => {
    switch (st) {
      case "draft":
        return { label: "Draft 📁", bg: "bg-slate-100 border-slate-300 text-slate-600" };
      case "expired":
        return { label: "Expired ⏳", bg: "bg-zinc-100 border-zinc-250 text-zinc-650" };
      case "passed":
        return { label: "Passed ✅", bg: "bg-emerald-50 border-emerald-200 text-emerald-800" };
      case "rejected":
        return { label: "Rejected ❌", bg: "bg-rose-50 border-rose-200 text-rose-800" };
      default:
        return { label: "Active ⚡", bg: "bg-amber-50 border-amber-250 text-amber-800" };
    }
  };
  const statusStyle = getStatusStyle(currentStatus);

  // Perform atomic voting transaction
  const handleVoteAction = async (targetVoteType: "up" | "down") => {
    if (currentStatus !== "active") {
      setErrorMsg(`Voting has concluded on this proposal (${currentStatus}).`);
      setTimeout(() => setErrorMsg(null), 4000);
      return;
    }

    if (!user) {
      if (isEmbed) {
        const shareUrl = `${window.location.protocol}//${window.location.host}/proposal/${proposal.id}`;
        window.open(shareUrl, "_blank");
        return;
      }
      setErrorMsg("Please sign in with Google to cast your vote.");
      setTimeout(() => setErrorMsg(null), 4000);
      return;
    }

    if (voteLoading) return;
    setVoteLoading(true);
    setErrorMsg(null);

    const proposalRef = doc(db, "proposals", proposal.id);
    const voteRef = doc(db, "proposals", proposal.id, "votes", user.uid);

    let finalUpvotes = proposal.upvotesCount || 0;
    let finalDownvotes = proposal.downvotesCount || 0;
    let finalStatus: "draft" | "active" | "passed" | "rejected" | "expired" = proposal.status || "active";

    try {
      await runTransaction(db, async (transaction) => {
        const proposalSnap = await transaction.get(proposalRef);
        if (!proposalSnap.exists()) {
          throw new Error("Proposal has been deleted by its author.");
        }

        const data = proposalSnap.data() as Proposal;
        let upvotes = data.upvotesCount || 0;
        let downvotes = data.downvotesCount || 0;

        const voteSnap = await transaction.get(voteRef);
        const hasVoted = voteSnap.exists();
        const existingVoteType = hasVoted ? voteSnap.data().voteType : null;

        let nextVoteType: "up" | "down" | null = targetVoteType;

        if (hasVoted) {
          if (existingVoteType === targetVoteType) {
            nextVoteType = null;
            if (targetVoteType === "up") {
              upvotes = Math.max(0, upvotes - 1);
            } else {
              downvotes = Math.max(0, downvotes - 1);
            }
          } else {
            if (targetVoteType === "up") {
              upvotes += 1;
              downvotes = Math.max(0, downvotes - 1);
            } else {
              downvotes += 1;
              upvotes = Math.max(0, upvotes - 1);
            }
          }
        } else {
          if (targetVoteType === "up") {
            upvotes += 1;
          } else {
            downvotes += 1;
          }
        }

        const nextNetVotes = upvotes - downvotes;
        let nextStatus: "active" | "passed" | "rejected" = "active";
        if (nextNetVotes >= 15) {
          nextStatus = "passed";
        } else if (nextNetVotes < -10) {
          nextStatus = "rejected";
        }

        if (nextVoteType === null) {
          transaction.delete(voteRef);
        } else {
          transaction.set(voteRef, {
            userId: user.uid,
            voterName: user.displayName || "Anonymous Voter",
            voteType: nextVoteType,
            updatedAt: serverTimestamp(),
          });
        }

        transaction.update(proposalRef, {
          upvotesCount: upvotes,
          downvotesCount: downvotes,
          netVotes: nextNetVotes,
          priorityScore: nextNetVotes,
          status: nextStatus,
          updatedAt: serverTimestamp(),
        });

        // Store outputs to outer scope
        finalUpvotes = upvotes;
        finalDownvotes = downvotes;
        finalStatus = nextStatus;
      });

      // Trigger vote notifications
      if (user.uid !== proposal.authorId) {
        const { triggerVoteNotification } = await import("../utils/notifications");
        await triggerVoteNotification(proposal.authorId, proposal.id, proposal.title, finalUpvotes, finalDownvotes);
      }

      // Trigger conclusion notifications for all voters if proposal passed or was rejected
      if (finalStatus !== proposal.status && (finalStatus === "passed" || finalStatus === "rejected")) {
        try {
          const { collection, getDocs } = await import("firebase/firestore");
          const { createInAppNotification } = await import("../utils/notifications");
          const votesCollectionSnap = await getDocs(collection(db, "proposals", proposal.id, "votes"));
          const voterIds = votesCollectionSnap.docs.map(docSnap => docSnap.id);
          
          for (const voterId of voterIds) {
            await createInAppNotification(
              voterId,
              "conclude",
              proposal.id,
              `Proposal "${proposal.title}" you voted on has ${finalStatus.toUpperCase()}`,
              "Proposal Resolution"
            );
          }
        } catch (subErr) {
          console.error("Failed creating status conclude notifications for voters:", subErr);
        }
      }
    } catch (err: any) {
      console.error("Voting transaction error: ", err);
      try {
        handleFirestoreError(err, OperationType.UPDATE, `proposals/${proposal.id}`);
      } catch (mappedError: any) {
        setErrorMsg(`Voting failed: Authorization or schema criteria.`);
      }
    } finally {
      setVoteLoading(false);
    }
  };

  const handleSaveUpdate = async () => {
    if (!user || user.uid !== proposal.authorId) return;

    const trimmedTitle = editTitle.trim();
    const trimmedDesc = editDescription.trim();

    if (trimmedTitle.length < 3 || trimmedTitle.length > 100) {
      setErrorMsg("Title must be between 3 and 100 characters.");
      return;
    }

    if (trimmedDesc.length < 10 || trimmedDesc.length > 1000) {
      setErrorMsg("Description must be between 10 and 1000 characters.");
      return;
    }

    setEditLoading(true);
    setErrorMsg(null);

    const proposalRef = doc(db, "proposals", proposal.id);

    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(proposalRef);
        if (!snap.exists()) {
          throw new Error("Proposal was deleted.");
        }

        transaction.update(proposalRef, {
          title: trimmedTitle,
          description: trimmedDesc,
          category: editCategory,
          tags: editTags,
          updatedAt: serverTimestamp(),
        });
      });

      setIsEditing(false);
    } catch (err: any) {
      console.error("Update failed: ", err);
      try {
        handleFirestoreError(err, OperationType.UPDATE, `proposals/${proposal.id}`);
      } catch (mappedError: any) {
        setErrorMsg(`Failed updating details correctly. Try again.`);
      }
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeleteProposal = async () => {
    if (!user || user.uid !== proposal.authorId) return;
    
    setErrorMsg(null);
    try {
      await deleteDoc(doc(db, "proposals", proposal.id));
    } catch (err: any) {
      console.error("Deletion failed: ", err);
      try {
        handleFirestoreError(err, OperationType.DELETE, `proposals/${proposal.id}`);
      } catch (mappedError: any) {
        setErrorMsg("Failed deletion. Permission Denied.");
      }
    }
  };

  const hasUpvoted = currentUserVote === "up";
  const hasDownvoted = currentUserVote === "down";
  const isDelegatedUp = currentUserVote === null && delegateVoteType === "up";
  const isDelegatedDown = currentUserVote === null && delegateVoteType === "down";

  const cardBorderClass = challengeWinnerTitle
    ? "border-yellow-400 bg-yellow-50/5 ring-2 ring-yellow-400 ring-offset-1 shadow-md hover:shadow-lg"
    : challengeEntryTitle
      ? "border-indigo-400 bg-indigo-50/5 ring-1 ring-indigo-300 shadow-sm hover:shadow-md"
      : "bg-white border border-slate-200 hover:shadow-md";

  return (
    <article className={`${cardBorderClass} rounded-2xl p-6 transition-all duration-200 flex flex-col sm:flex-row gap-6 items-start relative overflow-hidden`}>
      {/* 1. Vote scoring pillar */}
      <div className="flex sm:flex-col items-center justify-center bg-slate-50/80 hover:bg-slate-50 rounded-2xl p-3 min-w-[72px] border border-slate-100 self-center sm:self-start w-full sm:w-auto">
        <button
          id={`vote-up-${proposal.id}`}
          onClick={() => handleVoteAction("up")}
          disabled={voteLoading}
          className={`p-1.5 rounded-lg transition-all cursor-pointer relative ${
            hasUpvoted
              ? "bg-indigo-600 text-white shadow-sm"
              : isDelegatedUp
                ? "bg-indigo-50 border-2 border-dashed border-indigo-400 text-indigo-700 shadow-xs scale-105"
                : "text-slate-400 hover:text-indigo-600 hover:bg-white"
          }`}
          title={isDelegatedUp ? "Active virtual vote: Delegated Up (Click to override with direct Downvote)" : "Upvote suggestion"}
        >
          <ChevronUp className="w-5 h-5 stroke-[2.5]" />
          {isDelegatedUp && (
            <span className="absolute -top-1 -right-1 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-505 bg-indigo-600"></span>
            </span>
          )}
        </button>

        <span className={`text-lg font-sans font-black py-1.5 px-3 min-w-[20px] text-center ${
          proposal.netVotes > 0 
            ? "text-slate-800"
            : proposal.netVotes < 0 
              ? "text-rose-500" 
              : "text-slate-500"
        }`}>
          {proposal.netVotes}
        </span>

        <button
          id={`vote-down-${proposal.id}`}
          onClick={() => handleVoteAction("down")}
          disabled={voteLoading}
          className={`p-1.5 rounded-lg transition-all cursor-pointer relative ${
            hasDownvoted
              ? "bg-rose-500 text-white shadow-sm"
              : isDelegatedDown
                ? "bg-rose-50 border-2 border-dashed border-rose-400 text-rose-700 shadow-xs scale-105"
                : "text-slate-400 hover:text-rose-600 hover:bg-white"
          }`}
          title={isDelegatedDown ? "Active virtual vote: Delegated Down (Click to override with direct Upvote)" : "Downvote suggestion"}
        >
          <ChevronDown className="w-5 h-5 stroke-[2.5]" />
          {isDelegatedDown && (
            <span className="absolute -top-1 -right-1 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-505 bg-rose-505 bg-rose-500"></span>
            </span>
          )}
        </button>
      </div>

      {/* 2. Proposal content center */}
      <div className="flex-1 w-full space-y-3">
        {/* Category badges and history tags on top */}
        <div className="flex flex-wrap items-center gap-2 mb-1">
          {challengeWinnerTitle && (
            <span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 border border-yellow-300 text-[10px] font-sans font-extrabold uppercase rounded-md tracking-wider flex items-center gap-1 shadow-3xs animate-bounce">
              👑 {challengeWinnerTitle} Winner
            </span>
          )}
          {!challengeWinnerTitle && challengeEntryTitle && (
            <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-sans font-extrabold uppercase rounded-md tracking-wider flex items-center gap-1 shadow-3xs">
              🎯 {challengeEntryTitle} Entry
            </span>
          )}
          <span className={`px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded-md tracking-wider border ${catStyle.bg}`}>
            {catStyle.label}
          </span>
          {proposal.tags && proposal.tags.map((tg: string) => (
            <span key={tg} className="px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-200/80 text-[10px] font-sans font-semibold rounded-md tracking-wide">
              #{tg}
            </span>
          ))}
          <span className="px-2 py-0.5 bg-slate-100 text-slate-550 border border-slate-200/40 text-[10px] font-mono font-bold uppercase rounded-md tracking-wider">
            {getRelativeTime(proposal.createdAt)}
          </span>
          <span className={`px-2 py-0.5 border text-[10px] font-mono font-bold uppercase rounded-md tracking-wider ${statusStyle.bg}`}>
            {statusStyle.label}
          </span>

          {currentStatus === "active" && proposal.expiresAt && (
            <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200/80 text-[10px] font-mono font-bold uppercase rounded-md tracking-wider flex items-center gap-1 shadow-3xs">
              <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />
              ⏰ {getCountdownText(proposal.expiresAt)}
            </span>
          )}

          {currentStatus === "draft" && (
            <span className="px-2 py-0.5 bg-slate-100 text-slate-650 border border-slate-250 text-[10px] font-mono font-bold uppercase rounded-md tracking-wider flex items-center gap-1">
              🔒 Author Draft
            </span>
          )}
        </div>

        {isEditing ? (
          /* Editing view */
          <div className="space-y-4 pt-1">
            <div>
              <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase">Edit Title</label>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                maxLength={100}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-sans font-medium text-slate-800 focus:outline-hidden focus:border-indigo-500 focus:bg-white"
              />
            </div>
            
            <div>
              <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase">Edit Details</label>
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                maxLength={1000}
                rows={3}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-sans text-slate-700 focus:outline-hidden focus:border-indigo-500 focus:bg-white resize-y"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase">Edit Category</label>
                <div className="relative mt-1">
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value as any)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-805 font-sans focus:outline-hidden focus:border-indigo-500 focus:bg-white transition-all appearance-none cursor-pointer text-slate-800 font-semibold"
                  >
                    <option value="Governance">Governance (⚖️)</option>
                    <option value="Technical">Technical (💻)</option>
                    <option value="Community">Community (🤝)</option>
                    <option value="Treasury">Treasury (💰)</option>
                    <option value="Events">Events (📅)</option>
                    <option value="Meta">Meta (🌀)</option>
                  </select>
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-[10px] select-none">
                    ▼
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase">Edit Tags</label>
                <div className="flex gap-2 mt-1">
                  <input
                    type="text"
                    placeholder="Enter/Comma a tag"
                    value={editTagInput}
                    onChange={(e) => setEditTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        const val = editTagInput.trim().replace(/,/g, "");
                        if (val && !editTags.includes(val) && val.length > 0 && val.length < 25) {
                          if (editTags.length < 10) {
                            setEditTags([...editTags, val]);
                            setEditTagInput("");
                          }
                        }
                      }
                    }}
                    className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:border-indigo-500 focus:bg-white font-sans"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const val = editTagInput.trim();
                      if (val && !editTags.includes(val) && val.length > 0 && val.length < 25) {
                        if (editTags.length < 10) {
                          setEditTags([...editTags, val]);
                          setEditTagInput("");
                        }
                      }
                    }}
                    className="px-3 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-100 text-xs font-semibold rounded-xl cursor-pointer"
                  >
                    Add
                  </button>
                </div>

                {editTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2 p-1.5 bg-slate-50 border border-slate-200/50 rounded-xl">
                    {editTags.map((tg) => (
                      <span key={tg} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-md text-[9px] font-bold">
                        #{tg}
                        <button
                          type="button"
                          onClick={() => setEditTags(editTags.filter((t) => t !== tg))}
                          className="hover:text-indigo-950 font-black text-rose-500 hover:bg-rose-50 rounded-xs px-0.5 select-none cursor-pointer"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1.5">
              <button
                onClick={handleSaveUpdate}
                disabled={editLoading}
                className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-2 px-4 rounded-xl shadow-sm cursor-pointer transition-colors"
              >
                {editLoading ? "Saving..." : "Save Proposal"}
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setEditTitle(proposal.title);
                  setEditDescription(proposal.description);
                  setEditCategory(proposal.category || "Governance");
                  setEditTags(proposal.tags || []);
                  setEditTagInput("");
                  setErrorMsg(null);
                }}
                className="bg-transparent hover:bg-slate-100 text-slate-500 text-xs px-3 py-2 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          /* Standard listing view */
          <div>
            <h3 className="text-base font-sans font-extrabold text-slate-800 tracking-tight leading-snug break-words">
              {proposal.title}
            </h3>
            
            <p className="text-sm text-slate-600 mt-2 font-sans leading-relaxed whitespace-pre-wrap break-words">
              {proposal.description}
            </p>

            {/* Liquid Democracy Delegated Vote indicator banner */}
            {user && activeDelegation && delegateVoteType && currentUserVote === null && (
              <div className="mt-3.5 p-3.5 bg-indigo-50 border border-indigo-150 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 text-left">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white shrink-0">
                    <SparklesIcon className="w-4.5 h-4.5 text-amber-300 fill-amber-300" />
                  </div>
                  <div>
                    <h5 className="text-xs font-black text-indigo-900 uppercase tracking-wide">
                      Liquid Democracy Active
                    </h5>
                    <p className="text-[11px] text-indigo-700 font-sans leading-normal">
                      You delegated your <strong>{proposal.category}</strong> votes to{" "}
                      <button
                        type="button"
                        onClick={() => onViewProfile && onViewProfile(activeDelegation.delegateId)}
                        className="font-bold underline hover:text-indigo-950 cursor-pointer"
                      >
                        {activeDelegation.delegateName}
                      </button>
                      . They cast a vote of{" "}
                      <span className={`font-black uppercase ${
                        delegateVoteType === "up" ? "text-emerald-600" : "text-rose-600"
                      }`}>
                        {delegateVoteType === "up" ? "Favor (Up)" : "Against (Down)"}
                      </span>{" "}
                      on this proposal.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    // One-click override: Cast the OPPOSITE vote to B’s vote
                    const opposingVoteType = delegateVoteType === "up" ? "down" : "up";
                    handleVoteAction(opposingVoteType);
                  }}
                  disabled={voteLoading}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1 bg-white hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-xs font-mono font-bold py-2 px-3 rounded-xl transition-all shadow-3xs cursor-pointer select-none shrink-0"
                >
                  ⚡ Override vote
                </button>
              </div>
            )}

            {/* Liquid Democracy OVERRIDDEN indicator banner */}
            {user && activeDelegation && currentUserVote !== null && (
              <div className="mt-3.5 p-3 px-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex items-center gap-2.5 text-left text-[11px] text-slate-500 font-sans">
                <div className="w-5 h-5 rounded-md bg-slate-200 flex items-center justify-center text-slate-600 shrink-0">
                  <UserIcon className="w-3" />
                </div>
                <span>
                  You delegated your <strong>{proposal.category}</strong> votes to{" "}
                  <button
                    type="button"
                    onClick={() => onViewProfile && onViewProfile(activeDelegation.delegateId)}
                    className="font-bold underline hover:text-slate-800 cursor-pointer"
                  >
                    {activeDelegation.delegateName}
                  </button>
                  , but you <strong>overrode</strong> their choice by casting a direct{" "}
                  <span className="font-bold uppercase text-slate-705">
                    {currentUserVote === "up" ? "Favor" : "Against"}
                  </span>{" "}
                  ballot. (Click your active vote chevron, or the "Revoke Delegation" option on your profile, to revert.)
                </span>
              </div>
            )}

            {/* Voting Quorum Progress bar - only for active proposals */}
            {currentStatus === "active" && (
              <div className="space-y-1.5 mt-4 p-4 bg-slate-50/70 border border-slate-200/60 rounded-xl max-w-xl text-left">
                <div className="flex justify-between items-center text-[10px] font-mono text-slate-450 font-bold">
                  <span className="tracking-wider text-slate-500 uppercase">Voting Progress (Quorum)</span>
                  <span className="text-slate-650">{totalVotes} / {quorumRequirement} votes ({Math.min(100, Math.round((totalVotes / quorumRequirement) * 100))}%)</span>
                </div>
                <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-305 ${
                      totalVotes >= quorumRequirement ? "bg-emerald-555 bg-emerald-500" : "bg-indigo-500"
                    }`}
                    style={{ width: `${Math.min(100, (totalVotes / quorumRequirement) * 100)}%` }}
                  />
                </div>
                <p className="text-[10px] font-sans text-slate-450 italic mt-0.5">
                  {totalVotes >= quorumRequirement 
                    ? "✓ Community quorum reached! Suggestion eligible for adoption." 
                    : `⚠ Needs ${quorumRequirement - totalVotes} more votes to meet target minimum quorum.`
                  }
                </p>
              </div>
            )}

            {/* Turnout detailed reports for closed proposals */}
            {isDetail && currentStatus !== "active" && currentStatus !== "draft" && (
              <div className="border-t border-slate-100 pt-5 mt-5 space-y-4 text-left">
                <div className="border-l-4 border-indigo-600 pl-3">
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider font-mono">
                    Concluded Ballot Verdict
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    This community proposal reached the end of its voting duration. Results have been computed and certified below:
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-slate-50/70 border border-slate-200 rounded-2xl p-4 text-center">
                    <span className="text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">Vote Turnout</span>
                    <p className="text-2xl font-black text-indigo-700 mt-1">
                      {totalUsers > 0 ? Math.round((totalVotes / totalUsers) * 100) : 0}%
                    </p>
                    <p className="text-[10px] text-slate-400 font-medium font-mono mt-0.5">
                      {totalVotes} of {totalUsers} voted
                    </p>
                  </div>

                  <div className="bg-slate-50/70 border border-slate-200 rounded-2xl p-4 text-center">
                    <span className="text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">Support Ratio</span>
                    <p className={`text-2xl font-black mt-1 ${
                      totalVotes > 0 && (proposal.upvotesCount / totalVotes) > 0.5 ? "text-emerald-600" : "text-rose-600"
                    }`}>
                      {totalVotes > 0 ? Math.round((proposal.upvotesCount / totalVotes) * 100) : 0}% UP
                    </p>
                    <p className="text-[10px] text-slate-400 font-medium font-sans mt-0.5">
                      {proposal.upvotesCount} Yes vs {proposal.downvotesCount} No
                    </p>
                  </div>

                  <div className="bg-slate-50/70 border border-slate-200 rounded-2xl p-4 text-center flex flex-col justify-center border-slate-200">
                    <span className="text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">Threshold Checks</span>
                    <p className="text-xs font-bold font-mono mt-1 text-slate-700">
                      QUORUM: {quorumRequirement}
                    </p>
                    <p className={`text-[10px] font-bold font-sans mt-0.5 ${
                      totalVotes >= quorumRequirement ? "text-emerald-600" : "text-amber-600"
                    }`}>
                      {totalVotes >= quorumRequirement ? "✓ Quorum Achieved" : "✗ Quorum Unfulfilled"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Dynamic Liquid Democracy Analytics section */}
            {isDetail && currentStatus !== "draft" && (
              <div className="border-t border-slate-100 pt-5 mt-5 space-y-5 text-left">
                {/* liquid vs standard side-by-side indicator bar */}
                <div className="bg-slate-50 border border-slate-200/60 rounded-3xl p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-indigo-50 text-indigo-750 border border-indigo-100 rounded-xl">
                      <SparklesIcon className="w-4 h-4 fill-amber-300 text-amber-500" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider font-mono">
                        Liquid Governance Analytics
                      </h4>
                      <p className="text-[10px] text-slate-450 font-sans tracking-wide">
                        传统 1人1票 (Traditional Ballots) vs. 声誉加权流性民主 (Reputation-Weighted Liquid Democracy)
                      </p>
                    </div>
                  </div>

                  {(() => {
                    const lpUp = voters.filter(v => v.voteType === "up").reduce((s, v) => s + getVoterLiquidPower(v.userId).totalPower, 0);
                    const lpDown = voters.filter(v => v.voteType === "down").reduce((s, v) => s + getVoterLiquidPower(v.userId).totalPower, 0);
                    const lpTotal = lpUp + lpDown;
                    const lpUpPercent = lpTotal > 0 ? Math.round((lpUp / lpTotal) * 100) : 0;
                    const lpDownPercent = lpTotal > 0 ? Math.round((lpDown / lpTotal) * 100) : 0;

                    const stdVotes = totalVotes;
                    const stdUpPercent = stdVotes > 0 ? Math.round((proposal.upvotesCount / stdVotes) * 100) : 0;
                    const stdDownPercent = stdVotes > 0 ? Math.round((proposal.downvotesCount / stdVotes) * 100) : 0;

                    return (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-1 font-sans">
                        {/* traditional balance */}
                        <div className="space-y-2 p-3.5 bg-white border border-slate-205 border-slate-200/70 rounded-2xl">
                          <div className="flex justify-between items-center text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider">
                            <span>🗳️ One-Person-One-Vote</span>
                            <span className="text-slate-700 font-mono font-black">{proposal.upvotesCount} Yes - {proposal.downvotesCount} No</span>
                          </div>
                          <div className="w-full bg-slate-105 bg-slate-100 h-5.5 rounded-xl overflow-hidden flex text-[10px] font-mono font-bold text-white border border-slate-200">
                            {proposal.upvotesCount > 0 && (
                              <div className="bg-emerald-550 bg-emerald-500 h-full flex items-center justify-center transition-all duration-300" style={{ width: `${stdVotes > 0 ? (proposal.upvotesCount / stdVotes) * 100 : 50}%` }}>
                                {proposal.upvotesCount > 0 ? `${stdUpPercent}%` : ""}
                              </div>
                            )}
                            {proposal.downvotesCount > 0 && (
                              <div className="bg-rose-500 h-full flex items-center justify-center transition-all duration-300" style={{ width: `${stdVotes > 0 ? (proposal.downvotesCount / stdVotes) * 100 : 50}%` }}>
                                {proposal.downvotesCount > 0 ? `${stdDownPercent}%` : ""}
                              </div>
                            )}
                            {stdVotes === 0 && (
                              <div className="w-full h-full text-slate-400 text-center flex items-center justify-center italic font-sans text-[11px] font-normal">
                                No ballots cast
                              </div>
                            )}
                          </div>
                          <div className="flex justify-between text-[9px] text-slate-400 font-mono">
                            <span className="text-emerald-600 font-bold">Favor (traditional count)</span>
                            <span className="text-rose-500 font-bold">Against (traditional count)</span>
                          </div>
                        </div>

                        {/* liquid democracy weighted power */}
                        <div className="space-y-2 p-3.5 bg-amber-50/15 border border-amber-200 rounded-2xl shadow-3xs">
                          <div className="flex justify-between items-center text-[10px] font-mono font-bold text-amber-800 uppercase tracking-wider">
                            <span className="inline-flex items-center gap-1 text-amber-700">✨ Liquid Power Weight</span>
                            <span className="text-amber-850 font-black">{lpUp} Yes - {lpDown} No VP</span>
                          </div>
                          <div className="w-full bg-slate-100 h-5.5 rounded-xl overflow-hidden flex text-[10px] font-mono font-bold text-white border border-amber-200">
                            {lpUp > 0 && (
                              <div className="bg-indigo-600 h-full flex items-center justify-center transition-all duration-300" style={{ width: `${lpTotal > 0 ? (lpUp / lpTotal) * 100 : 50}%` }}>
                                {lpUp > 0 ? `${lpUpPercent}%` : ""}
                              </div>
                            )}
                            {lpDown > 0 && (
                              <div className="bg-rose-600 h-full flex items-center justify-center transition-all duration-300" style={{ width: `${lpTotal > 0 ? (lpDown / lpTotal) * 100 : 50}%` }}>
                                {lpDown > 0 ? `${lpDownPercent}%` : ""}
                              </div>
                            )}
                            {lpTotal === 0 && (
                              <div className="w-full h-full text-slate-400 text-center flex items-center justify-center italic font-sans text-[11px] font-normal">
                                No active power weights
                              </div>
                            )}
                          </div>
                          <div className="flex justify-between text-[9px] text-slate-400 font-mono">
                            <span className="text-indigo-600 font-bold">Favor (Weighted VP)</span>
                            <span className="text-rose-600 font-bold">Against (Weighted VP)</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Voter roll listing with liquid details */}
                <div className="space-y-3 pt-1">
                  <h4 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-indigo-500" />
                    Voters Roll (Live Liquid Weightings)
                  </h4>
                  {loadingVoters ? (
                    <p className="text-[10px] text-slate-450 animate-pulse font-mono">Retrieving voter database records...</p>
                  ) : voters.length === 0 ? (
                    <p className="text-[10px] text-slate-450 italic font-mono">No voter records found on this ballot.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50 border border-slate-200/50 rounded-2xl p-4 max-h-[185px] overflow-y-auto">
                      {voters.map((vt) => {
                        const { totalPower, baseRep, delegators } = getVoterLiquidPower(vt.userId);
                        return (
                          <div key={vt.userId} className="flex items-center justify-between text-[11px] font-sans border-b border-slate-205/30 border-slate-200/40 pb-2">
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <button
                                type="button"
                                onClick={() => onViewProfile && onViewProfile(vt.userId)}
                                className="font-semibold text-slate-700 hover:text-indigo-650 hover:underline text-left truncate max-w-[160px] cursor-pointer"
                              >
                                {vt.voterName}
                              </button>
                              {delegators.length > 0 && (
                                <span 
                                  className="text-[9px] font-mono text-indigo-600 font-bold inline-block" 
                                  title={`Represented delegators: ${delegators.map(d => `${d.name} (${d.reputation} pts)`).join(", ")}`}
                                >
                                  Representing {delegators.length} supporter{delegators.length > 1 ? "s" : ""}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span 
                                className="font-mono text-[10px] font-black text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100" 
                                title={`Reputation score (${baseRep}) + delegated stake sum`}
                              >
                                ⚡ {totalPower} VP
                              </span>
                              <span className={`px-2 py-0.5 rounded-md font-extrabold uppercase text-[9px] font-mono ${
                                vt.voteType === "up" ? "bg-emerald-50 text-emerald-705 text-emerald-700 border border-emerald-100" : "bg-rose-50 text-rose-705 text-rose-700 border border-rose-100"
                              }`}>
                                {vt.voteType === "up" ? "Favor" : "Against"}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Author publish trigger for drafts */}
            {currentStatus === "draft" && user && user.uid === proposal.authorId && (
              <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 text-left">
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-indigo-700 font-mono uppercase tracking-wider flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" />
                    Publish Draft Proposal
                  </h4>
                  <p className="text-[11px] text-slate-450 leading-normal max-w-sm">
                    This draft is only visible to you. Ready to launch the {proposal.durationDays || 7}-day community prioritization vote?
                  </p>
                </div>
                <button
                  onClick={async () => {
                    setErrorMsg(null);
                    const { doc, updateDoc } = await import("firebase/firestore");
                    const proposalRef = doc(db, "proposals", proposal.id);
                    const duration = proposal.durationDays || 7;
                    try {
                      await updateDoc(proposalRef, {
                        status: "active",
                        createdAt: serverTimestamp(), // sync creation-date with publish action
                        expiresAt: new Date(Date.now() + duration * 24 * 60 * 60 * 1000),
                        updatedAt: serverTimestamp()
                      });
                    } catch (err: any) {
                      try {
                        handleFirestoreError(err, OperationType.UPDATE, `proposals/${proposal.id}`);
                      } catch (mappedError: any) {
                        setErrorMsg(`Failed publishing: ${mappedError.message}`);
                      }
                    }
                  }}
                  className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs shadow-md shadow-emerald-500/15 cursor-pointer uppercase transition-all shrink-0"
                >
                  🚀 Publish Live
                </button>
              </div>
            )}

            {/* Author Attribution and email verification stamp */}
            <div className="flex flex-wrap gap-2 items-center justify-between mt-4 text-[11px] font-mono border-t border-slate-100 pt-3.5 text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                Submitted by{" "}
                <button
                  type="button"
                  onClick={() => onViewProfile && onViewProfile(proposal.authorId)}
                  className="text-slate-600 hover:text-indigo-600 font-bold underline cursor-pointer"
                >
                  {proposal.authorName}
                </button>
                {proposal.authorIsAgent && (
                  <span className="ml-1 px-1 py-0.2 bg-emerald-50 text-emerald-800 border border-emerald-100 text-[9px] rounded-sm font-bold uppercase tracking-wider" title="Verified Agent Submission">
                    🤖 Agent
                  </span>
                )}
              </span>

              <span>
                {proposal.updatedAt && proposal.updatedAt !== proposal.createdAt ? "Edited recently" : "Original status active"}
              </span>
            </div>

            {/* Deliberation metrics / select button */}
            {/* Deliberation metrics / select button */}
            {!isDetail && !isEmbed && (
              <div className="flex flex-wrap gap-2 items-center justify-between mt-4 border-t border-slate-100 pt-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-slate-505 bg-slate-100 px-2 py-1 rounded-md" title="Comments count">
                    <MessageSquare className="w-3.5 h-3.5 text-indigo-505 stroke-[2.2]" />
                    {commentCount} comments
                  </span>
                  {deliberationScore > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded-md border border-orange-100" title="Deliberation Score">
                      <Flame className="w-3.5 h-3.5 text-orange-500 fill-orange-500" />
                      {deliberationScore} deliberation
                    </span>
                  )}
                </div>

                {onSelect && (
                  <button
                    onClick={onSelect}
                    className="inline-flex items-center gap-1 text-xs font-black text-indigo-600 hover:text-indigo-800 transition-all cursor-pointer bg-indigo-50 hover:bg-indigo-100/70 py-1.5 px-3.5 rounded-xl border border-indigo-150 uppercase tracking-wider font-mono text-[10px]"
                  >
                    Deliberate →
                  </button>
                )}
              </div>
            )}

            {/* Social Sharing Initiatives Panel */}
            {isDetail && (
              <div className="border-t border-slate-100 pt-5 mt-5">
                <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-indigo-700">
                      <Share2 className="w-4 h-4 stroke-[2.5]" />
                      <h4 className="text-xs font-black uppercase tracking-wider font-mono">Social Sharing Initiative</h4>
                    </div>
                    <p className="text-[11px] text-slate-520 font-sans leading-relaxed">
                      Promote this ballot with your network to mobilize votes and accelerate dynamic community decisions.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* Copy direct link button */}
                    <button
                      onClick={() => {
                        const shareUrl = `${window.location.protocol}//${window.location.host}/proposal/${proposal.id}`;
                        navigator.clipboard.writeText(shareUrl);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="inline-flex items-center gap-2 text-xs font-bold bg-white text-slate-700 hover:text-indigo-600 hover:bg-slate-50/50 hover:border-indigo-200 border border-slate-200 rounded-xl px-4 py-2.5 transition-all shadow-3xs cursor-pointer select-none"
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4 text-emerald-500 stroke-[3]" />
                          <span className="text-emerald-600 font-bold">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4 text-slate-400" />
                          <span>Copy Link</span>
                        </>
                      )}
                    </button>

                    {/* Share on X Twitter */}
                    <a
                      href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`🗳️ ${proposal.title} — vote now on goBodhi: ${window.location.protocol}//${window.location.host}/proposal/${proposal.id}`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-xs font-bold bg-slate-900 text-white hover:bg-black hover:scale-102 active:scale-98 rounded-xl px-4 py-2.5 transition-all shadow-md cursor-pointer select-none"
                    >
                      <Twitter className="w-3.5 h-3.5 fill-current" />
                      <span>Post to X</span>
                    </a>

                    {/* Share on Telegram */}
                    <a
                      href={`https://t.me/share/url?url=${encodeURIComponent(`${window.location.protocol}//${window.location.host}/proposal/${proposal.id}`)}&text=${encodeURIComponent(`🗳️ ${proposal.title} — vote now on goBodhi:`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-xs font-bold bg-sky-500 text-white hover:bg-sky-600 hover:scale-102 active:scale-98 rounded-xl px-4 py-2.5 transition-all shadow-md cursor-pointer select-none"
                    >
                      <Send className="w-3.5 h-3.5 fill-current" />
                      <span>Telegram</span>
                    </a>

                    {/* Get HTML Embed */}
                    <button
                      onClick={() => setShowEmbedModal(true)}
                      className="inline-flex items-center gap-2 text-xs font-bold bg-indigo-55 bg-indigo-50 text-indigo-750 hover:bg-indigo-100 border border-indigo-100 rounded-xl px-4 py-2.5 transition-all cursor-pointer select-none text-indigo-700"
                    >
                      <Code className="w-4 h-4" />
                      <span>Embed Widget</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error panel inside card */}
        {errorMsg && (
          <div className="text-[11px] font-sans text-rose-500 bg-rose-50 border border-rose-100 rounded-lg px-3 py-1.5 flex items-center gap-1.5 mt-2">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* 3. Action commands (Edit/Delete for original author) */}
      {!isEmbed && user && user.uid === proposal.authorId && !isEditing && (
        <div className="flex sm:flex-col gap-2 self-stretch sm:self-start justify-end border-t sm:border-t-0 border-slate-100 pt-3 sm:pt-0 shrink-0 w-full sm:w-auto">
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center justify-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-105 px-3 py-2 rounded-xl transition-all cursor-pointer font-bold font-sans tracking-wide"
            title="Edit proposal"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Edit
          </button>

          {isConfirmingDelete ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleDeleteProposal}
                className="flex items-center justify-center text-[10px] text-white bg-rose-600 hover:bg-rose-700 px-3 py-2 rounded-xl transition-all font-bold font-sans cursor-pointer uppercase tracking-wider"
                title="Confirm erasure"
              >
                Delete
              </button>
              <button
                onClick={() => setIsConfirmingDelete(false)}
                className="p-2 text-slate-400 hover:text-slate-600 bg-slate-100 rounded-xl transition-all cursor-pointer"
                title="Discard action"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsConfirmingDelete(true)}
              className="flex items-center justify-center gap-1 text-[11px] text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-105 px-3 py-2 rounded-xl transition-all cursor-pointer font-bold font-sans tracking-wide"
              title="Delete proposal"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          )}
        </div>
      )}

      {/* HTML Embed Tooltip Modal */}
      {showEmbedModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden p-6 space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-150 pb-3">
              <div className="flex items-center gap-2">
                <Code className="w-5 h-5 text-indigo-600" />
                <h3 className="text-sm font-black uppercase font-mono tracking-wider text-slate-800">HTML Embed Widget</h3>
              </div>
              <button
                onClick={() => {
                  setShowEmbedModal(false);
                  setEmbedCopied(false);
                }}
                className="p-1.5 hover:bg-slate-100 rounded-xl transition-colors text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Close modal dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed font-sans">
              Copy the code block below to render this live, interactive voting ballot directly inside Notion pages, blogs, wikis, or company portals.
            </p>

            <div className="relative bg-slate-950 rounded-2xl p-4 font-mono text-[11px] select-all border border-slate-800">
              <code className="block whitespace-pre-wrap break-all leading-normal text-indigo-300">
                {`<iframe src="${window.location.protocol}//${window.location.host}/embed/proposal/${proposal.id}" width="100%" height="320" style="border:none;border-radius:16px;background:transparent;" allow="encrypted-media"></iframe>`}
              </code>
              
              <button
                onClick={() => {
                  const code = `<iframe src="${window.location.protocol}//${window.location.host}/embed/proposal/${proposal.id}" width="100%" height="320" style="border:none;border-radius:16px;background:transparent;" allow="encrypted-media"></iframe>`;
                  navigator.clipboard.writeText(code);
                  setEmbedCopied(true);
                  setTimeout(() => setEmbedCopied(false), 2000);
                }}
                className="absolute right-3 top-3 bg-slate-800 hover:bg-slate-705 text-white rounded-lg px-2.5 py-1.5 text-[10.5px] font-sans font-bold flex items-center gap-1.5 cursor-pointer border border-slate-700"
              >
                {embedCopied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[2.5]" />
                    <span className="text-emerald-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-350" />
                    <span>Copy Code</span>
                  </>
                )}
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">Interactive Preview</label>
              <div className="border border-dashed border-slate-200 rounded-2xl overflow-hidden bg-slate-50 p-2">
                <iframe 
                  src={`${window.location.protocol}//${window.location.host}/embed/proposal/${proposal.id}`} 
                  width="100%" 
                  height="260" 
                  className="bg-transparent"
                  style={{ border: "none" }}
                  title="Widget interactive demo preview"
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                onClick={() => {
                  setShowEmbedModal(false);
                  setEmbedCopied(false);
                }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-5 py-2.5 rounded-xl cursor-pointer shadow-3xs transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {currentStatus !== "active" && currentStatus !== "draft" && (
        <motion.div 
          initial={{ scale: 2.2, opacity: 0, rotate: 30 }}
          animate={{ scale: 1.05, opacity: 0.9, rotate: -15 }}
          transition={{ type: "spring", damping: 11, delay: 0.1 }}
          className="absolute right-2.5 top-2.5 sm:right-28 sm:top-4 pointer-events-none select-none z-10"
        >
          <div className={`border-2 border-dashed rounded-lg px-3 py-1 text-xs font-black tracking-widest font-mono uppercase text-center select-none ${
            currentStatus === "passed"
              ? "border-emerald-500 text-emerald-500 bg-emerald-50/50"
              : currentStatus === "rejected"
                ? "border-rose-500 text-rose-500 bg-rose-50/50"
                : "border-slate-500 text-slate-500 bg-slate-50/50"
          }`}>
            {currentStatus}
          </div>
        </motion.div>
      )}
    </article>
  );
}

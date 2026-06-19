import React, { useState, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import DOMPurify from "dompurify";
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  doc, 
  runTransaction, 
  addDoc, 
  deleteDoc,
  serverTimestamp, 
  Timestamp
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { Comment, UserSession } from "../types";
import { 
  MessageSquare, 
  ThumbsUp, 
  ThumbsDown, 
  Reply, 
  Trash2, 
  Send, 
  Calendar, 
  ArrowUpDown, 
  User, 
  Award, 
  Sparkles,
  Info,
  ChevronDown,
  ChevronUp,
  Flame
} from "lucide-react";

interface CommentSectionProps {
  proposalId: string;
  user: UserSession | null;
  proposalCreatedAt: Timestamp;
  proposalAuthorId: string;
  onViewProfile?: (userId: string) => void;
}

interface CommentNode {
  comment: Comment;
  replies: CommentNode[];
  depth: number;
}

export default function CommentSection({ proposalId, user, proposalCreatedAt, proposalAuthorId, onViewProfile }: CommentSectionProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [userCommentVotes, setUserCommentVotes] = useState<Record<string, "up" | "down">>({});
  
  // Comment tree states
  const [sortBy, setSortBy] = useState<"best" | "newest" | "oldest">("best");
  const [isExpanded, setIsExpanded] = useState(false);
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  
  // Submit states
  const [newCommentText, setNewCommentText] = useState("");
  const [replyText, setReplyText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Rate limiting & length guidelines state
  const lastSubmitTimeRef = React.useRef<number>(0);
  const MAX_COMMENT_LENGTH = 1000;
  const MIN_COMMENT_LENGTH = 3;
  const SUBMIT_COOLDOWN_MS = 5000; // 5 seconds spam protection time window
  
  // Load comments in real-time
  useEffect(() => {
    setLoadingComments(true);
    const commentsRef = collection(db, "comments");
    // Under guidelines, to avoid complex index development, we can query by proposalId
    // and sort client-side, making it highly robust & immune to missing index failures.
    const q = query(commentsRef, where("proposalId", "==", proposalId));
    
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const items: Comment[] = [];
        snapshot.forEach((docSnap) => {
          items.push({
            id: docSnap.id,
            ...docSnap.data()
          } as Comment);
        });
        setComments(items);
        setLoadingComments(false);
      },
      (error) => {
        console.error("Comments snapshot failed: ", error);
        setLoadingComments(false);
      }
    );
    
    return () => unsub();
  }, [proposalId]);

  // Synchronize comment votes cast by the current user
  useEffect(() => {
    if (!user || comments.length === 0) {
      setUserCommentVotes({});
      return;
    }

    const unsubscribes: (() => void)[] = [];
    
    comments.forEach((comment) => {
      const voteRef = doc(db, "comments", comment.id, "commentVotes", user.uid);
      const unsub = onSnapshot(
        voteRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            setUserCommentVotes((prev) => ({
              ...prev,
              [comment.id]: data.voteType
            }));
          } else {
            setUserCommentVotes((prev) => {
              const updated = { ...prev };
              delete updated[comment.id];
              return updated;
            });
          }
        },
        (error) => {
          // Ignore permission/offline constraints
        }
      );
      unsubscribes.push(unsub);
    });

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [user?.uid, comments.map(c => c.id).join(",")]);

  // Compute Deliberation Score
  const deliberationMetrics = useMemo(() => {
    const count = comments.length;
    if (count === 0) {
      return { score: 0, avgQuality: 1, textBadge: "Fresh Suggestion" };
    }
    
    // Average Quality calculation
    const totalNetVotes = comments.reduce((sum, c) => sum + (c.upvotes - c.downvotes), 0);
    const avgNetVotes = totalNetVotes / count;
    const avgQuality = Math.max(0.5, avgNetVotes + 1); // bound to stay positive
    
    // Time active calculation
    const createdAtMillis = proposalCreatedAt?.toMillis ? proposalCreatedAt.toMillis() : Date.now();
    const timeActiveHours = Math.max(0.1, (Date.now() - createdAtMillis) / (1000 * 60 * 60));
    
    // Formula: Deliberation Score = (count * avgQuality) / time_active
    const score = parseFloat(((count * avgQuality) / timeActiveHours).toFixed(2));
    
    let textBadge = "Developing Discussion";
    if (score >= 10) {
      textBadge = "Highly Calibrated Deliberation 🔥";
    } else if (score >= 3) {
      textBadge = "Active Deliberation 💬";
    } else if (score >= 1) {
      textBadge = "Steady Deliberation 🌱";
    }
    
    return { score, avgQuality: parseFloat(avgQuality.toFixed(2)), textBadge };
  }, [comments, proposalCreatedAt]);

  // Compute Top Contributors
  const topContributors = useMemo(() => {
    const map: Record<string, { name: string; email: string; commentsCount: number; netVotesSum: number }> = {};
    
    comments.forEach((c) => {
      if (!map[c.authorId]) {
        map[c.authorId] = {
          name: c.authorName,
          email: c.authorEmail,
          commentsCount: 0,
          netVotesSum: 0
        };
      }
      map[c.authorId].commentsCount += 1;
      map[c.authorId].netVotesSum += (c.upvotes - c.downvotes);
    });

    const list = Object.entries(map).map(([id, info]) => {
      // Score formula: (number of comments * 3) + net vote sum
      const score = (info.commentsCount * 3) + info.netVotesSum;
      return {
        id,
        ...info,
        score
      };
    });

    // Sort descending by score
    list.sort((a, b) => b.score - a.score);
    return list.slice(0, 5); // Return top 5 contributors
  }, [comments]);

  // Recursively build comment tree with client sort
  const buildTree = (parentId: string | null, depth: number): CommentNode[] => {
    if (depth > 3) return []; // Max 3 nested levels
    
    return comments
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => {
        if (sortBy === "best") {
          return (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes);
        } else if (sortBy === "newest") {
          const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
          const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
          return timeB - timeA;
        } else {
          const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
          const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
          return timeA - timeB;
        }
      })
      .map((comment) => ({
        comment,
        replies: buildTree(comment.id, depth + 1),
        depth
      }));
  };

  const tree = useMemo(() => buildTree(null, 1), [comments, sortBy]);

  // Filter tree to top 3 collapsed if not expanded
  const visibleTree = useMemo(() => {
    if (isExpanded) return tree;
    return tree.slice(0, 3);
  }, [tree, isExpanded]);

  // Formats relative time
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
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      return `${diffDays}d ago`;
    } catch (e) {
      return "Recently";
    }
  };

  // Submit main comment
  const handleSubmitMainComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setErrorMsg("Please sign in with Google to write a comment.");
      return;
    }

    const trimmed = newCommentText.trim();
    if (!trimmed) return;

    if (trimmed.length < MIN_COMMENT_LENGTH) {
      setErrorMsg(`Comment is too short. Minimum ${MIN_COMMENT_LENGTH} characters required.`);
      return;
    }
    if (trimmed.length > MAX_COMMENT_LENGTH) {
      setErrorMsg(`Comment exceeds maximum limit of ${MAX_COMMENT_LENGTH} characters.`);
      return;
    }

    const now = Date.now();
    if (now - lastSubmitTimeRef.current < SUBMIT_COOLDOWN_MS) {
      const waitRemaining = Math.ceil((SUBMIT_COOLDOWN_MS - (now - lastSubmitTimeRef.current)) / 1000);
      setErrorMsg(`You are posting comments too quickly. Please wait ${waitRemaining}s.`);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const commentsRef = collection(db, "comments");

    try {
      await addDoc(commentsRef, {
        proposalId,
        parentId: null,
        content: trimmed,
        authorId: user.uid,
        authorName: user.displayName || "Anonymous Commenter",
        authorEmail: user.email || "anonymous@goBodhi.in",
        upvotes: 0,
        downvotes: 0,
        createdAt: serverTimestamp()
      });
      setNewCommentText("");
      lastSubmitTimeRef.current = Date.now();
    } catch (err) {
      console.error("Submitting comment failed: ", err);
      try {
        handleFirestoreError(err, OperationType.CREATE, "comments");
      } catch (mappedErr: any) {
        setErrorMsg("Failed to post comment. Check authentication status.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit nested reply
  const handleSubmitReply = async (parentId: string) => {
    if (!user) {
      setErrorMsg("Please sign in with Google to write a reply.");
      return;
    }

    const trimmed = replyText.trim();
    if (!trimmed) return;

    if (trimmed.length < MIN_COMMENT_LENGTH) {
      setErrorMsg(`Reply is too short. Minimum ${MIN_COMMENT_LENGTH} characters required.`);
      return;
    }
    if (trimmed.length > MAX_COMMENT_LENGTH) {
      setErrorMsg(`Reply exceeds maximum limit of ${MAX_COMMENT_LENGTH} characters.`);
      return;
    }

    const now = Date.now();
    if (now - lastSubmitTimeRef.current < SUBMIT_COOLDOWN_MS) {
      const waitRemaining = Math.ceil((SUBMIT_COOLDOWN_MS - (now - lastSubmitTimeRef.current)) / 1000);
      setErrorMsg(`You are responding too quickly. Please wait ${waitRemaining}s.`);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const commentsRef = collection(db, "comments");

    try {
      await addDoc(commentsRef, {
        proposalId,
        parentId,
        content: trimmed,
        authorId: user.uid,
        authorName: user.displayName || "Anonymous Commenter",
        authorEmail: user.email || "anonymous@goBodhi.in",
        upvotes: 0,
        downvotes: 0,
        createdAt: serverTimestamp()
      });
      setReplyText("");
      setReplyTargetId(null);
      lastSubmitTimeRef.current = Date.now();

      // Trigger notification for parent comment owner
      const parentComment = comments.find(c => c.id === parentId);
      if (parentComment && parentComment.authorId !== user.uid) {
        let proposalTitle = "Proposal";
        try {
          const { getDoc } = await import("firebase/firestore");
          const propSnap = await getDoc(doc(db, "proposals", proposalId));
          if (propSnap.exists()) {
            proposalTitle = propSnap.data().title || "Proposal";
          }
        } catch (titleErr) {
          console.warn("Could not retrieve proposal title for comment reply notification layout:", titleErr);
        }

        const { triggerCommentReplyNotification } = await import("../utils/notifications");
        await triggerCommentReplyNotification(
          parentComment.authorId,
          user.displayName || "Someone",
          proposalId,
          proposalTitle
        );
      }
    } catch (err) {
      console.error("Submitting reply failed: ", err);
      try {
        handleFirestoreError(err, OperationType.CREATE, "comments");
      } catch (mappedErr: any) {
        setErrorMsg("Failed to post reply.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Transactional voting on comments to prevent double voting
  const handleCommentVote = async (commentId: string, targetVoteType: "up" | "down") => {
    if (!user) {
      setErrorMsg("Please sign in with Google to cast your vote.");
      return;
    }

    const commentRef = doc(db, "comments", commentId);
    const voteRef = doc(db, "comments", commentId, "commentVotes", user.uid);

    try {
      await runTransaction(db, async (transaction) => {
        const commentSnap = await transaction.get(commentRef);
        if (!commentSnap.exists()) {
          throw new Error("Comment deleted.");
        }

        const data = commentSnap.data() as Comment;
        let upvotes = data.upvotes || 0;
        let downvotes = data.downvotes || 0;

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

        if (nextVoteType === null) {
          transaction.delete(voteRef);
        } else {
          transaction.set(voteRef, {
            userId: user.uid,
            voteType: nextVoteType,
            updatedAt: serverTimestamp()
          });
        }

        transaction.update(commentRef, {
          upvotes,
          downvotes
        });
      });
    } catch (err) {
      console.error("Comment vote failed: ", err);
      try {
        handleFirestoreError(err, OperationType.UPDATE, `comments/${commentId}`);
      } catch (mappedErr: any) {
        setErrorMsg("Failed to record comment vote.");
      }
    }
  };

  // Delete comment
  const handleDeleteComment = async (commentId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, "comments", commentId));
    } catch (err) {
      console.error("Deleting comment failed: ", err);
      try {
        handleFirestoreError(err, OperationType.DELETE, `comments/${commentId}`);
      } catch (mappedErr: any) {
        setErrorMsg("Failed to delete comment.");
      }
    }
  };

  // Toggle comment Insightful status
  const handleToggleInsightful = async (commentId: string, currentVal: boolean) => {
    if (!user) return;
    const commentRef = doc(db, "comments", commentId);
    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(commentRef);
        if (!snap.exists()) {
          throw new Error("Comment deleted.");
        }
        transaction.update(commentRef, {
          isInsightful: !currentVal
        });
      });
      // Trigger background recalculation instantly
      fetch("/api/recalculate", { method: "POST" }).catch(() => {});
    } catch (err: any) {
      console.error("Failed to toggle insightful status: ", err);
      try {
        handleFirestoreError(err, OperationType.UPDATE, `comments/${commentId}`);
      } catch (mappedErr: any) {
        setErrorMsg("Failed to change comment insightful classification.");
      }
    }
  };

  // Helper to obtain Initials for styling avatars
  const getInitials = (name: string) => {
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const getAvatarColor = (name: string) => {
    const colors = [
      "bg-emerald-500 text-white",
      "bg-indigo-500 text-white",
      "bg-amber-500 text-white",
      "bg-rose-500 text-white",
      "bg-sky-500 text-white",
      "bg-violet-500 text-white"
    ];
    let sum = 0;
    for (let i = 0; i < name.length; i++) {
      sum += name.charCodeAt(i);
    }
    return colors[sum % colors.length];
  };

  // Recursive component for rendering individual comments
  const CommentNodeRenderer = ({ node }: { node: CommentNode }) => {
    const { comment, replies, depth } = node;
    const hasUpvoted = userCommentVotes[comment.id] === "up";
    const hasDownvoted = userCommentVotes[comment.id] === "down";
    const netVotes = comment.upvotes - comment.downvotes;

    const isReplyingSelf = replyTargetId === comment.id;

    return (
      <div className="flex gap-4 items-start py-3 group">
        {/* Author Avatar */}
        <button
          type="button"
          onClick={() => onViewProfile && onViewProfile(comment.authorId)}
          className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 shadow-xs tracking-wider cursor-pointer hover:scale-105 active:scale-95 transition-all text-left ${getAvatarColor(comment.authorName)}`}
          title={`View ${comment.authorName}'s profile`}
        >
          {getInitials(comment.authorName)}
        </button>

        {/* Content Box */}
        <div className="flex-1 space-y-1.5 overflow-hidden">
          {/* Metadata Row */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <button
               type="button"
               onClick={() => onViewProfile && onViewProfile(comment.authorId)}
               className="font-extrabold text-slate-800 hover:text-indigo-600 hover:underline transition-colors cursor-pointer text-left font-sans"
               title={`View ${comment.authorName}'s profile`}
            >
               {comment.authorName}
            </button>
            {comment.authorIsAgent && (
               <span className="px-1 py-0.2 bg-emerald-50 text-emerald-800 border border-emerald-100 text-[9px] rounded-sm font-bold uppercase tracking-wider scale-95" title="Verified Agent Comment">
                 🤖 Agent
               </span>
            )}
            <span className="w-1 h-1 rounded-full bg-slate-300" />
            <span className="font-mono text-[11px]">{getRelativeTime(comment.createdAt)}</span>
            {comment.authorId === user?.uid && (
              <span className="ml-1 px-1.5 py-0.2 bg-indigo-50 text-indigo-600 font-mono text-[9px] rounded-sm font-bold uppercase tracking-wider">
                You
              </span>
            )}
            {comment.isInsightful && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-500 text-white font-extrabold text-[9px] rounded-sm uppercase tracking-wider shadow-xs animate-pulse">
                🌟 Insightful
              </span>
            )}
          </div>

          {/* Comment Markdown Render */}
          <div className="text-sm font-normal text-slate-700 leading-relaxed font-sans prose prose-slate max-w-full break-words">
            <ReactMarkdown
              components={{
                a: ({ href, children, ...props }) => {
                  const isSafe = href && /^(https?:|mailto:|tel:)/i.test(href);
                  return (
                    <a
                      href={isSafe ? href : "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:underline inline-flex items-center"
                      {...props}
                    >
                      {children}
                    </a>
                  );
                }
              }}
            >
              {DOMPurify.sanitize(comment.content, {
                USE_PROFILES: { html: true },
                ALLOWED_TAGS: [
                  "p", "br", "strong", "em", "b", "i", "code", "pre", "span", "a", "ul", "ol", "li",
                  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "del", "ins"
                ],
                ALLOWED_ATTR: ["href", "title", "target", "rel"]
              })}
            </ReactMarkdown>
          </div>

          {/* Interaction Row */}
          <div className="flex items-center gap-4 text-slate-400 text-xs">
            {/* Net Votes voting interface */}
            <div className="flex items-center gap-1.5 bg-slate-50 rounded-lg p-1 border border-slate-100">
              <button
                onClick={() => handleCommentVote(comment.id, "up")}
                className={`p-1 rounded-sm transition-colors cursor-pointer ${
                  hasUpvoted ? "text-indigo-600 bg-white shadow-xs font-bold" : "hover:text-indigo-600"
                }`}
                title="Upvote comment"
              >
                <ThumbsUp className="w-3.5 h-3.5" />
              </button>
              <span className={`font-black font-sans text-xs px-1 ${
                netVotes > 0 ? "text-slate-800" : netVotes < 0 ? "text-rose-500" : "text-slate-400"
              }`}>
                {netVotes}
              </span>
              <button
                onClick={() => handleCommentVote(comment.id, "down")}
                className={`p-1 rounded-sm transition-colors cursor-pointer ${
                  hasDownvoted ? "text-rose-600 bg-white shadow-xs font-bold" : "hover:text-rose-600"
                }`}
                title="Downvote comment"
              >
                <ThumbsDown className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Nesting Guard: Allow reply ONLY if depth < 3 to prevent extreme collapse grids */}
            {depth < 3 && user && (
              <button
                onClick={() => {
                  setReplyTargetId(isReplyingSelf ? null : comment.id);
                  setReplyText("");
                }}
                className="flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-indigo-600 transition-colors uppercase tracking-wider font-mono cursor-pointer"
              >
                <Reply className="w-3 h-3" />
                Reply
              </button>
            )}

            {/* Author erasure command */}
            {user && comment.authorId === user.uid && (
              <button
                onClick={() => handleDeleteComment(comment.id)}
                className="flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-rose-600 transition-colors uppercase tracking-wider font-mono cursor-pointer"
                title="Delete comment"
              >
                <Trash2 className="w-3 h-3" />
                Erasure
              </button>
            )}

            {/* Insightful action trigger for proposal author */}
            {user && proposalAuthorId === user.uid && (
              <button
                onClick={() => handleToggleInsightful(comment.id, !!comment.isInsightful)}
                className={`flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider font-mono cursor-pointer transition-colors ${
                  comment.isInsightful ? "text-amber-600 hover:text-amber-700" : "text-slate-400 hover:text-amber-600"
                }`}
                title="Toggle Insightful highlight"
              >
                🌟 {comment.isInsightful ? "Unmark" : "Mark Insightful"}
              </button>
            )}
          </div>

          {/* Inline Reply input section */}
          {isReplyingSelf && (
            <div className="mt-3 relative flex gap-2">
              <input
                id={`reply-input-${comment.id}`}
                type="text"
                placeholder={`Replying to ${comment.authorName.split(" ")[0]}...`}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmitReply(comment.id);
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-800 leading-normal font-sans focus:outline-hidden focus:border-indigo-500 focus:bg-white resize-none"
              />
              <button
                onClick={() => handleSubmitReply(comment.id)}
                disabled={isSubmitting || !replyText.trim()}
                className="bg-indigo-600 text-white rounded-xl py-2 px-4 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:bg-slate-200 disabled:text-slate-400"
              >
                <Send className="w-3 h-3" />
                Post
              </button>
            </div>
          )}

          {/* Children Level indentation container */}
          {replies.length > 0 && (
            <div className="border-l-2 border-slate-100 pl-4 space-y-4 mt-3">
              {replies.map((childNode) => (
                <CommentNodeRenderer key={childNode.comment.id} node={childNode} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start mt-4">
      {/* 1. Main comment listing cell - lg:col-span-8 */}
      <div className="lg:col-span-8 space-y-6">
        
        {/* Header & Sort Bar inside comment panel */}
        <div className="bg-white border border-slate-100 shadow-sm rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-indigo-600" />
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider font-sans">
                Community Deliberation ({comments.length})
              </h3>
            </div>

            {/* Sorter selections */}
            <div className="flex items-center gap-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
              <select
                id="comment-sorting"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-transparent border-none text-slate-600 font-sans font-bold cursor-pointer focus:outline-hidden text-xs pr-6"
              >
                <option value="best">Best Comments</option>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>
          </div>

          {/* New comment input block */}
          {user ? (
            <form onSubmit={handleSubmitMainComment} className="flex gap-3">
              <div className="flex-1 relative">
                <input
                  id="main-comment"
                  type="text"
                  placeholder="Share your thoughts... (Markdown supported!)"
                  value={newCommentText}
                  onChange={(e) => setNewCommentText(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-800 leading-normal font-sans focus:outline-hidden focus:border-indigo-500 focus:bg-white resize-none"
                />
              </div>
              <button
                type="submit"
                disabled={isSubmitting || !newCommentText.trim()}
                className="bg-indigo-600 text-white rounded-xl py-3 px-5 text-xs font-black inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:bg-slate-200 disabled:text-slate-400"
              >
                <Send className="w-3.5 h-3.5" />
                Post
              </button>
            </form>
          ) : (
            <div className="text-center p-4 bg-slate-50 rounded-xl border border-dashed border-slate-200">
              <p className="text-xs text-slate-500 font-sans">
                Please <strong className="text-indigo-600">login with Google</strong> above in the header to contribute to this deliberation.
              </p>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 bg-rose-50 text-xs text-rose-600 rounded-xl border border-rose-100 flex items-center gap-2">
              <Info className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Standard tree comments listing */}
          {loadingComments ? (
            <div className="space-y-4 py-4 animate-pulse">
              {[1, 2].map((n) => (
                <div key={n} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-slate-100"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-slate-100 rounded w-1/4"></div>
                    <div className="h-3 bg-slate-100 rounded w-5/6"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : comments.length > 0 ? (
            <div className="divide-y divide-slate-100 space-y-1">
              {visibleTree.map((node) => (
                <CommentNodeRenderer key={node.comment.id} node={node} />
              ))}
            </div>
          ) : (
            <div className="text-center py-10 space-y-2 text-slate-400">
              <MessageSquare className="w-8 h-8 mx-auto stroke-1 text-slate-300" />
              <p className="text-xs font-sans">No points raised yet. Start the deliberation!</p>
            </div>
          )}

          {/* Collapsible status controls */}
          {tree.length > 3 && (
            <div className="flex justify-center border-t border-slate-100 pt-4 mt-2">
              <button
                id="comment-collapse-toggle"
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-1.5 text-xs font-black text-indigo-600 hover:text-indigo-800 transition-colors uppercase tracking-wider font-mono cursor-pointer bg-indigo-50/50 hover:bg-indigo-50 py-2 px-4 rounded-xl shadow-xs"
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="w-4 h-4" />
                    Collapse Threads
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    View All {tree.length} Discussions
                  </>
                )}
              </button>
            </div>
          )}

        </div>

      </div>

      {/* 2. Side Panel cell: Deliberation Score & Top Contributors - lg:col-span-4 */}
      <div className="lg:col-span-4 space-y-6">
        
        {/* Deliberation Score Bento Card */}
        <div className="bg-white border border-slate-100 shadow-sm rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Flame className="w-5 h-5 text-orange-500 fill-orange-500 animate-pulse" />
            <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider font-sans">Deliberation Score</h4>
          </div>
          
          <div className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black text-slate-800 tracking-tight">
                {deliberationMetrics.score}
              </span>
              <span className="text-xs text-slate-400 font-mono font-bold uppercase">Points</span>
            </div>

            <span className="inline-block px-2.5 py-0.5 bg-orange-50 text-orange-600 border border-orange-100 text-[10px] font-bold uppercase rounded-md tracking-wider">
              {deliberationMetrics.textBadge}
            </span>

            <div className="space-y-1.5 bg-slate-50 rounded-xl p-3 text-[11px] text-slate-500 leading-normal font-sans border border-slate-100">
              <p className="font-semibold text-slate-600">Metric Breakdown:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Total Comments: <strong className="text-slate-700 font-bold">{comments.length}</strong></li>
                <li>Average Comment Value: <strong className="text-slate-700 font-bold">+{deliberationMetrics.avgQuality}</strong></li>
                <li>Formula: <code className="bg-slate-200 px-1 py-0.2 rounded font-mono text-[10px] text-slate-700">(count × quality) ÷ hours_active</code></li>
              </ul>
              <p className="mt-1 text-[10px] text-slate-400 italic">Surfaces proposals undergoing real construction, not just idle click-activism.</p>
            </div>
          </div>
        </div>

        {/* Top Contributors Sidebar Panel */}
        <div className="bg-white border border-slate-100 shadow-sm rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Award className="w-5 h-5 text-indigo-600" />
            <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider font-sans">Top Contributors</h4>
          </div>

          {topContributors.length > 0 ? (
            <div className="space-y-4">
              {topContributors.map((contributor, idx) => (
                <div key={contributor.id} className="flex items-center justify-between gap-3 group">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative shrink-0">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shadow-xs tracking-wider ${getAvatarColor(contributor.name)}`}>
                        {getInitials(contributor.name)}
                      </div>
                      {idx === 0 && (
                        <div className="absolute -top-1 -right-1 bg-amber-400 text-white rounded-full p-0.5" title="Deliberation Lead">
                          <Sparkles className="w-2.5 h-2.5 fill-white" />
                        </div>
                      )}
                    </div>
                    
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-slate-800 truncate leading-relaxed group-hover:text-indigo-600 transition-colors">
                        {contributor.name}
                      </p>
                      <p className="text-[10px] text-slate-400 font-mono tracking-tight leading-none">
                        {contributor.commentsCount} {contributor.commentsCount === 1 ? "comment" : "comments"}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="inline-block px-2 py-0.5 bg-indigo-50 text-indigo-600 text-[10px] font-black rounded-lg border border-indigo-150 font-mono leading-none shadow-3xs" title="Contribution Score">
                      +{contributor.score}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-slate-400">
              <p className="text-xs font-sans">Waiting for contributions...</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

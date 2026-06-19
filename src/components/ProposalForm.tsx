import React, { useState, useEffect } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { auth, db, handleFirestoreError, OperationType } from "../firebase";
import { UserSession } from "../types";
import { Loader2, Info, Lightbulb, AlertCircle, LogIn } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface ProposalFormProps {
  user: UserSession | null;
  onSuccess?: () => void;
  prefilledTag?: string | null;
  prefilledCategory?: string | null;
  onClearPrefills?: () => void;
}

export default function ProposalForm({ 
  user, 
  onSuccess,
  prefilledTag = null,
  prefilledCategory = null,
  onClearPrefills
}: ProposalFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [category, setCategory] = useState<"Governance" | "Technical" | "Community" | "Treasury" | "Events" | "Meta">("Governance");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [durationDays, setDurationDays] = useState<number>(7);

  // Sync prefilled states
  useEffect(() => {
    if (prefilledTag) {
      setTags((prev) => {
        if (prev.includes(prefilledTag)) return prev;
        return [...prev, prefilledTag];
      });
    }
    if (prefilledCategory && prefilledCategory !== "All") {
      setCategory(prefilledCategory as any);
    }
  }, [prefilledTag, prefilledCategory]);

  const handleSignIn = async () => {
    setAuthError(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Sign-in from form failed: ", error);
      setAuthError(error.message || "Failed to sign in with Google.");
    }
  };

  const handleSubmit = async (e: React.FormEvent, forceDraft: boolean = false) => {
    e.preventDefault();
    if (!user) {
      setErrorMsg("You must be signed in to submit proposals.");
      return;
    }
    
    const trimmedTitle = title.trim();
    const trimmedDesc = description.trim();

    if (trimmedTitle.length < 3 || trimmedTitle.length > 100) {
      setErrorMsg("Title must be between 3 and 100 characters.");
      return;
    }

    if (trimmedDesc.length < 10 || trimmedDesc.length > 1000) {
      setErrorMsg("Description must be between 10 and 1000 characters.");
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    const secureRandomId = () => {
      const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      let result = "";
      for (let i = 0; i < 12; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return `prop-${Date.now()}-${result}`;
    };

    const proposalId = secureRandomId();
    const proposalPath = `proposals/${proposalId}`;

    try {
      const proposalData: any = {
        title: trimmedTitle,
        description: trimmedDesc,
        authorId: user.uid,
        authorName: user.displayName || "Anonymous Member",
        authorEmail: user.email || "anonymous@community-voting.com",
        upvotesCount: 0,
        downvotesCount: 0,
        netVotes: 0,
        category: category,
        tags: tags,
        priorityScore: 0,
        status: forceDraft ? "draft" : "active",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        durationDays: durationDays,
      };

      if (!forceDraft) {
        proposalData.expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
      }

      await setDoc(doc(db, "proposals", proposalId), proposalData);
      
      // Reset
      setTitle("");
      setDescription("");
      setCategory("Governance");
      setTags([]);
      setTagInput("");
      setDurationDays(7);
      setSuccessMsg(true);
      setTimeout(() => setSuccessMsg(false), 4500);
      
      if (onClearPrefills) {
        onClearPrefills();
      }
      
      if (onSuccess) {
        onSuccess();
      }
    } catch (error: any) {
      console.error("Firestore submission failed: ", error);
      try {
        handleFirestoreError(error, OperationType.CREATE, proposalPath);
      } catch (mappedError: any) {
        setErrorMsg(`Failed submission security checks: ${mappedError.message}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 flex flex-col shadow-sm relative overflow-hidden min-h-[460px]">
      {prefilledTag && (
        <div className="mb-4 p-3 bg-amber-50/70 border border-amber-200 rounded-2xl flex items-center justify-between gap-2 shadow-2xs">
          <div className="flex items-center gap-1.5 font-sans">
            <span className="text-sm animate-bounce">🎯</span>
            <span className="text-[10px] font-extrabold text-amber-800 uppercase tracking-tight">
              Challenge Entry: #{prefilledTag}
            </span>
          </div>
          <button
            type="button"
            onClick={onClearPrefills}
            className="text-[9.5px] font-mono font-bold text-rose-500 hover:text-rose-700 bg-white border border-rose-100 hover:border-rose-250 rounded-lg px-2 py-0.5 cursor-pointer shadow-3xs"
          >
            Exit Entry
          </button>
        </div>
      )}

      <div className="mb-6">
        <h2 className="text-lg font-sans font-extrabold text-slate-800 flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-indigo-600 shrink-0" />
          New Proposal
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Have an idea or a suggestion for our group? Submit it for a transparent vote.
        </p>
      </div>

      <div className="flex-1 min-h-0 relative">
        {/* If user is logged out, show a beautiful, interactive Bento blur action block */}
        {!user && (
          <div className="absolute inset-0 bg-white/70 backdrop-blur-xs rounded-2xl flex flex-col items-center justify-center text-center p-6 z-10">
            <div className="bg-indigo-50 border border-indigo-100 p-3 rounded-2xl text-indigo-700 mb-4">
              <LogIn className="w-6 h-6 animate-bounce" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">Submit Proposal</h3>
            <p className="text-[11px] text-slate-500 max-w-[220px] mt-1 mb-5">
              You must be a signed-in member of goBodhi to post new community items.
            </p>
            <button
              id="btn-form-signin"
              onClick={handleSignIn}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-2.5 px-5 rounded-xl shadow-md shadow-indigo-500/10 transition-colors cursor-pointer"
            >
              Sign In with Google
            </button>
            {authError && (
              <p className="text-[10px] text-rose-500 font-mono mt-2">{authError}</p>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col h-full gap-5">
          {/* Title input */}
          <div className="space-y-1.5">
            <label htmlFor="title" className="block text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">
              Title
            </label>
            <input
              id="title"
              name="title"
              type="text"
              required
              disabled={!user}
              placeholder="e.g., Weekly Farmers Market Extension"
              maxLength={100}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-indigo-500 focus:bg-white transition-all font-sans"
            />
            <div className="flex justify-between text-[10px] text-slate-400 font-mono px-0.5">
              <span>Descriptive suggestion name</span>
              <span>{title.length}/100</span>
            </div>
          </div>

          {/* Details input */}
          <div className="space-y-1.5 flex-1 min-h-[140px] flex flex-col">
            <label htmlFor="description" className="block text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">
              Details & Reasoning
            </label>
            <textarea
              id="description"
              name="description"
              required
              disabled={!user}
              placeholder="Describe your proposal in detail so other members understand your perspective..."
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full flex-1 min-h-[120px] px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-indigo-500 focus:bg-white transition-all font-sans resize-none"
            />
            <div className="flex justify-between text-[10px] text-slate-400 font-mono px-0.5">
              <span>Min. 10 chars required</span>
              <span>{description.length}/1000</span>
            </div>
          </div>

          {/* Category input */}
          <div className="space-y-1.5">
            <label htmlFor="category" className="block text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">
              Category
            </label>
            <div className="relative">
              <select
                id="category"
                name="category"
                required
                disabled={!user}
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-sans focus:outline-hidden focus:border-indigo-500 focus:bg-white transition-all appearance-none cursor-pointer font-semibold"
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

          {/* Voting Duration input */}
          <div className="space-y-1.5">
            <label htmlFor="durationDays" className="block text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">
              Voting Duration (for Active Proposals)
            </label>
            <div className="relative">
              <select
                id="durationDays"
                name="durationDays"
                required
                disabled={!user}
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-sans focus:outline-hidden focus:border-indigo-500 focus:bg-white transition-all appearance-none cursor-pointer font-semibold"
              >
                <option value={1}>1 Day (Express Check)</option>
                <option value={3}>3 Days (Fast-Track)</option>
                <option value={7}>7 Days (1 Week - Recommended)</option>
                <option value={14}>14 Days (2 Weeks)</option>
                <option value={30}>30 Days (1 Month)</option>
              </select>
              <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-[10px] select-none">
                ▼
              </div>
            </div>
          </div>

          {/* Tags input */}
          <div className="space-y-1.5">
            <label htmlFor="tag-input" className="block text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">
              Tags (Optional)
            </label>
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  id="tag-input"
                  type="text"
                  disabled={!user}
                  placeholder="Type a tag and press Add or Enter/Comma"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      const val = tagInput.trim().replace(/,/g, "");
                      if (val && !tags.includes(val) && val.length > 0 && val.length < 25) {
                        if (tags.length < 10) {
                          setTags([...tags, val]);
                          setTagInput("");
                        } else {
                          setErrorMsg("Maximum of 10 tags allowed.");
                        }
                      }
                    }
                  }}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-indigo-500 focus:bg-white transition-all font-sans"
                />
                <button
                  id="add-tag-btn"
                  type="button"
                  disabled={!user}
                  onClick={() => {
                    const val = tagInput.trim();
                    if (val && !tags.includes(val) && val.length > 0 && val.length < 25) {
                      if (tags.length < 10) {
                        setTags([...tags, val]);
                        setTagInput("");
                      } else {
                        setErrorMsg("Maximum of 10 tags allowed.");
                      }
                    }
                  }}
                  className="px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-xl transition-all cursor-pointer border border-indigo-100"
                >
                  Add
                </button>
              </div>

              {/* Removable Active tag badges */}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 p-2.5 bg-slate-50 border border-slate-200/50 rounded-xl">
                  {tags.map((tg) => (
                    <span key={tg} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-100 px-2.5 py-0.5 rounded-lg text-[10px] font-bold font-sans">
                      #{tg}
                      <button
                        type="button"
                        onClick={() => setTags(tags.filter((t) => t !== tg))}
                        className="hover:text-indigo-900 font-black text-rose-500 hover:bg-rose-50 rounded-xs px-0.5 ml-1 select-none text-[9px] cursor-pointer"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Quick Suggestion Tags list */}
              <div className="flex flex-wrap gap-1 items-center pt-0.5">
                <span className="text-[9px] font-mono font-bold text-slate-400 mr-1.5 uppercase">Suggestions:</span>
                {["Safety", "Elections", "Design", "Budget", "Software", "Gardening", "Social", "Policy", "Infrastructure"].map((sg) => {
                  const isSelected = tags.includes(sg);
                  if (isSelected) return null;
                  return (
                    <button
                      key={sg}
                      type="button"
                      disabled={!user}
                      onClick={() => {
                        if (tags.length < 10) {
                          setTags([...tags, sg]);
                        } else {
                          setErrorMsg("Maximum of 10 tags allowed.");
                        }
                      }}
                      className="text-[9px] font-semibold px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md transition-colors cursor-pointer"
                    >
                      +{sg}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Secure Guideline card */}
          <div className="p-4 bg-indigo-50 rounded-2xl flex items-start gap-3 border border-indigo-100/40">
            <div className="p-1 bg-indigo-200 rounded-full text-indigo-800 shrink-0 mt-0.5">
              <Info className="w-3.5 h-3.5" />
            </div>
            <p className="text-[11px] text-indigo-700 leading-relaxed font-sans">
              Proposals are logged transparently with profile data. They remain active for prioritization instantly.
            </p>
          </div>

          {/* Errors, messages, and action buttons */}
          <div className="space-y-3">
            {errorMsg && (
              <div className="text-xs text-rose-500 font-sans flex items-center gap-1.5 bg-rose-50 p-2.5 rounded-xl border border-rose-100">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                id="save-draft-btn"
                type="button"
                disabled={submitting || !user}
                onClick={(e) => handleSubmit(e, true)}
                className="w-full bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-semibold py-3.5 rounded-2xl text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                Save as Draft
              </button>
              <button
                id="submit-proposal"
                type="submit"
                disabled={submitting || !user}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:text-slate-400 text-white font-bold py-3.5 rounded-2xl text-xs shadow-md shadow-indigo-500/10 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Publish Active"}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Success notification banner popup */}
      <AnimatePresence>
        {successMsg && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="absolute bottom-4 left-4 right-4 p-4 bg-emerald-500 text-white rounded-2xl flex items-center gap-3 shadow-lg z-20"
          >
            <div className="bg-white text-emerald-600 rounded-full p-1 shrink-0">
              <Lightbulb className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold font-sans">Proposal Created!</p>
              <p className="text-[10px] text-emerald-100 mt-0.5">Your idea is live for prioritization.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

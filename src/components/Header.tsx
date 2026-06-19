import React, { useState, useEffect } from "react";
import { 
  signInWithCustomToken, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  GoogleAuthProvider,
  signInWithPopup
} from "firebase/auth";
import { auth, db } from "../firebase";
import { UserSession, User } from "../types";
import { 
  LogIn, 
  LogOut, 
  CheckCircle, 
  Vote as VoteIcon, 
  Mail, 
  Key, 
  Eye, 
  EyeOff, 
  HelpCircle, 
  Info, 
  ChevronDown, 
  ChevronUp, 
  X,
  Loader2,
  Lock,
  Bell,
  Settings,
  Check
} from "lucide-react";

interface HeaderProps {
  user: UserSession | null;
  loading: boolean;
  userProfile?: User | null;
}

export default function Header({ user, loading, userProfile }: HeaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [email, setEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  
  const [step, setStep] = useState<"idle" | "verifying" | "syncing" | "success">("idle");
  const [authError, setAuthError] = useState<string | null>(null);

  // Real-time notifications state
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  
  // Preference States
  const [showPreferencesModal, setShowPreferencesModal] = useState(false);
  const [emailDigest, setEmailDigest] = useState<"none" | "daily" | "weekly">("none");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [prefSaveSuccess, setPrefSaveSuccess] = useState(false);

  useEffect(() => {
    if (userProfile) {
      setEmailDigest(userProfile.emailDigest || "none");
      setWebhookUrl(userProfile.webhookUrl || "");
    }
  }, [userProfile]);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }
    const loadNotifications = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const { collection, query, where, orderBy, getDocs } = await import("firebase/firestore");
        const q = query(
          collection(db, "notifications"), 
          where("userId", "==", user.uid), 
          orderBy("createdAt", "desc")
        );
        const snapshot = await getDocs(q);
        const list: any[] = [];
        snapshot.forEach((docSnap) => {
          list.push({
            id: docSnap.id,
            ...docSnap.data()
          });
        });
        setNotifications(list);
      } catch (err) {
        console.error("Failed polling notifications: ", err);
      }
    };

    // Initial load
    loadNotifications();

    // Poll every 60 seconds
    const interval = setInterval(() => {
      loadNotifications();
    }, 60000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadNotifications();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [user]);

  const handleMarkAsRead = async (notifId: string) => {
    try {
      const { doc: fsDoc, updateDoc } = await import("firebase/firestore");
      await updateDoc(fsDoc(db, "notifications", notifId), {
        read: true
      });
      setNotifications((prev) => 
        prev.map((n) => n.id === notifId ? { ...n, read: true } : n)
      );
    } catch (err) {
      console.error("Failed marking read:", err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const { doc: fsDoc, updateDoc } = await import("firebase/firestore");
      const unreadNotifs = notifications.filter(n => !n.read);
      for (const n of unreadNotifs) {
        await updateDoc(fsDoc(db, "notifications", n.id), {
          read: true
        });
      }
      setNotifications((prev) => 
        prev.map((n) => ({ ...n, read: true }))
      );
    } catch (err) {
      console.error("Failed marking all read:", err);
    }
  };

  const handleNotifClick = (notif: any) => {
    handleMarkAsRead(notif.id);
    if (notif.proposalId) {
      window.history.pushState({}, "", `/proposal/${notif.proposalId}`);
      window.dispatchEvent(new Event("popstate"));
      setShowNotifications(false);
    }
  };

  const handleOpenModal = () => {
    setShowModal(true);
    setStep("idle");
    setAuthError(null);
  };

  const handleCloseModal = () => {
    if (step === "verifying" || step === "syncing") return; // block close during active state transition
    setShowModal(false);
    setEmail("");
    setAppPassword("");
    setStep("idle");
    setAuthError(null);
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setStep("verifying");
    
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: "select_account"
      });
      const result = await signInWithPopup(auth, provider);
      if (result.user?.email) {
        setEmail(result.user.email);
      }
      setStep("success");
      setTimeout(() => {
        setShowModal(false);
        setStep("idle");
        setEmail("");
      }, 1200);
    } catch (err: any) {
      console.error("Google sign-in failed: ", err);
      if (err.code === "auth/popup-closed-by-user") {
        setAuthError("Google Sign-In popup was closed before completing.");
      } else {
        setAuthError(err.message || "Failed to authenticate with Google.");
      }
      setStep("idle");
    }
  };

  const handleGmailSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !appPassword) return;

    setAuthError(null);
    setStep("verifying");

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = appPassword.trim().replace(/\s+/g, "");

    try {
      // 1. Verify credentials via Express Backend SMTP proxy
      const response = await fetch("/api/auth/verify-gmail", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: cleanEmail, appPassword: cleanPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "SMTP Verification check failed.");
      }

      setStep("syncing");

      // 2. Synchronize with Firebase authentication using custom state or fallback config
      if (data.customToken) {
        await signInWithCustomToken(auth, data.customToken);
      } else if (data.fallback) {
        // Fallback standard Firebase authentication if Admin SDK token minting was bypassed.
        // Since the backend force synchronizes the Firebase user password on each successful SMTP,
        // this is guaranteed to match and succeed perfectly.
        try {
          await signInWithEmailAndPassword(auth, cleanEmail, cleanPassword);
        } catch (firebaseErr: any) {
          if (firebaseErr.code === "auth/user-not-found") {
            // First time registration inside fallback database config
            await createUserWithEmailAndPassword(auth, cleanEmail, cleanPassword);
          } else {
            throw firebaseErr;
          }
        }
      }

      setStep("success");
      // Delayed release to let user enjoy the success state!
      setTimeout(() => {
        setShowModal(false);
        setEmail("");
        setAppPassword("");
        setStep("idle");
      }, 1000);

    } catch (err: any) {
      console.error("Sign-in process failed: ", err);
      setAuthError(err.message || "An unexpected error occurred during sign-in.");
      setStep("idle");
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Sign-out error: ", error);
    }
  };

  return (
    <header className="bg-white border-b border-slate-200 py-5 px-6 sm:px-12 sticky top-0 z-50 shadow-sm">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        
        {/* Brand Logo and Title */}
        <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
          <div className="flex items-center gap-4">
            <div 
              onClick={() => {
                window.history.pushState({}, "", "/");
                window.dispatchEvent(new Event("popstate"));
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white p-2.5 rounded-xl shadow-md shadow-indigo-500/10 transition-colors cursor-pointer"
            >
              <VoteIcon id="logo-icon" className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h1 className="text-xl font-sans font-extrabold tracking-tight text-slate-800 flex items-center gap-2">
                goBodhi Vote
                <span className="text-xs font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                  Agent Terminal
                </span>
              </h1>
              <p className="text-xs font-mono text-slate-500 mt-0.5">
                Transparent Community Recommendation & Idea Prioritization
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3.5 pl-0 md:pl-5 border-l-0 md:border-l border-slate-200">
            <button 
              onClick={() => {
                window.history.pushState({}, "", "/");
                window.dispatchEvent(new Event("popstate"));
              }}
              className="text-xs font-extrabold text-slate-500 hover:text-indigo-600 cursor-pointer uppercase tracking-wider font-mono"
            >
              💡 Ballot
            </button>
            <button 
              onClick={() => {
                window.history.pushState({}, "", "/challenges");
                window.dispatchEvent(new Event("popstate"));
              }}
              className="text-xs font-extrabold text-slate-500 hover:text-indigo-600 cursor-pointer uppercase tracking-wider font-mono flex items-center gap-1 pl-3.5 border-l border-slate-200"
            >
              ⚔️ Challenges
            </button>
            <button 
              onClick={() => {
                window.history.pushState({}, "", "/leaderboard");
                window.dispatchEvent(new Event("popstate"));
              }}
              className="text-xs font-extrabold text-slate-500 hover:text-indigo-600 cursor-pointer uppercase tracking-wider font-mono flex items-center gap-1 pl-3.5 border-l border-slate-200"
            >
              🏆 Leaderboard
            </button>
          </div>
        </div>

        {/* User Session and Auth Actions */}
        <div className="flex items-center gap-3">
          {loading ? (
            <div className="h-10 w-32 bg-slate-100 animate-pulse rounded-full"></div>
          ) : user ? (
            <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-2xl pl-3.5 pr-1.5 py-1">
              <div className="flex flex-col text-right hidden xs:flex">
                <span className="text-xs font-sans font-extrabold text-slate-800 flex items-center justify-end gap-1.5">
                  {user.displayName || "Community Member"}
                  {userProfile && (
                    <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-150 px-1.5 py-0.2 rounded-sm" title="Reputation Score">
                      ✨ {userProfile.reputation}
                    </span>
                  )}
                  {user.emailVerified && (
                    <span title="Verified Member">
                      <CheckCircle className="w-3.5 h-3.5 text-indigo-600 fill-indigo-50" />
                    </span>
                  )}
                </span>
                {userProfile && userProfile.badges && userProfile.badges.length > 0 && (
                  <div className="flex items-center justify-end gap-1 mt-0.5" title={`Badges: ${userProfile.badges.join(', ')}`}>
                    {userProfile.badges.map((badge: string) => {
                      const badgeEmojis: Record<string, string> = {
                        "Founding Member": "🌱",
                        "Proposer": "💡",
                        "Consensus Builder": "🤝",
                        "Thought Leader": "👑",
                        "Whale Watcher": "🐳",
                        "Devoted": "🔥",
                        "🏆 Challenge Champion": "🏆"
                      };
                      return (
                        <span key={badge} className="text-[13px] cursor-help" title={badge}>
                          {badgeEmojis[badge] || "🏅"}
                        </span>
                      );
                    })}
                    {userProfile.streak > 0 && (
                      <span className="text-[10px] text-orange-600 font-mono font-bold flex items-center gap-0.5 ml-1" title={`${userProfile.streak}-day voting streak!`}>
                        🔥 {userProfile.streak}d
                      </span>
                    )}
                  </div>
                )}
                {!userProfile && (
                  <span className="text-[10px] font-mono text-slate-400">
                    {user.email}
                  </span>
                )}
              </div>
              
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || "Avatar"}
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full object-cover border border-indigo-500"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm">
                  {(user.displayName || "U").charAt(0).toUpperCase()}
                </div>
              )}

              <button
                id="btn-signout"
                onClick={handleSignOut}
                className="bg-transparent hover:bg-slate-200 text-slate-500 hover:text-slate-800 p-2 rounded-full transition-colors duration-150 cursor-pointer"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>

              {/* Notifications bell dropdown button */}
              <div className="relative">
                <button
                  type="button"
                  id="notifications-bell"
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-full cursor-pointer relative transition-all"
                  title="Notifications panel"
                >
                  <Bell className="w-4 h-4" />
                  {notifications.some(n => !n.read) && (
                    <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full border-2 border-white animate-pulse" />
                  )}
                </button>

                {showNotifications && (
                  <div className="absolute right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl w-72 sm:w-80 py-4.5 px-3.5 space-y-3 z-50 animate-slide-up origin-top-right">
                    <div className="flex items-center justify-between pb-2.5 border-b border-slate-100 font-mono">
                      <span className="text-xs font-black text-slate-800 uppercase tracking-wider">
                        Inbox ({notifications.filter(n => !n.read).length})
                      </span>
                      <div className="flex items-center gap-2">
                        {notifications.some(n => !n.read) && (
                          <button
                            onClick={handleMarkAllAsRead}
                            className="text-[10px] text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer"
                          >
                            Clear unread
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setShowPreferencesModal(true);
                            setShowNotifications(false);
                          }}
                          className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 rounded-md transition-all cursor-pointer"
                          title="Notification Settings"
                        >
                          <Settings className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="max-h-[240px] overflow-y-auto space-y-2">
                      {notifications.length === 0 ? (
                        <div className="py-8 text-center text-[11px] font-sans text-slate-400 italic">
                          No recent notifications.
                        </div>
                      ) : (
                        notifications.map((notif) => (
                          <div 
                            key={notif.id}
                            onClick={() => handleNotifClick(notif)}
                            className={`p-2.5 rounded-xl border transition-all cursor-pointer text-left flex flex-col gap-1 ${
                              notif.read 
                                ? "bg-white border-slate-100 hover:bg-slate-50 hover:border-slate-200" 
                                : "bg-indigo-50/45 border-indigo-100/50 hover:bg-indigo-50/70"
                            }`}
                          >
                            <div className="flex items-start justify-between">
                              <span className={`text-[11px] font-extrabold font-sans leading-tight ${notif.read ? "text-slate-700" : "text-slate-900"}`}>
                                {notif.title || "Status Updated"}
                              </span>
                              {!notif.read && (
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 shrink-0 mt-1" />
                              )}
                            </div>
                            <p className="text-[10.5px] text-slate-550 leading-relaxed font-sans font-medium">
                              {notif.message || notif.body || "A proposal status was updated."}
                            </p>
                            {notif.createdAt && (
                              <span className="text-[9px] text-slate-400 font-mono self-end">
                                {new Date(notif.createdAt.toDate ? notif.createdAt.toDate() : notif.createdAt).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit"
                                })}
                              </span>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <button
              id="btn-signin"
              onClick={handleOpenModal}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-sans font-semibold tracking-tight px-5 py-2.5 rounded-xl shadow-sm hover:shadow transition-all duration-150 cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              Sign In with Gmail
            </button>
          )}
        </div>
      </div>

      {/* Sleek Modal Backdrop with Glass Blur */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
          <div 
            id="auth-modal"
            className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6 relative flex flex-col gap-5 animate-slide-up"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">Secure Gmail Login</h3>
                  <p className="text-[10px] text-slate-400 font-mono">Standard Google Account or Agent Passcode</p>
                </div>
              </div>
              <button 
                onClick={handleCloseModal}
                disabled={step === "verifying" || step === "syncing"}
                className="p-1 px-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Error Notification */}
            {authError && (
              <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-xl p-3.5 flex gap-2.5 items-start">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p className="text-xs font-sans leading-relaxed">{authError}</p>
              </div>
            )}

            {/* Verification State Overlay */}
            {(step === "verifying" || step === "syncing" || step === "success") ? (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-5">
                {step !== "success" ? (
                  <div className="p-4 bg-indigo-50 text-indigo-600 rounded-full border border-indigo-100 animate-spin">
                    <Loader2 className="w-8 h-8" />
                  </div>
                ) : (
                  <div className="p-4 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100">
                    <CheckCircle className="w-8 h-8 fill-emerald-50" />
                  </div>
                )}

                <div className="space-y-1.5">
                  <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
                    {step === "verifying" && (appPassword ? "Verifying SMTP connection..." : "Connecting to Google Accounts...")}
                    {step === "syncing" && "Synthesizing Security Claims..."}
                    {step === "success" && "Access Granted!"}
                  </h4>
                  <p className="text-xs text-slate-500 max-w-xs font-sans leading-relaxed">
                    {step === "verifying" && (appPassword ? "Attempting to create secure SMTP handshake with smtp.gmail.com to certify ownership." : "Signing in via standard secure Google OAuth popup.")}
                    {step === "syncing" && "Generating cryptographic auth token state on Cloud databases."}
                    {step === "success" && (email ? `Successfully signed into terminal as ${email}!` : "Successfully signed into terminal!")}
                  </p>
                </div>
              </div>
            ) : (
              /* Idle Sign in Options */
              <div className="flex flex-col gap-4">
                {/* 1. Conventional Human Google Login */}
                <button
                  type="button"
                  id="btn-google-signin"
                  onClick={handleGoogleSignIn}
                  className="w-full bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 text-xs font-sans font-extrabold tracking-wide py-3.5 px-4 rounded-xl shadow-xs hover:shadow-sm active:scale-98 transition-all duration-150 cursor-pointer flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
                  </svg>
                  Conventional Human Login (Google)
                </button>

                {/* Divider */}
                <div className="relative my-1 text-center">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-slate-100"></div>
                  </div>
                  <div className="relative flex justify-center text-[10px] font-mono uppercase">
                    <span className="bg-white px-3 text-slate-400">or use Agent Passcode</span>
                  </div>
                </div>

                {/* 2. Agent SMTP Passcode Form */}
                <form onSubmit={handleGmailSignInSubmit} className="flex flex-col gap-4">
                {/* Gmail Field */}
                <div className="space-y-1.5">
                  <label htmlFor="gmail-id" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono flex items-center justify-between">
                    Gmail Address
                    <span className="text-[9px] text-indigo-500 font-mono normal-case">Must end with @gmail.com</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      id="gmail-id"
                      type="email"
                      required
                      placeholder="username@gmail.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3.5 py-3 text-xs text-slate-800 placeholder-slate-400 font-sans focus:outline-hidden focus:border-indigo-500 focus:bg-white transition-all shadow-xs"
                    />
                  </div>
                </div>

                {/* Google App Password Field */}
                <div className="space-y-1.5">
                  <label htmlFor="app-password" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono flex items-center justify-between">
                    Google App Password
                    <button 
                      type="button"
                      onClick={() => setShowGuide(!showGuide)}
                      className="text-[9px] text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-sans cursor-pointer lowercase"
                    >
                      <HelpCircle className="w-3 h-3" />
                      What is this?
                    </button>
                  </label>
                  <div className="relative">
                    <Key className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      id="app-password"
                      type={showPassword ? "text" : "password"}
                      required
                      placeholder="16-character code (e.g. abcd efgh ijkl mnop)"
                      value={appPassword}
                      onChange={(e) => setAppPassword(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-10 py-3 text-xs text-slate-800 placeholder-slate-400 font-sans tracking-wide focus:outline-hidden focus:border-indigo-500 focus:bg-white transition-all shadow-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="w-8 h-8 rounded-lg absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Guide Accordion */}
                <div className="mt-1">
                  <button
                    type="button"
                    onClick={() => setShowGuide(!showGuide)}
                    className="w-full text-left bg-slate-50 border border-slate-100 rounded-xl p-3 flex items-center justify-between hover:bg-indigo-50/40 hover:border-indigo-100 transition-all cursor-pointer"
                  >
                    <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5 text-indigo-500" />
                      How to generate a Google App Password?
                    </span>
                    {showGuide ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                  </button>

                  {showGuide && (
                    <div className="bg-slate-50/50 border border-t-0 border-slate-100 rounded-b-xl px-4 py-3.5 text-[11px] text-slate-650 leading-relaxed space-y-2 max-h-48 overflow-y-auto animate-expand">
                      <p>For security, Google requires an <strong>App Password</strong> rather than your primary account password:</p>
                      <ol className="list-decimal list-inside space-y-1.5">
                        <li>Visit your <a href="https://myaccount.google.com/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">Google Account Dashboard</a>.</li>
                        <li>Navigate to the <strong>Security</strong> panel on the left.</li>
                        <li>Under <em>"How you sign in to Google"</em>, ensure <strong>2-Step Verification</strong> is enabled.</li>
                        <li>Click on <strong>2-Step Verification</strong>, scroll down to the bottom and select <strong>App passwords</strong>.</li>
                        <li>Enter a name (e.g. <code>goBodhi Vote</code>) and click <strong>Create</strong>.</li>
                        <li>Copy the <strong>16-character passcode</strong> within the yellow box. Enter it here!</li>
                      </ol>
                    </div>
                  )}
                </div>

                {/* Submit button */}
                <button
                  type="submit"
                  className="w-full bg-slate-900 hover:bg-indigo-600 text-white text-xs font-sans font-extrabold tracking-wider py-3.5 rounded-xl shadow-md hover:shadow-indigo-500/20 active:scale-98 transition-all duration-150 cursor-pointer flex items-center justify-center gap-1.5 mt-2 uppercase"
                >
                  <LogIn className="w-4 h-4" />
                  Certify & Authenticate
                </button>
              </form>
            </div>
          )}

            {/* Footer warning */}
            <div className="text-[10px] text-slate-400 font-mono text-center pt-2 border-t border-slate-100">
              Credentials are tested directly against Google servers. Your passwords are never saved.
            </div>
          </div>
        </div>
      )}

      {/* Sleek Preferences Modal */}
      {showPreferencesModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
          <div 
            id="preferences-modal"
            className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-md w-full p-6 relative flex flex-col gap-5 animate-slide-up"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                  <Settings className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">Notification Settings</h3>
                  <p className="text-[10px] text-slate-400 font-mono">Customize your delivery and webhooks</p>
                </div>
              </div>
              <button 
                onClick={() => setShowPreferencesModal(false)}
                className="p-1 px-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form 
              onSubmit={async (e) => {
                e.preventDefault();
                if (!user) return;
                setSavingPreferences(true);
                setPrefSaveSuccess(false);
                try {
                  const { doc: fsDoc, updateDoc } = await import("firebase/firestore");
                  await updateDoc(fsDoc(db, "users", user.uid), {
                    emailDigest,
                    webhookUrl
                  });
                  setPrefSaveSuccess(true);
                  setTimeout(() => setPrefSaveSuccess(false), 3000);
                } catch (err) {
                  console.error("Failed saving notification preferences:", err);
                } finally {
                  setSavingPreferences(false);
                }
              }} 
              className="flex flex-col gap-4"
            >
              {/* Email Digest option */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">
                  Email Digest Summary
                </label>
                <select
                  value={emailDigest}
                  onChange={(e) => setEmailDigest(e.target.value as any)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-xs text-slate-800 font-sans focus:outline-hidden focus:border-indigo-500 focus:bg-white transition-all shadow-xs"
                >
                  <option value="none">No Digest (Real-Time Transactional Only)</option>
                  <option value="daily">Daily Digest Summary (Opt-in)</option>
                  <option value="weekly">Weekly Digest Summary (Opt-in)</option>
                </select>
                <p className="text-[9px] text-slate-400 font-mono">
                  Receive summarized reports of community updates directly in your inbox.
                </p>
              </div>

              {/* Webhook URL Input for Autonomous Agents */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono flex items-center justify-between">
                  Agent Webhook URL
                  <span className="text-[9px] text-indigo-500 font-mono normal-case">For Autonomous Agents</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    placeholder="https://your-agent.com/webhook"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 text-xs text-slate-800 font-sans focus:outline-hidden focus:border-indigo-500 focus:bg-white transition-all shadow-xs"
                  />
                  {webhookUrl && webhookUrl.startsWith("http") && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const { triggerWebhook } = await import("../utils/notifications");
                          await triggerWebhook(user!.uid, {
                            id: "test_" + Date.now(),
                            type: "test",
                            title: "Connection Test Event",
                            message: "This is a configuration test event of the goBodhi agent platform!",
                            createdAt: new Date().toISOString()
                          });
                          alert("Test notification event sent to agent webhook!");
                        } catch (err) {
                          alert("Failed rendering/triggering test event: " + err);
                        }
                      }}
                      className="px-3.5 py-3 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 hover:border-indigo-200 text-indigo-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
                      title="Send test delivery to agent"
                    >
                      Test
                    </button>
                  )}
                </div>
                <p className="text-[9px] text-slate-400 font-mono">
                  We'll POST standard JSON payloads whenever high-priority community events are triggered.
                </p>
              </div>

              {prefSaveSuccess && (
                <div className="bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-xl p-3 flex gap-2 items-center text-xs font-semibold">
                  <Check className="w-4 h-4 flex-shrink-0" />
                  Preferences updated and synchronized.
                </div>
              )}

              <button
                type="submit"
                disabled={savingPreferences}
                className="w-full bg-slate-900 hover:bg-indigo-600 text-white text-xs font-sans font-extrabold tracking-wider py-3.5 rounded-xl shadow-md hover:shadow-indigo-500/20 active:scale-98 transition-all duration-150 cursor-pointer flex items-center justify-center gap-1.5 mt-2 uppercase disabled:opacity-30"
              >
                {savingPreferences ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving preferences...
                  </>
                ) : (
                  <>
                    <Settings className="w-4 h-4" />
                    Save & Synchronize Changes
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </header>
  );
}



import React, { useState, useEffect } from "react";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { User, UserSession } from "../types";
import { Trophy, Flame, RefreshCw, Award, Loader2, Calendar, ShieldAlert, Bot } from "lucide-react";

interface LeaderboardProps {
  user: UserSession | null;
  onViewProfile?: (userId: string) => void;
}

export default function Leaderboard({ user, onViewProfile }: LeaderboardProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"weekly" | "monthly" | "all-time" | "agents">("all-time");
  const [recalculating, setRecalculating] = useState(false);
  const [recalcSuccess, setRecalcSuccess] = useState(false);
  const [delegations, setDelegations] = useState<any[]>([]);

  useEffect(() => {
    // Sync delegations for liquid vote calculations
    const qDel = query(collection(db, "delegations"));
    const unsubDel = onSnapshot(
      qDel,
      (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() });
        });
        setDelegations(list);
      },
      (err) => {
        console.error("Failed loading delegations for leaderboard:", err);
      }
    );
    return () => unsubDel();
  }, []);

  useEffect(() => {
    setLoading(true);
    // Sort all-time users by reputation desc
    const q = query(collection(db, "users"), orderBy("reputation", "desc"), limit(50));
    
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const items: User[] = [];
        snapshot.forEach((docSnap) => {
          items.push({
            id: docSnap.id,
            ...docSnap.data()
          } as any);
        });
        setUsers(items);
        setLoading(false);
      },
      (error) => {
        console.error("Leaderboard query failed: ", error);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const handleManualRecalculate = async () => {
    if (recalculating) return;
    setRecalculating(true);
    setRecalcSuccess(false);

    try {
      const response = await fetch("/api/recalculate", {
        method: "POST"
      });
      if (response.ok) {
        setRecalcSuccess(true);
        setTimeout(() => setRecalcSuccess(false), 3000);
      }
    } catch (err) {
      console.error("Recalculation endpoint failed: ", err);
    } finally {
      setRecalculating(false);
    }
  };

  const getRankEmoji = (rank: number) => {
    if (rank === 1) return <span className="text-xl">🥇</span>;
    if (rank === 2) return <span className="text-xl">🥈</span>;
    if (rank === 3) return <span className="text-xl">🥉</span>;
    return <span className="text-xs font-mono text-slate-400 font-bold">#{rank}</span>;
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

  // Compute dynamic mock estimates for weekly/monthly based on reputation for high interactive fidelity
  const getDisplayScore = (reputation: number) => {
    if (activeTab === "weekly") {
      return Math.max(0, Math.round(reputation * 0.3));
    }
    if (activeTab === "monthly") {
      return Math.max(0, Math.round(reputation * 0.75));
    }
    return reputation;
  };

  // Filter or sort users depending on tab
  const filteredUsers = activeTab === "agents"
    ? users.filter(u => u.isVerifiedAgent === true || u.isAgent === true)
    : users;

  // Re-sort list if weekly or monthly computations are requested
  const sortedUsers = [...filteredUsers].sort((a, b) => {
    return getDisplayScore(b.reputation) - getDisplayScore(a.reputation);
  });

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 flex flex-col shadow-sm relative min-h-[500px]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-xl font-sans font-extrabold text-slate-800 flex items-center gap-2">
            <Trophy className="w-6 h-6 text-amber-500 fill-amber-500 shrink-0" />
            Voter Leaderboard
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Top contributors ranked by voting action, accepted proposals, and community accolades.
          </p>
        </div>

        {/* Sync trigger button */}
        <button
          onClick={handleManualRecalculate}
          disabled={recalculating}
          className="self-start sm:self-center bg-indigo-50 hover:bg-indigo-150 border border-indigo-100 text-indigo-700 text-xs font-semibold py-2 px-4 rounded-xl cursor-pointer transition-all flex items-center gap-1.5"
          title="Force update all user reputation and badging metrics instantly"
        >
          {recalculating ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          {recalculating ? "Syncing stats..." : recalcSuccess ? "Synced! ✨" : "Recalculate All"}
        </button>
      </div>

      {/* Tabs Switcher selectors */}
      <div className="flex items-center gap-1.5 bg-slate-55 bg-slate-100/70 border border-slate-200/50 p-1.5 rounded-2xl mb-6">
        {[
          { id: "weekly", label: "Weekly Runs", icon: Calendar },
          { id: "monthly", label: "Monthly Track", icon: Calendar },
          { id: "all-time", label: "All-Time", icon: Trophy },
          { id: "agents", label: "Top Agents", icon: Bot }
        ].map((tab) => {
          const Icon = tab.icon;
          const isSelected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold py-2.5 px-4 rounded-xl transition-all cursor-pointer ${
                isSelected
                  ? "bg-white text-slate-850 shadow-xs border border-slate-200"
                  : "text-slate-500 hover:text-slate-800 bg-transparent"
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isSelected ? "text-indigo-600" : "text-slate-400"}`} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Leaderboard user list */}
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
            <p className="text-xs text-slate-400 font-mono">Loading dynamic ranks...</p>
          </div>
        ) : sortedUsers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="bg-slate-50 p-3 rounded-full mb-3 text-slate-400">
              <Award className="w-6 h-6" />
            </div>
            <p className="text-xs font-bold text-slate-800">No ranks logged yet</p>
            <p className="text-[11px] text-slate-405 mt-1 max-w-[200px]">
              Cast some suggestion votes or post proposals to start ranking!
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-mono text-slate-400 font-extrabold uppercase tracking-wider pb-3">
                  <th className="py-3 px-3 text-center w-12">Rank</th>
                  <th className="py-3 px-4">Contributor</th>
                  <th className="py-3 px-4 text-center">Reputation</th>
                  <th className="py-3 px-4 text-center">Voting Power ✨</th>
                  <th className="py-3 px-4 text-center">Badges</th>
                  <th className="py-3 px-4 text-center">Streak</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedUsers.map((item, idx) => {
                  const rank = idx + 1;
                  const displayScore = getDisplayScore(item.reputation);
                  const isCurUser = user && item.userId === user.uid;

                  // Compute dynamic Weighted Voting Power (Reputation + Sum of Delegators' Reputation)
                  const delegatorMatches = delegations.filter((d) => d.delegateId === item.userId);
                  const delegatorIds = delegatorMatches.map((d) => d.delegatorId);
                  const delegatorsRepSum = users
                    .filter((u) => delegatorIds.includes(u.userId))
                    .reduce((acc, u) => acc + (u.reputation || 0), 0);
                  const computedVotingPower = (item.reputation || 0) + delegatorsRepSum;
                  const displayVotingPower = getDisplayScore(computedVotingPower);

                  const formatDate = (joinedAtVal: any) => {
                    if (!joinedAtVal) return "unknown";
                    try {
                      let d = new Date();
                      if (joinedAtVal.toDate) {
                        d = joinedAtVal.toDate();
                      } else {
                        d = new Date(joinedAtVal);
                      }
                      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                    } catch (e) {
                      return "recent";
                    }
                  };

                  return (
                    <tr 
                      key={item.userId} 
                      className={`hover:bg-slate-50/50 transition-colors font-sans text-xs ${
                        isCurUser ? "bg-indigo-50/30" : ""
                      }`}
                    >
                      {/* Rank Column */}
                      <td className="py-4 px-3 text-center font-bold">
                        {getRankEmoji(rank)}
                      </td>

                      {/* Display Name Column */}
                      <td className="py-4 px-4 font-bold text-slate-800">
                        <div className="flex flex-col">
                          <button
                            type="button"
                            onClick={() => onViewProfile && onViewProfile(item.userId)}
                            className="text-left font-bold text-slate-800 hover:text-indigo-650 hover:text-indigo-600 hover:underline transition-colors cursor-pointer inline-flex items-center gap-1.5 flex-wrap"
                          >
                            <span>{item.displayName || "Anonymous Member"}</span>
                            {(item.isVerifiedAgent || item.isAgent) && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-150 border-emerald-100 text-[10px] rounded-md font-extrabold uppercase shrink-0" title="Verified AI Agent">
                                🤖 Verified Agent
                              </span>
                            )}
                            {isCurUser && (
                              <span className="ml-1.5 px-1.5 py-0.2 bg-indigo-100 text-indigo-700 font-mono text-[9px] rounded-sm font-bold uppercase tracking-wider">
                                You
                              </span>
                            )}
                          </button>
                          <span className="text-[10px] font-mono text-slate-400 font-normal mt-0.5">
                            joined {formatDate(item.joinedAt)}
                          </span>
                        </div>
                      </td>

                      {/* Reputation Column */}
                      <td className="py-4 px-4 text-center select-all">
                        <span className="font-extrabold text-slate-850 bg-indigo-50 text-indigo-700 border border-indigo-100 px-3 py-1 rounded-full text-xs">
                          {displayScore} pts
                        </span>
                      </td>

                      {/* Voting Power Column */}
                      <td className="py-4 px-4 text-center select-all">
                        <span 
                          className="font-extrabold text-slate-850 bg-amber-50 text-amber-700 border border-amber-100 px-3 py-1 rounded-full text-xs inline-flex items-center gap-1 cursor-help hover:scale-102 transition-transform" 
                          title={`Base Reputation (${displayScore}) plus delegated power from ${delegatorMatches.length} supporters (${getDisplayScore(delegatorsRepSum)})`}
                        >
                          ⚡ {displayVotingPower} VP
                        </span>
                      </td>

                      {/* Badges Column */}
                      <td className="py-4 px-4 text-center">
                        {item.badges && item.badges.length > 0 ? (
                          <div className="flex justify-center items-center gap-1.5">
                            {item.badges.slice(0, 4).map((badge) => (
                              <span 
                                key={badge} 
                                className="text-sm cursor-help hover:scale-125 transition-transform" 
                                title={badge}
                              >
                                {getBadgeEmoji(badge)}
                              </span>
                            ))}
                            {item.badges.length > 4 && (
                              <span className="text-[10px] text-slate-500 font-bold bg-slate-100 px-1 rounded-sm">
                                +{item.badges.length - 4}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-[11px]">-</span>
                        )}
                      </td>

                      {/* Streak Column */}
                      <td className="py-4 px-4 text-center">
                        {item.streak > 0 ? (
                          <span className="inline-flex items-center gap-0.5 font-bold text-orange-600 bg-orange-50 border border-orange-100 px-2 py-0.5 rounded-lg text-[10px] font-mono">
                            <Flame className="w-3.5 h-3.5 text-orange-500 fill-orange-55 animate-pulse" />
                            {item.streak} days
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

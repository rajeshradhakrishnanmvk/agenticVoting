import { Timestamp } from "firebase/firestore";

export interface Proposal {
  id: string; // The Firestore document ID
  title: string;
  description: string;
  authorId: string;
  authorName: string;
  authorEmail: string;
  upvotesCount: number;
  downvotesCount: number;
  netVotes: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  category: "Governance" | "Technical" | "Community" | "Treasury" | "Events" | "Meta";
  tags: string[];
  priorityScore: number;
  status: "draft" | "active" | "passed" | "rejected" | "expired";
  durationDays?: number;
  expiresAt?: Timestamp;
  authorIsAgent?: boolean;
}

export interface Vote {
  userId: string;
  voterName: string;
  voteType: "up" | "down";
  updatedAt: Timestamp;
}

export interface UserSession {
  uid: string;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  photoURL: string | null;
}

export interface Comment {
  id: string; // The Firestore document ID
  proposalId: string;
  parentId: string | null; // For nested replies, null for top-level
  content: string;
  authorId: string;
  authorName: string;
  authorEmail: string;
  upvotes: number;
  downvotes: number;
  createdAt: Timestamp;
  isInsightful?: boolean;
  authorIsAgent?: boolean;
}

export interface CommentVote {
  userId: string;
  voteType: "up" | "down";
  updatedAt: Timestamp;
}

export interface User {
  userId: string;
  displayName: string;
  email: string;
  reputation: number;
  badges: string[];
  streak: number;
  joinedAt: Timestamp;
  lastVotedDate: string;
  photoURL?: string;
  sandboxStreak?: number;
  sandboxVotesCount?: number;
  emailDigest?: "none" | "daily" | "weekly";
  webhookUrl?: string;
  lastVisit?: Timestamp;
  isAgent?: boolean;
  isVerifiedAgent?: boolean;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  content: string;
  createdAt: Timestamp;
  read: boolean;
  type: "success" | "alert" | "info";
}

export interface Delegation {
  id: string;
  delegatorId: string;
  delegatorName: string;
  delegateId: string;
  delegateName: string;
  category: "All" | "Governance" | "Technical" | "Community" | "Treasury" | "Events" | "Meta";
  createdAt: Timestamp;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  category: "All" | "Governance" | "Technical" | "Community" | "Treasury" | "Events" | "Meta";
  startDate: Timestamp;
  endDate: Timestamp;
  prizeDescription: string;
  winnerProposalId?: string;
  tag: string;
  creatorId: string;
  creatorName: string;
  createdAt: Timestamp;
}


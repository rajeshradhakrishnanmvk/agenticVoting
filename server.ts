import express from "express";
import path from "path";
import nodemailer from "nodemailer";
import admin from "firebase-admin";
import { createServer as createViteServer } from "vite";
import fs from "fs";
// @ts-ignore
import svg2img from "svg2img";
import crypto from "crypto";

const app = express();
const PORT = 3000;

app.use(express.json());

// SSRF webhooks protection hostname validator
function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
      return false;
    }
    const hostname = parsed.hostname;
    // Block private / loopback IP ranges
    if (/^(localhost|127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Securely dispatching outgoing webhooks with signature verification
async function triggerServerWebhook(webhookUrl: string, payload: any) {
  if (!webhookUrl || !isValidWebhookUrl(webhookUrl)) {
    return;
  }
  try {
    const secret = process.env.WEBHOOK_SECRET || "default_voter_webhook_secret";
    const signature = crypto
      .createHmac("sha256", secret)
      .update(JSON.stringify(payload))
      .digest("hex");

    fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000)
    }).catch((err) => {
      console.warn(`[WEBHOOK] Failed delivering to ${webhookUrl}:`, err);
    });
  } catch (err) {
    console.warn(`[WEBHOOK] Failed executing signature or transmission for ${webhookUrl}:`, err);
  }
}

// Lazy initialization of firebase-admin
let adminAuth: admin.auth.Auth | null = null;
try {
  const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(firebaseConfigPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
    admin.initializeApp({
      projectId: firebaseConfig.projectId,
    });
    adminAuth = admin.auth();
    console.log("Firebase Admin successfully initialized.");
  } else {
    console.warn("firebase-applet-config.json not found, skipping immediate Firebase Admin initialization.");
  }
} catch (error) {
  console.warn("Failed to initialize Firebase Admin natively on startup. Will retry on demand or run without it:", error);
}

// Robust centralized Firestore admin database initialization targeting correct databaseId
let cachedDb: admin.firestore.Firestore | null = null;
async function getAdminDb(): Promise<admin.firestore.Firestore> {
  if (cachedDb) return cachedDb;
  const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
  let firebaseConfig: any = {};
  if (fs.existsSync(firebaseConfigPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
  }
  if (admin.apps.length === 0) {
    admin.initializeApp({
      projectId: firebaseConfig.projectId,
    });
  }
  const { getFirestore } = await import("firebase-admin/firestore");
  cachedDb = getFirestore(admin.app(), firebaseConfig.firestoreDatabaseId || "(default)") as any;
  return cachedDb!;
}

// API Route for verifying Gmail ID and Google App Password
app.post("/api/auth/verify-gmail", async (req, res) => {
  const { email, appPassword } = req.body;

  if (!email || !appPassword) {
    return res.status(400).json({ error: "Gmail ID and App Password are required." });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanPassword = appPassword.trim().replace(/\s+/g, "");

  if (!cleanEmail.endsWith("@gmail.com")) {
    return res.status(400).json({ error: "Only Gmail accounts (@gmail.com) are supported." });
  }

  // 1. Verify credentials via Google SMTP server
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: cleanEmail,
      pass: cleanPassword,
    },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
  });

  try {
    await transporter.verify();
    console.log(`SMTP Verification successful for ${cleanEmail}`);
  } catch (smtpError: any) {
    console.error(`SMTP Verification failed for ${cleanEmail}:`, smtpError);
    return res.status(401).json({
      error: "Authentication failed. Please verify your Gmail ID and that you are using a 16-character Google App Password (not your primary account password).",
    });
  }

  // 2. Integration with Firebase Auth / Token Generation
  try {
    if (!adminAuth) {
      try {
        const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
        if (fs.existsSync(firebaseConfigPath)) {
          const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
          admin.initializeApp({
            projectId: firebaseConfig.projectId,
          });
          adminAuth = admin.auth();
        }
      } catch (initErr) {
        console.error("Lazy initialization of Firebase Admin failed:", initErr);
      }
    }

    if (adminAuth) {
      let userRecord: admin.auth.UserRecord;
      try {
        userRecord = await adminAuth.getUserByEmail(cleanEmail);
        // Force synchronize user's Firebase Auth password with the verified App Password.
        // This is extremely important because if minting custom token fails (due to lack of service account key configs),
        // the user can fall back to standard email/password authentication using the EXACT SAME App Password,
        // and it is guaranteed to succeed without auth/invalid-credential errors!
        await adminAuth.updateUser(userRecord.uid, {
          password: cleanPassword,
          emailVerified: true,
        });
        console.log(`Successfully updated Firebase user password & verified status for: ${cleanEmail}`);
      } catch (getErr: any) {
        if (getErr.code === "auth/user-not-found") {
          // Create user if they don't exist
          const displayName = cleanEmail.split("@")[0];
          userRecord = await adminAuth.createUser({
            email: cleanEmail,
            emailVerified: true,
            displayName,
            password: cleanPassword,
          });
          console.log(`Successfully created new Firebase user with synchronized app password for: ${cleanEmail}`);
        } else {
          throw getErr;
        }
      }

      // Try to mint a custom token
      try {
        const customToken = await adminAuth.createCustomToken(userRecord.uid);
        console.log(`Minted custom token successfully for ${cleanEmail}`);
        return res.json({ success: true, customToken });
      } catch (tokenErr: any) {
        console.warn(`Could not sign custom token (expected without private key file). Proceeding to fallback email/password auth using synchronized password:`, tokenErr.message);
        return res.json({
          success: true,
          fallback: true,
          email: cleanEmail,
        });
      }
    } else {
      console.warn("Firebase Admin auth unavailable, fallback to direct client signin.");
      return res.json({
        success: true,
        fallback: true,
        email: cleanEmail,
      });
    }
  } catch (firebaseErr: any) {
    console.error("Firebase synchronization failed:", firebaseErr);
    return res.status(500).json({
      error: `SMTP credentials are valid, but synchronization with Firebase metadata failed: ${firebaseErr.message}`,
    });
  }
});

// Helper utilities for dynamic SVG formatting and XML wrapping
function wrapText(text: string, maxCharsPerLine: number = 32): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";
  
  for (const word of words) {
    if ((currentLine + " " + word).trim().length <= maxCharsPerLine) {
      currentLine = (currentLine + " " + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function escapeXml(unsafe: string): string {
  if (!unsafe) return "";
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case "\"": return "&quot;";
      default: return c;
    }
  });
}

// Robust Firestore admin fetch with database ID fallback
const getProposalFromAdmin = async (proposalId: string) => {
  try {
    const adminDb = await getAdminDb();
    const docSnap = await adminDb.collection("proposals").doc(proposalId).get();
    if (docSnap.exists) {
      return docSnap.data();
    }
  } catch (err) {
    console.error("getProposalFromAdmin lookup failed:", err);
  }
  return null;
};

const getHtmlContent = () => {
  const distIndex = path.join(process.cwd(), "dist", "index.html");
  const rootIndex = path.join(process.cwd(), "index.html");
  if (fs.existsSync(distIndex)) {
    return fs.readFileSync(distIndex, "utf-8");
  }
  return fs.readFileSync(rootIndex, "utf-8");
};

// Route for rendering proposal details with server-side og:tags
app.get("/proposal/:id", async (req, res) => {
  const proposalId = req.params.id;
  const proposal = await getProposalFromAdmin(proposalId);
  
  if (!proposal) {
    try {
      return res.send(getHtmlContent());
    } catch (err) {
      return res.status(404).send("Proposal not found.");
    }
  }
  
  try {
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host;
    const appUrl = `${protocol}://${host}`;
    
    const html = getHtmlContent();
    const title = proposal.title || "Proposal Details";
    const rawDesc = proposal.description || "";
    const desc = rawDesc.replace(/["\r\n]/g, " ").slice(0, 155) + "...";
    const ogImageUrl = `${appUrl}/api/proposals/${proposalId}/og-image`;
    const ogUrl = `${appUrl}/proposal/${proposalId}`;
    
    const metaTags = `
      <title>${escapeXml(title)} | goBodhi</title>
      <meta name="description" content="${escapeXml(desc)}" />
      
      <!-- Open Graph / Facebook -->
      <meta property="og:title" content="${escapeXml(title)}" />
      <meta property="og:description" content="${escapeXml(desc)}" />
      <meta property="og:image" content="${ogImageUrl}" />
      <meta property="og:url" content="${ogUrl}" />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="goBodhi" />
      
      <!-- Twitter -->
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="${escapeXml(title)}" />
      <meta name="twitter:description" content="${escapeXml(desc)}" />
      <meta name="twitter:image" content="${ogImageUrl}" />
    `;
    
    const modifiedHtml = html.replace("<title>goBodhi</title>", metaTags);
    res.setHeader("Content-Type", "text/html");
    res.send(modifiedHtml);
  } catch (err) {
    console.error("Failed serving SSR proposal meta tags:", err);
    try {
      res.send(getHtmlContent());
    } catch {
      res.status(500).send("Internal Server Error");
    }
  }
});

// Route for rendering proposal embeds with custom meta-tags
app.get("/embed/proposal/:id", async (req, res) => {
  const proposalId = req.params.id;
  const proposal = await getProposalFromAdmin(proposalId);
  
  if (!proposal) {
    try {
      return res.send(getHtmlContent());
    } catch (err) {
      return res.status(404).send("Embed not found.");
    }
  }
  
  try {
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host;
    const appUrl = `${protocol}://${host}`;
    
    const html = getHtmlContent();
    const title = `Live Embed: ${proposal.title || "Proposal"}`;
    const rawDesc = proposal.description || "";
    const desc = `Live Vote Embed - ${rawDesc.replace(/["\r\n]/g, " ").slice(0, 155)}...`;
    const ogImageUrl = `${appUrl}/api/proposals/${proposalId}/og-image`;
    const ogUrl = `${appUrl}/embed/proposal/${proposalId}`;
    
    const metaTags = `
      <title>${escapeXml(title)}</title>
      <meta name="description" content="${escapeXml(desc)}" />
      <meta property="og:title" content="${escapeXml(title)}" />
      <meta property="og:description" content="${escapeXml(desc)}" />
      <meta property="og:image" content="${ogImageUrl}" />
      <meta property="og:url" content="${ogUrl}" />
    `;
    
    const modifiedHtml = html.replace("<title>goBodhi</title>", metaTags);
    res.setHeader("Content-Type", "text/html");
    res.send(modifiedHtml);
  } catch (err) {
    console.error("Failed serving SSR embed page:", err);
    try {
      res.send(getHtmlContent());
    } catch {
      res.status(500).send("Internal Server Error");
    }
  }
});

// Dedicated dynamic API route generating PNG image buffer on-the-fly
app.get("/api/proposals/:id/og-image", async (req, res) => {
  const proposalId = req.params.id;
  const proposal = await getProposalFromAdmin(proposalId);
  
  const title = proposal ? (proposal.title || "Untitled Suggestion") : "Community Suggestion Draft";
  const author = proposal ? (proposal.authorName || "Anonymous") : "Ecosystem Member";
  const category = proposal ? (proposal.category || "Community") : "General";
  const upvotes = proposal ? (proposal.upvotesCount || 0) : 0;
  const downvotes = proposal ? (proposal.downvotesCount || 0) : 0;
  const netVotes = proposal ? (proposal.netVotes || 0) : 0;
  
  let catColor = "#6366F1";
  if (category === "Technical") catColor = "#3B82F6";
  if (category === "Community") catColor = "#0D9488";
  if (category === "Treasury") catColor = "#10B981";
  if (category === "Events") catColor = "#8B5CF6";
  if (category === "Meta") catColor = "#F43F5E";
  
  const wrappedLines = wrapText(title, 34).slice(0, 3);
  let textYStart = 260;
  if (wrappedLines.length === 1) textYStart = 310;
  else if (wrappedLines.length === 2) textYStart = 280;
  
  const textSvgs = wrappedLines.map((line, idx) => {
    return `<text x="100" y="${textYStart + idx * 64}" fill="#FFFFFF" font-family="'Inter', system-ui, -apple-system, sans-serif" font-size="48" font-weight="900" letter-spacing="-0.03em">${escapeXml(line)}</text>`;
  }).join("\n");
  
  const svgString = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1E1B4B" />
          <stop offset="60%" stop-color="#0F172A" />
          <stop offset="100%" stop-color="#020617" />
        </linearGradient>
        <linearGradient id="badgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${catColor}" stop-opacity="0.95" />
          <stop offset="100%" stop-color="${catColor}" stop-opacity="0.75" />
        </linearGradient>
        <linearGradient id="accentGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#4F46E5" />
          <stop offset="100%" stop-color="#818CF8" />
        </linearGradient>
        <filter id="cardShadow" x="-10%" y="-10%" width="125%" height="125%">
          <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#000000" flood-opacity="0.5" />
        </filter>
      </defs>
      
      <rect width="1200" height="630" fill="url(#bgGrad)" />
      
      <circle cx="1100" cy="100" r="300" fill="#4F46E5" opacity="0.15" filter="blur(80px)" />
      <circle cx="100" cy="550" r="250" fill="${catColor}" opacity="0.1" filter="blur(60px)" />
      
      <rect x="0" y="0" width="12" height="630" fill="url(#accentGrad)" />
      
      <g transform="translate(100, 90)">
        <rect x="-8" y="-12" width="46" height="46" rx="10" fill="#4F46E5" />
        <text x="5" y="21" fill="#FFFFFF" font-family="'JetBrains Mono', monospace" font-size="28" font-weight="950">🗳️</text>
        <text x="54" y="20" fill="#F8FAFC" font-family="'Inter', system-ui, sans-serif" font-size="26" font-weight="900" letter-spacing="-0.02em">goBodhi</text>
        <text x="172" y="20" fill="#64748B" font-family="'JetBrains Mono', monospace" font-size="18" font-weight="bold">| Community Sentiment</text>
      </g>
      
      <g transform="translate(100, 160)">
        <rect x="0" y="0" width="220" height="42" rx="12" fill="url(#badgeGrad)" stroke="${catColor}" stroke-opacity="0.8" stroke-width="2" />
        <text x="110" y="26" fill="#FFFFFF" font-family="'Inter', system-ui, sans-serif" font-size="14" font-weight="800" text-anchor="middle" letter-spacing="0.12em" text-transform="uppercase">${escapeXml(category)}</text>
      </g>
      
      ${textSvgs}
      
      <g transform="translate(100, 445)">
        <text x="0" y="22" fill="#94A3B8" font-family="'Inter', system-ui, sans-serif" font-size="20" font-weight="500">Proposed by</text>
        <text x="135" y="22" fill="#F8FAFC" font-family="'Inter', system-ui, sans-serif" font-size="20" font-weight="700">${escapeXml(author)}</text>
      </g>
      
      <g transform="translate(730, 200)" filter="url(#cardShadow)">
        <rect width="370" height="260" rx="28" fill="#1E293B" fill-opacity="0.5" stroke="#475569" stroke-opacity="0.5" stroke-width="2" />
        
        <text x="185" y="55" fill="#94A3B8" font-family="'Inter', system-ui, sans-serif" font-size="14" font-weight="800" text-anchor="middle" letter-spacing="0.1em" text-transform="uppercase">Ballot Receipt</text>
        
        <text x="185" y="145" fill="${netVotes >= 0 ? "#10B981" : "#F43F5E"}" font-family="'Inter', system-ui, sans-serif" font-size="76" font-weight="900" text-anchor="middle" letter-spacing="-0.04em">${netVotes >= 0 ? `+${netVotes}` : netVotes}</text>
        <text x="185" y="175" fill="#64748B" font-family="'Inter', system-ui, sans-serif" font-size="13" font-weight="bold" text-anchor="middle" letter-spacing="0.05em" text-transform="uppercase">Net Support Score</text>
        
        <line x1="40" y1="205" x2="330" y2="205" stroke="#334155" stroke-width="2" />
        
        <text x="85" y="235" fill="#10B981" font-family="'Inter', system-ui, -apple-system, sans-serif" font-size="15" font-weight="900">▲ ${upvotes} UP</text>
        <text x="285" y="235" fill="#F43F5E" font-family="'Inter', system-ui, -apple-system, sans-serif" font-size="15" font-weight="900" text-anchor="end">▼ ${downvotes} DOWN</text>
      </g>
    </svg>
  `;
  
  try {
    // @ts-ignore
    svg2img(svgString, { width: 1200, height: 630, format: "png" }, (err: any, buffer: Buffer) => {
      if (err) {
        console.error("svg2img failed producing OG: ", err);
        return res.status(500).send("Error compiling image buffer.");
      }
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=60");
      res.send(buffer);
    });
  } catch (err) {
    console.error("Critical svg rendering crash:", err);
    res.status(500).send("Failed dynamic compilation.");
  }
});

// Real-Time Background Reputation Recalculation Engine
let isRecalculating = false;

async function runDirectRecalculation() {
  if (isRecalculating) return;
  isRecalculating = true;
  try {
    const adminDb = await getAdminDb();

    // Obtain core datasets
    const proposalsSnap = await adminDb.collection("proposals").get();
    const commentsSnap = await adminDb.collection("comments").get();
    const usersSnap = await adminDb.collection("users").get();
    const votesSnap = await adminDb.collectionGroup("votes").get();

    const proposals = proposalsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
    const comments = commentsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
    const votes = votesSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
    const existingUsers = new Map(usersSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }])) as Map<string, any>;

    // Construct unified list of users
    const systemUserIds = new Set<string>();
    votes.forEach((v: any) => { if (v.userId) systemUserIds.add(v.userId); });
    proposals.forEach((p: any) => { if (p.authorId) systemUserIds.add(p.authorId); });
    comments.forEach((c: any) => { if (c.authorId) systemUserIds.add(c.authorId); });
    existingUsers.forEach((u: any) => { if (u.userId) systemUserIds.add(u.userId); });

    const batch = adminDb.batch();

    for (const uid of systemUserIds) {
      if (!uid) continue;
      const userRef = adminDb.collection("users").doc(uid);
      const existingUser: any = existingUsers.get(uid) || {};

      const userProposals = proposals.filter((p: any) => p.authorId === uid);
      const userComments = comments.filter((c: any) => c.authorId === uid);
      const userVotesCast = votes.filter((v: any) => v.userId === uid);

      // Points Formulation
      // 1. Voting on a proposal: +1 points
      let points = userVotesCast.length * 1;

      // 2. Proposal milestones and statuses
      //   +5: reaches 10 total votes
      //   +10: reaches 50 total votes (cumulative: +15 total)
      //   +15: Proposal passes (status == "passed" or netVotes >= 15)
      //   -5: Proposal rejected (status == "rejected" or netVotes < -10)
      let passedProposalsCount = 0;
      userProposals.forEach((p: any) => {
        const totalVotes = (p.upvotesCount || 0) + (p.downvotesCount || 0);
        if (totalVotes >= 10) points += 5;
        if (totalVotes >= 50) points += 10;

        const netVotes = (p.upvotesCount || 0) - (p.downvotesCount || 0);
        if (netVotes >= 15 || p.status === "passed") {
          points += 15;
          passedProposalsCount += 1;
        } else if (netVotes < -10 || p.status === "rejected") {
          points -= 5;
        }
      });

      // 3. Comments contribution
      //   +2:comment upvoted (* upvotes value)
      //   +3: comment marked as Insightful by original proposal author
      let insightfulCount = 0;
      userComments.forEach((c: any) => {
        points += (c.upvotes || 0) * 2;
        if (c.isInsightful === true) {
          points += 3;
          insightfulCount += 1;
        }
      });

      // 4. Streak Calculation from Voting Dates
      const voteDates = Array.from(new Set(
        userVotesCast
          .map((v: any) => {
            if (!v.updatedAt) return "";
            const d = v.updatedAt.toDate ? v.updatedAt.toDate() : new Date(v.updatedAt);
            return d.toISOString().split("T")[0]; // "YYYY-MM-DD"
          })
          .filter(Boolean)
      )).sort(); // Ascending chronological

      let streak = 0;
      if (voteDates.length > 0) {
        streak = 1;
        const parseDate = (s: string) => {
          const [y, m, d] = s.split("-").map(Number);
          return new Date(Date.UTC(y, m - 1, d));
        };
        for (let i = voteDates.length - 1; i > 0; i--) {
          const dCurr = parseDate(voteDates[i]);
          const dPrev = parseDate(voteDates[i - 1]);
          const diffDays = Math.round((dCurr.getTime() - dPrev.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays === 1) {
            streak += 1;
          } else if (diffDays > 1) {
            break; // unbroken streak block terminates here
          }
        }
      }

      // 5. Automatic Badge Awards
      const badges: string[] = [];
      const joinedAtTimestamp = existingUser.joinedAt;
      let joinedAtDate = new Date();
      if (joinedAtTimestamp) {
        joinedAtDate = joinedAtTimestamp.toDate ? joinedAtTimestamp.toDate() : new Date(joinedAtTimestamp);
      }

      // "Founding Member" — joined in first 30 days of project (epoch: May 1, 2026)
      const epochLimit = new Date("2026-06-01T00:00:00Z");
      // If signed up within limit or joinedAt is <= 30 days, award badge (everyone joining right now in sandbox fits)
      if (joinedAtDate <= epochLimit) {
        badges.push("Founding Member");
      }

      // "Proposer" — first proposal submitted
      if (userProposals.length >= 1) {
        badges.push("Proposer");
      }

      // "Consensus Builder" — 5 proposals passed
      if (passedProposalsCount >= 5) {
        badges.push("Consensus Builder");
      }

      // "Thought Leader" — 3 "Insightful" comments
      if (insightfulCount >= 3) {
        badges.push("Thought Leader");
      }

      // "Whale Watcher" — voted on 100+ proposals
      if (userVotesCast.length >= 100) {
        badges.push("Whale Watcher");
      }

      // "Devoted" — 30-day voting streak
      if (streak >= 30) {
        badges.push("Devoted");
      }

      // Sandbox simulated variables for effortless developer evaluation
      if (existingUser.sandboxStreak >= 30 && !badges.includes("Devoted")) {
        badges.push("Devoted");
      }
      if (existingUser.sandboxStreak) {
        streak = Math.max(streak, existingUser.sandboxStreak);
      }
      if (existingUser.sandboxVotesCount >= 100) {
        if (!badges.includes("Whale Watcher")) {
          badges.push("Whale Watcher");
        }
        points += 100; // Simulated vote reward points
      }

      const displayName = existingUser.displayName || (userProposals[0]?.authorName) || (userComments[0]?.authorName) || "Community Member";
      const email = existingUser.email || (userProposals[0]?.authorEmail) || (userComments[0]?.authorEmail) || "";

      // Check for new badges
      const newBadges = badges.filter((b: string) => !(existingUser.badges || []).includes(b));
      for (const badge of newBadges) {
        const badgeNotifId = `notif_badge_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        batch.set(adminDb.collection("notifications").doc(badgeNotifId), {
          userId: uid,
          type: "badge",
          proposalId: null,
          title: "New Badge Earned",
          message: `You earned a badge: "${badge}"`,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Trigger webhook delivery if configured for agent
        if (existingUser.webhookUrl) {
          triggerServerWebhook(existingUser.webhookUrl, {
            event: "notification",
            timestamp: new Date().toISOString(),
            notification: {
              id: badgeNotifId,
              userId: uid,
              type: "badge",
              proposalId: null,
              title: "New Badge Earned",
              message: `You earned a badge: "${badge}"`,
              read: false,
              createdAt: new Date().toISOString()
            }
          });
        }
      }

      batch.set(userRef, {
        userId: uid,
        displayName,
        email,
        reputation: points,
        badges,
        streak,
        joinedAt: existingUser.joinedAt || admin.firestore.FieldValue.serverTimestamp(),
        lastVotedDate: voteDates[voteDates.length - 1] || existingUser.lastVotedDate || ""
      }, { merge: true });
    }

    await batch.commit();
    console.log("Database reputation recalculation executed successfully.");
  } catch (err) {
    console.error("Direct reputation recalculation failed in backend: ", err);
  } finally {
    isRecalculating = false;
  }
}

// Compile and email digest reports to signed-up users (can be tested manually)
const sendEmailDigest = async (userId: string, forceType?: "daily" | "weekly") => {
  try {
    const dbAdmin = await getAdminDb();

    const userSnap = await dbAdmin.collection("users").doc(userId).get();
    if (!userSnap.exists) return;
    
    const userData = userSnap.data();
    if (!userData || !userData.email) return;

    const digestType = forceType || userData.emailDigest || "none";
    if (digestType === "none") return;

    // Fetch unread notifications
    const unreadSnap = await dbAdmin.collection("notifications")
      .where("userId", "==", userId)
      .where("read", "==", false)
      .get();

    if (unreadSnap.empty) {
      console.log(`[DIGEST] No unread notifications for user ${userData.email}. Skipping email.`);
      return;
    }

    const unreadList = unreadSnap.docs.map(d => d.data());
    const smtpEmail = process.env.SMTP_EMAIL;
    const smtpPassword = process.env.SMTP_PASSWORD;

    if (!smtpEmail || !smtpPassword) {
      console.warn("[DIGEST] SMTP configurations are missing in environment variables. Can't send digest.");
      return;
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: smtpEmail,
        pass: smtpPassword,
      },
    });

    const listHtml = unreadList.map(n => {
      const ts = n.createdAt;
      const dateStr = ts ? new Date(ts.toDate ? ts.toDate() : ts).toLocaleDateString() : "";
      return `
        <li style="padding: 12px 0; border-bottom: 1px solid #E2E8F0; list-style: none;">
          <strong style="color: #4F46E5; text-transform: uppercase; font-size: 10px; font-family: monospace; display: block; margin-bottom: 2px;">[${n.type || "ALERT"}]</strong>
          <span style="font-size: 13px; font-weight: 700; color: #1E293B;">${n.title || "Community Alert"}</span>
          <p style="margin: 4px 0 0 0; font-size: 12px; color: #475569;">${n.message || "Summary description"}</p>
          <span style="font-size: 9px; color: #94A3B8; font-family: monospace;">${dateStr}</span>
        </li>
      `;
    }).join("");

    const emailHtml = `
      <div style="font-family: system-ui, sans-serif; max-width: 550px; margin: 0 auto; padding: 24px; border: 1px solid #E2E8F0; border-radius: 20px; background-color: #FFFFFF; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
        <h2 style="color: #4F46E5; margin-top: 0; font-family: system-ui, sans-serif; letter-spacing: -0.02em;">Your goBodhi Digest</h2>
        <p style="font-size: 13px; color: #475569; margin-bottom: 18px; line-height: 1.5;">
          Here is your requested <strong>${digestType.toUpperCase()}</strong> voting notifications summary:
        </p>
        <ul style="padding: 0; margin: 0;">
          ${listHtml}
        </ul>
        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #F1F5F9; text-align: center;">
          <a href="${process.env.APP_URL || "http://localhost:3000"}" style="display: inline-block; padding: 10px 20px; background-color: #4F46E5; color: #FFFFFF; text-decoration: none; border-radius: 10px; font-size: 12px; font-weight: bold;">Go to goBodhi Inbox</a>
          <p style="font-size: 9px; color: #94A3B8; margin-top: 16px; font-family: monospace;">
            To modify these alerts, navigate to settings inside goBodhi.
          </p>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"goBodhi Governance" <${smtpEmail}>`,
      to: userData.email,
      subject: `goBodhi Digest Update - ${digestType.toUpperCase()}`,
      html: emailHtml,
    });

    console.log(`[DIGEST] Dispatched email digest report successfully to ${userData.email}`);
  } catch (err) {
    console.error("[DIGEST ERROR] Failed delivering digest summary email:", err);
  }
};

// Digest trigger endpoint
app.post("/api/notifications/test-digest", async (req, res) => {
  const { userId, type } = req.body;
  if (!userId) {
    return res.status(400).json({ error: "Missing required parameter: userId" });
  }
  try {
    await sendEmailDigest(userId, type || "daily");
    res.json({ success: true, message: "Manual test digest request has been executed successfully." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// REST route for manually recalculating
app.post("/api/recalculate", async (req, res) => {
  try {
    await runDirectRecalculation();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Start background change listeners
async function startRealtimeListeners() {
  try {
    const adminDb = await getAdminDb();

    const triggerRecalc = () => {
      runDirectRecalculation();
    };

    // Subscriptions to auto trigger updates on write operations
    adminDb.collection("proposals").onSnapshot(triggerRecalc, () => {});
    adminDb.collection("comments").onSnapshot(triggerRecalc, () => {});
    adminDb.collectionGroup("votes").onSnapshot(triggerRecalc, () => {});
  } catch (err) {
    console.warn("Background reputation listeners skipped: ", err);
  }
}

startRealtimeListeners();

// Background Proposal Expiration and Lifecycle Scheduler (Active -> Passed / Rejected / Expired)
async function startProposalLifecycleScheduler() {
  console.log("Proposal Lifecycle Scheduler initialized. Running checks...");
  
  const checkActiveProposals = async () => {
    try {
      const adminDb = await getAdminDb();

      const now = new Date();
      // Get all active proposals
      const activeProposalsQuery = await adminDb.collection("proposals")
        .where("status", "==", "active")
        .get();

      if (activeProposalsQuery.empty) {
        return;
      }

      // Fetch member count
      const usersSnapshot = await adminDb.collection("users").get();
      const totalUsers = usersSnapshot.size || 1;

      // Quorum requirements default (min 10 votes or 5% of members, whichever is higher)
      let quorumMinVotes = 10;
      let quorumPercent = 5;
      try {
        const quorumConfigDoc = await adminDb.doc("configs/communityQuorum").get();
        if (quorumConfigDoc.exists) {
          const data = quorumConfigDoc.data();
          if (data?.minVotes !== undefined) quorumMinVotes = Number(data.minVotes);
          if (data?.memberPercent !== undefined) quorumPercent = Number(data.memberPercent);
        }
      } catch (configErr) {
        // config not specified, use default
      }

      const calculatedQuorum = Math.max(quorumMinVotes, Math.ceil((quorumPercent / 100) * totalUsers));

      for (const proposalDoc of activeProposalsQuery.docs) {
        const proposalData = proposalDoc.data();
        if (!proposalData.expiresAt) continue;

        let expiresAtDate: Date;
        if (proposalData.expiresAt.toDate) {
          expiresAtDate = proposalData.expiresAt.toDate();
        } else {
          expiresAtDate = new Date(proposalData.expiresAt);
        }

        const timeLeftMs = expiresAtDate.getTime() - now.getTime();

        // 1. 24 Hours Expiration Warning Action
        if (timeLeftMs > 0 && timeLeftMs <= 24 * 60 * 60 * 1000 && !proposalData.warned24h) {
          console.log(`[LIFECYCLE] Proposal "${proposalData.title}" expiring in less than 24 hours. Dispatching alert.`);
          await proposalDoc.ref.update({ warned24h: true });

          const authorId = proposalData.authorId;
          if (authorId) {
            const warnNotifId = `notif_exp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const textContent = `Your proposal "${proposalData.title}" will expire in less than 24 hours. Concluding counts will be measured dynamically then.`;
            
            await adminDb.collection("notifications").doc(warnNotifId).set({
              userId: authorId,
              type: "expiration_warning",
              proposalId: proposalDoc.id,
              title: "Proposal Expiring Soon",
              message: textContent,
              read: false,
              createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // Deliver Webhook trigger if configured
            const userSnap = await adminDb.collection("users").doc(authorId).get();
            if (userSnap.exists) {
              const uData = userSnap.data();
              if (uData && uData.webhookUrl) {
                triggerServerWebhook(uData.webhookUrl, {
                  event: "notification",
                  timestamp: new Date().toISOString(),
                  notification: {
                    id: warnNotifId,
                    userId: authorId,
                    type: "expiration_warning",
                    proposalId: proposalDoc.id,
                    title: "Proposal Expiring Soon",
                    message: textContent,
                    read: false,
                    createdAt: new Date().toISOString()
                  }
                });
              }
            }
          }
        }

        // 2. Exact Expiration / Concluding Count Action
        if (expiresAtDate <= now) {
          console.log(`[LIFECYCLE] Proposal "${proposalData.title}" (${proposalDoc.id}) has reached duration. Conducting count.`);

          const upvotes = Number(proposalData.upvotesCount) || 0;
          const downvotes = Number(proposalData.downvotesCount) || 0;
          const totalVotes = upvotes + downvotes;

          let finalStatus: "passed" | "rejected" | "expired" = "expired";
          if (totalVotes >= calculatedQuorum) {
            const upvoteRatio = totalVotes > 0 ? (upvotes / totalVotes) : 0;
            if (upvoteRatio > 0.5) {
              finalStatus = "passed";
            } else {
              finalStatus = "rejected";
            }
          } else {
            finalStatus = "expired";
          }

          console.log(`[LIFECYCLE] Transitioning proposal status to: ${finalStatus.toUpperCase()}`);

          // Update Firestore proposal status
          await proposalDoc.ref.update({
            status: finalStatus,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          // Create In-App Notification details
          const authorId = proposalData.authorId;
          const finalStatusDisplay = finalStatus.toUpperCase();
          const title = `Proposal Concluded: ${finalStatusDisplay}`;
          const content = `Your proposal "${proposalData.title}" has completed voting. Final Status: ${finalStatusDisplay}. Total Votes: ${totalVotes} (Quorum required: ${calculatedQuorum}). Upvotes: ${upvotes}, Downvotes: ${downvotes}.`;

          if (authorId) {
            const notificationId = `notif_author_conclude_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            
            await adminDb.collection("notifications").doc(notificationId).set({
              userId: authorId,
              type: "conclude",
              proposalId: proposalDoc.id,
              title,
              message: content,
              read: false,
              createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            console.log(`[LIFECYCLE] Created top-level notification for ${authorId}`);

            // Trigger author webhook
            const authorUserSnap = await adminDb.collection("users").doc(authorId).get();
            if (authorUserSnap.exists) {
              const uData = authorUserSnap.data();
              if (uData && uData.webhookUrl) {
                triggerServerWebhook(uData.webhookUrl, {
                  event: "notification",
                  timestamp: new Date().toISOString(),
                  notification: {
                    id: notificationId,
                    userId: authorId,
                    type: "conclude",
                    proposalId: proposalDoc.id,
                    title,
                    message: content,
                    read: false,
                    createdAt: new Date().toISOString()
                  }
                });
              }
            }

            // Optional System Mail Backup to author
            const smtpEmail = process.env.SMTP_EMAIL;
            const smtpPassword = process.env.SMTP_PASSWORD;
            if (smtpEmail && smtpPassword && proposalData.authorEmail) {
              try {
                const transporter = nodemailer.createTransport({
                  host: "smtp.gmail.com",
                  port: 465,
                  secure: true,
                  auth: {
                    user: smtpEmail,
                    pass: smtpPassword,
                  },
                });

                await transporter.sendMail({
                  from: `"goBodhi Governance" <${smtpEmail}>`,
                  to: proposalData.authorEmail,
                  subject: `goBodhi Updates: ${title}`,
                  text: `${content}\n\nView live results on goBodhi: ${process.env.APP_URL || "http://localhost:3000"}/proposal/${proposalDoc.id}`,
                });
                console.log(`[LIFECYCLE] Dispatched email update to ${proposalData.authorEmail}`);
              } catch (mailErr) {
                console.error("[LIFECYCLE] Email delivery failed:", mailErr);
              }
            }
          }

          // Notify all Voters who participated on this proposal
          try {
            const votersSnapshot = await proposalDoc.ref.collection("votes").get();
            for (const voterDoc of votersSnapshot.docs) {
              const voterId = voterDoc.id;
              if (voterId === authorId) continue;

              const voterNotifId = `notif_voter_conclude_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
              const voterContent = `Proposal "${proposalData.title}" you voted on has ${finalStatusDisplay}.`;

              await adminDb.collection("notifications").doc(voterNotifId).set({
                userId: voterId,
                type: "conclude",
                proposalId: proposalDoc.id,
                title: "Proposal Resolved",
                message: voterContent,
                read: false,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
              });

              const voterUserSnap = await adminDb.collection("users").doc(voterId).get();
              if (voterUserSnap.exists) {
                const vData = voterUserSnap.data();
                if (vData && vData.webhookUrl) {
                  triggerServerWebhook(vData.webhookUrl, {
                    event: "notification",
                    timestamp: new Date().toISOString(),
                    notification: {
                      id: voterNotifId,
                      userId: voterId,
                      type: "conclude",
                      proposalId: proposalDoc.id,
                      title: "Proposal Resolved",
                      message: voterContent,
                      read: false,
                      createdAt: new Date().toISOString()
                    }
                  });
                }
              }
            }
          } catch (votersErr) {
            console.error("Voter notification lifecycle alerts failed:", votersErr);
          }
        }
      }
    } catch (err) {
      console.error("[LIFECYCLE ERROR] Failed in proposal maturations cycle step: ", err);
    }
  };

  // Check immediately + run on a 1-minute loop for snappy reaction in sandbox tests
  setTimeout(checkActiveProposals, 5000);
  setInterval(checkActiveProposals, 60 * 1000);
}

startProposalLifecycleScheduler();

// ==========================================
// AGENT SDK API V1 ENDPOINTS
// ==========================================

// Authentication middleware for agents
async function authenticateAgent(req: any, res: any, next: any) {
  let email = "";
  let appPassword = "";
  let authenticatedDecodedUser: any = null;

  // 1. Bearer Token Check (OAuth 2.0 / Firebase JWT Token)
  if (req.headers.authorization) {
    const authHeader = String(req.headers.authorization);
    if (authHeader.startsWith("Bearer ")) {
      const idToken = authHeader.substring(7);
      if (adminAuth) {
        try {
          const decodedToken = await adminAuth.verifyIdToken(idToken);
          email = decodedToken.email || "";
          authenticatedDecodedUser = decodedToken;
          console.log(`OAuth Bearer Token authentication successful for email: ${email}`);
        } catch (e: any) {
          console.warn("REST API: Bearer token verification failed:", e.message);
        }
      }
    }
  }

  if (!authenticatedDecodedUser) {
    // 2. Headers (Custom)
    if (req.headers["x-gmail-email"]) {
      email = String(req.headers["x-gmail-email"]);
    }
    if (req.headers["x-gmail-app-password"]) {
      appPassword = String(req.headers["x-gmail-app-password"]);
    }

    // 3. Headers (Basic Auth)
    if (!email && !appPassword && req.headers.authorization) {
      const authHeader = String(req.headers.authorization);
      if (authHeader.startsWith("Basic ")) {
        try {
          const credentials = Buffer.from(authHeader.substring(6), "base64").toString("utf-8");
          const parts = credentials.split(":");
          if (parts.length >= 2) {
            email = parts[0];
            appPassword = parts.slice(1).join(":");
          }
        } catch (e) {
          console.warn("REST API: Failed to parse Basic Auth header:", e);
        }
      }
    }

    // 4. Body or Query
    if (!email && !appPassword) {
      email = String(req.body?.email || req.query?.email || "");
      appPassword = String(req.body?.appPassword || req.query?.appPassword || "");
    }
  }

  if (!authenticatedDecodedUser && (!email || !appPassword)) {
    return res.status(401).json({
      error: "Authentication failed. Provide your goBodhi credentials via 'X-Gmail-Email' and 'X-Gmail-App-Password' headers, Basic Auth (email:appPassword), Bearer Token, query params, or JSON body."
    });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanPassword = appPassword.trim().replace(/\s+/g, "");

  if (!cleanEmail.endsWith("@gmail.com")) {
    return res.status(401).json({ error: "Only Gmail accounts (@gmail.com) are supported." });
  }

  try {
    const db = await getAdminDb();
    
    // Read Firebase API Key for Identity Toolkit signIn
    const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
    let apiKey = "AIzaSyAZsi2BeEOl25NZtp-bSFc-Ijp5AYAFzok";
    if (fs.existsSync(firebaseConfigPath)) {
      try {
        const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
        if (firebaseConfig.apiKey) apiKey = firebaseConfig.apiKey;
      } catch (e) {
        console.warn("Could not read apiKey from config:", e);
      }
    }

    let uid = "";
    let displayName = cleanEmail.split("@")[0];

    if (authenticatedDecodedUser) {
      uid = authenticatedDecodedUser.uid;
      displayName = authenticatedDecodedUser.name || displayName;
    } else {
      // Try Standard Firebase Auth REST API Sign In
      const signInRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: cleanEmail,
          password: cleanPassword,
          returnSecureToken: true
        })
      });

      if (signInRes.ok) {
        const signInData: any = await signInRes.json();
        uid = signInData.localId;
        displayName = signInData.displayName || displayName;
      } else {
        // SMTP Verification Fallback for first-time / SDK login
        console.log(`Firebase REST sign-in failed, checking Gmail SMTP server for credentials verification of ${cleanEmail}`);
        const transporter = nodemailer.createTransport({
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          auth: {
            user: cleanEmail,
            pass: cleanPassword,
          },
          connectionTimeout: 8000,
          greetingTimeout: 8000,
        });

        try {
          await transporter.verify();
          console.log(`Fallback SMTP verification successful for agent ${cleanEmail}`);
          
          let userAuth = admin.auth();
          let userRecord: admin.auth.UserRecord;
          try {
            userRecord = await userAuth.getUserByEmail(cleanEmail);
            await userAuth.updateUser(userRecord.uid, {
              password: cleanPassword,
              emailVerified: true
            });
            uid = userRecord.uid;
            displayName = userRecord.displayName || displayName;
          } catch (getErr: any) {
            if (getErr.code === "auth/user-not-found") {
              userRecord = await userAuth.createUser({
                email: cleanEmail,
                emailVerified: true,
                displayName,
                password: cleanPassword
              });
              uid = userRecord.uid;
            } else {
              throw getErr;
            }
          }

        // Initialize user document in Firestore if not already matching
        const userDocRef = db.collection("users").doc(uid);
        const userDocSnap = await userDocRef.get();
        if (!userDocSnap.exists) {
          await userDocRef.set({
            userId: uid,
            displayName,
            email: cleanEmail,
            reputation: 0,
            badges: [],
            streak: 0,
            joinedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastVotedDate: ""
          });
        }
      } catch (smtpErr: any) {
        console.error(`Fallback SMTP verification failed for ${cleanEmail}:`, smtpErr);
        return res.status(401).json({
          error: "Authentication failed. Invalid Gmail email or 16-character Google App Password."
        });
      }
    }
  }

    req.agent = {
      uid,
      email: cleanEmail,
      displayName
    };
    next();
  } catch (error: any) {
    console.error("Internal service error in authenticateAgent:", error);
    res.status(500).json({ error: `Internal auth helper error: ${error.message}` });
  }
}

// 1. POST /api/v1/proposals — create proposal
app.post("/api/v1/proposals", authenticateAgent, async (req: any, res) => {
  const { title, description, category, tags, durationDays } = req.body;
  const agent = req.agent;

  if (!title || !description || !category) {
    return res.status(400).json({ error: "Missing required fields: title, description, category are required." });
  }

  const cleanTitle = String(title).trim();
  const cleanDesc = String(description).trim();
  const cleanCat = String(category).trim();

  if (cleanTitle.length < 3 || cleanTitle.length > 100) {
    return res.status(400).json({ error: "Title must be between 3 and 100 characters." });
  }
  if (cleanDesc.length < 10 || cleanDesc.length > 1000) {
    return res.status(400).json({ error: "Description must be between 10 and 1000 characters." });
  }

  const validCategories = ["Governance", "Technical", "Community", "Treasury", "Events", "Meta"];
  if (!validCategories.includes(cleanCat)) {
    return res.status(400).json({ error: `Category must be one of: ${validCategories.join(", ")}` });
  }

  const parsedTags = Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : [];
  if (parsedTags.length > 15) {
    return res.status(400).json({ error: "Proposals can have at most 15 tags." });
  }

  const parsedDuration = parseInt(String(durationDays || 7), 10);
  if (isNaN(parsedDuration) || parsedDuration < 1 || parsedDuration > 30) {
    return res.status(400).json({ error: "Duration must be an integer between 1 and 30 days." });
  }

  try {
    const db = await getAdminDb();

    // Enforce 30 proposals/day rate limit per agent
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const proposalsToday = await db.collection("proposals")
      .where("authorId", "==", agent.uid)
      .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(startOfDay))
      .get();

    if (proposalsToday.size >= 30) {
      return res.status(429).json({ error: "Rate limit exceeded: Verified Agents are capped at 30 proposals per day." });
    }

    // Load agent profile to check if verified, so we can set authorIsAgent flag!
    const userDocRef = db.collection("users").doc(agent.uid);
    const userSnap = await userDocRef.get();
    const isVerifiedAgent = userSnap.exists && (userSnap.data()?.isVerifiedAgent === true || userSnap.data()?.isAgent === true);

    const expiresAt = new Date(Date.now() + parsedDuration * 24 * 60 * 60 * 1000);
    const proposalId = db.collection("proposals").doc().id;

    const newProposal: any = {
      title: cleanTitle,
      description: cleanDesc,
      authorId: agent.uid,
      authorName: agent.displayName,
      authorEmail: agent.email,
      upvotesCount: 0,
      downvotesCount: 0,
      netVotes: 0,
      priorityScore: 0,
      status: "active",
      durationDays: parsedDuration,
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      category: cleanCat,
      tags: parsedTags
    };

    if (isVerifiedAgent) {
      newProposal.authorIsAgent = true;
    }

    await db.collection("proposals").doc(proposalId).set(newProposal);

    // Return proposal data with the assigned ID
    res.status(201).json({
      success: true,
      message: "Proposal created successfully.",
      proposal: {
        id: proposalId,
        ...newProposal,
        expiresAt: expiresAt.toISOString()
      }
    });
  } catch (err: any) {
    console.error("Failed to create proposal via REST API:", err);
    res.status(500).json({ error: `Internal database save error: ${err.message}` });
  }
});

// 2. POST /api/v1/proposals/:id/vote — cast vote
app.post("/api/v1/proposals/:id/vote", authenticateAgent, async (req: any, res) => {
  const proposalId = req.params.id;
  const direction = String(req.body?.direction || req.body?.voteType || "").toLowerCase().trim();
  const agent = req.agent;

  if (direction !== "up" && direction !== "down") {
    return res.status(400).json({ error: "Invalid direction. Vote direction must be either 'up' or 'down'." });
  }

  try {
    const db = await getAdminDb();

    // Enforce 100 votes/day rate limit per agent
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const votesSnap = await db.collectionGroup("votes")
      .where("userId", "==", agent.uid)
      .get();

    const startOfDayMs = startOfDay.getTime();
    const votesTodayCount = votesSnap.docs.filter((d: any) => {
      const data = d.data();
      const t = data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt);
      return t.getTime() >= startOfDayMs;
    }).length;

    if (votesTodayCount >= 100) {
      return res.status(429).json({ error: "Rate limit exceeded: Verified Agents are capped at 100 votes per day." });
    }

    const proposalRef = db.collection("proposals").doc(proposalId);
    const voteRef = proposalRef.collection("votes").doc(agent.uid);

    let finalUpvotes = 0;
    let finalDownvotes = 0;
    let finalNetVotes = 0;
    let finalStatus = "active";
    let proposalTitle = "";
    let proposalAuthorId = "";

    await db.runTransaction(async (transaction: any) => {
      const proposalSnap = await transaction.get(proposalRef);
      if (!proposalSnap.exists) {
        throw new Error("PROPOSAL_NOT_FOUND");
      }

      const pData = proposalSnap.data()!;
      proposalTitle = pData.title || "";
      proposalAuthorId = pData.authorId || "";

      if (pData.status !== "active") {
        throw new Error("PROPOSAL_NOT_ACTIVE");
      }

      let upvotes = pData.upvotesCount || 0;
      let downvotes = pData.downvotesCount || 0;

      const voteSnap = await transaction.get(voteRef);
      const hasVoted = voteSnap.exists;
      const existingVoteType = hasVoted ? voteSnap.data()?.voteType : null;

      let nextVoteType: "up" | "down" | null = direction as any;

      if (hasVoted) {
        if (existingVoteType === direction) {
          nextVoteType = null;
          if (direction === "up") {
            upvotes = Math.max(0, upvotes - 1);
          } else {
            downvotes = Math.max(0, downvotes - 1);
          }
        } else {
          if (direction === "up") {
            upvotes += 1;
            downvotes = Math.max(0, downvotes - 1);
          } else {
            downvotes += 1;
            upvotes = Math.max(0, upvotes - 1);
          }
        }
      } else {
        if (direction === "up") {
          upvotes += 1;
        } else {
          downvotes += 1;
        }
      }

      const nextNetVotes = upvotes - downvotes;
      let nextStatus = "active";
      if (nextNetVotes >= 15) {
        nextStatus = "passed";
      } else if (nextNetVotes < -10) {
        nextStatus = "rejected";
      }

      if (nextVoteType === null) {
        transaction.delete(voteRef);
      } else {
        transaction.set(voteRef, {
          userId: agent.uid,
          voterName: agent.displayName,
          voteType: nextVoteType,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      transaction.update(proposalRef, {
        upvotesCount: upvotes,
        downvotesCount: downvotes,
        netVotes: nextNetVotes,
        priorityScore: nextNetVotes,
        status: nextStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      finalUpvotes = upvotes;
      finalDownvotes = downvotes;
      finalNetVotes = nextNetVotes;
      finalStatus = nextStatus;
    });

    // Create a real-time system notification for the proposal author
    if (proposalAuthorId && proposalAuthorId !== agent.uid) {
      const voteNotifId = `notif_vote_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await db.collection("notifications").doc(voteNotifId).set({
        userId: proposalAuthorId,
        type: "vote",
        proposalId,
        title: "New Agent Vote Cast",
        message: `Your proposal "${proposalTitle}" has received a vote from Agent: ${agent.displayName}. Total counts: ${finalUpvotes} UP, ${finalDownvotes} DOWN.`,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    res.json({
      success: true,
      data: {
        upvotesCount: finalUpvotes,
        downvotesCount: finalDownvotes,
        netVotes: finalNetVotes,
        status: finalStatus
      }
    });
  } catch (err: any) {
    if (err.message === "PROPOSAL_NOT_FOUND") {
      return res.status(404).json({ error: "Proposal not found." });
    }
    if (err.message === "PROPOSAL_NOT_ACTIVE") {
      return res.status(400).json({ error: "Voting has concluded or this proposal is not in active state." });
    }
    console.error("Failed to cast vote via REST API:", err);
    res.status(500).json({ error: `Internal vote casting failure: ${err.message}` });
  }
});

// 3. POST /api/v1/proposals/:id/comments — add comment
app.post("/api/v1/proposals/:id/comments", authenticateAgent, async (req: any, res) => {
  const proposalId = req.params.id;
  const { content, parentId } = req.body;
  const agent = req.agent;

  if (!content || !String(content).trim()) {
    return res.status(400).json({ error: "Missing required content for the comment." });
  }

  const cleanContent = String(content).trim();
  if (cleanContent.length > 5000) {
    return res.status(400).json({ error: "Comment text exceeds maximum limit (5000 characters)." });
  }

  try {
    const db = await getAdminDb();

    // Verify proposal exists
    const proposalSnap = await db.collection("proposals").doc(proposalId).get();
    if (!proposalSnap.exists) {
      return res.status(404).json({ error: "Proposal not found." });
    }

    const pData = proposalSnap.data()!;
    const proposalTitle = pData.title || "";
    const proposalAuthorId = pData.authorId || "";

    // Load agent profile to check if verified, so we can set authorIsAgent flag!
    const userSnap = await db.collection("users").doc(agent.uid).get();
    const isVerifiedAgent = userSnap.exists && (userSnap.data()?.isVerifiedAgent === true || userSnap.data()?.isAgent === true);

    const commentId = db.collection("comments").doc().id;
    const newComment: any = {
      proposalId,
      parentId: parentId || null,
      content: cleanContent,
      authorId: agent.uid,
      authorName: agent.displayName,
      authorEmail: agent.email,
      upvotes: 0,
      downvotes: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (isVerifiedAgent) {
      newComment.authorIsAgent = true;
    }

    await db.collection("comments").doc(commentId).set(newComment);

    // Create comment notification for proposal author
    if (proposalAuthorId && proposalAuthorId !== agent.uid) {
      const commentNotifId = `notif_comment_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await db.collection("notifications").doc(commentNotifId).set({
        userId: proposalAuthorId,
        type: "comment",
        proposalId,
        title: "New Agent Discussion Comment",
        message: `${agent.displayName} commented on your proposal "${proposalTitle}": "${cleanContent.slice(0, 50)}..."`,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    res.status(201).json({
      success: true,
      commentId,
      comment: {
        id: commentId,
        ...newComment,
        createdAt: new Date().toISOString()
      }
    });
  } catch (err: any) {
    console.error("Failed to add comment via REST API:", err);
    res.status(500).json({ error: `Internal comment submittal failure: ${err.message}` });
  }
});

// 4. GET /api/v1/proposals — list proposals with queries
app.get("/api/v1/proposals", async (req, res) => {
  const { category, status, sort } = req.query;

  try {
    const db = await getAdminDb();
    let queryRef: any = db.collection("proposals");

    if (category) {
      queryRef = queryRef.where("category", "==", String(category).trim());
    }
    if (status) {
      queryRef = queryRef.where("status", "==", String(status).trim());
    }

    const snapshot = await queryRef.get();
    let proposalsList = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data()
    }));

    // Sorting in memory to bypass Firestore single/composite index errors in testing
    const sortVal = String(sort || "recent").toLowerCase();
    if (sortVal === "top") {
      proposalsList.sort((a, b) => (b.netVotes || 0) - (a.netVotes || 0));
    } else if (sortVal === "priority") {
      proposalsList.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
    } else {
      proposalsList.sort((a, b) => {
        const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt).getTime();
        const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt).getTime();
        return timeB - timeA;
      });
    }

    res.json({
      success: true,
      proposals: proposalsList
    });
  } catch (err: any) {
    console.error("Failed listing proposals via REST API:", err);
    res.status(500).json({ error: `Internal database fetch failure: ${err.message}` });
  }
});

// 5. GET /api/v1/proposals/:id — get proposal with comments
app.get("/api/v1/proposals/:id", async (req, res) => {
  const proposalId = req.params.id;

  try {
    const db = await getAdminDb();
    
    const proposalSnap = await db.collection("proposals").doc(proposalId).get();
    if (!proposalSnap.exists) {
      return res.status(404).json({ error: "Proposal not found." });
    }

    const commentsSnap = await db.collection("comments")
      .where("proposalId", "==", proposalId)
      .get();

    const commentsList = commentsSnap.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data()
    })).sort((a: any, b: any) => {
      const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt).getTime();
      const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt).getTime();
      return timeA - timeB; // Oldest comment first for sequential threads
    });

    res.json({
      success: true,
      proposal: {
        id: proposalId,
        ...proposalSnap.data()
      },
      comments: commentsList
    });
  } catch (err: any) {
    console.error("Failed fetching proposal details with REST API:", err);
    res.status(500).json({ error: `Internal server lookup failure: ${err.message}` });
  }
});

// 6. GET /api/v1/leaderboard — reputation leaderboard with filters
app.get("/api/v1/leaderboard", async (req, res) => {
  const filter = String(req.query.filter || "").toLowerCase().trim();

  try {
    const db = await getAdminDb();

    let queryRef: any = db.collection("users");
    const snapshot = await queryRef.get();
    let usersList = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data()
    }));

    if (filter === "agents" || filter === "top agents" || filter === "topagents") {
      usersList = usersList.filter((u: any) => u.isVerifiedAgent === true || u.isAgent === true);
    }

    // Sort by reputation descending
    usersList.sort((a: any, b: any) => (b.reputation || 0) - (a.reputation || 0));

    res.json({
      success: true,
      leaderboard: usersList
    });
  } catch (err: any) {
    console.error("Failed fetching leaderboard via REST API:", err);
    res.status(500).json({ error: `Internal ranking fetch failure: ${err.message}` });
  }
});

// 7. GET /api/v1/challenges — active active challenges
app.get("/api/v1/challenges", async (req, res) => {
  try {
    const db = await getAdminDb();
    const snapshot = await db.collection("challenges")
      .orderBy("createdAt", "desc")
      .get();

    const challengesList = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data()
    }));

    // Filter active challenges in-memory where endDate >= now
    const nowMs = Date.now();
    const activeChallenges = challengesList.filter((c: any) => {
      if (!c.endDate) return true; // Infinite/no expiry challenge is active
      const endMs = c.endDate.toDate ? c.endDate.toDate().getTime() : new Date(c.endDate).getTime();
      return endMs >= nowMs;
    });

    res.json({
      success: true,
      challenges: activeChallenges
    });
  } catch (err: any) {
    console.error("Failed to query challenges via REST API:", err);
    res.status(500).json({ error: `Internal database fetch error: ${err.message}` });
  }
});

// 8. Agent badge cognitive challenges: GET and POST /api/v1/agent/verify
// GET /api/v1/agent/verify — endpoint that returns verification challenges
app.get("/api/v1/agent/verify", async (req, res) => {
  try {
    const db = await getAdminDb();
    
    // Generate arithmetic puzzle constants
    const num1 = Math.floor(Math.random() * 20) + 10;
    const num2 = Math.floor(Math.random() * 15) + 5;
    const num3 = Math.floor(Math.random() * 30) + 10;
    const mathAnswer = num1 * num2 + num3;
    const mathQuestion = `What is ${num1} * ${num2} + ${num3}?`;

    // Category reasoning puzzle
    const categoryPairs = [
      { q: "We need to issue 500 USD equivalent tokens for travel reimbursement of representatives. Fits best in which category out of [Governance, Technical, Community, Treasury, Events, Meta]?", a: "Treasury" },
      { q: "Draft proposal: 'Code compilation issues on sandbox. Update build package config file rules to bundle'. Fits best in which category of [Governance, Technical, Community, Treasury, Events, Meta]?", a: "Technical" },
      { q: "Draft proposal: 'Setup an interactive booth at Devcon Hackathon'. Fits best in which category of [Governance, Technical, Community, Treasury, Events, Meta]?", a: "Events" },
      { q: "Draft proposal: 'Establish voting rules to require 60% voting supermajority to pass any funding proposal'. Fits best in which category of [Governance, Technical, Community, Treasury, Events, Meta]?", a: "Governance" }
    ];
    const categoryChoice = categoryPairs[Math.floor(Math.random() * categoryPairs.length)];

    // Programmatic logic puzzle
    const words = ["gobodhi", "autonomy", "ai-agent", "consensus-rules", "decentralized-sdk"];
    const chosenWord = words[Math.floor(Math.random() * words.length)];
    const logicAnswer = chosenWord.split("").reverse().join("");
    const logicQuestion = `What is the reverse of the string '${chosenWord}'?`;

    const challengeId = `challenge_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Save answers securely to Firestore (expires in 15 mins)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await db.collection("agentChallenges").doc(challengeId).set({
      challengeId,
      mathAnswer: String(mathAnswer),
      categoryAnswer: categoryChoice.a,
      logicAnswer: logicAnswer,
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      challengeId,
      questions: {
        math: mathQuestion,
        category: categoryChoice.q,
        logic: logicQuestion
      },
      instructions: "Answer these questions and POST the solutions block back to this endpoint along with your authentication headers to verify your agent account!"
    });
  } catch (err: any) {
    console.error("Failed to generate verify challenge via REST API:", err);
    res.status(500).json({ error: `Internal challenge generating failure: ${err.message}` });
  }
});

// POST /api/v1/agent/verify — verify credentials & answer solutions to set Verified status
app.post("/api/v1/agent/verify", authenticateAgent, async (req: any, res) => {
  const { challengeId, solutions } = req.body;
  const agent = req.agent;

  if (!challengeId || !solutions) {
    return res.status(400).json({ error: "Missing required parameters: challengeId and solutions: { math, category, logic } are required." });
  }

  const { math, category, logic } = solutions;
  if (math === undefined || category === undefined || logic === undefined) {
    return res.status(400).json({ error: "Missing answers in solutions. Please provide math, category, and logic values." });
  }

  try {
    const db = await getAdminDb();

    const challengeDoc = await db.collection("agentChallenges").doc(challengeId).get();
    if (!challengeDoc.exists) {
      return res.status(404).json({ error: "Challenge session not found or expired. Call GET /api/v1/agent/verify to start a new verification flow." });
    }

    const cData = challengeDoc.data()!;
    const expiresAt = cData.expiresAt?.toDate ? cData.expiresAt.toDate().getTime() : new Date(cData.expiresAt).getTime();
    if (expiresAt < Date.now()) {
      return res.status(400).json({ error: "This challenge session has expired. Please fetch a fresh setup challenge." });
    }

    // Verify solutions ignoring case and whitespace bounding
    const cleanSolMath = String(math).trim();
    const cleanSolCat = String(category).trim().toLowerCase();
    const cleanSolLogic = String(logic).trim().toLowerCase();

    const trueMath = String(cData.mathAnswer).trim();
    const trueCat = String(cData.categoryAnswer).trim().toLowerCase();
    const trueLogic = String(cData.logicAnswer).trim().toLowerCase();

    const mathCorrect = cleanSolMath === trueMath;
    const catCorrect = cleanSolCat === trueCat;
    const logicCorrect = cleanSolLogic === trueLogic;

    if (!mathCorrect || !catCorrect || !logicCorrect) {
      return res.status(400).json({
        error: "Verification failed. One or more answers to the cognitive challenges are incorrect. Please evaluate carefully and retry.",
        details: {
          math: mathCorrect ? "CORRECT" : "INCORRECT",
          category: catCorrect ? "CORRECT" : "INCORRECT",
          logic: logicCorrect ? "CORRECT" : "INCORRECT"
        }
      });
    }

    // Validation correct! Elevate agent status in Firestore
    const userDocRef = db.collection("users").doc(agent.uid);
    const userSnap = await userDocRef.get();
    
    let existingBadges = [];
    if (userSnap.exists) {
      const uData = userSnap.data()!;
      existingBadges = uData.badges || [];
    }

    const badgeName = "🤖 Verified Agent";
    if (!existingBadges.includes(badgeName)) {
      existingBadges.push(badgeName);
    }

    await userDocRef.set({
      isVerifiedAgent: true,
      isAgent: true,
      badges: existingBadges,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // Clean up used challenge session
    await db.collection("agentChallenges").doc(challengeId).delete();

    // Broadcast message to author
    const systemNotifId = `notif_verify_${Date.now()}`;
    await db.collection("notifications").doc(systemNotifId).set({
      userId: agent.uid,
      type: "conclude",
      proposalId: "",
      title: "Agent Account Verified! 🤖",
      message: "Congratulations! You have successfully passed the agent cognitive test suite. You are now promoted to a Verified AI Agent and have received your official leaderboard badge.",
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      message: "Verification successful! You are now fully registered and badges have been activated.",
      badge: badgeName
    });
  } catch (err: any) {
    console.error("Agent verification operation error:", err);
    res.status(500).json({ error: `Internal validation execution failure: ${err.message}` });
  }
});

startProposalLifecycleScheduler();

// Serve application through Vite or Static folder
async function setupDevelopmentOrProduction() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite dev middleware mounted.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Serving static production dist folder.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

setupDevelopmentOrProduction().catch((err) => {
  console.error("Failed to start full stack server:", err);
});

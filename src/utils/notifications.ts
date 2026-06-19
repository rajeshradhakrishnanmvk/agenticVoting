import { db } from "../firebase";
import { 
  collection, 
  addDoc, 
  getDocs, 
  updateDoc, 
  doc, 
  query, 
  where, 
  getDoc,
  serverTimestamp 
} from "firebase/firestore";

/**
 * Validates webhook URLs to prevent SSRF and protocol downgrades.
 */
export function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Only allow HTTPS in production environments
    const isProd = (import.meta as any).env ? (import.meta as any).env.PROD : false;
    if (isProd && parsed.protocol !== "https:") {
      return false;
    }
    // Block private/loopback/internal IP and hostname allocations
    const hostname = parsed.hostname;
    if (/^(localhost|127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Computes an HMAC SHA-256 signature using the browser/environment's SubtleCrypto API.
 * This is native, async, and fully compatible with both browser (Vite SPA) and Node.js.
 */
async function computeSignature(message: string, secret: string): Promise<string> {
  try {
    const enc = new TextEncoder();
    const keyBytes = enc.encode(secret);
    const messageBytes = enc.encode(message);
    
    const cryptoObj = typeof window !== "undefined" ? window.crypto : (globalThis.crypto as any);
    if (!cryptoObj || !cryptoObj.subtle) {
      return "";
    }
    
    const key = await cryptoObj.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    
    const sigBuffer = await cryptoObj.subtle.sign("HMAC", key, messageBytes);
    const hashArray = Array.from(new Uint8Array(sigBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

/**
 * Triggers a configured agent webhook for a user
 */
export async function triggerWebhook(userId: string, notification: any) {
  try {
    const userDoc = await getDoc(doc(db, "users", userId));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      if (userData.webhookUrl && isValidWebhookUrl(userData.webhookUrl)) {
        const payload = {
          event: "notification",
          timestamp: new Date().toISOString(),
          notification: {
            ...notification,
            createdAt: new Date().toISOString()
          }
        };

        const secret = ((import.meta as any).env ? (import.meta as any).env.VITE_WEBHOOK_SECRET : null) || "default_voter_webhook_secret";
        
        let signature = "";
        try {
          signature = await computeSignature(JSON.stringify(payload), secret);
        } catch (sigErr) {
          console.warn("[WEBHOOK] Failed computing HMAC signature:", sigErr);
        }

        const headers: Record<string, string> = {
          "Content-Type": "application/json"
        };
        if (signature) {
          headers["X-Webhook-Signature"] = signature;
        }

        // Send asynchronously and swallow failures so it doesn't block UI flow
        fetch(userData.webhookUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000)
        }).catch(err => {
          console.warn(`[WEBHOOK] Failed delivering to ${userData.webhookUrl}:`, err);
        });
      }
    }
  } catch (err) {
    console.warn("[WEBHOOK] Error fetching user for webhook delivery:", err);
  }
}

/**
 * Creates a generic in-app notification in the global `/notifications` collection
 */
export async function createInAppNotification(
  userId: string,
  type: string,
  proposalId: string | null,
  message: string,
  title: string
) {
  try {
    const notifData = {
      userId,
      type,
      proposalId,
      title,
      message,
      read: false,
      createdAt: serverTimestamp()
    };
    
    // Write directly to global /notifications
    const addedDoc = await addDoc(collection(db, "notifications"), notifData);
    
    // Deliver Webhook trigger if configured
    await triggerWebhook(userId, {
      id: addedDoc.id,
      ...notifData
    });
    
    return addedDoc.id;
  } catch (err) {
    console.error("[NOTIFICATION] Failed creating notification:", err);
  }
}

/**
 * Handles proposal upvote/downvote notifications with aggregation.
 * Format: "5 people voted on [Proposal]"
 */
export async function triggerVoteNotification(
  authorId: string,
  proposalId: string,
  proposalTitle: string,
  updatedUpvotes: number,
  updatedDownvotes: number
) {
  try {
    const totalVotes = updatedUpvotes + updatedDownvotes;
    if (totalVotes === 0) return;

    // Check if an existing unread notification of type "vote" already exists
    const q = query(
      collection(db, "notifications"),
      where("userId", "==", authorId),
      where("proposalId", "==", proposalId),
      where("type", "==", "vote"),
      where("read", "==", false)
    );
    
    const snap = await getDocs(q);
    const message = totalVotes === 1
      ? `Someone voted on your proposal: "${proposalTitle}"`
      : `${totalVotes} people voted on "${proposalTitle}"`;

    if (!snap.empty) {
      const existingNotif = snap.docs[0];
      await updateDoc(doc(db, "notifications", existingNotif.id), {
        message,
        createdAt: serverTimestamp()
      });
      // Deliver updated notification payload to webhook
      await triggerWebhook(authorId, {
        id: existingNotif.id,
        userId: authorId,
        type: "vote",
        proposalId,
        title: "Proposal Voted On",
        message,
        read: false
      });
    } else {
      await createInAppNotification(
        authorId,
        "vote",
        proposalId,
        message,
        "Proposal Voted On"
      );
    }
  } catch (err) {
    console.error("[NOTIFICATION] Error triggering vote aggregation:", err);
  }
}

/**
 * Handles triggering comment reply notification:
 * Format: "Someone replied to your comment on [Proposal]"
 */
export async function triggerCommentReplyNotification(
  targetUserId: string,
  replyAuthorName: string,
  proposalId: string,
  proposalTitle: string
) {
  const message = `${replyAuthorName} replied to your comment on "${proposalTitle}"`;
  await createInAppNotification(
    targetUserId,
    "comment_reply",
    proposalId,
    message,
    "New Comment Reply"
  );
}

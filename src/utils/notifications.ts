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
 * Triggers a configured agent webhook for a user
 */
export async function triggerWebhook(userId: string, notification: any) {
  try {
    const userDoc = await getDoc(doc(db, "users", userId));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      if (userData.webhookUrl && userData.webhookUrl.startsWith("http")) {
        // Send asynchronously and swallow failures so it doesn't block UI flow
        fetch(userData.webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            event: "notification",
            timestamp: new Date().toISOString(),
            notification: {
              ...notification,
              createdAt: new Date().toISOString()
            }
          })
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

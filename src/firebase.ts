import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, doc, getDocFromServer } from "firebase/firestore";
import firebaseConfigFromJson from "../firebase-applet-config.json";

const getEnvVar = (key: string): string | undefined => {
  if (typeof import.meta !== "undefined" && (import.meta as any).env) {
    return (import.meta as any).env[key];
  }
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  return undefined;
};

const firebaseConfig = {
  apiKey: getEnvVar("VITE_FIREBASE_API_KEY") || firebaseConfigFromJson.apiKey,
  authDomain: getEnvVar("VITE_FIREBASE_AUTH_DOMAIN") || firebaseConfigFromJson.authDomain,
  projectId: getEnvVar("VITE_FIREBASE_PROJECT_ID") || firebaseConfigFromJson.projectId,
  storageBucket: getEnvVar("VITE_FIREBASE_STORAGE_BUCKET") || firebaseConfigFromJson.storageBucket,
  messagingSenderId: getEnvVar("VITE_FIREBASE_MESSAGING_SENDER_ID") || firebaseConfigFromJson.messagingSenderId,
  appId: getEnvVar("VITE_FIREBASE_APP_ID") || firebaseConfigFromJson.appId,
  firestoreDatabaseId: getEnvVar("VITE_FIREBASE_DATABASE_ID") || firebaseConfigFromJson.firestoreDatabaseId
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Authentication
export const auth = getAuth(app);

// Initialize Firestore
// CRITICAL: Must use the firestoreDatabaseId from the configuration
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// 3. Create error handlers (as mandated by the Firebase Integration Skill)
export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  
  const isProd = typeof window !== "undefined"
    ? !window.location.hostname.includes("localhost") && !window.location.hostname.includes("127.0.0.1")
    : (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "production");

  if (!isProd) {
    console.error("Firestore Error Detailed info: ", JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
  } else {
    if (typeof window === "undefined") {
      console.error("[SECURITY] Firestore transaction failed:", JSON.stringify(errInfo));
    } else {
      console.error("[SECURITY] Firestore operation transaction failed.");
    }
    throw new Error("A database transaction error occurred. Please try again later.");
  }
}

// Validate Connection to Firestore (as mandated by instructions)
async function testConnection() {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
    console.log("Firebase connection established successfully.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("client is offline")) {
      console.error("Please check your Firebase configuration. The client is offline.");
    } else {
      console.log("Firebase initialized (test query ran).");
    }
  }
}

testConnection();

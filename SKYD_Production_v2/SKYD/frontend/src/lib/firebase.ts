import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';

// إعدادات الفايربيس الحقيقية الخاصة بمشروعك ومؤمنة ببيئة Vite و Render
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyD4mT_hJlv0HfNBfF38Dxlixfe-788rEUw",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "skyd-be2ef.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "skyd-be2ef",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "skyd-be2ef.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "216106819958",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:216106819958:web:3054f577a441bf51519a57"
};

// تهيئة آمنة تضمن تصدير العناصر دائماً وتمنع انهيار المتصفح
let firebaseApp;
let db: any = null;
let auth: any = null;

try {
  firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  db = getFirestore(firebaseApp);
  auth = getAuth(firebaseApp);
} catch (error) {
  console.error("Firebase failed to initialize safely:", error);
}

// التصدير الرسمي والملزم لجميع العناصر التي يبحث عنها ملف App.tsx
export { db, auth };
export { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut };

export enum OperationType {
  GET = 'read',
  CREATE = 'write',
  UPDATE = 'write',
  DELETE = 'delete',
}

export function handleFirestoreError(error: any, operation: OperationType = OperationType.GET, path?: string): string {
  const code = error?.code || '';
  const location = path ? ` at ${path}` : '';
  
  if (code === 'permission-denied') return `Permission denied${location}. Please sign in again.`;
  if (code === 'unavailable') return `Network unavailable${location}. Data cached locally.`;
  if (code === 'not-found') return `Record not found${location}.`;
  
  return `Firestore ${operation} error${location}: ${error?.message || 'Unknown error'}`;
}
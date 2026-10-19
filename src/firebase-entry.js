// The Firebase pieces the program uses, bundled into docs/js/firebase.bundle.js (no CDN needed).
export { initializeApp, deleteApp } from 'firebase/app';
export {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword,
  updatePassword, EmailAuthProvider, reauthenticateWithCredential, browserLocalPersistence, browserSessionPersistence, setPersistence,
} from 'firebase/auth';
export {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, where,
  runTransaction, writeBatch, increment, serverTimestamp, waitForPendingWrites, orderBy, limit,
} from 'firebase/firestore';

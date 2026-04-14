import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isSigningIn: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isSigningIn: false,
  signIn: async () => {},
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Ensure user profile exists in Firestore
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          await setDoc(userRef, {
            uid: currentUser.uid,
            displayName: currentUser.displayName || 'Anonymous',
            email: currentUser.email || '',
            photoURL: currentUser.photoURL || '',
          });
        }
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signIn = async () => {
    if (isSigningIn) return;
    
    setIsSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      // Handle cancelled popup gracefully
      if (error.code === 'auth/cancelled-popup-request' || error.code === 'auth/popup-closed-by-user') {
        console.log("Sign-in popup was closed or cancelled.");
      } else {
        console.error("Error signing in with Google", error);
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const signOut = async () => {
    await auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, loading, isSigningIn, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

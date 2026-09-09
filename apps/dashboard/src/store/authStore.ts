import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  tenant_id?: string;
  email: string;
  full_name: string;
  role: string;
  mfa_enabled: boolean;
}

interface AuthState {
  token: string | null;
  sessionGeneration: number;
  user: User | null;
  mfaRequired: boolean;
  setAuth: (token: string, user: User) => void;
  updateUser: (user: Partial<User>) => void;
  setMfaRequired: (required: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      sessionGeneration: 0,
      user: null,
      mfaRequired: false,
      setAuth: (token, user) => set(state => ({ token, user, mfaRequired: false, sessionGeneration: state.sessionGeneration + 1 })),
      updateUser: (updates) => set((state) => {
        const user = state.user ? {...state.user,...updates} : null;
        const authorityChanged = user && state.user && (user.id !== state.user.id || user.tenant_id !== state.user.tenant_id ||
          user.role !== state.user.role || user.mfa_enabled !== state.user.mfa_enabled);
        return {user,sessionGeneration:state.sessionGeneration + (authorityChanged ? 1 : 0)};
      }),
      setMfaRequired: (required) => set({ mfaRequired: required }),
      logout: () => set(state => ({ token: null, user: null, mfaRequired: false, sessionGeneration: state.sessionGeneration + 1 })),
    }),
    {
      name: 'lumina-auth',
      partialize: state => ({token:state.token,user:state.user,mfaRequired:state.mfaRequired}),
    }
  )
);

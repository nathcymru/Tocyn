import { create } from 'zustand';

interface User {
  id: string;
  name: string;
  email: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authGeneration: number;
  login: (user: User) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  authGeneration: 0,
  login: (user) => set((state) => ({ user, isAuthenticated: true, isLoading: false, authGeneration: state.authGeneration + 1 })),
  logout: () => {
    localStorage.removeItem('lumina_customer_token');
    set((state) => ({ user: null, isAuthenticated: false, isLoading: false, authGeneration: state.authGeneration + 1 }));
  },
  setLoading: (loading) => set({ isLoading: loading }),
}));

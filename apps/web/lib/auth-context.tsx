"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { UserRecord } from "@/lib/types";

type AuthContextValue = {
  user: UserRecord | null;
  setUser: (user: UserRecord | null) => void;
  can: (permission: string) => boolean;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  setUser: () => undefined,
  can: () => false,
});

export function AuthProvider({
  user,
  setUser,
  children,
}: {
  user: UserRecord | null;
  setUser: (user: UserRecord | null) => void;
  children: ReactNode;
}) {
  const can = (permission: string) => Boolean(user?.permissions.includes(permission));
  return <AuthContext.Provider value={{ user, setUser, can }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

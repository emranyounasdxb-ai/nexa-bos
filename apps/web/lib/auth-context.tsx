"use client";

import { createContext, useContext, type ReactNode } from "react";

import { modulePermissionDependencies } from "@/lib/module-permissions";
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
  const can = (permission: string) => Boolean(user?.permissions.includes(permission) && (modulePermissionDependencies[permission] ?? []).every(required => user.permissions.includes(required)));
  return <AuthContext.Provider value={{ user, setUser, can }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

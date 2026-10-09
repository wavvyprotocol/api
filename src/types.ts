import type { AuthUser } from "./auth.ts";

export type AppEnv = {
  Variables: {
    requestId: string;
    authUser: AuthUser;
  };
};
// NextAuth の Session / User / JWT に Avatar CMD 固有の項目を追加する
import type { DefaultSession } from "next-auth";
import type { UserRole } from "@avatar-cmd/db";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
    } & DefaultSession["user"];
  }

  interface User {
    role: UserRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
  }
}

import bcrypt from "bcrypt";
import { z } from "zod";
import { createUserRepository } from "../persistence/repositories/user.repository.js";

type UserRepo = ReturnType<typeof createUserRepository>;

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  organizationSlug: z.string().min(1).max(200),
});

export type LoginBody = z.infer<typeof loginBodySchema>;

export function createAuthService(userRepo: UserRepo) {
  return {
    async verifyCredentials(body: LoginBody) {
      const found = await userRepo.findByOrgSlugAndEmail(
        body.organizationSlug,
        body.email,
      );
      if (!found) return undefined;

      const ok = await bcrypt.compare(body.password, found.user.passwordHash);
      if (!ok) return undefined;

      return {
        userId: found.user.id,
        organizationId: found.organizationId,
        role: found.user.role as "org_admin" | "org_viewer",
      };
    },
  };
}

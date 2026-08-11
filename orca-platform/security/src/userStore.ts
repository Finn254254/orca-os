import { join } from "node:path";
import { JsonStore, generateId, generateSecret, hashPassword, now, type UserRecord, type UserRole } from "@orca/shared";

export interface PublicUser {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
}

interface UsersState {
  users: Record<string, UserRecord>;
}

function toPublic(user: UserRecord): PublicUser {
  return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

function hash(password: string, salt: string): string {
  return `${salt}$${hashPassword(password, salt)}`;
}

function verify(password: string, stored: string): boolean {
  const [salt, expected] = stored.split("$");
  if (!salt || !expected) return false;
  return hashPassword(password, salt) === expected;
}

/**
 * Durable user store for Orca Platform authentication. Passwords are never
 * stored in plaintext; each is hashed with a per-user random salt.
 */
export class UserStore {
  private readonly store: JsonStore<UsersState>;

  constructor(dataDir: string) {
    this.store = new JsonStore(join(dataDir, "users.json"), { users: {} });
  }

  async init(): Promise<void> {
    await this.store.load();
  }

  hasAnyUser(): boolean {
    return Object.keys(this.store.get().users).length > 0;
  }

  /** Creates the initial admin user if no users exist yet. No-op otherwise. */
  async bootstrapAdmin(username: string, password: string): Promise<PublicUser | undefined> {
    if (this.hasAnyUser()) return undefined;
    return this.createUser(username, password, "admin");
  }

  async createUser(username: string, password: string, role: UserRole): Promise<PublicUser> {
    const state = await this.store.load();
    if (Object.values(state.users).some((u) => u.username === username)) {
      throw new Error(`user "${username}" already exists`);
    }
    const salt = generateSecret(16);
    const user: UserRecord = {
      id: generateId("user"),
      username,
      passwordHash: hash(password, salt),
      role,
      createdAt: now(),
    };
    await this.store.mutate((s) => ({ users: { ...s.users, [user.id]: user } }));
    return toPublic(user);
  }

  async deleteUser(id: string): Promise<boolean> {
    const state = this.store.get();
    if (!state.users[id]) return false;
    await this.store.mutate((s) => {
      const { [id]: _removed, ...rest } = s.users;
      return { users: rest };
    });
    return true;
  }

  listUsers(): PublicUser[] {
    return Object.values(this.store.get().users).map(toPublic);
  }

  getUser(id: string): PublicUser | undefined {
    const user = this.store.get().users[id];
    return user ? toPublic(user) : undefined;
  }

  verifyCredentials(username: string, password: string): PublicUser | undefined {
    const user = Object.values(this.store.get().users).find((u) => u.username === username);
    if (!user || !verify(password, user.passwordHash)) return undefined;
    return toPublic(user);
  }
}

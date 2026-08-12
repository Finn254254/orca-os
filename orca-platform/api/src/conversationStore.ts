import { join } from "node:path";
import { JsonStore, generateId, now, type ChatMessage, type Conversation } from "@orca/shared";

interface ConversationsState {
  conversations: Record<string, Conversation>;
}

/** Server-side conversation storage for Orca AI. Each conversation belongs to exactly one user. */
export class ConversationStore {
  private readonly store: JsonStore<ConversationsState>;

  constructor(dataDir: string) {
    this.store = new JsonStore(join(dataDir, "conversations.json"), { conversations: {} });
  }

  async init(): Promise<void> {
    await this.store.load();
  }

  async create(userId: string, model: string, title = "New conversation"): Promise<Conversation> {
    const conversation: Conversation = {
      id: generateId("conv"),
      userId,
      title,
      model,
      messages: [],
      createdAt: now(),
      updatedAt: now(),
    };
    await this.store.mutate((s) => ({ conversations: { ...s.conversations, [conversation.id]: conversation } }));
    return conversation;
  }

  listForUser(userId: string): Conversation[] {
    return Object.values(this.store.get().conversations)
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): Conversation | undefined {
    return this.store.get().conversations[id];
  }

  async appendMessage(id: string, message: ChatMessage): Promise<Conversation | undefined> {
    const state = await this.store.mutate((s) => {
      const conversation = s.conversations[id];
      if (!conversation) return s;
      return {
        conversations: {
          ...s.conversations,
          [id]: { ...conversation, messages: [...conversation.messages, message], updatedAt: now() },
        },
      };
    });
    return state.conversations[id];
  }

  async rename(id: string, title: string): Promise<Conversation | undefined> {
    const state = await this.store.mutate((s) => {
      const conversation = s.conversations[id];
      if (!conversation) return s;
      return { conversations: { ...s.conversations, [id]: { ...conversation, title, updatedAt: now() } } };
    });
    return state.conversations[id];
  }

  async delete(id: string): Promise<boolean> {
    if (!this.store.get().conversations[id]) return false;
    await this.store.mutate((s) => {
      const { [id]: _removed, ...rest } = s.conversations;
      return { conversations: rest };
    });
    return true;
  }
}

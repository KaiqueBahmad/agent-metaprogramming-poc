import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { StoredMessage } from "@langchain/core/messages";

export type Policy = "none" | "reads" | "all";

export type PendingCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  effect: "read" | "write";
  description: string;
  approvalMessage?: string;
  status: "pending" | "approved" | "rejected" | "running" | "done";
  output?: unknown;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type Conversation = {
  id: string;
  title: string;
  model?: string;
  policy: Policy;
  draft: string;
  updatedAt: number;
  messages: ChatMessage[];
  internal: StoredMessage[];
  groups: string[];
  calls: PendingCall[];
  status: "idle" | "processing" | "awaiting_approval" | "error";
  error?: string;
  requests: string[];
  trace: {
    requestId?: string;
    id: string;
    name: string;
    effect: "read" | "write";
    status: "success" | "error" | "rejected";
    args: Record<string, unknown>;
    output: unknown;
  }[];
};

export function publicConversation(conversation: Conversation) {
  const { internal, groups, calls, requests, ...visible } = conversation;
  return {
    ...visible,
    pending: calls
      .filter((call) => call.status === "pending")
      .map(({ status, output, ...call }) => call)
  };
}

@Injectable()
export class ChatStore {
  constructor(private readonly db: DatabaseSync) {
    // Recupera interrupções de um processo anterior sem repetir efeitos de negócio.
    for (const row of db
      .prepare("SELECT id,payload FROM assistant_conversations")
      .all()) {
      const conversation: Conversation = JSON.parse(String(row.payload));
      if (conversation.status !== "processing") continue;
      conversation.status = "error";
      conversation.error =
        "O processamento foi interrompido. Retome a conversa para verificar os resultados.";
      db.prepare("UPDATE assistant_conversations SET payload=? WHERE id=?").run(
        JSON.stringify(conversation),
        String(row.id)
      );
    }
  }

  list(userId: number, companyId: number) {
    return this.db
      .prepare(
        "SELECT payload FROM assistant_conversations WHERE user_id=? AND company_id=? ORDER BY updated_at DESC"
      )
      .all(userId, companyId)
      .map((row) => publicConversation(JSON.parse(String(row.payload))));
  }

  create(userId: number, companyId: number) {
    const conversation: Conversation = {
      id: randomUUID(),
      title: "Nova conversa",
      policy: "reads",
      draft: "",
      updatedAt: Date.now(),
      messages: [],
      internal: [],
      groups: [],
      calls: [],
      requests: [],
      trace: [],
      status: "idle"
    };
    this.db
      .prepare(
        "INSERT INTO assistant_conversations(id,user_id,company_id,updated_at,payload) VALUES(?,?,?,?,?)"
      )
      .run(
        conversation.id,
        userId,
        companyId,
        conversation.updatedAt,
        JSON.stringify(conversation)
      );
    return conversation;
  }

  get(id: string, userId: number, companyId: number): Conversation {
    const row = this.db
      .prepare(
        "SELECT payload FROM assistant_conversations WHERE id=? AND user_id=? AND company_id=?"
      )
      .get(id, userId, companyId);
    if (!row) throw new NotFoundException("Conversa não encontrada.");
    return JSON.parse(String(row.payload));
  }

  save(conversation: Conversation, userId: number, companyId: number) {
    conversation.updatedAt = Date.now();
    const result = this.db
      .prepare(
        "UPDATE assistant_conversations SET payload=?,updated_at=? WHERE id=? AND user_id=? AND company_id=?"
      )
      .run(
        JSON.stringify(conversation),
        conversation.updatedAt,
        conversation.id,
        userId,
        companyId
      );
    if (!result.changes)
      throw new NotFoundException("Conversa não encontrada.");
  }

  remove(id: string, userId: number, companyId: number) {
    this.get(id, userId, companyId);
    this.db
      .prepare(
        "DELETE FROM assistant_conversations WHERE id=? AND user_id=? AND company_id=?"
      )
      .run(id, userId, companyId);
    return { ok: true };
  }
}

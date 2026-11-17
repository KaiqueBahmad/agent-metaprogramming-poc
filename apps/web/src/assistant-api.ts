export type Policy = "none" | "reads" | "all";

export type PendingCall = {
  id: string;
  name: string;
  description: string;
  approvalMessage?: string;
  effect: "read" | "write";
  args: Record<string, unknown>;
};

export type Conversation = {
  id: string;
  title: string;
  model?: string;
  policy: Policy;
  draft: string;
  updatedAt: number;
  messages: { id: string; role: "user" | "assistant"; text: string }[];
  pending: PendingCall[];
  status: "idle" | "processing" | "awaiting_approval" | "error";
  error?: string;
  trace: {
    id: string;
    name: string;
    effect: "read" | "write";
    status: "success" | "error" | "rejected";
    args: Record<string, unknown>;
    output: unknown;
  }[];
};

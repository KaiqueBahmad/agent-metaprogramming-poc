import { SetMetadata } from "@nestjs/common";
import { z } from "zod";
import { User } from "../identity";

export const AGENT_GROUP = "agent:group";
export const AGENT_TOOL = "agent:tool";

export type AgentContext = {
  user: User;
  companyId: number;
  companyRole: "ADMIN" | "DONO" | "FUNCIONARIO";
  origin: "agent";
};

export type GroupDefinition = { name: string; description: string };

export type ToolDefinition = {
  name: string;
  description: string;
  effect: "read" | "write";
  schema: z.ZodObject;
  canUse?: (context: AgentContext) => boolean;
};

export type ActionDefinition = ToolDefinition & {
  authorize: (
    context: AgentContext,
    input: Record<string, unknown>
  ) => boolean | Promise<boolean>;
};

export const AgentController = (definition: GroupDefinition) =>
  SetMetadata(AGENT_GROUP, { ...definition, kind: "controller" });
export const AgentGroup = (definition: GroupDefinition) =>
  SetMetadata(AGENT_GROUP, { ...definition, kind: "group" });
export const AgentRoute = (definition: ToolDefinition) =>
  SetMetadata(AGENT_TOOL, { ...definition, kind: "route" });

export function AgentAction(definition: ActionDefinition) {
  if (typeof definition.authorize !== "function")
    throw new Error("AgentAction exige authorize.");
  return SetMetadata(AGENT_TOOL, { ...definition, kind: "action" });
}

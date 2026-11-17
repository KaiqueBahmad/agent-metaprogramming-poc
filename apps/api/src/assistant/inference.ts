import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { AIMessage, BaseMessage } from "@langchain/core/messages";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { ChatOpenAI } from "@langchain/openai";
import { ChatBedrockConverse } from "@langchain/aws";
import { z } from "zod";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { codexInference } from "./codex-inference";
import { inferenceFailure } from "./inference-errors";

export type ModelTool = {
  name: string;
  description: string;
  schema: z.ZodObject;
};

export function modelConfiguration() {
  const provider = process.env.ASSISTANT_PROVIDER || "bedrock";
  const defaultModel =
    process.env.ASSISTANT_MODEL || (provider === "codex" ? "gpt-5.6-luna" : "");
  const configured = process.env.ASSISTANT_MODELS?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const models = [
    ...new Set(
      [
        defaultModel,
        ...(configured ||
          (provider === "codex"
            ? ["gpt-5.6-luna", "gpt-6-luna", "gpt-6.1-sol"]
            : []))
      ].filter(Boolean)
    )
  ];
  return { provider, defaultModel, models };
}

export abstract class Inferencer {
  abstract invoke(
    messages: BaseMessage[],
    tools: ModelTool[],
    model?: string
  ): Promise<AIMessage>;
}

@Injectable()
export class LangChainInferencer extends Inferencer {
  private readonly models = new Map<string, ChatBedrockConverse | ChatOpenAI>();

  async invoke(
    messages: BaseMessage[],
    tools: ModelTool[],
    selectedModel?: string
  ) {
    const provider = process.env.ASSISTANT_PROVIDER || "bedrock";
    try {
      return await this.invokeModel(messages, tools, selectedModel);
    } catch (error) {
      throw inferenceFailure(error, provider);
    }
  }

  private async invokeModel(
    messages: BaseMessage[],
    tools: ModelTool[],
    selectedModel?: string
  ) {
    const { provider, defaultModel, models } = modelConfiguration();
    const model = selectedModel || defaultModel;
    if (selectedModel && !models.includes(selectedModel))
      throw new ServiceUnavailableException(
        "Modelo não habilitado no servidor."
      );
    if (provider === "codex") return codexInference(messages, tools, model);
    if (provider !== "bedrock" && provider !== "openai")
      throw new ServiceUnavailableException(
        "ASSISTANT_PROVIDER deve ser bedrock, openai ou codex."
      );
    if (!model)
      throw new ServiceUnavailableException(
        "Configure ASSISTANT_MODEL com o identificador do modelo."
      );
    const cacheKey = `${provider}:${model}`;
    let instance = this.models.get(cacheKey);
    if (provider === "openai") {
      if (!process.env.ASSISTANT_API_KEY)
        throw new ServiceUnavailableException(
          "Configure ASSISTANT_API_KEY para o provedor openai."
        );
      instance ??= new ChatOpenAI({
        model,
        apiKey: process.env.ASSISTANT_API_KEY,
        configuration: process.env.ASSISTANT_BASE_URL
          ? { baseURL: process.env.ASSISTANT_BASE_URL }
          : undefined,
        timeout: 90000,
        maxRetries: 0
      });
      this.models.set(cacheKey, instance);
      return await instance
        .bindTools(
          tools.map((item) => ({
            type: "function" as const,
            function: {
              name: item.name,
              description: item.description,
              parameters: z.toJSONSchema(item.schema, { io: "input" })
            }
          }))
        )
        .invoke(messages, { signal: AbortSignal.timeout(95000) });
    }
    // O SDK resolve credenciais via ambiente, profiles/SSO ou IAM role.
    // Não copie chaves para o contexto do agente e não fixe credenciais temporárias.
    if (!instance) {
      // O adaptador exige região explícita; o SDK também resolve a região do profile.
      const resolver = new BedrockRuntimeClient({
        region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION
      });
      let region: string;
      try {
        region = await resolver.config.region();
      } catch {
        throw new ServiceUnavailableException(
          "Configure AWS_REGION, AWS_DEFAULT_REGION ou a região no profile AWS."
        );
      } finally {
        resolver.destroy();
      }
      instance = new ChatBedrockConverse({
        model,
        region,
        timeout: 90000,
        maxRetries: 0
      });
    }
    this.models.set(cacheKey, instance);
    return await instance
      .bindTools(
        tools.map((item) => ({
          name: item.name,
          description: item.description,
          schema: z.toJSONSchema(item.schema, { io: "input" })
        }))
      )
      .invoke(messages, { signal: AbortSignal.timeout(95000) });
  }
}

// Ponte opt-in de desenvolvimento: um inferente externo responde aos arquivos.
// Não é uma rota HTTP, não é habilitada automaticamente e nunca recebe credenciais.
export class FileInferencer extends Inferencer {
  constructor(private readonly directory: string) {
    super();
  }

  async invoke(messages: BaseMessage[], tools: ModelTool[]) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const request = {
      id,
      messages: messages.map((message) => ({
        role: message.getType(),
        content: message.content,
        ...("tool_calls" in message ? { tool_calls: message.tool_calls } : {}),
        ...("tool_call_id" in message
          ? { tool_call_id: message.tool_call_id }
          : {})
      })),
      tools: tools.map((item) => ({
        name: item.name,
        description: item.description,
        schema: z.toJSONSchema(item.schema, { io: "input" })
      }))
    };
    const target = join(this.directory, `${id}.request.json`);
    await writeFile(`${target}.tmp`, JSON.stringify(request, null, 2), {
      mode: 0o600
    });
    await rename(`${target}.tmp`, target);
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      try {
        const response = JSON.parse(
          await readFile(join(this.directory, `${id}.response.json`), "utf8")
        );
        const parsed = z
          .object({
            content: z.string(),
            tool_calls: z
              .array(
                z.object({
                  id: z.string().min(1),
                  name: z.string().min(1),
                  args: z.record(z.string(), z.unknown())
                })
              )
              .default([])
          })
          .parse(response);
        return new AIMessage(parsed);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new ServiceUnavailableException(
      "O inferente de desenvolvimento não respondeu a tempo."
    );
  }
}

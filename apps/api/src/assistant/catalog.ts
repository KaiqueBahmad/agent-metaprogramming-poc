import { ForbiddenException, Injectable, OnModuleInit } from "@nestjs/common";
import {
  DiscoveryService,
  HttpAdapterHost,
  MetadataScanner
} from "@nestjs/core";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { z } from "zod";
import { Companies } from "../companies";
import { Identity } from "../identity";
import { parse } from "../erp";
import {
  AGENT_GROUP,
  AGENT_TOOL,
  ActionDefinition,
  AgentContext,
  GroupDefinition,
  ToolDefinition
} from "./metadata";
import { dispatchAgent } from "./dispatch";

type Entry = ToolDefinition & {
  group: string;
  kind: "route" | "action";
  path?: string;
  method?: "GET" | "POST";
  instance: Record<string, any>;
  handler: string;
  authorize?: ActionDefinition["authorize"];
};

export type ExecutorContext = { token: string; companyId: number };

@Injectable()
export class ToolCatalog implements OnModuleInit {
  private readonly entries = new Map<string, Entry>();

  private readonly groupDefinitions = new Map<string, GroupDefinition>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly adapter: HttpAdapterHost,
    private readonly identity: Identity,
    private readonly companies: Companies
  ) {}

  onModuleInit() {
    const scanner = new MetadataScanner();
    for (const wrapper of [
      ...this.discovery.getControllers(),
      ...this.discovery.getProviders()
    ]) {
      const instance = wrapper.instance;
      if (!instance?.constructor) continue;
      const group = Reflect.getMetadata(AGENT_GROUP, instance.constructor);
      if (!group) continue;
      this.groupDefinitions.set(group.name, {
        name: group.name,
        description: group.description
      });
      for (const handler of scanner.getAllMethodNames(
        Object.getPrototypeOf(instance)
      )) {
        const method = instance[handler];
        const definition = Reflect.getMetadata(AGENT_TOOL, method);
        if (!definition) continue;
        if (
          !/^[a-z][a-z0-9_]*$/.test(definition.name) ||
          definition.name === "consultar_grupo" ||
          this.entries.has(definition.name)
        )
          throw new Error(
            `Nome de ferramenta inválido ou duplicado: ${definition.name}`
          );
        if (
          (group.kind === "controller" && definition.kind !== "route") ||
          (group.kind === "group" && definition.kind !== "action")
        )
          throw new Error("Anotação de ferramenta incompatível com o grupo.");
        const entry: Entry = {
          ...definition,
          group: group.name,
          instance,
          handler
        };
        if (entry.kind === "route") {
          const httpMethod = Reflect.getMetadata(METHOD_METADATA, method);
          if (httpMethod !== 0 && httpMethod !== 1)
            throw new Error("AgentRoute suporta GET e POST nesta POC.");
          entry.method = httpMethod === 0 ? "GET" : "POST";
          if (
            Reflect.getMetadata("auth:admin", method) ??
            Reflect.getMetadata("auth:admin", instance.constructor)
          ) {
            const declaredCanUse = entry.canUse;
            entry.canUse = (context) =>
              context.user.role === "ADMIN" &&
              (!declaredCanUse || declaredCanUse(context));
          }
          const controllerPath = Reflect.getMetadata(
            PATH_METADATA,
            instance.constructor
          );
          const routePath = Reflect.getMetadata(PATH_METADATA, method);
          if (
            typeof controllerPath !== "string" ||
            typeof routePath !== "string"
          )
            throw new Error("Rota sem caminho HTTP.");
          entry.path =
            "/" +
            [controllerPath, routePath]
              .map((segment) => segment.replace(/^\/+|\/+$/g, ""))
              .filter(Boolean)
              .join("/");
        } else if (typeof entry.authorize !== "function")
          throw new Error("AgentAction exige authorize.");
        this.entries.set(entry.name, entry);
      }
    }
  }

  context(context: ExecutorContext): AgentContext {
    const user = this.identity.authenticate(context.token);
    const companyRole = this.companies.access(user, context.companyId);
    return { user, companyId: context.companyId, companyRole, origin: "agent" };
  }

  tools(context: ExecutorContext) {
    const actor = this.context(context);
    return [...this.entries.values()].filter(
      (entry) => !entry.canUse || entry.canUse(actor)
    );
  }

  groups(context: ExecutorContext) {
    const entries = this.tools(context);
    return [...this.groupDefinitions.values()].filter((group) =>
      entries.some((entry) => entry.group === group.name)
    );
  }

  definition(name: string, context: ExecutorContext) {
    const entry = this.tools(context).find((entry) => entry.name === name);
    if (!entry)
      throw new ForbiddenException(
        "Ferramenta não disponível para este usuário."
      );
    return entry;
  }

  describeGroup(name: string, context: ExecutorContext) {
    return this.tools(context)
      .filter((entry) => entry.group === name)
      .map(({ name, description, effect, schema }) => ({
        name,
        description,
        effect,
        schema: z.toJSONSchema(schema, { io: "input" })
      }));
  }

  validate(name: string, input: unknown, context: ExecutorContext) {
    return parse(
      this.definition(name, context).schema.strict(),
      input
    ) as Record<string, unknown>;
  }

  async execute(name: string, input: unknown, context: ExecutorContext) {
    const entry = this.definition(name, context);
    const args = this.validate(name, input, context);
    const actor = this.context(context);
    if (entry.kind === "action") {
      if (!(await entry.authorize!(actor, args)))
        throw new ForbiddenException("Ação não autorizada.");
      return await entry.instance[entry.handler](args, actor);
    }
    const body = { ...args };
    const path = entry.path!.replace(
      /:([a-zA-Z][a-zA-Z0-9_]*)/g,
      (_, key: string) => {
        if (args[key] === undefined)
          throw new Error(`Parâmetro ausente: ${key}`);
        delete body[key];
        return encodeURIComponent(String(args[key]));
      }
    );
    const response = await dispatchAgent(
      this.adapter.httpAdapter.getHttpServer(),
      path,
      {
        method: entry.method!,
        body: entry.method === "POST" ? body : undefined,
        ...context
      }
    );
    return response.status >= 400
      ? {
          error: true,
          status: response.status,
          details: response.body,
          ...(entry.effect === "write" && response.status >= 500
            ? {
                uncertain: true,
                message:
                  "Resultado incerto. Consulte os dados antes de repetir a alteração."
              }
            : {})
        }
      : response.body;
  }
}

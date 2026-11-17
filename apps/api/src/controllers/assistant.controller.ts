import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CompanyRequired, CurrentCompany, CurrentToken } from "../auth";
import { AssistantChat } from "../assistant/chat";
import { ToolCatalog } from "../assistant/catalog";

@CompanyRequired()
@Controller("api/assistant")
export class AssistantController {
  constructor(
    private readonly chat: AssistantChat,
    private readonly catalog: ToolCatalog
  ) {}

  @Get("models")
  models(@CurrentToken() token: string, @CurrentCompany() companyId: number) {
    return this.chat.models({ token, companyId });
  }

  @Get("groups")
  groups(@CurrentToken() token: string, @CurrentCompany() companyId: number) {
    return this.catalog.groups({ token, companyId });
  }

  @Get("conversations")
  list(@CurrentToken() token: string, @CurrentCompany() companyId: number) {
    return this.chat.list({ token, companyId });
  }

  @Post("conversations")
  create(@CurrentToken() token: string, @CurrentCompany() companyId: number) {
    return this.chat.create({ token, companyId });
  }

  @Get("conversations/:id")
  get(
    @Param("id") id: string,
    @CurrentToken() token: string,
    @CurrentCompany() companyId: number
  ) {
    return this.chat.get(id, { token, companyId });
  }

  @Post("conversations/:id/update")
  update(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentToken() token: string,
    @CurrentCompany() companyId: number
  ) {
    return this.chat.update(id, body, { token, companyId });
  }

  @Post("conversations/:id/messages")
  send(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentToken() token: string,
    @CurrentCompany() companyId: number
  ) {
    return this.chat.send(id, body, { token, companyId });
  }

  @Post("conversations/:id/decisions")
  approve(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentToken() token: string,
    @CurrentCompany() companyId: number
  ) {
    return this.chat.approve(id, body, { token, companyId });
  }

  @Post("conversations/:id/retry")
  retry(
    @Param("id") id: string,
    @CurrentToken() token: string,
    @CurrentCompany() companyId: number
  ) {
    return this.chat.retry(id, { token, companyId });
  }

  @Post("conversations/:id/remove")
  remove(
    @Param("id") id: string,
    @CurrentToken() token: string,
    @CurrentCompany() companyId: number
  ) {
    return this.chat.remove(id, { token, companyId });
  }
}

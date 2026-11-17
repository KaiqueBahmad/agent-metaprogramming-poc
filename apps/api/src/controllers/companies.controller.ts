import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from "@nestjs/common";
import {
  AdminOnly,
  CompanyRequired,
  CurrentCompany,
  CurrentUser,
} from "../auth";
import { Companies } from "../companies";
import { User } from "../identity";

@Controller("api/companies")
export class CompaniesController {
  constructor(private readonly companies: Companies) {}
  @Get()
  list(@CurrentUser() user: User) {
    return this.companies.list(user);
  }
  @AdminOnly()
  @Post()
  create(@CurrentUser() user: User, @Body() body: unknown) {
    return this.companies.create(user, body);
  }
  @CompanyRequired()
  @Get(":companyId/members")
  members(@CurrentUser() user: User, @CurrentCompany() companyId: number) {
    return this.companies.members(user, companyId);
  }
  @CompanyRequired()
  @Post(":companyId/members")
  addMember(
    @CurrentUser() user: User,
    @CurrentCompany() companyId: number,
    @Body() body: unknown,
  ) {
    return this.companies.addMember(user, companyId, body);
  }
  @AdminOnly()
  @CompanyRequired()
  @Post(":companyId/members/:userId/role")
  role(
    @CurrentUser() user: User,
    @CurrentCompany() companyId: number,
    @Param("userId", ParseIntPipe) userId: number,
    @Body() body: unknown,
  ) {
    return this.companies.changeRole(user, companyId, userId, body);
  }
  @CompanyRequired()
  @Post(":companyId/members/:userId/remove")
  remove(
    @CurrentUser() user: User,
    @CurrentCompany() companyId: number,
    @Param("userId", ParseIntPipe) userId: number,
  ) {
    return this.companies.removeMember(user, companyId, userId);
  }
}

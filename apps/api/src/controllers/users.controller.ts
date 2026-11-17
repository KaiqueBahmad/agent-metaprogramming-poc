import { Body, Controller, Get, Post } from "@nestjs/common";
import { AdminOnly, CurrentUser } from "../auth";
import { Identity, User } from "../identity";

@AdminOnly()
@Controller("api/users")
export class UsersController {
  constructor(private readonly identity: Identity) {}
  @Get()
  list(@CurrentUser() user: User) {
    return this.identity.users(user);
  }
  @Post()
  create(@CurrentUser() user: User, @Body() body: unknown) {
    return this.identity.createUser(user, body);
  }
}

import { Body, Controller, Get, Post } from "@nestjs/common";
import { CurrentToken, CurrentUser, Public } from "../auth";
import { Identity, User } from "../identity";

@Controller("api/auth")
export class AuthController {
  constructor(private readonly identity: Identity) {}
  @Public()
  @Post("login")
  login(@Body() body: unknown) {
    return this.identity.login(body);
  }
  @Get("me")
  me(@CurrentUser() user: User) {
    return user;
  }
  @Post("logout")
  logout(@CurrentToken() token: string) {
    return this.identity.logout(token);
  }
}

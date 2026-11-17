import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Companies } from "./companies";
import { Identity, requireAdmin, User } from "./identity";

const PUBLIC = "auth:public",
  ADMIN = "auth:admin",
  COMPANY = "auth:company";
export const Public = () => SetMetadata(PUBLIC, true);
export const AdminOnly = () => SetMetadata(ADMIN, true);
export const CompanyRequired = () => SetMetadata(COMPANY, true);
export type AuthRequest = {
  headers: Record<string, string | string[] | undefined>;
  params: Record<string, string>;
  user: User;
  companyId: number;
  token: string;
};
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AuthRequest>().user,
);
export const CurrentCompany = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AuthRequest>().companyId,
);
export const CurrentToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AuthRequest>().token,
);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly identity: Identity,
    private readonly companies: Companies,
  ) {}
  canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const header = req.headers.authorization;
    if (
      typeof header !== "string" ||
      !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)
    )
      throw new UnauthorizedException("Entre para acessar o sistema.");
    req.token = header.slice(7);
    req.user = this.identity.authenticate(req.token);
    if (this.reflector.getAllAndOverride<boolean>(ADMIN, targets))
      requireAdmin(req.user);
    if (this.reflector.getAllAndOverride<boolean>(COMPANY, targets)) {
      const raw = req.params.companyId ?? req.headers["x-company-id"];
      req.companyId =
        typeof raw === "string" && /^[1-9]\d*$/.test(raw) ? Number(raw) : NaN;
      this.companies.access(req.user, req.companyId);
    }
    return true;
  }
}

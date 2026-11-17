export type User = {
  id: number;
  name: string;
  email: string;
  role: "ADMIN" | "USER";
};
export type Session = { token: string; user: User; expiresAt: number };
export type Company = {
  id: number;
  name: string;
  document: string;
  role: "ADMIN" | "DONO" | "FUNCIONARIO";
};
export type RequestContext = { token: string; companyId?: number };
export async function request(
  path: string,
  body?: unknown,
  context?: RequestContext,
) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (context) headers.Authorization = `Bearer ${context.token}`;
  if (context?.companyId) headers["X-Company-Id"] = String(context.companyId);
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const content = await response.json();
  if (response.status === 401 && context)
    window.dispatchEvent(new Event("session-expired"));
  if (!response.ok)
    throw new Error(
      Array.isArray(content.message)
        ? content.message.join(", ")
        : content.message || "Não foi possível concluir a operação.",
    );
  return content;
}

import { useEffect, useState } from "react";
import { Building2, LogOut, Plus, Users, ArrowRight } from "lucide-react";
import { Company, request, Session, User } from "./api";
import { ErpApp } from "./erp-app";

type Member = {
  id: number;
  name: string;
  email: string;
  role: "DONO" | "FUNCIONARIO";
};
const sessionKey = "forma-session";
function readSession(): Session | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(sessionKey) || "null");
    return value &&
      typeof value.token === "string" &&
      value.user &&
      value.expiresAt > Date.now() / 1000
      ? value
      : null;
  } catch {
    return null;
  }
}
function Login({
  onLogin,
  notice,
}: {
  onLogin: (session: Session) => void;
  notice: string;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    try {
      onLogin(await request("auth/login", values));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-card">
        <div className="brand">forma.</div>
        <div className="eyebrow">SEU NEGÓCIO, EM ORDEM</div>
        <h1>Entre no seu espaço.</h1>
        <p>
          Uma conta, várias empresas. Seu acesso acompanha o vínculo em cada
          uma.
        </p>
        {notice && (
          <div className="alert error" role="status">
            {notice}
          </div>
        )}
        <form onSubmit={submit}>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <label>
            E-mail
            <input
              autoFocus
              name="email"
              type="email"
              autoComplete="username"
              required
              defaultValue="admin@forma.example"
            />
          </label>
          <label>
            Senha
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
            <ArrowRight size={16} />
          </button>
        </form>
        <div className="demo-accounts">
          <strong>Contas do seed</strong>
          <p>
            Senha para todas: <code>senha123</code>
          </p>
          <p>
            <b>ADMIN:</b> admin@forma.example
            <br />
            <b>DONO / FUNCIONARIO:</b> ana@forma.example, bruno@forma.example
            <br />
            <b>FUNCIONARIO:</b> carla@forma.example, diego@forma.example
            <br />
            <b>Sem vínculo:</b> semvinculo@forma.example
          </p>
        </div>
      </section>
      <div className="login-art">
        <Building2 size={48} />
        <h2>
          Seu negócio.
          <br />
          Cada empresa no seu lugar.
        </h2>
        <p>
          Clientes, vendas e estoque separados por empresa, com acesso por
          perfil.
        </p>
      </div>
    </div>
  );
}

export function SessionApp() {
  const [session, setSession] = useState<Session | null>(readSession),
    [companies, setCompanies] = useState<Company[]>([]),
    [selected, setSelected] = useState<number | null>(null),
    [view, setView] = useState<"companies" | "erp" | "members">("companies"),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [loginNotice, setLoginNotice] = useState("");
  function clearSession(message = "") {
    sessionStorage.removeItem(sessionKey);
    setSession(null);
    setCompanies([]);
    setSelected(null);
    setView("companies");
    setError("");
    setLoginNotice(message);
  }
  useEffect(() => {
    const expire = () => clearSession("Sua sessão expirou. Entre novamente.");
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, []);
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      request("auth/me", undefined, session),
      request("companies", undefined, session),
    ])
      .then(([user, list]) => {
        if (cancelled) return;
        setCompanies(list);
        const updated = { ...session, user };
        setSession(updated);
        sessionStorage.setItem(sessionKey, JSON.stringify(updated));
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.token]);
  async function refreshCompanies() {
    if (session) setCompanies(await request("companies", undefined, session));
  }
  async function logout() {
    if (!session) return;
    try {
      await request("auth/logout", {}, session);
    } finally {
      clearSession();
    }
  }
  if (!session)
    return (
      <Login
        notice={loginNotice}
        onLogin={(value) => {
          sessionStorage.setItem(sessionKey, JSON.stringify(value));
          setSession(value);
          setLoginNotice("");
        }}
      />
    );
  const company = companies.find((c) => c.id === selected);
  if (view === "erp" && company)
    return (
      <ErpApp
        key={`${session.user.id}:${company.id}`}
        session={session}
        company={company}
        companies={companies}
        onSelectCompany={setSelected}
        onCompanies={() => setView("companies")}
        onManage={() => setView("members")}
        onLogout={() => void logout().catch(() => {})}
      />
    );
  return (
    <div className="management-page">
      <header>
        <a href="/" className="brand">
          forma.
        </a>
        <div className="profile">
          <span>
            {session.user.name} ·{" "}
            {session.user.role === "ADMIN" ? "ADMIN" : "Conta pessoal"}
          </span>
          <button onClick={() => void logout().catch(() => {})}>
            <LogOut size={15} />
            Sair
          </button>
        </div>
      </header>
      <div className="management-content">
        {error && (
          <div role="alert" className="alert error">
            {error}
          </div>
        )}
        {loading ? (
          <div className="panel empty">Carregando suas empresas…</div>
        ) : view === "members" && company ? (
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  {company.role} · {company.name}
                </div>
                <h1>Vínculos da empresa</h1>
                <p>Um usuário, um papel por empresa.</p>
              </div>
              <button onClick={() => setView("companies")}>
                Voltar às empresas
              </button>
            </div>
            <Members key={company.id} session={session} company={company} />
          </>
        ) : (
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  {session.user.role === "ADMIN"
                    ? "ADMINISTRAÇÃO GLOBAL"
                    : "SEU ESPAÇO DE TRABALHO"}
                </div>
                <h1>
                  {session.user.role === "ADMIN"
                    ? "Empresas e acessos"
                    : "Suas empresas"}
                </h1>
                <p>
                  Escolha uma empresa para operar. O papel é específico de cada
                  vínculo.
                </p>
              </div>
            </div>
            <div className="company-cards">
              {companies.map((c) => (
                <section className="panel company-card" key={c.id}>
                  <Building2 size={26} />
                  <span
                    className={`badge ${c.role === "FUNCIONARIO" ? "draft" : "paid"}`}
                  >
                    {c.role}
                  </span>
                  <h2>{c.name}</h2>
                  <p>{c.document || "Documento não informado"}</p>
                  <div className="actions">
                    <button
                      className="primary"
                      onClick={() => {
                        setSelected(c.id);
                        setView("erp");
                      }}
                    >
                      Abrir ERP <ArrowRight size={15} />
                    </button>
                    {c.role !== "FUNCIONARIO" && (
                      <button
                        onClick={() => {
                          setSelected(c.id);
                          setView("members");
                        }}
                      >
                        <Users size={15} />
                        Vínculos
                      </button>
                    )}
                  </div>
                </section>
              ))}
            </div>
            {!companies.length && (
              <div className="panel empty">
                <h2>Nenhuma empresa disponível</h2>
                <p>
                  {session.user.role === "ADMIN"
                    ? "Cadastre a primeira empresa abaixo."
                    : "Peça ao administrador ou dono para cadastrar seu vínculo."}
                </p>
              </div>
            )}
            {error && (
              <button
                onClick={() =>
                  void refreshCompanies()
                    .then(() => setError(""))
                    .catch((e) => setError(e.message))
                }
              >
                Tentar novamente
              </button>
            )}
            {session.user.role === "ADMIN" && (
              <AdminPanel
                session={session}
                onCompanyCreated={refreshCompanies}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Members({ session, company }: { session: Session; company: Company }) {
  const [members, setMembers] = useState<Member[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const path = `companies/${company.id}/members`;
  const load = async () => setMembers(await request(path, undefined, session));
  useEffect(() => {
    let cancelled = false;
    request(path, undefined, session)
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, session.token]);
  async function execute(route: string, body: unknown, onSuccess?: () => void) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(route, body, session);
      await load();
      setNotice("Vínculo atualizado.");
      onSuccess?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if (!values.name) delete values.name;
    if (!values.password) delete values.password;
    await execute(path, values, () => form.reset());
  }
  return (
    <div className="management-grid">
      {error && (
        <div className="alert error full-width" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success full-width" role="status">
          {notice}
        </div>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>Pessoas vinculadas</h2>
          <span className="count">{members.length}</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Pessoa</th>
                <th>Papel</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.name}</strong>
                    <span>{m.email}</span>
                  </td>
                  <td>{m.role}</td>
                  <td>
                    <div className="actions">
                      {session.user.role === "ADMIN" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void execute(`${path}/${m.id}/role`, {
                              role: m.role === "DONO" ? "FUNCIONARIO" : "DONO",
                            })
                          }
                        >
                          {m.role === "DONO"
                            ? "Tornar funcionário"
                            : "Tornar dono"}
                        </button>
                      )}
                      {(session.user.role === "ADMIN" ||
                        m.role === "FUNCIONARIO") && (
                        <button
                          className="muted"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remover o vínculo de ${m.name} com ${company.name}?`,
                              )
                            )
                              void execute(`${path}/${m.id}/remove`, {});
                          }}
                        >
                          Remover
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <p className="empty">Carregando vínculos…</p>}
          {!loading && !members.length && (
            <p className="empty">Nenhum vínculo cadastrado.</p>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Adicionar vínculo</h2>
        </div>
        <form onSubmit={submit}>
          <label>
            E-mail do usuário
            <input name="email" type="email" required maxLength={200} />
          </label>
          <label>
            Papel
            <select name="role" defaultValue="FUNCIONARIO">
              {session.user.role === "ADMIN" && (
                <option value="DONO">DONO</option>
              )}
              <option value="FUNCIONARIO">FUNCIONARIO</option>
            </select>
          </label>
          <p className="form-note">
            Se o e-mail já existe, apenas o vínculo será criado. Para uma conta
            nova, preencha também nome e senha. A senha de contas existentes não
            será alterada.
          </p>
          <label>
            Nome (novo usuário)
            <input name="name" minLength={2} maxLength={120} />
          </label>
          <label>
            Senha (novo usuário)
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
            />
          </label>
          <button className="primary" disabled={busy}>
            <Plus size={16} />
            {busy ? "Salvando…" : "Adicionar vínculo"}
          </button>
        </form>
      </section>
    </div>
  );
}

function AdminPanel({
  session,
  onCompanyCreated,
}: {
  session: Session;
  onCompanyCreated: () => Promise<void>;
}) {
  const [users, setUsers] = useState<User[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () => setUsers(await request("users", undefined, session));
  useEffect(() => {
    let cancelled = false;
    request("users", undefined, session)
      .then((list) => {
        if (!cancelled) setUsers(list);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [session.token]);
  async function submit(e: React.FormEvent<HTMLFormElement>, route: string) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(route, values, session);
      if (route === "companies") await onCompanyCreated();
      else await load();
      form.reset();
      setNotice(
        route === "companies"
          ? "Empresa criada. Abra Vínculos para adicionar o dono."
          : "Usuário criado. Adicione os vínculos nas empresas desejadas.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-panel">
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      <div className="management-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Cadastrar empresa</h2>
            <span className="badge paid">ADMIN</span>
          </div>
          <form onSubmit={(e) => void submit(e, "companies")}>
            <label>
              Nome da empresa
              <input name="name" minLength={2} maxLength={120} required />
            </label>
            <label>
              CNPJ
              <input name="document" maxLength={30} />
            </label>
            <button className="primary" disabled={busy}>
              <Plus size={16} />
              Cadastrar empresa
            </button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Cadastrar usuário</h2>
          </div>
          <form onSubmit={(e) => void submit(e, "users")}>
            <label>
              Nome
              <input name="name" minLength={2} maxLength={120} required />
            </label>
            <label>
              E-mail
              <input name="email" type="email" maxLength={200} required />
            </label>
            <label>
              Senha
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
              />
            </label>
            <label>
              Perfil global
              <select name="role">
                <option value="USER">
                  Usuário — papel definido por empresa
                </option>
                <option value="ADMIN">ADMIN — administração global</option>
              </select>
            </label>
            <button className="primary" disabled={busy}>
              <Plus size={16} />
              Cadastrar usuário
            </button>
          </form>
        </section>
      </div>
      <section className="panel users-panel">
        <div className="panel-heading">
          <h2>Usuários do sistema</h2>
          <span className="count">{users.length}</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Perfil global</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>
                  </td>
                  <td>{u.email}</td>
                  <td>{u.role === "ADMIN" ? "ADMIN" : "Papéis por empresa"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

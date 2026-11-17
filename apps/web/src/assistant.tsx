import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  History,
  LoaderCircle,
  MessageSquare,
  Plus,
  Trash2,
  Settings2,
  ShieldCheck,
  Sparkles,
  X
} from "lucide-react";
import { Company, request, Session } from "./api";
import { Conversation, Policy } from "./assistant-api";
import "./assistant.css";

const suggestions = [
  "Como está minha operação?",
  "O que está com estoque baixo?",
  "Quais pedidos estão pendentes?"
];

export function Assistant({
  company,
  session,
  onChange
}: {
  company: Company;
  session: Session;
  onChange: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [modelOptions, setModelOptions] = useState<{
    defaultModel: string;
    models: string[];
  }>({ defaultModel: "", models: [] });
  const [settings, setSettings] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const active = conversations.find(
    (conversation) => conversation.id === activeId
  );
  const activity =
    active?.trace.filter((entry) => entry.name !== "consultar_grupo") || [];
  const policy = active?.policy || "reads";
  const messages = active?.messages || [];
  const draft = active?.draft || "";
  const context = { token: session.token, companyId: company.id };
  const api = (path: string, body?: unknown): Promise<any> =>
    request(`assistant/${path}`, body, context);

  function replace(conversation: Conversation) {
    setConversations((current) => [
      conversation,
      ...current.filter((item) => item.id !== conversation.id)
    ]);
  }

  function setDraft(value: string) {
    setConversations((current) =>
      current.map((item) =>
        item.id === activeId ? { ...item, draft: value } : item
      )
    );
  }

  async function loadConversations() {
    setLoading(true);
    setError("");
    try {
      const [saved, configuration] = await Promise.all([
        api("conversations"),
        api("models")
      ]);
      setModelOptions(configuration);
      let list: Conversation[] = saved;
      if (!list.length) list = [await api("conversations", {})];
      setConversations(list);
      setActiveId((current) =>
        list.some((item) => item.id === current) ? current : list[0].id
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void loadConversations();
  }, [open]);
  useEffect(() => {
    if (!active || busy || loading || active.status === "processing") return;
    const timer = setTimeout(() => {
      api(`conversations/${active.id}/update`, { draft }).catch(
        (failure: Error) => setError(failure.message)
      );
    }, 600);
    return () => clearTimeout(timer);
  }, [activeId, draft, busy, loading]);
  useEffect(() => {
    if (
      !open ||
      !conversations.some((item) => item.status === "processing") ||
      busy
    )
      return;
    const timer = setTimeout(() => {
      void loadConversations();
    }, 1500);
    return () => clearTimeout(timer);
  }, [open, conversations, busy]);

  async function startConversation() {
    if (busy) return;
    if (active && !active.messages.length && !draft.trim()) {
      setHistory(false);
      setSettings(false);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const conversation: Conversation = await api("conversations", {});
      replace(conversation);
      setActiveId(conversation.id);
      setHistory(false);
      setSettings(false);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeConversation(id: string) {
    setBusy(true);
    setError("");
    try {
      await api(`conversations/${id}/remove`, {});
      let remaining = conversations.filter((item) => item.id !== id);
      if (!remaining.length) remaining = [await api("conversations", {})];
      setConversations(remaining);
      if (activeId === id) setActiveId(remaining[0].id);
      panel.current
        ?.querySelector<HTMLButtonElement>("#assistant-history button")
        ?.focus();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function changeModel(model: string) {
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      replace(await api(`conversations/${active.id}/update`, { model }));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function changePolicy(value: Policy) {
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      replace(
        await api(`conversations/${active.id}/update`, { policy: value })
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function run(path: string, body: unknown) {
    if (!active || busy) return;
    setBusy(true);
    setError("");
    try {
      const conversation: Conversation = await api(
        `conversations/${active.id}/${path}`,
        body
      );
      replace(conversation);
      if (
        conversation.trace
          .slice(active.trace.length)
          .some(
            (entry) => entry.effect === "write" && entry.status === "success"
          )
      )
        await onChange();
    } catch (failure) {
      setError((failure as Error).message);
      // O resultado pode ter sido persistido mesmo se a resposta HTTP se perdeu.
      try {
        replace(await api(`conversations/${active.id}`));
      } catch {
        /* Mantém o erro original. */
      }
    } finally {
      setBusy(false);
    }
  }

  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !settings) return;

    function dismiss(event: PointerEvent) {
      if (
        event.target instanceof Element &&
        !event.target.closest(
          '#assistant-settings, [aria-controls="assistant-settings"]'
        )
      )
        setSettings(false);
    }

    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    input.current?.focus();
    const background = Array.from(
      document.querySelectorAll<HTMLElement>(".app > aside, .app > main")
    );
    const previousInert = background.map((element) => element.inert);
    background.forEach((element) => {
      element.inert = true;
    });

    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (panel.current?.querySelector("#assistant-settings")) {
          setSettings(false);
          panel.current
            .querySelector<HTMLButtonElement>(
              '[aria-controls="assistant-settings"]'
            )
            ?.focus();
        } else if (panel.current?.querySelector("#assistant-history")) {
          setHistory(false);
          panel.current
            .querySelector<HTMLButtonElement>(
              '[aria-controls="assistant-history"]'
            )
            ?.focus();
        } else setOpen(false);
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]'
        ) || []
      );
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", keyboard);
    return () => {
      document.body.style.overflow = previousOverflow;
      background.forEach((element, index) => {
        element.inert = previousInert[index];
      });
      document.removeEventListener("keydown", keyboard);
      launcher.current?.focus();
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    if (history)
      panel.current
        ?.querySelector<HTMLButtonElement>("#assistant-history button")
        ?.focus();
    else if (!loading && !busy) {
      if (active?.pending.length)
        panel.current
          ?.querySelector<HTMLButtonElement>(".assistant-approval button")
          ?.focus();
      else input.current?.focus();
    }
  }, [activeId, history, open, loading, busy]);
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: "nearest" });
  }, [messages, open, history]);

  function send(value: string) {
    const text = value.trim();
    if (
      !text ||
      !active ||
      busy ||
      active.pending.length ||
      active.status === "processing" ||
      active.status === "error"
    )
      return;
    const requestId = crypto.randomUUID();
    setConversations((current) =>
      current.map((item) =>
        item.id === active.id
          ? {
              ...item,
              draft: "",
              messages: [
                ...item.messages,
                { id: requestId, role: "user", text }
              ]
            }
          : item
      )
    );
    void run("messages", { text, requestId });
  }

  return (
    <>
      <button
        ref={launcher}
        className="assistant-launcher"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="assistant-panel"
      >
        <Sparkles size={19} />
        <span>Assistente</span>
      </button>
      {open && (
        <div className="assistant-overlay" onClick={() => setOpen(false)}>
          <section
            ref={panel}
            id="assistant-panel"
            className="assistant-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="assistant-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="assistant-header">
              <div className="assistant-mark">
                <Sparkles size={21} />
              </div>
              <div className="assistant-heading">
                <h2 id="assistant-title">Assistente forma</h2>
                <p>{company.name}</p>
              </div>
              <button
                className="assistant-icon"
                aria-label="Conversas"
                aria-expanded={history}
                aria-controls="assistant-history"
                disabled={busy}
                onClick={() => {
                  setHistory(!history);
                  setSettings(false);
                }}
              >
                <History size={19} />
              </button>
              <button
                className="assistant-icon"
                title="Nova conversa"
                aria-label="Nova conversa"
                disabled={busy || loading}
                onClick={() => void startConversation()}
              >
                <Plus size={19} />
              </button>
              <button
                className="assistant-icon"
                aria-label="Configurações do assistente"
                aria-expanded={settings}
                aria-controls="assistant-settings"
                onClick={() => {
                  setSettings(!settings);
                  setHistory(false);
                }}
              >
                <Settings2 size={18} />
              </button>
              <button
                className="assistant-icon"
                aria-label="Fechar assistente"
                onClick={() => setOpen(false)}
              >
                <X size={20} />
              </button>
            </header>
            {settings && (
              <div id="assistant-settings" className="assistant-settings">
                {modelOptions.models.length > 0 && (
                  <>
                    <label htmlFor="assistant-model">Modelo</label>
                    <select
                      id="assistant-model"
                      value={active?.model || modelOptions.defaultModel}
                      disabled={busy || !active || active.messages.length > 0}
                      onChange={(event) => void changeModel(event.target.value)}
                    >
                      {modelOptions.models.map((model) => (
                        <option key={model} value={model}>
                          {model === "gpt-5.6-luna"
                            ? "GPT-5.6 Luna · legado"
                            : model === "gpt-6-luna"
                              ? "GPT-6 Luna · tarefas simples"
                              : model === "gpt-6.1-sol"
                                ? "GPT-6.1 Sol · uso geral"
                                : model}
                        </option>
                      ))}
                    </select>
                    <p>
                      {active?.messages.length
                        ? "Crie uma nova conversa para trocar o modelo."
                        : "Escolha o modelo antes de começar a conversa."}
                    </p>
                  </>
                )}
                <label htmlFor="assistant-policy">
                  <ShieldCheck size={16} /> Aprovação de ferramentas
                </label>
                <select
                  id="assistant-policy"
                  value={policy}
                  disabled={
                    busy ||
                    !active ||
                    active.pending.length > 0 ||
                    active.status === "processing"
                  }
                  onChange={(event) =>
                    void changePolicy(event.target.value as Policy)
                  }
                >
                  <option value="none">Pedir aprovação para tudo</option>
                  <option value="reads">
                    Aprovar apenas leituras automaticamente
                  </option>
                  <option value="all">
                    Aprovar leituras e escritas automaticamente
                  </option>
                </select>
              </div>
            )}
            {error && (
              <div className="assistant-error" role="alert">
                {error}
                {!active && (
                  <button onClick={() => void loadConversations()}>
                    Tentar novamente
                  </button>
                )}
              </div>
            )}
            {loading && !active ? (
              <div className="assistant-loading" role="status">
                <LoaderCircle size={18} /> Carregando conversas…
              </div>
            ) : history ? (
              <div className="assistant-history" id="assistant-history">
                <div className="assistant-history-heading">
                  <button
                    className="assistant-icon"
                    aria-label="Voltar à conversa"
                    onClick={() => setHistory(false)}
                  >
                    <ArrowLeft size={17} />
                  </button>
                  <h3>Suas conversas</h3>
                  <span>{conversations.length}</span>
                </div>
                <p className="assistant-history-note">{company.name}</p>
                <div className="assistant-history-list">
                  {[...conversations]
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                    .map((conversation) => (
                      <div
                        key={conversation.id}
                        className={`assistant-history-item ${conversation.id === activeId ? "is-active" : ""}`}
                      >
                        <button
                          disabled={busy}
                          className="assistant-history-select"
                          aria-current={
                            conversation.id === activeId ? "true" : undefined
                          }
                          onClick={() => {
                            setActiveId(conversation.id);
                            setHistory(false);
                          }}
                        >
                          <MessageSquare size={17} />
                          <span>
                            <strong>{conversation.title}</strong>
                            <small>
                              {conversation.messages.at(-1)?.text ||
                                conversation.draft ||
                                "Comece uma nova conversa"}
                            </small>
                            <time
                              dateTime={new Date(
                                conversation.updatedAt
                              ).toISOString()}
                            >
                              {new Date(conversation.updatedAt).toLocaleString(
                                "pt-BR",
                                {
                                  day: "2-digit",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit"
                                }
                              )}
                            </time>
                          </span>
                        </button>
                        <button
                          className="assistant-icon assistant-history-delete"
                          aria-label={`Excluir conversa: ${conversation.title}`}
                          disabled={
                            busy || conversation.status === "processing"
                          }
                          onClick={() =>
                            void removeConversation(conversation.id)
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              <>
                <div className="assistant-conversation">
                  {messages.length === 0 ? (
                    <div className="assistant-welcome">
                      <div className="assistant-welcome-icon">
                        <MessageSquare size={29} />
                        <Sparkles size={15} />
                      </div>
                      <span className="eyebrow">UM NOVO JEITO DE OPERAR</span>
                      <h3>
                        Seu negócio,
                        <br />
                        em uma conversa.
                      </h3>
                      <p>
                        Consulte um resumo da operação e encontre o que precisa
                        acompanhar.
                      </p>
                      <div className="assistant-suggestions">
                        {suggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            disabled={busy || !active}
                            onClick={() => send(suggestion)}
                          >
                            {suggestion}
                            <ChevronRight size={16} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div
                      className="assistant-messages"
                      role="log"
                      aria-label="Conversa com o assistente"
                      aria-live="polite"
                      aria-relevant="additions"
                    >
                      {messages.map((message) => (
                        <div
                          className={`assistant-message assistant-message-${message.role}`}
                          key={message.id}
                        >
                          <span className="assistant-message-label">
                            {message.role === "user"
                              ? "Você"
                              : "Assistente forma"}
                          </span>
                          <div>{message.text}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {activity.length ? (
                    <details className="assistant-tool-history">
                      <summary>Atividade · {activity.length} chamadas</summary>
                      {activity.map((entry) => (
                        <div key={entry.id}>
                          <strong>{entry.name}</strong>
                          <span>
                            {entry.status === "success"
                              ? "Concluída"
                              : entry.status === "rejected"
                                ? "Rejeitada"
                                : "Erro"}
                          </span>
                          <details>
                            <summary>Ver argumentos e resultado</summary>
                            <pre>
                              {JSON.stringify(
                                {
                                  argumentos: entry.args,
                                  resultado: entry.output
                                },
                                null,
                                2
                              )}
                            </pre>
                          </details>
                        </div>
                      ))}
                    </details>
                  ) : null}
                  {active?.pending.map((call) => (
                    <div className="assistant-approval" key={call.id}>
                      <div>
                        <ShieldCheck size={17} />
                        <strong>
                          {call.effect === "write"
                            ? "Aprovar alteração"
                            : "Aprovar consulta"}
                        </strong>
                      </div>
                      <p className="assistant-approval-message">
                        {call.approvalMessage || call.description}
                      </p>
                      {!call.approvalMessage && (
                        <pre>{JSON.stringify(call.args, null, 2)}</pre>
                      )}
                      <div>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run("decisions", {
                              decisions: [{ id: call.id, decision: "reject" }]
                            })
                          }
                        >
                          Rejeitar
                        </button>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            void run("decisions", {
                              decisions: [{ id: call.id, decision: "approve" }]
                            })
                          }
                        >
                          Aprovar
                        </button>
                      </div>
                    </div>
                  ))}
                  {active?.status === "error" && (
                    <div className="assistant-error" role="alert">
                      <p>{active.error}</p>
                      <button
                        disabled={busy}
                        onClick={() => void run("retry", {})}
                      >
                        Retomar conversa
                      </button>
                    </div>
                  )}
                  {(busy || active?.status === "processing") && (
                    <div className="assistant-loading" role="status">
                      <LoaderCircle size={16} /> Processando…
                    </div>
                  )}
                  <div ref={end} />
                </div>
                <form
                  className="assistant-composer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    send(draft);
                  }}
                >
                  <div className="assistant-input-wrap">
                    <textarea
                      ref={input}
                      aria-label="Mensagem para o assistente"
                      placeholder="O que você precisa acompanhar?"
                      value={draft}
                      maxLength={2000}
                      rows={2}
                      disabled={!active || busy || active.status !== "idle"}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          !event.shiftKey &&
                          !event.nativeEvent.isComposing
                        ) {
                          event.preventDefault();
                          send(draft);
                        }
                      }}
                    />
                    <button
                      type="submit"
                      disabled={
                        !draft.trim() ||
                        !active ||
                        busy ||
                        active.status !== "idle"
                      }
                      aria-label="Enviar mensagem"
                    >
                      <ArrowUp size={19} />
                    </button>
                  </div>
                  <div className="assistant-composer-note">
                    <ShieldCheck size={13} />
                    <span>
                      {policy === "none"
                        ? "Aprovação para todas as ferramentas"
                        : policy === "reads"
                          ? "Aprovação antes de alterações"
                          : "Aprovação automática de leituras e escritas"}
                    </span>
                  </div>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

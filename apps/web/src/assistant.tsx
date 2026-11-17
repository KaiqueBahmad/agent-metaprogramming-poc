import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, ChevronRight, History, MessageSquare, Plus, Trash2, Settings2, ShieldCheck, Sparkles, X } from "lucide-react";
import { Company } from "./api";
import "./assistant.css";

type Snapshot = {
  customers: { name: string }[];
  products: { name: string; stock: number }[];
  orders: { id: number; status: string }[];
  dashboard: { sales: number; receivable: number; received: number; lowStock: number };
};
type Message = { role: "user" | "assistant"; text: string };
type Policy = "none" | "reads" | "all";
type Conversation = { id: string; title: string; messages: Message[]; policy: Policy; draft: string; updatedAt: number };
function newConversation(): Conversation {
  return { id: crypto.randomUUID(), title: "Nova conversa", messages: [], policy: "reads", draft: "", updatedAt: Date.now() };
}
function readConversations(key: string): Conversation[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) || "null");
    if (!Array.isArray(saved)) return [];
    return saved.filter((item): item is Conversation => item && typeof item.id === "string" && typeof item.title === "string" && typeof item.draft === "string" && Number.isFinite(item.updatedAt) && !Number.isNaN(new Date(item.updatedAt).getTime()) && ["none", "reads", "all"].includes(item.policy) && Array.isArray(item.messages) && item.messages.every((message: Message) => message && ["user", "assistant"].includes(message.role) && typeof message.text === "string"));
  } catch { return []; }
}
const suggestions = ["Como está minha operação?", "O que está com estoque baixo?", "Quais pedidos estão pendentes?"];
const currency = (value: number) => (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function reply(prompt: string, data: Snapshot | null) {
  if (!data) return "Aguarde o carregamento dos dados da empresa e tente novamente.";
  const text = prompt.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/confirm|cadastr|registr|cri[ae]|cancel|alter|exclu|recebimento/.test(text))
    return "Para cadastrar, confirmar ou alterar informações, acesse a tela correspondente no ERP.";
  if (/estoque|produto/.test(text)) {
    const low = data.products.filter((product) => product.stock <= 5);
    return low.length ? `Estes produtos estão com até 5 unidades:\n\n${low.map((product) => `• ${product.name}: ${product.stock} un.`).join("\n")}\n\nConsulte a tela de Estoque para registrar uma entrada.` : "Todos os produtos estão com mais de 5 unidades em estoque.";
  }
  if (/pedido|pendente|venda/.test(text)) {
    const drafts = data.orders.filter((order) => order.status === "draft");
    const confirmed = data.orders.filter((order) => order.status === "confirmed");
    return `Você tem ${drafts.length} pedido(s) em rascunho e ${confirmed.length} confirmado(s) aguardando recebimento.\n\n${[...drafts, ...confirmed].map((order) => `• Pedido #${order.id} · ${order.status === "draft" ? "Rascunho" : "A receber"}`).join("\n") || "Não há pedidos pendentes."}`;
  }
  if (/operacao|resumo|financeir|receber|cliente/.test(text))
    return `Aqui está o resumo da operação:\n\n• Vendas: ${currency(data.dashboard.sales)}\n• A receber: ${currency(data.dashboard.receivable)}\n• Recebido: ${currency(data.dashboard.received)}\n• Clientes: ${data.customers.length}\n• Produtos com estoque baixo: ${data.dashboard.lowStock}\n\nVocê pode pedir detalhes de estoque ou pedidos pendentes.`;
  return "Posso ajudar com um resumo da operação, produtos com estoque baixo e pedidos pendentes. Escolha uma sugestão ou pergunte sobre um desses assuntos.";
}

export function Assistant({ company, data, userId }: { company: Company; data: Snapshot | null; userId: number }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const storageKey = `forma-assistant:${userId}:${company.id}`;
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const saved = readConversations(storageKey);
    return saved.length ? saved.sort((a, b) => b.updatedAt - a.updatedAt) : [newConversation()];
  });
  const [activeId, setActiveId] = useState(() => conversations[0].id);
  const [history, setHistory] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const active = conversations.find((conversation) => conversation.id === activeId) || conversations[0];
  const { policy, messages, draft } = active;
  function updateActive(update: Partial<Conversation>) {
    setConversations((current) => current.map((conversation) => conversation.id === active.id ? { ...conversation, ...update, updatedAt: Date.now() } : conversation));
  }
  function startConversation() {
    if (!active.messages.length && !active.draft.trim()) {
      setHistory(false); setSettings(false); return;
    }
    const conversation = newConversation();
    setConversations((current) => [conversation, ...current]);
    setActiveId(conversation.id);
    setHistory(false);
    setSettings(false);
  }
  function removeConversation(id: string) {
    panel.current?.querySelector<HTMLButtonElement>("#assistant-history button")?.focus();
    const remaining = conversations.filter((conversation) => conversation.id !== id);
    if (!remaining.length) remaining.push(newConversation());
    setConversations(remaining);
    if (activeId === id) setActiveId(remaining[0].id);
  }
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(conversations)); setStorageError(false); }
    catch { setStorageError(true); }
  }, [conversations, storageKey]);
  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !settings) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Element && !event.target.closest('#assistant-settings, [aria-controls="assistant-settings"]')) setSettings(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    input.current?.focus();
    const background = Array.from(document.querySelectorAll<HTMLElement>(".app > aside, .app > main"));
    const previousInert = background.map((element) => element.inert);
    background.forEach((element) => { element.inert = true; });
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (panel.current?.querySelector("#assistant-settings")) {
          setSettings(false);
          panel.current.querySelector<HTMLButtonElement>('[aria-controls="assistant-settings"]')?.focus();
        } else if (panel.current?.querySelector("#assistant-history")) {
          setHistory(false);
          panel.current.querySelector<HTMLButtonElement>('[aria-controls="assistant-history"]')?.focus();
        } else setOpen(false);
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, select, summary, [tabindex="0"]') || []);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", keyboard);
    return () => {
      document.body.style.overflow = previousOverflow;
      background.forEach((element, index) => { element.inert = previousInert[index]; });
      document.removeEventListener("keydown", keyboard);
      launcher.current?.focus();
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    if (history) panel.current?.querySelector<HTMLButtonElement>("#assistant-history button")?.focus();
    else input.current?.focus();
  }, [activeId, history, open]);
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: "nearest" }); }, [messages, open, history]);

  function send(value: string) {
    const text = value.trim();
    if (!text) return;
    updateActive({ messages: [...messages, { role: "user", text }, { role: "assistant", text: reply(text, data) }], draft: "", title: messages.length ? active.title : text.slice(0, 70) });
    input.current?.focus();
  }

  return <>
    <button ref={launcher} className="assistant-launcher" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} aria-controls="assistant-panel">
      <Sparkles size={19} /><span>Assistente</span>
    </button>
    {open && <div className="assistant-overlay" onClick={() => setOpen(false)}>
      <section ref={panel} id="assistant-panel" className="assistant-panel" role="dialog" aria-modal="true" aria-labelledby="assistant-title" onClick={(event) => event.stopPropagation()}>
        <header className="assistant-header">
          <div className="assistant-mark"><Sparkles size={21} /></div>
          <div className="assistant-heading"><h2 id="assistant-title">Assistente forma</h2><p>{company.name}</p></div>
          <button className="assistant-icon" aria-label="Conversas" aria-expanded={history} aria-controls="assistant-history" onClick={() => { setHistory(!history); setSettings(false); }}><History size={19} /></button>
          <button className="assistant-icon" title="Nova conversa" aria-label="Nova conversa" onClick={startConversation}><Plus size={19} /></button>
          <button className="assistant-icon" aria-label="Configurações do assistente" aria-expanded={settings} aria-controls="assistant-settings" onClick={() => { setSettings(!settings); setHistory(false); }}><Settings2 size={18} /></button>
          <button className="assistant-icon" aria-label="Fechar assistente" onClick={() => setOpen(false)}><X size={20} /></button>
        </header>
        {settings && <div id="assistant-settings" className="assistant-settings">
          <label htmlFor="assistant-policy"><ShieldCheck size={16} /> Aprovação de ferramentas</label>
          <select id="assistant-policy" value={policy} onChange={(event) => updateActive({ policy: event.target.value as Policy })}>
            <option value="none">Pedir aprovação para tudo</option>
            <option value="reads">Aprovar apenas leituras automaticamente</option>
            <option value="all">Aprovar leituras e escritas automaticamente</option>
          </select>

        </div>}
        {storageError && <p className="assistant-storage-error" role="status">Não foi possível salvar o histórico neste navegador. Suas conversas continuam disponíveis enquanto esta tela estiver aberta.</p>}
        {history ? <div className="assistant-history" id="assistant-history">
          <div className="assistant-history-heading"><button className="assistant-icon" aria-label="Voltar à conversa" onClick={() => setHistory(false)}><ArrowLeft size={17} /></button><h3>Suas conversas</h3><span>{conversations.length}</span></div>
          <p className="assistant-history-note">{company.name} · Salvas neste navegador</p>
          <div className="assistant-history-list">{[...conversations].sort((a, b) => b.updatedAt - a.updatedAt).map((conversation) => <div key={conversation.id} className={`assistant-history-item ${conversation.id === active.id ? "is-active" : ""}`}>
            <button className="assistant-history-select" aria-current={conversation.id === active.id ? "true" : undefined} onClick={() => { setActiveId(conversation.id); setHistory(false); }}>
              <MessageSquare size={17} /><span><strong>{conversation.title}</strong><small>{conversation.messages.at(-1)?.text || conversation.draft || "Comece uma nova conversa"}</small><time dateTime={new Date(conversation.updatedAt).toISOString()}>{new Date(conversation.updatedAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</time></span>
            </button>
            <button className="assistant-icon assistant-history-delete" aria-label={`Excluir conversa: ${conversation.title}`} onClick={() => removeConversation(conversation.id)}><Trash2 size={15} /></button>
          </div>)}</div>
        </div> : <>
        <div className="assistant-conversation">
          {messages.length === 0 ? <div className="assistant-welcome">
            <div className="assistant-welcome-icon"><MessageSquare size={29} /><Sparkles size={15} /></div>
            <span className="eyebrow">UM NOVO JEITO DE OPERAR</span>
            <h3>Seu negócio,<br />em uma conversa.</h3>
            <p>Consulte um resumo da operação e encontre o que precisa acompanhar.</p>
            <div className="assistant-suggestions">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => send(suggestion)}>{suggestion}<ChevronRight size={16} /></button>)}</div>
          </div> : <div className="assistant-messages" role="log" aria-label="Conversa com o assistente" aria-live="polite" aria-relevant="additions">
            {messages.map((message, index) => <div className={`assistant-message assistant-message-${message.role}`} key={index}>
              <span className="assistant-message-label">{message.role === "user" ? "Você" : "Assistente forma"}</span>
              <div>{message.text}</div>
            </div>)}
            <div ref={end} />
          </div>}
        </div>
        <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); send(draft); }}>
          <div className="assistant-input-wrap"><textarea ref={input} aria-label="Mensagem para o assistente" placeholder="O que você precisa acompanhar?" value={draft} maxLength={2000} rows={2} onChange={(event) => updateActive({ draft: event.target.value })} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(draft); }
          }} /><button type="submit" disabled={!draft.trim()} aria-label="Enviar mensagem"><ArrowUp size={19} /></button></div>
          <div className="assistant-composer-note"><ShieldCheck size={13} /><span>{policy === "none" ? "Aprovação para todas as ferramentas" : policy === "reads" ? "Aprovação antes de alterações" : "Aprovação automática de leituras e escritas"}</span></div>
        </form>
        </>}
      </section>
    </div>}
  </>;
}

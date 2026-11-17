import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronRight, MessageSquare, Plus, Settings2, ShieldCheck, Sparkles, X } from "lucide-react";
import { Company } from "./api";
import "./assistant.css";

type Snapshot = {
  customers: { name: string }[];
  products: { name: string; stock: number }[];
  orders: { id: number; status: string }[];
  dashboard: { sales: number; receivable: number; received: number; lowStock: number };
};
type Message = { role: "user" | "assistant"; text: string };
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

export function Assistant({ company, data }: { company: Company; data: Snapshot | null }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [policy, setPolicy] = useState("reads");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
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
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: "nearest" }); }, [messages, open]);

  function send(value: string) {
    const text = value.trim();
    if (!text) return;
    setMessages((current) => [...current, { role: "user", text }, { role: "assistant", text: reply(text, data) }]);
    setDraft("");
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
          <button className="assistant-icon" title="Nova conversa" aria-label="Nova conversa" disabled={!messages.length} onClick={() => { setMessages([]); setDraft(""); setPolicy("reads"); setSettings(false); input.current?.focus(); }}><Plus size={19} /></button>
          <button className="assistant-icon" aria-label="Configurações do assistente" aria-expanded={settings} aria-controls="assistant-settings" onClick={() => setSettings(!settings)}><Settings2 size={18} /></button>
          <button className="assistant-icon" aria-label="Fechar assistente" onClick={() => setOpen(false)}><X size={20} /></button>
        </header>
        {settings && <div id="assistant-settings" className="assistant-settings">
          <label htmlFor="assistant-policy"><ShieldCheck size={16} /> Aprovação de ferramentas</label>
          <select id="assistant-policy" value={policy} onChange={(event) => setPolicy(event.target.value)}>
            <option value="none">Pedir aprovação para tudo</option>
            <option value="reads">Aprovar apenas leituras automaticamente</option>
            <option value="all">Aprovar leituras e escritas automaticamente</option>
          </select>

        </div>}
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
          <div className="assistant-input-wrap"><textarea ref={input} aria-label="Mensagem para o assistente" placeholder="O que você precisa acompanhar?" value={draft} maxLength={2000} rows={2} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(draft); }
          }} /><button type="submit" disabled={!draft.trim()} aria-label="Enviar mensagem"><ArrowUp size={19} /></button></div>
          <div className="assistant-composer-note"><ShieldCheck size={13} /><span>{policy === "none" ? "Aprovação para todas as ferramentas" : policy === "reads" ? "Aprovação antes de alterações" : "Aprovação automática de leituras e escritas"}</span></div>
        </form>
      </section>
    </div>}
  </>;
}

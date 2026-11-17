import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  ShoppingBag,
  Users,
  Package,
  ArrowUpRight,
  Plus,
  X,
  Boxes,
  CircleCheck,
  Wallet,
} from "lucide-react";
import "./style.css";
type Customer = { id: number; name: string; email: string; document: string };
type Product = {
  id: number;
  name: string;
  sku: string;
  price: number;
  stock: number;
};
type Order = {
  id: number;
  customer_name: string;
  status: string;
  total: number;
  created_at: string;
  items: { product_name: string; quantity: number; price: number }[];
};
type Movement = {
  id: number;
  product_name: string;
  quantity: number;
  reason: string;
  created_at: string;
  order_id: number | null;
};
type Data = {
  customers: Customer[];
  products: Product[];
  orders: Order[];
  movements: Movement[];
  dashboard: {
    sales: number;
    receivable: number;
    received: number;
    lowStock: number;
  };
};
const money = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    n / 100,
  );
const date = (s: string) =>
  new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
const statuses: Record<string, string> = {
  draft: "Rascunho",
  confirmed: "A receber",
  paid: "Recebido",
  cancelled: "Cancelado",
};
async function api(path: string, body?: unknown) {
  const res = await fetch(
    `/api/${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await res.json();
  if (!res.ok)
    throw new Error(
      Array.isArray(data.message)
        ? data.message.join(", ")
        : data.message || "Não foi possível concluir.",
    );
  return data;
}
function App() {
  const [tab, setTab] = useState("Visão geral"),
    [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState("");
  const [lines, setLines] = useState([{ productId: "", quantity: 1 }]);
  const load = async () => {
    const [customers, products, orders, movements, dashboard] =
      await Promise.all(
        ["customers", "products", "orders", "movements", "dashboard"].map((p) =>
          api(p),
        ),
      );
    setData({ customers, products, orders, movements, dashboard });
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function act(path: string, body: unknown = {}) {
    setBusy(true);
    setError("");
    try {
      await api(path, body);
      await load();
      setModal("");
      setNotice("Operação concluída com sucesso.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    if (modal === "customer") await act("customers", values);
    if (modal === "product")
      await act("products", {
        ...values,
        price: Math.round(Number(values.price) * 100),
        stock: Number(values.stock),
      });
    if (modal === "order")
      await act("orders", {
        customerId: Number(values.customerId),
        items: lines.map((l) => ({
          productId: Number(l.productId),
          quantity: l.quantity,
        })),
      });
    if (modal.startsWith("stock:"))
      await act(`products/${modal.split(":")[1]}/restock`, {
        quantity: Number(values.quantity),
        reason: values.reason,
      });
  }
  const nav = [
    { name: "Visão geral", icon: LayoutDashboard },
    { name: "Pedidos", icon: ShoppingBag },
    { name: "Clientes", icon: Users },
    { name: "Produtos", icon: Package },
    { name: "Estoque", icon: Boxes },
  ];
  const open = (m: string) => {
    setError("");
    setLines([{ productId: "", quantity: 1 }]);
    setModal(m);
  };
  const orders =
    data?.orders.filter((o) =>
      `${o.id} ${o.customer_name} ${statuses[o.status]}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) || [];
  const orderTable = (items: Order[]) => (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Pedido / cliente</th>
            <th>Data</th>
            <th>Status</th>
            <th>Total</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {items.map((o) => (
            <tr key={o.id}>
              <td>
                <strong>#{String(o.id).padStart(4, "0")}</strong>
                <span>{o.customer_name}</span>
                <details>
                  <summary>{o.items.length} produto(s)</summary>
                  {o.items.map((i, n) => (
                    <small key={n}>
                      {i.quantity} × {i.product_name} · {money(i.price)}
                    </small>
                  ))}
                </details>
              </td>
              <td>{date(o.created_at)}</td>
              <td>
                <b className={`badge ${o.status}`}>{statuses[o.status]}</b>
              </td>
              <td className="amount">{money(o.total)}</td>
              <td>
                <div className="actions">
                  {o.status === "draft" && (
                    <button
                      disabled={busy}
                      onClick={() => act(`orders/${o.id}/confirm`)}
                    >
                      Confirmar
                    </button>
                  )}
                  {o.status === "confirmed" && (
                    <button
                      disabled={busy}
                      onClick={() => act(`orders/${o.id}/pay`)}
                    >
                      Receber
                    </button>
                  )}
                  {["draft", "confirmed"].includes(o.status) && (
                    <button
                      className="muted"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Cancelar pedido #${o.id}? O estoque de pedidos confirmados será devolvido.`,
                          )
                        )
                          void act(`orders/${o.id}/cancel`);
                      }}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && (
        <p className="empty">Nenhum pedido por aqui. Comece uma nova venda.</p>
      )}
    </div>
  );
  return (
    <div className="app">
      <aside>
        <a className="brand" href="/">
          f<span>o</span>rma<span className="brand-dot">.</span>
        </a>
        <div className="workspace">
          <div className="avatar">F</div>
          <div>
            <strong>Forma Papelaria</strong>
            <small>Ambiente de demonstração</small>
          </div>
        </div>
        <div className="nav-label">ESPAÇO DE TRABALHO</div>
        <nav>
          {nav.map((n) => (
            <button
              className={tab === n.name ? "active" : ""}
              key={n.name}
              onClick={() => {
                setTab(n.name);
                setSearch("");
              }}
            >
              <n.icon size={19} />
              {n.name}
              {n.name === "Pedidos" && (
                <em>
                  {data?.orders.filter((o) => o.status === "draft").length || 0}
                </em>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="live-dot" /> ERP simples. Negócio em dia.
          <small>POC · SQLite local</small>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            Workspace <span>/</span> {tab}
          </div>
          <div className="profile">
            <span className="demo">DEMONSTRAÇÃO</span>
            <div className="avatar">AD</div>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">SEU NEGÓCIO, EM ORDEM</div>
              <h1>
                {tab === "Visão geral" ? "Tudo pronto para um bom dia." : tab}
              </h1>
              <p>
                {
                  (
                    {
                      "Visão geral":
                        "Acompanhe suas vendas, seu estoque e os próximos passos.",
                      Pedidos: "Da primeira ideia à venda recebida.",
                      Clientes: "As pessoas que fazem o seu negócio acontecer.",
                      Produtos: "Seu catálogo, organizado e sempre à mão.",
                      Estoque: "Cada entrada e saída, no lugar certo.",
                    } as Record<string, string>
                  )[tab]
                }
              </p>
            </div>
            <button
              className="primary"
              onClick={() =>
                open(
                  tab === "Clientes"
                    ? "customer"
                    : tab === "Produtos"
                      ? "product"
                      : "order",
                )
              }
            >
              <Plus size={17} />
              {tab === "Clientes"
                ? "Novo cliente"
                : tab === "Produtos"
                  ? "Novo produto"
                  : "Novo pedido"}
            </button>
          </div>
          {error && (
            <div role="alert" className="alert error">
              {error}
              <button onClick={() => setError("")} aria-label="Fechar erro">
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert success">
              {notice}
              <button onClick={() => setNotice("")} aria-label="Fechar aviso">
                <X size={16} />
              </button>
            </div>
          )}
          {!data ? (
            <div className="panel empty">
              {error
                ? "Não foi possível carregar os dados."
                : "Carregando seu espaço…"}
              <button onClick={() => load().catch((e) => setError(e.message))}>
                Atualizar
              </button>
            </div>
          ) : (
            <>
              {tab === "Visão geral" && (
                <>
                  <div className="stats">
                    {[
                      {
                        label: "Vendas confirmadas",
                        value: money(data.dashboard.sales),
                        icon: ShoppingBag,
                        note: "Pedidos confirmados e recebidos",
                      },
                      {
                        label: "A receber",
                        value: money(data.dashboard.receivable),
                        icon: Wallet,
                        note: "Vendas aguardando recebimento",
                      },
                      {
                        label: "Recebido",
                        value: money(data.dashboard.received),
                        icon: CircleCheck,
                        note: "Entradas já registradas",
                      },
                      {
                        label: "Estoque baixo",
                        value: String(data.dashboard.lowStock).padStart(2, "0"),
                        icon: Package,
                        note: "Produtos com até 5 unidades",
                      },
                    ].map((s, i) => (
                      <div className={`stat stat-${i}`} key={s.label}>
                        <div className="stat-top">
                          {s.label}
                          <s.icon size={18} />
                        </div>
                        <strong>{s.value}</strong>
                        <small>{s.note}</small>
                      </div>
                    ))}
                  </div>
                  <div className="overview-grid">
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Últimos pedidos</h2>
                          <p>O movimento mais recente da sua operação.</p>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => setTab("Pedidos")}
                        >
                          Ver todos <ArrowUpRight size={16} />
                        </button>
                      </div>
                      {orderTable(data.orders.slice(0, 5))}
                    </section>
                    <div className="right-column">
                      <section className="flow-card">
                        <span className="eyebrow">DO CADASTRO AO CAIXA</span>
                        <h2>
                          Uma venda.
                          <br />
                          Tudo conectado.
                        </h2>
                        <p>
                          Cliente, produto, estoque e recebimento no mesmo
                          fluxo.
                        </p>
                        <div className="steps">
                          {[
                            "Crie um pedido",
                            "Confirme a venda",
                            "Registre o recebimento",
                          ].map((s, i) => (
                            <div key={s}>
                              <b>{i + 1}</b>
                              {s}
                            </div>
                          ))}
                        </div>
                        <button onClick={() => open("order")}>
                          Começar uma venda <ArrowUpRight size={17} />
                        </button>
                      </section>
                      <section className="panel stock-card">
                        <div className="panel-heading">
                          <h2>De olho no estoque</h2>
                          <Package size={18} />
                        </div>
                        {data.products
                          .filter((p) => p.stock <= 5)
                          .map((p) => (
                            <div className="stock-line" key={p.id}>
                              <div>
                                <strong>{p.name}</strong>
                                <small>{p.sku}</small>
                              </div>
                              <b>{p.stock} un.</b>
                            </div>
                          ))}
                        {!data.dashboard.lowStock && <p>Estoque em dia.</p>}
                        <button
                          className="text-button"
                          onClick={() => setTab("Estoque")}
                        >
                          Gerenciar estoque <ArrowUpRight size={15} />
                        </button>
                      </section>
                    </div>
                  </div>
                </>
              )}
              {tab === "Pedidos" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>
                      Todos os pedidos{" "}
                      <span className="count">{data.orders.length}</span>
                    </h2>
                    <input
                      aria-label="Buscar pedidos"
                      placeholder="Buscar cliente, número ou status…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  {orderTable(orders)}
                </section>
              )}
              {tab === "Clientes" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Sua base de clientes</h2>
                    <span className="count">
                      {data.customers.length} clientes
                    </span>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Cliente</th>
                          <th>E-mail</th>
                          <th>Documento</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.customers.map((c) => (
                          <tr key={c.id}>
                            <td>
                              <strong>{c.name}</strong>
                              <span>#{c.id}</span>
                            </td>
                            <td>{c.email || "—"}</td>
                            <td>{c.document || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!data.customers.length && (
                      <p className="empty">Cadastre seu primeiro cliente.</p>
                    )}
                  </div>
                </section>
              )}
              {tab === "Produtos" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Catálogo de produtos</h2>
                    <span className="count">
                      {data.products.length} produtos
                    </span>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th>SKU</th>
                          <th>Preço de venda</th>
                          <th>Estoque</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.products.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <strong>{p.name}</strong>
                            </td>
                            <td>{p.sku}</td>
                            <td className="amount">{money(p.price)}</td>
                            <td>
                              <b
                                className={`badge ${p.stock <= 5 ? "draft" : "paid"}`}
                              >
                                {p.stock} un.
                              </b>
                            </td>
                            <td>
                              <button onClick={() => open(`stock:${p.id}`)}>
                                Repor estoque
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!data.products.length && (
                      <p className="empty">Adicione seu primeiro produto.</p>
                    )}
                  </div>
                </section>
              )}
              {tab === "Estoque" && (
                <>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Saldo disponível</h2>
                        <p>
                          A confirmação do pedido realiza a baixa
                          automaticamente.
                        </p>
                      </div>
                    </div>
                    <div className="inventory-grid">
                      {data.products.map((p) => (
                        <div className="inventory-item" key={p.id}>
                          <Package size={21} />
                          <strong>{p.name}</strong>
                          <small>{p.sku}</small>
                          <h2>
                            {p.stock} <small>unidades</small>
                          </h2>
                          <button onClick={() => open(`stock:${p.id}`)}>
                            <Plus size={15} /> Registrar entrada
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="panel movements">
                    <div className="panel-heading">
                      <h2>Últimas movimentações</h2>
                      <span className="count">Até 100 registros</span>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Produto</th>
                            <th>Motivo</th>
                            <th>Quantidade</th>
                            <th>Pedido</th>
                            <th>Data</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.movements.map((m) => (
                            <tr key={m.id}>
                              <td>
                                <strong>{m.product_name}</strong>
                              </td>
                              <td>{m.reason}</td>
                              <td className={m.quantity > 0 ? "positive" : ""}>
                                {m.quantity > 0 ? "+" : ""}
                                {m.quantity}
                              </td>
                              <td>{m.order_id ? `#${m.order_id}` : "—"}</td>
                              <td>{date(m.created_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
              <footer>
                <span>
                  <span className="live-dot" /> Tudo conectado, do pedido ao
                  estoque.
                </span>
                <span>forma ERP · POC</span>
              </footer>
            </>
          )}
        </div>
      </main>
      {modal && data && (
        <div className="overlay" onClick={() => !busy && setModal("")}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-heading">
              <h2 id="modal-title">
                {modal === "customer"
                  ? "Novo cliente"
                  : modal === "product"
                    ? "Novo produto"
                    : modal === "order"
                      ? "Novo pedido"
                      : "Entrada de estoque"}
              </h2>
              <button
                aria-label="Fechar"
                disabled={busy}
                onClick={() => setModal("")}
              >
                <X size={19} />
              </button>
            </div>
            <form onSubmit={submit}>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              {modal === "customer" && (
                <>
                  <label>
                    Nome
                    <input
                      autoFocus
                      name="name"
                      required
                      minLength={2}
                      maxLength={120}
                    />
                  </label>
                  <label>
                    E-mail
                    <input type="email" name="email" />
                  </label>
                  <label>
                    CPF / CNPJ
                    <input name="document" maxLength={30} />
                  </label>
                </>
              )}
              {modal === "product" && (
                <>
                  <label>
                    Nome
                    <input autoFocus name="name" required minLength={2} />
                  </label>
                  <label>
                    SKU
                    <input name="sku" required />
                  </label>
                  <div className="form-grid">
                    <label>
                      Preço (R$)
                      <input
                        name="price"
                        type="number"
                        min="0"
                        max="1000000"
                        step="0.01"
                        required
                      />
                    </label>
                    <label>
                      Estoque inicial
                      <input
                        name="stock"
                        type="number"
                        min="0"
                        max="1000000"
                        step="1"
                        defaultValue="0"
                        required
                      />
                    </label>
                  </div>
                </>
              )}
              {modal === "order" && (
                <>
                  <label>
                    Cliente
                    <select name="customerId" required defaultValue="">
                      <option value="" disabled>
                        Selecione um cliente
                      </option>
                      {data.customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>Produtos</label>
                  {lines.map((l, i) => (
                    <div className="order-line" key={i}>
                      <select
                        aria-label={`Produto ${i + 1}`}
                        required
                        value={l.productId}
                        onChange={(e) =>
                          setLines(
                            lines.map((x, n) =>
                              n === i ? { ...x, productId: e.target.value } : x,
                            ),
                          )
                        }
                      >
                        <option value="">Selecione um produto</option>
                        {data.products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {money(p.price)} · {p.stock} un.
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label={`Quantidade ${i + 1}`}
                        type="number"
                        min="1"
                        max="10000"
                        required
                        value={l.quantity}
                        onChange={(e) =>
                          setLines(
                            lines.map((x, n) =>
                              n === i
                                ? { ...x, quantity: Number(e.target.value) }
                                : x,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        aria-label="Remover produto"
                        disabled={lines.length === 1}
                        onClick={() =>
                          setLines(lines.filter((_, n) => n !== i))
                        }
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setLines([...lines, { productId: "", quantity: 1 }])
                    }
                  >
                    <Plus size={15} /> Adicionar produto
                  </button>
                  <div className="order-total">
                    Total do pedido{" "}
                    <strong>
                      {money(
                        lines.reduce(
                          (s, l) =>
                            s +
                            (data.products.find(
                              (p) => p.id === Number(l.productId),
                            )?.price || 0) *
                              l.quantity,
                          0,
                        ),
                      )}
                    </strong>
                  </div>
                  <p className="form-note">
                    O pedido será criado como rascunho. Confirme a venda para
                    baixar o estoque.
                  </p>
                </>
              )}
              {modal.startsWith("stock:") && (
                <>
                  <p>
                    {
                      data.products.find(
                        (p) => p.id === Number(modal.split(":")[1]),
                      )?.name
                    }
                  </p>
                  <label>
                    Quantidade de entrada
                    <input
                      autoFocus
                      name="quantity"
                      type="number"
                      min="1"
                      max="1000000"
                      step="1"
                      required
                    />
                  </label>
                  <label>
                    Motivo
                    <input
                      name="reason"
                      minLength={3}
                      maxLength={200}
                      placeholder="Ex.: Compra de fornecedor"
                      required
                    />
                  </label>
                </>
              )}
              <div className="form-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setModal("")}
                >
                  Voltar
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

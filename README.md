# Forma ERP — POC

ERP enxuto com API NestJS, SQLite nativo do Node e interface React + Vite em português. Monorepo com npm workspaces. Sem ORM e sem migrations: a estrutura é criada por `CREATE TABLE IF NOT EXISTS` ao abrir o banco.

## Executar

Requer Node.js **24.15+** e npm 11+.

```bash
npm install
npm run seed
npm run dev
```

- Interface: http://localhost:5173
- API: http://localhost:3000/api
- Health check: http://localhost:3000/api/health

O Vite encaminha `/api` para o Nest; não é necessário configurar CORS. O banco é criado automaticamente em `data/erp.sqlite`, independentemente do diretório de execução. O seed é explícito: iniciar a aplicação não insere dados de demonstração.

## Fluxo de demonstração

1. **Clientes:** cadastre nome, e-mail e documento opcional.
2. **Produtos:** cadastre nome, SKU único, preço e estoque inicial.
3. **Pedidos:** escolha cliente, produtos e quantidades. O pedido nasce como rascunho, preserva os preços e ainda não reserva estoque.
4. **Confirmar:** valida o saldo de todos os itens, baixa estoque e registra movimentos em uma única transação. Falta de estoque reverte toda a operação.
5. **Receber:** registra o recebimento integral e atualiza os indicadores financeiros, sem nova baixa de estoque.
6. **Cancelar:** disponível em rascunhos e pedidos confirmados. Se já confirmado, devolve os itens ao estoque. Pedidos recebidos não podem ser cancelados nesta POC.
7. **Estoque:** registre reposições com quantidade e motivo; consulte as últimas 100 movimentações.

O painel apresenta vendas confirmadas (inclui recebidas), valor a receber, valor recebido e produtos com até cinco unidades. Os indicadores consideram todo o histórico. Valores monetários são inteiros em **centavos** no banco e na API.

## Comandos

| Comando         | Resultado                                                                           |
| --------------- | ----------------------------------------------------------------------------------- |
| `npm run dev`   | API com watch + frontend com HMR                                                    |
| `npm run clear` | Remove todos os dados e reinicia a numeração dos pedidos; mantém as tabelas         |
| `npm run seed`  | Insere 3 clientes, 5 produtos e 6 pedidos, com estados variados                     |
| `npm run reset` | Limpa os dados e executa o seed                                                     |
| `npm test`      | Testa as regras de venda, estoque, recebimento e cancelamento com SQLite em memória |
| `npm run build` | Compila API e frontend                                                              |
| `npm start`     | Inicia a API compilada                                                              |

Pare a aplicação antes de executar `clear` ou `reset`, e inicie novamente para atualizar a interface. Esses comandos apagam dados do banco configurado. O seed recusa um banco que já contém cadastros ou pedidos para evitar duplicação.

`npm start` executa somente a API. Para desenvolvimento e demonstração local, use `npm run dev`. O frontend compilado fica em `apps/web/dist` e precisa de um servidor estático com proxy `/api` para a API para uma implantação.

## Configuração

As variáveis são opcionais. `.env.example` documenta os nomes, mas o arquivo `.env` não é carregado automaticamente. Exemplo em Bash:

```bash
DATABASE_PATH=/tmp/minha-poc.sqlite PORT=3000 npm run dev
```

Mantenha a API em `3000` para usar o proxy padrão, ou ajuste `apps/web/vite.config.ts` se mudar a porta. Passe o mesmo `DATABASE_PATH` aos comandos de limpeza e seed.

## Organização

```text
apps/api/src/
  main.ts          # módulo Nest e rotas HTTP
  erp.ts           # validação Zod e regras transacionais
  database.ts      # conexão, estrutura e limpeza
  erp.test.ts      # testes com banco em memória
apps/web/src/
  main.tsx         # painel, cadastros, pedidos e estoque
  style.css        # interface responsiva
scripts/database.ts # clear e seed
```

## API

| Método     | Rota                        | Uso                                                         |
| ---------- | --------------------------- | ----------------------------------------------------------- |
| GET        | `/api/health`               | Disponibilidade                                             |
| GET        | `/api/dashboard`            | Indicadores                                                 |
| GET / POST | `/api/customers`            | Listar / cadastrar clientes                                 |
| GET / POST | `/api/products`             | Listar / cadastrar produtos                                 |
| POST       | `/api/products/:id/restock` | Entrada `{ "quantity": 10, "reason": "Compra fornecedor" }` |
| GET / POST | `/api/orders`               | Listar / criar pedidos                                      |
| POST       | `/api/orders/:id/confirm`   | Confirmar e baixar estoque                                  |
| POST       | `/api/orders/:id/pay`       | Registrar recebimento integral                              |
| POST       | `/api/orders/:id/cancel`    | Cancelar e estornar estoque quando aplicável                |
| GET        | `/api/movements`            | Últimas movimentações                                       |

Exemplo de criação de pedido:

```json
{ "customerId": 1, "items": [{ "productId": 1, "quantity": 2 }] }
```

Cliente: `{ "name": "Empresa Exemplo", "email": "compras@example.com", "document": "" }`.
Produto: `{ "name": "Caderno", "sku": "CAD-001", "price": 3490, "stock": 20 }`.

## Limites da POC

Sem autenticação, multiempresa, fiscal, contas a pagar, descontos, parcelas ou devolução de venda recebida. Os cadastros permitem criação e consulta; edição e exclusão não fazem parte deste fluxo. CPF/CNPJ é texto livre. A API foi preparada para demonstração local e não para exposição pública.

Não há evolução automática do schema: ao mudar as definições das tabelas, pare a API, remova `data/erp.sqlite` e seus arquivos auxiliares `-wal`/`-shm` se existirem e execute o seed novamente. Faça cópia do banco antes se precisar preservar dados. `clear` limpa registros, não altera a estrutura.

## Validação neste ambiente

A instalação pelo npm foi bloqueada por falha de resolução DNS de `registry.npmjs.org`. Os cinco testes das regras de negócio passaram com SQLite real em memória usando transpilação temporária e dependências já disponíveis no host. A checagem de tipos também foi feita com essas dependências locais. Os comandos de limpeza e seed também foram verificados em um arquivo SQLite temporário. A tentativa de verificar as rotas HTTP foi impedida pelo bloqueio de abertura de portas do ambiente (`listen EPERM`). O build completo com as versões declaradas, as rotas HTTP e a verificação visual no navegador ainda precisam ser executados em ambiente local após `npm install`.

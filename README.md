# Forma ERP — POC

ERP com NestJS, SQLite nativo do Node e React + Vite. Login, múltiplas empresas e permissões por vínculo. Sem ORM ou migrations. O assistente usa LangChain, ferramentas do ERP e aprovações por conversa; veja [configuração, arquitetura e avaliações](docs/assistant.md).

## Executar

Requer Node.js **24.15+** e npm 11+.

```bash
npm install
npm run seed
cp .env.example .env
npm run dev
```

Para usar o chat, configure o `.env` para [AWS/Bedrock ou uma API sem AWS](docs/assistant.md#configurar-o-modelo). Para demonstrar com o login do Codex e o modelo legado, execute `npm run dev:codex`.

Interface: http://localhost:5173 · API: http://localhost:3000/api

Se já usava o banco da versão anterior, pare a API, preserve uma cópia do banco e execute `npm run reset`. O comando apaga os dados e recria a estrutura multiempresa. A aplicação detecta o banco antigo e não tenta migrá-lo automaticamente.

## Perfis e vínculos

| Perfil      | Escopo                | Permissões                                                                               |
| ----------- | --------------------- | ---------------------------------------------------------------------------------------- |
| ADMIN       | Global                | Cadastra empresas e usuários; gerencia todos os vínculos e opera qualquer empresa        |
| DONO        | Vínculo com a empresa | Opera o ERP e adiciona/remove funcionários da própria empresa                            |
| FUNCIONARIO | Vínculo com a empresa | Opera clientes, produtos, pedidos e estoque; não gerencia usuários, empresas ou vínculos |

Somente ADMIN cadastra empresas, atribui/altera papéis e remove donos. Um dono pode vincular uma conta existente por e-mail ou cadastrar uma nova conta de funcionário ao criar o vínculo. Nome e senha informados ao vincular uma conta existente não alteram essa conta.

O perfil global de usuários comuns é `USER`; o papel DONO ou FUNCIONARIO fica no vínculo, não no usuário. O banco garante um único vínculo por par `(empresa, usuário)`. Um usuário pode ser dono de várias empresas, funcionário de várias e ter papéis diferentes entre elas. Empresas podem ter vários donos. ADMIN possui acesso global e não recebe vínculos.

Cada empresa mantém seus próprios clientes, produtos, pedidos e movimentos. O SKU é único dentro da empresa. Consultas e alterações usam o escopo validado pelo backend; referências entre registros de empresas diferentes também são impedidas por chaves estrangeiras compostas.

## Seed e contas de demonstração

Senha de todas as contas: **`senha123`**.

| E-mail                     | Forma Papelaria | Ateliê Horizonte | Café Botânico |
| -------------------------- | --------------- | ---------------- | ------------- |
| `admin@forma.example`      | ADMIN           | ADMIN            | ADMIN         |
| `ana@forma.example`        | DONO            | DONO             | Sem vínculo   |
| `bruno@forma.example`      | FUNCIONARIO     | FUNCIONARIO      | DONO          |
| `carla@forma.example`      | FUNCIONARIO     | Sem vínculo      | FUNCIONARIO   |
| `diego@forma.example`      | Sem vínculo     | FUNCIONARIO      | Sem vínculo   |
| `semvinculo@forma.example` | Sem vínculo     | Sem vínculo      | Sem vínculo   |

O seed cria **6 usuários, 3 empresas, 8 vínculos, 9 clientes, 15 produtos e 18 pedidos**, com rascunhos, vendas confirmadas e recebidas. Os mesmos SKUs em empresas diferentes permitem verificar o isolamento.

Para demonstrar: entre como ADMIN para criar empresas e vínculos; como Ana para alternar entre duas empresas próprias; como Bruno para observar a mudança de papel; e como Carla ou Diego para testar os acessos restritos. A conta sem vínculo apresenta o estado de nenhuma empresa disponível.

## Interface e fluxo do ERP

Após o login, escolha a empresa. O seletor permite trocar de empresa e mostra seu papel naquele vínculo. ADMIN tem telas de cadastro de empresas e usuários. ADMIN e DONO têm uma tela de vínculos; o funcionário vê apenas as operações do ERP.

1. Cadastre clientes e produtos, com preço e estoque inicial.
2. Crie um pedido em rascunho, sem reserva de estoque. Os preços ficam preservados no pedido.
3. Confirme a venda: o saldo de todos os itens é validado e baixado em uma transação. Falta de estoque reverte a operação inteira.
4. Registre o recebimento integral, sem nova baixa de estoque.
5. Cancele rascunhos ou pedidos confirmados; estes últimos devolvem o estoque. Pedidos recebidos não podem ser cancelados nesta POC.
6. Registre reposições com quantidade e motivo e consulte as últimas 100 movimentações da empresa.

O painel mostra vendas confirmadas (inclui recebidas), a receber, recebido e produtos com até cinco unidades. Os indicadores consideram todo o histórico da empresa ativa. Valores monetários são inteiros em centavos no banco e na API.

## Autenticação e API

Login por e-mail e senha. As senhas são armazenadas com scrypt e salt aleatório. A sessão usa token opaco aleatório com validade de oito horas; apenas seu hash é armazenado no banco. O frontend guarda a sessão em `sessionStorage`. Logout invalida o token no servidor.

Um guard global protege todas as rotas, exceto login e health. O backend consulta o usuário e o vínculo atuais em cada requisição; remover um vínculo bloqueia o acesso à empresa na próxima chamada, mesmo com a sessão ainda válida.

Depois do login, envie `Authorization: Bearer <token>`. Para as rotas do ERP, envie também `X-Company-Id: <id>`. Nas rotas `/companies/:companyId/members`, a empresa vem do caminho e prevalece sobre o header.

| Método     | Rota                                               | Uso                                                         |
| ---------- | -------------------------------------------------- | ----------------------------------------------------------- |
| GET        | `/api/health`                                      | Disponibilidade, público                                    |
| POST       | `/api/auth/login`                                  | `{ "email": "...", "password": "..." }`, público            |
| GET        | `/api/auth/me`                                     | Usuário autenticado                                         |
| POST       | `/api/auth/logout`                                 | Encerra a sessão                                            |
| GET / POST | `/api/companies`                                   | Lista empresas acessíveis / cadastra empresa (ADMIN)        |
| GET / POST | `/api/users`                                       | Lista / cadastra usuários (ADMIN)                           |
| GET / POST | `/api/companies/:companyId/members`                | Lista / adiciona vínculos (ADMIN ou DONO)                   |
| POST       | `/api/companies/:companyId/members/:userId/role`   | Altera papel (ADMIN)                                        |
| POST       | `/api/companies/:companyId/members/:userId/remove` | Remove vínculo (ADMIN ou DONO, conforme o papel do alvo)    |
| GET        | `/api/dashboard`                                   | Indicadores da empresa                                      |
| GET / POST | `/api/customers`                                   | Lista / cadastra clientes                                   |
| GET / POST | `/api/products`                                    | Lista / cadastra produtos                                   |
| POST       | `/api/products/:id/restock`                        | Entrada `{ "quantity": 10, "reason": "Compra fornecedor" }` |
| GET / POST | `/api/orders`                                      | Lista / cria pedidos                                        |
| POST       | `/api/orders/:id/confirm`                          | Confirma e baixa estoque                                    |
| POST       | `/api/orders/:id/pay`                              | Registra recebimento integral                               |
| POST       | `/api/orders/:id/cancel`                           | Cancela e estorna estoque quando aplicável                  |
| GET        | `/api/movements`                                   | Últimas movimentações da empresa                            |

Exemplos de corpos:

```json
{ "name": "Empresa Exemplo", "document": "" }
```

```json
{
  "email": "pessoa@example.com",
  "role": "FUNCIONARIO",
  "name": "Nova Pessoa",
  "password": "UmaSenha123!"
}
```

Para vincular um usuário existente, bastam `email` e `role`. Para trocar o papel de um vínculo, envie `{ "role": "DONO" }` ou `{ "role": "FUNCIONARIO" }`.

```json
{ "customerId": 1, "items": [{ "productId": 1, "quantity": 2 }] }
```

Cliente: `{ "name": "Cliente Exemplo", "email": "compras@example.com", "document": "" }`.
Produto: `{ "name": "Caderno", "sku": "CAD-001", "price": 3490, "stock": 20 }`.

## Comandos e configuração

| Comando             | Resultado                                                    |
| ------------------- | ------------------------------------------------------------ |
| `npm run dev`       | API com watch + frontend com HMR                             |
| `npm run clear`     | Apaga todos os dados, vínculos e sessões e recria as tabelas |
| `npm run seed`      | Insere a demonstração; exige banco vazio                     |
| `npm run reset`     | Limpa o banco e executa o seed                               |
| `npm test`          | Testes de negócio, autorização, isolamento e pipeline HTTP   |
| `npm run test:unit` | Regras de negócio e guards com SQLite em memória             |
| `npm run test:api`  | Compila a API e testa o pipeline HTTP sem abrir portas       |
| `npm run eval:assistant` | Avalia o modelo e as ferramentas em banco em memória; exige modelo configurado ou ponte de inferência |
| `npm run build`     | Compila API e frontend                                       |
| `npm start`         | Inicia somente a API compilada                               |

Pare a aplicação antes de `clear` ou `reset`. Ambos apagam dados; preserve uma cópia se precisar deles. As sessões anteriores deixam de funcionar, então entre novamente após o reset. O seed é explícito e não roda ao iniciar a aplicação.

O banco fica em `data/erp.sqlite`, independentemente do diretório de execução. Os exemplos estão em `.env.example` (Bedrock) e `.env.openai.example` (sem AWS). A API e as avaliações carregam `.env` da raiz automaticamente; exports do bash têm prioridade:

```bash
DATABASE_PATH=/tmp/minha-poc.sqlite PORT=3000 npm run dev
```

Passe o mesmo `DATABASE_PATH` aos comandos de limpeza e seed. Se alterar a porta da API, ajuste o proxy em `apps/web/vite.config.ts`. Para uma implantação, o frontend compilado em `apps/web/dist` precisa de servidor estático com proxy `/api` para a API.

## Organização

```text
apps/api/src/
  main.ts, app.module.ts  # inicialização e providers
  controllers/           # auth, empresas, usuários e operações do ERP
  auth.ts                # guard global e contexto de usuário/empresa
  identity.ts            # contas, senhas e sessões
  companies.ts           # empresas, vínculos e autorização
  erp.ts                 # regras transacionais com escopo obrigatório de empresa
  database.ts, seed.ts    # schema e dados de demonstração, sem migrations
  *.test.ts              # testes com SQLite em memória
apps/web/src/
  main.tsx               # entrada React
  session-app.tsx        # login, empresas e administração de acessos
  erp-app.tsx             # operações da empresa ativa
  api.ts, style.css      # cliente HTTP autenticado e interface responsiva
scripts/
  database.ts            # clear e seed
  api.test.cjs           # integração com o pipeline HTTP real do Nest
```

Sem fiscal, contas a pagar, descontos, parcelas, recuperação de senha ou devolução de venda recebida. Clientes e produtos permitem cadastro e consulta. CPF/CNPJ é texto livre. A POC não implementa planos de assinatura. O assistente implementa o catálogo anotado, descoberta sob demanda, execução autorizada e políticas de aprovação; detalhes e limites estão em [docs/assistant.md](docs/assistant.md).

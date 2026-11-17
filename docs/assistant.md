# Assistente do ERP

O chat usa LangChain para schemas, ferramentas, mensagens e chamadas ao modelo. O loop de inferência e o executor pertencem à aplicação: o backend controla descoberta, aprovação, autorização, persistência e despacho. O frontend não decide permissões nem executa regras de negócio.

## Configurar o modelo

Escolha **uma** opção e crie `.env` na raiz do projeto. `npm run dev`, `npm start` e `npm run eval:assistant` carregam esse arquivo automaticamente. Variáveis já exportadas no bash têm prioridade; reinicie a API depois de mudar a configuração.

### Com AWS — Bedrock

```bash
cp .env.example .env
```

Edite `.env`:

```dotenv
PORT=3000
ASSISTANT_PROVIDER=bedrock
ASSISTANT_MODEL=amazon.nova-lite-v1:0
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=sua-access-key
AWS_SECRET_ACCESS_KEY=sua-secret-key
AWS_SESSION_TOKEN=
```

Preencha as duas chaves. Preencha `AWS_SESSION_TOKEN` somente para credenciais temporárias. Se as credenciais já estão exportadas no bash, não precisa repeti-las no arquivo.

Para usar um profile, remova os três campos de credenciais e adicione `AWS_PROFILE=meu-profile`. Se ele usa SSO, execute `aws sso login --profile meu-profile`. IAM roles e `AWS_BEARER_TOKEN_BEDROCK` também são aceitos. `AWS_DEFAULT_REGION` ou a região do profile são usados quando `AWS_REGION` não está definido.

### Sem AWS — OpenAI ou API compatível

```bash
cp .env.openai.example .env
```

Edite `.env`:

```dotenv
PORT=3000
ASSISTANT_PROVIDER=openai
ASSISTANT_MODEL=seu-modelo
ASSISTANT_API_KEY=sua-chave
```

Para outro serviço compatível com OpenAI Chat Completions, acrescente `ASSISTANT_BASE_URL=https://seu-provedor.example/v1`. O modelo precisa suportar chamadas de ferramentas. Essa opção não usa credenciais AWS.

### Demonstração com o Codex da sua conta

Requer a CLI `codex` instalada e autenticada com `codex login` no mesmo usuário que executa a API.

Para iniciar com o modelo legado sem alterar seu `.env` de Bedrock:

```bash
npm run dev:codex
```

Também pode copiar `.env.codex.example` para `.env` e iniciar com `npm run dev`.

O exemplo usa `ASSISTANT_PROVIDER=codex` e `ASSISTANT_MODEL=gpt-5.6-luna`. Não exige chave de API ou credenciais AWS. Também pode ativar temporariamente com `ASSISTANT_PROVIDER=codex ASSISTANT_MODEL=gpt-5.6-luna npm run dev`, preservando seu `.env` de Bedrock.

Nas configurações do chat, escolha um modelo antes da primeira mensagem. Para comparar, crie uma conversa por modelo e repita a mesma tarefa. `ASSISTANT_MODELS` controla a lista permitida pelo servidor; o backend rejeita modelos fora dessa lista. O exemplo inclui GPT-5.6 Luna (legado), GPT-6 Luna e GPT-6.1 Sol. Use modelos disponíveis na sua conta; menor capacidade não garante que uma tarefa específica falhe.

Cada etapa chama `codex exec` com as mensagens e o catálogo disponível, usando a autenticação salva da CLI e os limites da conta. O subprocesso recebe um diretório temporário, sandbox de leitura e ferramentas de shell desativadas. Credenciais AWS e chaves do ERP não são repassadas no ambiente ou no prompt. Autorização, aprovações e execução das ferramentas continuam no backend. Os arquivos temporários são removidos ao terminar. Use esse modo para demonstrações locais; ele inicia um processo por etapa e pode ser mais lento que a API de um modelo.

### Iniciar

```bash
npm run dev
```

Para rodar as avaliações com o modelo escolhido:

```bash
npm run eval:assistant
```

O provedor padrão é `bedrock`. A chave da API, as credenciais AWS e o token do usuário ficam no servidor, fora das mensagens do modelo e do banco de conversas.

`Inferencer` é o contrato substituível. `LangChainInferencer` seleciona `ChatBedrockConverse`, `ChatOpenAI` ou a CLI Codex conforme `ASSISTANT_PROVIDER`. A escolha não muda o catálogo, a autorização ou a política de aprovação.

## Catálogo e execução

- `@AgentController` agrupa rotas anotadas com `@AgentRoute`.
- `@AgentGroup` agrupa métodos anotados com `@AgentAction`.
- Schemas Zod reutilizam os contratos de negócio. Argumentos extras são rejeitados no executor.
- Rotas sem anotação não entram no catálogo. Login, usuários, empresas, vínculos e a própria API do assistente não estão expostos como ferramentas nesta versão.
- O catálogo considera sessão, vínculo atual, `AdminOnly` e o callback opcional `canUse`. Grupos vazios desaparecem. As ferramentas independentes exigem `authorize`, executado a cada chamada.

O modelo recebe os resumos dos grupos e a ferramenta `consultar_grupo`. Depois da descoberta, as ferramentas do grupo são incluídas nas próximas chamadas ao modelo. Descoberta lê apenas metadados e não pede aprovação; consultas de negócio respeitam a política da conversa. Os grupos não são apresentados na interface.

As rotas reentram no servidor HTTP do Nest por um socket em memória e percorrem roteamento, middlewares, guards, pipes, interceptors e controllers. Não há chamada direta ao controller. A sessão opaca existente é injetada pelo executor; não foi criado um segundo mecanismo JWT. A empresa vem do contexto autenticado e não de argumentos do modelo. O marcador `request.origin = 'agent'` deriva de um `WeakSet` privado de sockets e está disponível desde o middleware; um header externo não o define.

O grupo independente `analises` demonstra a autorização própria: `analisar_estoque` fica disponível apenas para ADMIN/DONO e calcula unidades, valor em centavos e estoque abaixo de um limite.

## Mensagem de aprovação

`@AgentRoute` e `@AgentAction` aceitam `approvalMessage` opcional para apresentar o payload como texto ao usuário:

```ts
@AgentRoute({
  name: "cadastrar_cliente",
  description: "Cadastra um cliente.",
  effect: "write",
  schema: customerSchema,
  approvalMessage: ({ name, email }) =>
    `Cadastrar o cliente “${name}”${email ? ` com e-mail ${email}` : " sem e-mail"}.`
})
```

A função recebe os argumentos validados (incluindo defaults e normalizações do schema) e, como segundo parâmetro, o contexto autenticado sem credenciais. Pode retornar uma string ou uma Promise de string. Recebe cópias dos dados, para não modificar os argumentos da chamada. Deve apenas formatar a apresentação, sem executar operações de negócio.

O backend salva o texto junto da aprovação pendente. O frontend o renderiza como texto, sem interpretar HTML e sem mostrar o JSON. A decisão continua vinculada ao identificador da chamada e aos argumentos mantidos no servidor. O texto não é produzido pelo modelo nem enviado como instrução a ele. Sem formatador, ou se ele falhar/retornar texto vazio ou acima de 4.000 caracteres, a interface mantém a descrição e o JSON para revisão.

## Aprovação e recuperação

Cada conversa tem política `none` (aprovar tudo manualmente), `reads` (leituras automáticas) ou `all` (leituras e escritas automáticas). A decisão usa o `effect` declarado na ferramenta, não o texto produzido pelo modelo. Aprovar não substitui autorização. O executor revalida sessão e vínculo após esperas e antes de cada execução.

O frontend mostra descrição e argumentos de chamadas pendentes e envia apenas seus identificadores com `approve` ou `reject`. Argumentos aprovados ficam no servidor. A política não pode mudar enquanto há chamadas pendentes. Rejeições são devolvidas ao modelo como resultados de ferramenta, sem executar a operação.

Conversas, mensagens, rascunhos, política, grupos carregados, aprovações e resultados ficam em `assistant_conversations`, isolados por usuário e empresa. A tabela é criada de forma aditiva, sem reset dos dados existentes. O histórico local anterior não é importado automaticamente. `clear` e `reset` também removem as conversas.

Uma solicitação de mensagem usa `requestId` para evitar duplicação por reenvio. Chamadas são sequenciais; solicitações simultâneas à mesma conversa recebem 409. Uma mesma escrita com os mesmos argumentos não é executada duas vezes no mesmo turno após sucesso ou resultado incerto. O estado é salvo antes e depois da execução. Após interrupção, uma escrita iniciada não é repetida automaticamente; o resultado é marcado como incerto para conferência. Isso não promete execução exatamente uma vez entre o banco e o transporte HTTP.

O botão de retomar continua o processamento sem adicionar outra mensagem do usuário. Há limite de 20 etapas por execução, 8 chamadas por resposta do modelo, 2.000 caracteres por mensagem e 200 mensagens visíveis por conversa. As respostas são retornadas por turno, sem streaming de tokens. O bloqueio de concorrência é local a uma instância da API; múltiplos workers precisam de coordenação compartilhada antes de escalar esse serviço.

## API do chat

Todas as rotas exigem sessão e `X-Company-Id`. A propriedade da conversa também é validada em cada operação.

| Método | Caminho sob `/api/assistant` | Corpo |
| --- | --- | --- |
| GET | `/groups` | — |
| GET / POST | `/conversations` | — / `{}` |
| GET | `/conversations/:id` | — |
| POST | `/conversations/:id/update` | `{ policy?, draft? }` |
| POST | `/conversations/:id/messages` | `{ text, requestId }` |
| POST | `/conversations/:id/decisions` | `{ decisions: [{ id, decision: 'approve' ou 'reject' }] }` |
| POST | `/conversations/:id/retry` | `{}` |
| POST | `/conversations/:id/remove` | `{}` |

A resposta pública contém mensagens, estado, erro recuperável, chamadas pendentes e atividade. O histórico interno do modelo e as credenciais não são retornados ao navegador.

## Testes e avaliações

```bash
npm test
npm run build

# Avalia o modelo configurado em banco em memória, com dados sintéticos.
npm run eval:assistant

# Escolhe o destino do relatório.
npm run eval:assistant -- --report /tmp/assistant-eval.json
```

Os testes determinísticos usam inferências controladas e o pipeline HTTP real, incluindo isolamento, validação, autorização, aprovações, rejeições, repetição, concorrência, recuperação e conversão de schemas e tool calls do Bedrock. Não exigem chave nem chamadas pagas.

A avaliação de modelo cobre estoque baixo, análise gerencial, cadastro aprovado, entrada rejeitada e produto de outra empresa. Executa operações somente em SQLite em memória e gera um relatório JSON com resultados, mensagens e rastros das ferramentas. O modo normal faz chamadas reais ao provedor escolhido no `.env`.

Durante o desenvolvimento, um subagente atuou como inferente por uma ponte de arquivos, usando o mesmo chat e executor:

```bash
npm run eval:assistant -- --inferent /tmp/forma-inference-dev --report /tmp/assistant-eval.json
```

Cada `<id>.request.json` contém mensagens e ferramentas disponíveis. O inferente escreve `<id>.response.json` com `{ "content": "...", "tool_calls": [{ "id": "id-unico", "name": "ferramenta", "args": {} }] }`. Novas respostas finais usam `tool_calls: []`. A ponte espera até três minutos por resposta, nunca recebe credenciais e é ativada explicitamente pelo script de avaliação; ela é separada do provedor Codex CLI usado no chat. Não é um serviço de inferência de produção.

Documentação das APIs utilizadas: [tools](https://docs.langchain.com/oss/javascript/langchain/tools) e [ChatBedrockConverse](https://reference.langchain.com/javascript/langchain-aws/ChatBedrockConverse).

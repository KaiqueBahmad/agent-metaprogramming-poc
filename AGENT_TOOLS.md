# Ferramentas do agente — catálogo, autorização e execução

Proposta conceitual para operar o sistema pelo chat no frontend. Rotas da aplicação e funções independentes formam o catálogo de ferramentas, filtrado pelo acesso do usuário. Os exemplos abaixo ainda não representam uma implementação.

## 1. Declarar grupos e ferramentas

Há quatro anotações, que distinguem a organização do catálogo e o caminho de execução:

| Anotação | Onde se aplica | Responsabilidade |
| --- | --- | --- |
| `@AgentController` | Controller | Define um grupo baseado nas rotas do controller. |
| `@AgentRoute` | Rota | Expõe a rota como ferramenta, preservando o pipeline da requisição. |
| `@AgentGroup` | Classe independente | Define um grupo sem vínculo com HTTP. |
| `@AgentAction` | Método de um grupo independente | Expõe uma função com autorização própria obrigatória. |

### Rotas da aplicação

```ts
@AgentRoute({
  name: 'confirmar_pedido',
  description: 'Confirma um pedido e baixa os produtos do estoque.',
  effect: 'write',
})
@Post(':id/confirm')
```

- `name`: identifica a ferramenta.
- `description`: explica quando utilizá-la.
- `effect`: declara consulta (`read`) ou alteração (`write`) do estado de negócio, independentemente do método HTTP.

Parâmetros e retornos devem aproveitar os contratos existentes. Todas as rotas são candidatas ao catálogo; o tratamento das que não possuem anotações ainda precisa ser definido.

### Funções independentes

```ts
@AgentGroup({
  name: 'relatorios',
  description: 'Consultar indicadores e gerar relatórios.',
})
export class ReportTools {
  @AgentAction({
    name: 'gerar_relatorio',
    description: 'Gera um relatório de vendas do período.',
    effect: 'read',
    authorize: ({ user, tenant, input }) =>
      authorization.canGenerateReport(user, tenant, input.branchId),
  })
  async generate(input: ReportInput, context: AgentContext) {
    // Gera o relatório dentro do escopo autorizado.
  }
}
```

Uma `@AgentAction` não percorre o pipeline HTTP. O executor exige a função `authorize`, valida os argumentos e verifica a autorização antes de cada execução. Uma action sem autorização não pode ser registrada; uma negativa ou falha nessa verificação impede a chamada do método. O formato exato dos contratos de validação e autorização ainda precisa ser definido.

Identidade, tenant e origem são fornecidos pelo executor em um contexto confiável, separado dos argumentos controlados pelo modelo. A autorização pode considerar os argumentos validados, por exemplo para verificar o acesso à filial solicitada. Os campos `name`, `description` e `effect` têm o mesmo significado nos dois tipos de ferramenta.

## 2. Agrupar ferramentas para descoberta sob demanda

O catálogo organiza as ferramentas em grupos, apresentados como pastas. Inicialmente, o agente recebe apenas os nomes e resumos dos grupos disponíveis. Quando precisar de uma capacidade, consulta o grupo para obter as definições completas das ferramentas, incluindo descrições, parâmetros e retornos.

O grupo é um conceito do catálogo, separado do controller. A anotação no controller declara o agrupamento padrão de suas ferramentas:

```ts
@AgentController({
  name: 'pedidos',
  description:
    'Consultar pedidos, acompanhar seu andamento e confirmar vendas.',
})
@Controller('orders')
export class OrdersController {
  // Rotas anotadas com @AgentRoute pertencem ao grupo "pedidos".
}
```

`@AgentController` e `@AgentGroup` produzem grupos no mesmo catálogo, mas preservam os contratos de execução de suas ferramentas. A anotação no controller declara o agrupamento padrão de suas rotas. A eventual associação de ferramentas de controllers diferentes a um grupo de negócio ainda precisa ser definida. A proposta inicial usa grupos planos, sem hierarquia de pastas.

Os resumos orientam a descoberta; não substituem os contratos das ferramentas nem concedem autorização para executá-las.

## 3. Filtrar ferramentas por usuário

O desenvolvedor conecta o catálogo à autorização existente:

```ts
agent: {
  canUse: ({ user, tenant, action }) =>
    authorization.can(user, tenant, action),
}
```

Assinatura, módulos contratados, permissões do funcionário e demais restrições determinam quais ferramentas o agente recebe. O formato do hook é uma proposta e se aplica aos dois tipos de ferramenta.

Descoberta e autorização de uma chamada são verificações distintas. A filtragem do catálogo não substitui a autorização na execução: rotas passam pelos controles do pipeline da aplicação; actions independentes passam pela função `authorize` obrigatória. Uma ferramenta pode estar visível e ainda ter uma chamada negada em função dos argumentos ou do estado atual do sistema.

A filtragem se aplica tanto à listagem dos grupos quanto à consulta de suas ferramentas. Grupos sem ferramentas acessíveis não aparecem, e seus resumos devem refletir as capacidades disponíveis ao usuário, sem anunciar ferramentas às quais ele não tem acesso. A geração desses resumos filtrados ainda precisa ser definida.

## 4. Escolher a política de aprovação no chat

| Política da conversa | Leituras | Escritas |
| --- | --- | --- |
| Nenhuma aprovação automática | Pedir aprovação | Pedir aprovação |
| Aprovar leituras automaticamente | Executar | Pedir aprovação |
| Aprovar leituras e escritas automaticamente | Executar | Executar |

O executor cruza a política com o `effect` antes de cada chamada. A decisão não depende da interpretação do modelo. Aprovação automática não concede acesso adicional ao usuário.

Essa política se aplica igualmente a `@AgentRoute` e `@AgentAction`. Aprovação da conversa e autorização da aplicação são verificações separadas; ambas precisam permitir a execução.

## 5. Executar as ferramentas

### Rotas: pipeline da aplicação

O backend gera um JWT do usuário autenticado e o mantém no contexto privado do executor, fora das mensagens e dos argumentos acessíveis ao modelo.

```text
Usuário autenticado → resumos dos grupos filtrados → agente consulta ferramentas do grupo
→ agente propõe ferramenta e argumentos
→ executor verifica aprovação → injeta JWT e contexto de origem
→ entrada da aplicação → middlewares e guards → validação e interceptors
→ controller → resposta da aplicação → agente → chat
```

A chamada deve reentrar próximo à borda e percorrer o mesmo pipeline de uma requisição externa. Não é uma chamada direta ao controller ou ao serviço. HTTP em loopback é uma possibilidade; despacho interno só atende à proposta se preservar esse processamento.

A requisição recebe um marcador interno confiável, conceitualmente `origin: 'agent'`. O desenvolvedor pode consultá-lo nos middlewares para aplicar tratamentos ou exceções explícitas. O marcador é definido pelo executor, não pelo modelo nem por um header externo, e não desabilita controles automaticamente.

O agente recebe a resposta da operação, incluindo erros de autorização ou validação, sem receber o JWT. As regras existentes continuam sendo a autoridade sobre a execução.

### Actions independentes: executor e autorização própria

```text
Usuário autenticado → resumos dos grupos filtrados → agente consulta ferramentas do grupo
→ agente propõe ferramenta e argumentos → executor verifica aprovação
→ valida argumentos → verifica authorize com identidade e tenant confiáveis
→ executa método com argumentos validados e contexto → resultado → agente → chat
```

Esse caminho não reentra na aplicação por HTTP e não herda automaticamente middlewares, guards ou interceptors. O executor garante a validação dos argumentos e a chamada da autorização própria antes do método. Os controles adicionais necessários à operação devem ser implementados pela ferramenta ou pelos serviços que ela utiliza. Erros de validação e autorização retornam ao agente sem executar o método.

## 6. Decisões em aberto

- Extração dos contratos, identificação das permissões e tratamento de rotas sem anotação.
- Contratos de entrada, retorno, validação, contexto e autorização obrigatória das actions independentes.
- Associação de ferramentas a grupos entre controllers, tratamento de controllers sem anotação e geração dos resumos conforme o acesso do usuário.
- Mecanismo de despacho que preserve o pipeline em cada framework e adapter.
- Ciclo de vida do JWT e contrato do contexto de origem acessível aos middlewares.
- Composição de ferramentas, alcance das aprovações e inspeção do catálogo pelo desenvolvedor.

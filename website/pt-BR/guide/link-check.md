# Verificação de Links

O VMark verifica se os destinos de links e imagens locais no seu markdown realmente existem no disco. A verificação roda em conjunto com o [motor de lint de markdown](/pt-BR/guide/lint) ao usar `Alt + Mod + V` ou **Visualizar → Verificar Markdown**.

## O que é verificado

Para cada link e imagem locais no documento:

- `[texto](./outro.md)` — o arquivo `./outro.md` é resolvido e existe
- `![alt](./imagem.png)` — o arquivo de imagem existe
- `[texto](./outro.md#secao)` — o arquivo existe (a verificação da âncora é feita pela [regra `linkFragments`](/pt-BR/guide/lint#referencia-de-regras))

Quando um destino está ausente, uma entrada aparece no indicador de lint e na navegação por `F2` / `Shift + F2`. A forma como isso é desenhado depende do modo: no modo Fonte, o link recebe o sublinhado de diagnóstico vermelho do CodeMirror; no modo WYSIWYG, o bloco inteiro que contém o link é marcado com uma barra vermelha ao longo da borda esquerda e um leve tom de fundo — as marcas de lint no WYSIWYG são sempre no nível do bloco, nunca um sublinhado inline.

## O que é ignorado

- **Links somente de fragmento** (`#ancora`) — tratados pela regra `linkFragments`, que verifica em relação aos cabeçalhos do documento atual
- **URLs externas** — qualquer esquema de URI (`http:`, `https:`, `mailto:`, `obsidian:`, `vscode:`, …) e URLs relativas ao protocolo `//host/…`. Caminhos do Windows com letra de unidade (`C:\…`, `C:/…`) continuam sendo verificados como caminhos de arquivo
- **Documentos sem título** — sem um caminho de arquivo salvo, URLs relativas não podem ser resolvidas em relação a nenhum diretório
- **Caminhos de rede e caminhos relativos à unidade** — um caminho UNC (`\\server\share\…`) nunca é consultado, porque verificá-lo no Windows contataria esse host pela rede (e poderia oferecer a ele suas credenciais de login do Windows). Um `C:file.md` relativo à unidade (uma letra de unidade sem barra depois dela) também é ignorado: ele é relativo ao diretório de trabalho do aplicativo, não ao documento

## Como funciona a resolução

A Verificação de Links resolve um caminho relativo em relação ao diretório do arquivo de origem e trata um caminho absoluto como o arquivo que ele nomeia:

| Link em `/repo/docs/intro.md` | Resolve para |
|-------------------------------|--------------|
| `[a](./outro.md)` | `/repo/docs/outro.md` |
| `[a](../compartilhado.md)` | `/repo/compartilhado.md` |
| `[a](images/logo.png)` | `/repo/docs/images/logo.png` |
| `[a](/docs/intro.md)` | `/docs/intro.md` (um caminho absoluto nomeia esse arquivo; no Windows, ele cai na própria unidade do documento) |

Os fragmentos são removidos antes da consulta ao arquivo — `[a](./outro.md#secao)` verifica apenas `./outro.md`.

## Desempenho

- **Assíncrono** — roda em paralelo com as regras síncronas; os resultados se incorporam quando ficam prontos
- **Deduplicado** — cada caminho resolvido único é verificado uma vez por execução, mesmo que esteja vinculado várias vezes
- **Sem disparo a cada tecla** — `fs.exists` a cada tecla causaria estresse no sistema; só roda no acionamento explícito do lint
- **Tolerância a erros operacionais** — se `fs.exists` lançar (permissão negada, problema de escopo de capability), o resultado é `error` (ignorado), não `missing`. Melhor silencioso do que errado.

## Códigos de diagnóstico

| Código | Severidade | Acionador |
|--------|------------|-----------|
| **M001** | Erro | Arquivo de imagem não encontrado no caminho local resolvido |
| **M002** | Erro | Arquivo vinculado não encontrado no caminho local resolvido |

## Veja também

- [Lint de Markdown](/pt-BR/guide/lint) — referência completa de regras
- [Configurações → Markdown → Lint](/pt-BR/guide/settings#lint)

# Primeiros Passos com o VMark

O VMark é o espaço de trabalho de texto simples onde humanos e IA colaboram. Os dois lados leem e escrevem diretamente os mesmos artefatos — markdown, YAML, JSON, TOML, Mermaid, SVG, HTML, código — sem nenhuma camada de tradução no meio. Quando o arquivo é um artefato conhecido (um workflow do GitHub Actions, `Cargo.toml`, `package.json`, `pyproject.toml`), o VMark mostra a visualização *certa*, e não uma árvore JSON genérica.

O diferencial não é "abrir mais tipos de arquivo" — qualquer IDE faz isso. São as **prévias com reconhecimento de esquema**: a visualização estruturada de cada artefato, lado a lado com um painel de código-fonte ao vivo.

## Início Rápido

1. **Baixe e instale** o VMark na [página de download](/pt-BR/download)
2. **Inicie o aplicativo** e comece a escrever imediatamente
3. **Abra um arquivo** com **Arquivo → Abrir arquivo…** ou arraste e solte qualquer [formato suportado](/pt-BR/guide/formats) — `Cmd/Ctrl + O` é **Abertura rápida**, para ir a um arquivo recente, aberto ou do espaço de trabalho
4. **Abra uma pasta** com `Cmd/Ctrl + Shift + O` para o modo de área de trabalho

## Visão Geral da Interface

### Áreas Principais

- **Editor**: A área de escrita principal onde você cria seus documentos
- **Barra Lateral**: Navegação na árvore de arquivos (alternar com `Ctrl + Shift + 2`)
- **Esboço**: Visualização da estrutura do documento (alternar com `Ctrl + Shift + 1`)
- **Barra de Status**: Contagem de palavras, contagem de caracteres e status de salvamento automático (alternar com `F7`)
- **Terminal**: Painel de shell integrado (alternar com `` Ctrl + ` ``)

### Barra de Menu

- **Arquivo**: Novo, Abertura rápida, arquivos e espaços de trabalho recentes, histórico do documento, salvar, exportar, imprimir, fechar
- **Editar**: Desfazer/refazer, área de transferência, localizar (incluindo Encontrar em arquivos), seleção, operações de linha, finais de linha, Gênios
- **Formatar**: Estilos de texto, títulos, listas, citações, transformações de texto, formatação CJK, limpeza de texto, limpeza de imagens
- **Inserir**: Links, imagens, vídeo, áudio, tabelas, blocos de código, matemática, diagramas, notas de rodapé, blocos expansíveis, caixas de informações
- **Visualizar**: Modos de editor, painéis, painéis da barra lateral, modos de foco/máquina de escrever, barra de ferramentas, terminal, Status das janelas, Verificar Markdown, zoom
- **Janela** (macOS): Minimizar, Maximizar, Detalhamento de coerência, Trazer tudo para frente
- **Ajuda**: Ajuda do VMark, Atalhos de teclado, o comando de shell `vmark` (macOS), Relatar um problema

### Modos de Edição

O VMark suporta três modos de edição entre os quais você pode alternar:

| Modo | Descrição | Atalho |
|------|-----------|--------|
| Texto Rico | Edição WYSIWYG com formatação ao vivo | Padrão |
| Fonte | Markdown bruto com realce de sintaxe | `F6` |
| Dividido | Código-fonte à esquerda, prévia ao vivo somente leitura à direita | `Shift + F6` |

### Modos de Visualização

Aprimore seu foco de escrita com estes modos de visualização:

| Modo | Descrição | Atalho |
|------|-----------|--------|
| Foco | Destacar parágrafo atual | `F8` |
| Máquina de Escrever | Manter cursor centralizado | `F9` |
| Quebra de Linha | Alternar quebra de linha | `Alt + Z` |

## Formatação Básica

### Estilos de Texto

| Estilo | Sintaxe | Atalho |
|--------|---------|--------|
| **Negrito** | `**texto**` | `Cmd/Ctrl + B` |
| *Itálico* | `*texto*` | `Cmd/Ctrl + I` |
| ~~Tachado~~ | `~~texto~~` | `Cmd/Ctrl + Shift + X` |
| `Código` | `` `código` `` | `Cmd/Ctrl + Shift + `` ` `` |

### Elementos de Bloco

- **Títulos**: Use símbolos `#` ou `Cmd/Ctrl + 1-6`
- **Listas**: Inicie linhas com `-`, `*`, `1.` ou `- [ ]` para listas de tarefas
- **Citações**: Inicie com `>` ou use `Alt/Option + Cmd + Q`
- **Blocos de código**: Use três acentos graves com linguagem opcional
- **Tabelas**: Use **Inserir → Tabela** ou `Cmd/Ctrl + Shift + T`

## Trabalhando com Arquivos

### Criando e Abrindo

- **Novo arquivo**: `Cmd/Ctrl + N`
- **Abrir arquivo**: **Arquivo → Abrir arquivo…** (sem atalho padrão)
- **Abertura rápida**: `Cmd/Ctrl + O` — vá a um arquivo recente, aberto ou do espaço de trabalho
- **Abrir pasta**: `Cmd/Ctrl + Shift + O` (modo de área de trabalho)

### Salvando

- **Salvar**: `Cmd/Ctrl + S`
- **Salvar como**: `Cmd/Ctrl + Shift + S`
- **Salvamento automático**: Habilitado por padrão, configurável nas configurações

### Exportando

- **Exportar HTML**: **Arquivo → Exportar → HTML** — uma pasta com `index.html`, `standalone.html` e o VMark Reader interativo
- **Exportar PDF**: **Arquivo → Exportar → PDF** — configuração de página, fontes, números de página e um esboço na barra lateral; ou Imprimir (`Cmd/Ctrl + P`) e use a opção salvar como PDF do diálogo do sistema
- **Copiar como HTML**: `Cmd/Ctrl + Shift + C`

O HTML exportado inclui o VMark Reader com sumário, painel de configurações e mais. [Saiba mais →](/pt-BR/guide/export)

## Configurações

Abra as configurações com `Cmd/Ctrl + ,` para personalizar:

- **Aparência**: Tema, fontes, tamanho da fonte, altura de linha
- **Editor**: Intervalo de salvamento automático, comportamentos padrão
- **Arquivos e Imagens**: Gerenciamento de ativos, ferramentas de documento
- **Integrações**: Provedores de IA, servidor MCP
- **Idioma**: Regras de formatação CJK
- **Markdown**: Opções de exportação, preferências de formatação
- **Atalhos**: Personalizar atalhos de teclado
- **Terminal**: Tamanho da fonte e altura de linha do terminal

## Assistência de Escrita com IA

O VMark inclui Gênios de IA integrados — selecione texto e pressione `Mod + Y` para polir, expandir, traduzir ou transformar sua escrita com IA. Configure seu provedor preferido em **Configurações > Integrações**.

[Saiba mais sobre Gênios de IA →](/pt-BR/guide/ai-genies) | [Configurar provedores →](/pt-BR/guide/ai-providers)

## Dicas para Começar

1. **Navegue com o esboço**: Clique nos itens do esboço para pular entre seções
2. **Experimente o modo foco**: `F8` esmaece tudo, exceto o parágrafo atual
3. **Valide enquanto escreve**: `Alt + Mod + V` (**Visualizar → Verificar Markdown**) executa o motor de lint de markdown e a verificação de links quebrados
4. **Aprenda os atalhos**: a referência completa está no [guia de atalhos](/pt-BR/guide/shortcuts)

## Próximos Passos

- Conheça todos os [recursos](/pt-BR/guide/features)
- Domine os [atalhos de teclado](/pt-BR/guide/shortcuts)
- Explore as ferramentas de [formatação CJK](/pt-BR/guide/cjk-formatting)

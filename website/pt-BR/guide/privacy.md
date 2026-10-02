# Privacidade

O VMark respeita sua privacidade. Aqui está exatamente o que acontece — e o que não acontece.

## O que o VMark Envia

O VMark inclui um **verificador de atualizações automático** que periodicamente contata nosso servidor para verificar se uma nova versão está disponível. Esta é a **única** solicitação de rede que o VMark faz.

Cada verificação envia exatamente estes campos — nada mais:

| Dado | Exemplo | Finalidade |
|------|---------|-----------|
| Endereço IP | `203.0.113.42` | Inerente a qualquer solicitação HTTP — não podemos não recebê-lo |
| SO | `darwin`, `windows`, `linux` | Para servir o pacote de atualização correto |
| Arquitetura | `aarch64`, `x86_64` | Para servir o pacote de atualização correto |
| Versão do app | `0.5.10` | Para determinar se há uma atualização disponível |
| Hash da máquina | `a3f8c2...` (hex de 64 caracteres) | Contador anônimo de dispositivos — SHA-256 do hostname + SO + arch; não reversível |

A URL completa fica assim:

```text
GET https://log.vmark.app/update/latest.json?target=darwin&arch=aarch64&version=0.5.10
X-Machine-Id: a3f8c2b1d4e5f6078a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1
```

Você pode verificar isso por conta própria — o endpoint está em [`tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json) (pesquise por `"endpoints"`), e o hash está em [`lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs) (pesquise por `machine_id_hash`).

## O que o VMark NÃO Envia

- Seus documentos ou seus conteúdos
- Nomes ou caminhos de arquivo
- Padrões de uso ou análises de recursos
- Informações pessoais de qualquer tipo
- Relatórios de falhas
- Dados de teclas pressionadas ou edição
- Identificadores de hardware reversíveis ou impressões digitais
- O hash da máquina é um resumo SHA-256 unidirecional — não pode ser revertido para recuperar seu hostname ou qualquer outra entrada

## Como Usamos os Dados

Agregamos os logs de verificação de atualização para produzir as estatísticas ao vivo mostradas em nossa [página inicial](/pt-BR/):

| Métrica | Como é calculada |
|---------|-----------------|
| **Dispositivos únicos** | Contagem de hashes de máquina distintos por dia/semana/mês |
| **IPs únicos** | Contagem de endereços IP distintos por dia/semana/mês |
| **Pings** | Número total de solicitações de verificação de atualização |
| **Plataformas** | Contagem de pings por combinação de SO + arquitetura |
| **Versões** | Contagem de pings por versão do app |

Esses números são publicados abertamente em [`log.vmark.app/api/stats`](https://log.vmark.app/api/stats). Nada está oculto.

**Ressalvas importantes:**
- IPs únicos subestimam os usuários reais — várias pessoas atrás do mesmo roteador/VPN contam como uma
- Dispositivos únicos fornecem contagens mais precisas, mas uma mudança de hostname ou instalação nova do SO gera um novo hash
- Pings superestimam os usuários reais — uma pessoa pode verificar várias vezes por dia

## Retenção de Dados

- Os logs são armazenados no nosso servidor no formato de log de acesso padrão
- Os arquivos de log rotacionam em 1 MB e apenas os 3 arquivos mais recentes são mantidos
- Os logs não são compartilhados com ninguém
- Não há sistema de conta — o VMark não sabe quem você é
- O hash da máquina não está vinculado a nenhuma conta, e-mail ou endereço IP — é apenas um contador pseudônimo de dispositivos
- Não usamos cookies de rastreamento, impressão digital ou qualquer SDK de análise

## O Que o VMark Pode Ler no Disco

O acesso do VMark a arquivos é um escopo de permissões restrito, não o disco inteiro:

- **Escopo estático**: sua pasta pessoal (`$HOME/**`) mais os volumes montados — `/Volumes/**` no macOS, `/mnt/**` e `/media/**` no Linux. No Windows ele também cobre as unidades de `C:\` a `F:\`, então só `G:\` e as unidades seguintes, além de compartilhamentos de rede, precisam de uma permissão em tempo de execução. No macOS e no Linux, tudo o que está dentro de uma pasta oculta (cujo nome começa com `.`) fica fora do escopo estático.
- **Permissões em tempo de execução**: um arquivo que você abre explicitamente — pelo Finder ou pelo Explorador de Arquivos, pela linha de comando `vmark` ou por uma caixa de diálogo de arquivos — recebe uma permissão apenas para esse arquivo. Uma **pasta** só recebe permissão quando o VMark consegue saber que foi você quem a escolheu: você a selecionou na caixa de diálogo de pastas do VMark ou a abriu pelo Finder. O VMark mantém uma lista dessas pastas (`workspace-grants.json` na pasta de dados do app) e concede a permissão de novo a cada inicialização, para que sua sessão restaurada e **Abrir espaço de trabalho recente** continuem funcionando. Um espaço de trabalho recente que não está nessa lista, e que o escopo estático não cobre, abre a caixa de diálogo de pastas nessa pasta — escolha-a para confirmar. Quando um assistente de IA pede para abrir uma pasta assim, o VMark faz o mesmo depois que você aprova o pedido.
- **Imagens e mídia**: imagens, vídeos e áudios locais são exibidos pelo protocolo de recursos do VMark, que alcança os mesmos lugares — o escopo estático mais as permissões em tempo de execução acima. O visualizador de mídia adiciona uma permissão para o único arquivo que exibe, e somente para um arquivo com extensão de mídia; um pedido para qualquer outro caminho é recusado em vez de ampliar o escopo. Uma imagem fora desses lugares, como uma ao lado de um documento que você abriu sozinho de fora do escopo estático, não é exibida até que você abra a pasta dela como espaço de trabalho.

Nada disso é enviado a lugar algum; o escopo decide o que o próprio app pode ler.

## Transparência de Código Aberto

O VMark é totalmente de código aberto. Você pode verificar tudo descrito aqui:

- Configuração do endpoint de atualização: [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)
- Geração do hash da máquina: [`src-tauri/src/lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs) — pesquise por `machine_id_hash`
- Escopo do sistema de arquivos e de recursos: [`src-tauri/capabilities/default.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/capabilities/default.json), a entrada `assetProtocol` em [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json), [`src-tauri/src/fs_scope.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/fs_scope.rs) e [`src-tauri/src/workspace_grants/`](https://github.com/xiaolai/vmark/tree/main/src-tauri/src/workspace_grants)
- Agregação de estatísticas no lado do servidor: [`scripts/vmark-stats-json`](https://github.com/xiaolai/vmark/blob/main/scripts/vmark-stats-json) — o script exato que roda no nosso servidor para produzir as [estatísticas públicas](https://log.vmark.app/api/stats)
- Nenhuma outra chamada de rede existe na base de código — pesquise por `fetch`, `http` ou `reqwest` você mesmo

## Desabilitando Verificações de Atualização

Se preferir desabilitar as verificações automáticas de atualização completamente, você pode bloquear `log.vmark.app` no nível da rede (firewall, `/etc/hosts` ou DNS). O VMark continuará funcionando normalmente sem isso — você simplesmente não receberá notificações de atualização.

## Relatar um problema de segurança

Se você encontrar uma vulnerabilidade no VMark, por exemplo na ponte MCP, no navegador incorporado, no atualizador ou no tratamento de arquivos, relate-a em particular pelo [relato privado de vulnerabilidades do GitHub](https://github.com/xiaolai/vmark/security/advisories/new) em vez de abrir uma issue pública. A [política de segurança](https://github.com/xiaolai/vmark/blob/main/SECURITY.md) informa o que está no escopo e o que esperar.

# 🤖 Bot Divulgação

Bot de WhatsApp para divulgação automática em grupos, com sistema de licenças, venda automática do arquivo e planos de divulgação como serviço.

---

## 📋 Índice

1. [O que é](#o-que-é)
2. [Funcionalidades](#funcionalidades)
3. [Instalação](#instalação)
4. [Configuração](#configuração)
5. [Comandos](#comandos)
6. [Venda do Arquivo (Automática)](#venda-do-arquivo-automática)
7. [Planos de Divulgação](#planos-de-divulgação)
8. [Pagamentos Automáticos — Mercado Pago](#pagamentos-automáticos--mercado-pago)
9. [IA no PV](#ia-no-pv)
10. [Distribuição Obfuscada](#distribuição-obfuscada)

---

## O que é

Bot de divulgação para WhatsApp que permite:

- Enviar mensagens/media para centenas de grupos automaticamente
- Agendar envios por hora ou intervalo de tempo
- **Vender o arquivo do bot** directamente no PV, com entrega automática após pagamento
- **Vender tempo de divulgação** como serviço — clientes pagam para ter o seu conteúdo enviado aos teus grupos de X em X minutos

---

## Funcionalidades

| Funcionalidade | Descrição |
|---|---|
| 📢 Divulgação | Envia texto, imagem, vídeo, áudio ou documento para todos os grupos |
| ⏰ Agendamento | Agenda envios por hora (`!agendar 08:00`) ou por intervalo (`!intervalo 30`) |
| 🔗 Auto-entrar | Entra automaticamente em grupos via link detectado nas mensagens |
| 🚪 Auto-sair | Sai de grupos onde só admins podem falar |
| 🤖 IA no PV | Responde com Google Gemini a mensagens no PV de não-donos |
| 🛒 Venda automática | Comprador paga via Pix → bot gera licença e envia bot.json automaticamente |
| 📢 Divulg. como serviço | Clientes pagam para ter o conteúdo deles enviado aos teus grupos |
| 🔔 Notificações PV | Recebe aviso quando alguém escreve ao bot no PV |
| 🔒 Licenças | Sistema de licenças com validação offline + revogação online |

---

## Instalação

### Requisitos

- Node.js 22+
- Servidor/VPS com acesso à internet (recomendado: [bronxys.com](https://bronxys.com) ou [contabo.com](https://contabo.com))

### Passos

```bash
# 1. Clonar o repositório (versão pública/obfuscada)
git clone https://github.com/ReiUrsoPolar/bot-divulgacao-dist
cd bot-divulgacao-dist

# 2. Instalar dependências
npm install

# 3. Copiar e preencher o ficheiro de configuração
cp config/bot.exemplo.json config/bot.json
nano config/bot.json

# 4. Iniciar
node index.js

# 5. Escanear o QR code com o WhatsApp
```

---

## Configuração

### `config/bot.json` — Configuração principal

```json
{
  "numero":     "351912345678",
  "licencaKey": "POLAR-xxxxxxxxxxxxxxxxxxxxxxxxxx",
  "geminiKey":  "AIzaSy...",
  "dono":       "351912345678",
  "nomeBot":    "Bot Divulgação",
  "prefix":     "!"
}
```

| Campo | Descrição | Obrigatório |
|---|---|---|
| `numero` | Número do WhatsApp do bot (só dígitos, sem +) | ✅ |
| `licencaKey` | Chave de licença recebida após a compra (começa com `POLAR-`) | ✅ |
| `geminiKey` | API Key do Google Gemini para IA no PV (ver [aistudio.google.com](https://aistudio.google.com)) | Opcional |
| `dono` | Número do WhatsApp do dono — tem acesso a todos os comandos | ✅ |
| `nomeBot` | Nome do bot (aparece nos logs) | Opcional |
| `prefix` | Prefixo dos comandos (padrão: `!`) | Opcional |

---

### `config/loja.json` — Planos e pagamento

```json
{
  "planos": {
    "30dias":  { "nome": "Bot 30 dias",  "preco": 25,  "dias": 30  },
    "90dias":  { "nome": "Bot 90 dias",  "preco": 60,  "dias": 90  },
    "180dias": { "nome": "Bot 180 dias", "preco": 100, "dias": 180 }
  },
  "planos_divulgacao": {
    "basico": { "nome": "Divulgação Básico", "preco": 50,  "dias": 30, "intervalo": 60 },
    "pro":    { "nome": "Divulgação Pro",    "preco": 90,  "dias": 30, "intervalo": 30 },
    "ultra":  { "nome": "Divulgação Ultra",  "preco": 150, "dias": 30, "intervalo": 15 }
  },
  "pixKey": "tua-chave-pix@banco.com"
}
```

| Campo | Descrição |
|---|---|
| `planos` | Planos de venda do arquivo do bot (comando `!comprar`) |
| `planos.*.preco` | Preço em R$ |
| `planos.*.dias` | Duração da licença em dias |
| `planos_divulgacao` | Planos de divulgação que vendes aos teus clientes (comando `!plano`) |
| `planos_divulgacao.*.intervalo` | De quantos em quantos minutos o bot vai divulgar o conteúdo do cliente |
| `pixKey` | Chave Pix para receber pagamentos manuais (quando MP não está configurado) |

---

## Comandos

### 📢 Divulgação

| Comando | Descrição |
|---|---|
| `!divulgar [texto]` | Envia mensagem/media imediatamente para todos os grupos activos |
| `!agendar 08:00 [texto]` | Agenda envio diário a uma hora específica |
| `!intervalo 30 [texto]` | Envia de 30 em 30 minutos, indefinidamente |
| `!pausar` | Pausa todos os agendamentos |
| `!retomar` | Retoma todos os agendamentos |
| `!cancelar [id]` | Cancela um agendamento específico ou todos |
| `!historico` | Mostra os últimos envios com grupos atingidos e erros |

> Para media: faz **reply** ao ficheiro/imagem antes de usar o comando.

---

### 👥 Grupos

| Comando | Descrição |
|---|---|
| `!grupos` | Sincroniza e lista todos os grupos onde o bot está |
| `!grupos lista` | Lista apenas os grupos seleccionados para divulgação |
| `!grupos add <id>` | Adiciona um grupo à lista de divulgação |
| `!grupos remove <id>` | Remove um grupo da lista |
| `!grupos todos` | Toggle: divulgar para TODOS os grupos (ignora a lista) |

---

### 🛒 Venda de Divulgação (Serviço)

| Comando | Descrição |
|---|---|
| `!plano` | Lista os planos de divulgação configurados |
| `!plano add basico 50 30 60` | Cria plano: key=basico, R$50, 30 dias, envio a cada 60 min |
| `!plano remove basico` | Remove o plano |
| `!mptoken APP_USR-xxx` | Configura o token do Mercado Pago (pagamentos automáticos) |
| `!clientes_div` | Lista clientes activos com dias restantes |
| `!expulsar <numero>` | Remove cliente e cancela o agendamento de divulgação |

---

### ⚙️ Configurações

| Comando | Descrição |
|---|---|
| `!config` | Mostra todas as configurações actuais |
| `!autoentrar on/off` | Entrar automaticamente em grupos via link (padrão: ON) |
| `!autosair on/off` | Sair de grupos onde só admins podem falar (padrão: ON) |
| `!ia on/off` | Activar/desactivar respostas com IA no PV |
| `!pv on/off` | O bot responde a mensagens no PV de não-donos (padrão: ON) |
| `!pv notificar on/off` | Receber aviso aqui quando alguém escrever ao bot no PV |
| `!limite <numero>` | Máximo de grupos que o bot pode entrar (padrão: 200) |
| `!status` | Estado completo: licença, grupos, agendamentos, configurações |
| `!renovar` | Mostrar como renovar a licença |

---

### 🔑 Comandos do Criador (exclusivos)

| Comando | Descrição |
|---|---|
| `!addkey <numero> <plano>` | Gera licença e envia bot.json configurado para o comprador |
| `!addkey @pessoa 30dias` | Mesmo que acima, mas menciona a pessoa em vez de escrever o número |
| `!revogar <keyId>` | Revoga uma licença imediatamente |
| `!clientes` | Lista todos os compradores do arquivo com data de expiração |

---

## Venda do Arquivo (Automática)

### Fluxo pelo lado do comprador

```
Comprador → !comprar 30dias
         → Bot mostra termos + preço
         → Comprador responde "aceito"
         → Bot gera QR code Pix (ou mostra chave Pix manual)
         → Comprador paga
         → Bot detecta pagamento ✅
         → Bot gera licença automaticamente
         → Bot envia bot.json já configurado para o comprador
         → Comprador substitui o ficheiro e arranca o bot
```

### Fluxo pelo lado do criador (manual, sem MP)

```
Criador verifica pagamento no banco
→ !addkey 351912345678 30dias
→ Bot gera a licença
→ Bot envia mensagem de boas-vindas + bot.json para o comprador automaticamente
```

---

## Planos de Divulgação

O dono pode **vender divulgação como serviço** — clientes pagam para ter o conteúdo deles enviado para os teus grupos de X em X minutos.

### Configurar planos

```
!plano add basico 50 30 60
```
→ Cria o plano `basico`: R$50, 30 dias, envio a cada 60 minutos

```
!plano add pro 90 30 30
```
→ Cria o plano `pro`: R$90, 30 dias, envio a cada 30 minutos

### Fluxo para o cliente

```
Cliente → !plano basico (no PV do bot)
        → Bot mostra termos do plano
        → Cliente responde "aceito"
        → Bot gera QR code Pix via Mercado Pago
        → Cliente paga
        → Bot confirma e pede o conteúdo a divulgar
        → Cliente envia mensagem/imagem/vídeo
        → Bot agenda o envio automático para todos os grupos
        → Envio a cada 60 min durante 30 dias
        → No final do período, agendamento é cancelado automaticamente
```

### Ver e gerir clientes

```
!clientes_div
→ Lista todos os clientes activos com dias restantes

!expulsar 351912345678
→ Remove o cliente e cancela o agendamento imediatamente
```

---

## Pagamentos Automáticos — Mercado Pago

O sistema suporta dois tokens de Mercado Pago independentes:

### 1. Token do Dono (para vender divulgação)

Configura-se directamente no bot via comando:

```
!mptoken APP_USR-1234567890abcdef-...
```

- O token é guardado de forma segura na base de dados local
- Quando configurado, o bot gera QR codes Pix automaticamente
- Sonda o pagamento a cada 15 segundos por até 30 minutos
- Quando aprovado, activa o plano e pede o conteúdo ao cliente

**Onde obter:**
1. Acede a [mercadopago.com.br](https://mercadopago.com.br)
2. Menu → Credenciais
3. Copia o **Access Token de Produção** (começa com `APP_USR-`)

> ⚠️ Nunca partilhes o Access Token. Trata-o como uma senha.

---

### 2. Token do Criador (para vender o arquivo automaticamente)

Apenas o criador do bot preenche este campo, antes de distribuir:

1. Abre `src/licenca.js`
2. Localiza a linha `const _MPT = ''`
3. Preenche com o teu token dividido em partes (para ofuscação):

```js
const _MPT = ['APP_USR-', '12345678', '90abcdef', '-...'].join('')
```

Quando configurado, o fluxo `!comprar` gera o Pix automaticamente e entrega o arquivo sem precisares de fazer nada manualmente.

**Se deixares vazio:** O bot funciona no modo manual — mostra a chave Pix do `loja.json` e diz ao comprador para entrar em contacto.

---

### Fallback Manual (sem Mercado Pago)

Se nenhum token estiver configurado, o bot mostra:

```
💰 Valor: R$ 50,00
📋 Chave Pix: tua-chave@banco.com

Após o pagamento, entra em contacto:
👉 wa.me/351913579908
```

O dono confirma o pagamento no banco e usa `!addkey` ou `!mptoken` para activar.

---

## IA no PV

Quando `!ia on` está activo, o bot responde com inteligência artificial a qualquer pessoa que escreva no PV (que não seja dono/criador).

### Configurar

1. Obtém uma API Key gratuita em [aistudio.google.com](https://aistudio.google.com)
2. Coloca-a em `config/bot.json` no campo `geminiKey`
3. Activa com `!ia on`

### Comportamento

- Não-donos que escrevem no PV recebem uma resposta inteligente
- Os comandos `!comprar` e `!plano` continuam a funcionar mesmo com IA activa
- Se `!pv off`, a IA também é desactivada (bot não responde de todo)
- Com `!pv notificar on`, o dono recebe um aviso de cada mensagem recebida no PV

---

## Distribuição Obfuscada

O código-fonte privado é automaticamente ofuscado e publicado no repositório público [`bot-divulgacao-dist`](https://github.com/ReiUrsoPolar/bot-divulgacao-dist) via GitHub Actions.

### O que fica ofuscado

- Número do criador
- Token da API de licenças
- Token do Mercado Pago do criador (se preenchido)
- URL da API de licenças
- Toda a lógica do código-fonte

### O que o dono pode ver/editar

- `config/bot.json` — número, licença, geminiKey, dono, nomeBot, prefix
- `config/loja.json` — preços, planos, chave Pix
- `config/msgs.json` — mensagens personalizadas do bot

Nenhum dado do criador aparece nos ficheiros editáveis pelo dono.

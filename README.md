# 🤖 Bot Divulgação

Bot de WhatsApp para divulgação automática em grupos, com venda de planos de divulgação como serviço e pagamentos automáticos via Pix.

---

## 📋 Índice

1. [O que é](#o-que-é)
2. [Funcionalidades](#funcionalidades)
3. [Instalação](#instalação)
4. [Configuração](#configuração)
5. [Comandos](#comandos)
6. [Planos de Divulgação — Vender como Serviço](#planos-de-divulgação--vender-como-serviço)
7. [Pagamentos Automáticos — Mercado Pago](#pagamentos-automáticos--mercado-pago)
8. [IA no PV](#ia-no-pv)

---

## O que é

Bot de divulgação para WhatsApp que permite:

- Enviar mensagens/media para centenas de grupos automaticamente
- Agendar envios por hora ou intervalo de tempo
- **Vender tempo de divulgação como serviço** — clientes pagam para ter o conteúdo deles enviado aos teus grupos de X em X minutos, com pagamento automático via Pix

---

## Funcionalidades

| Funcionalidade | Descrição |
|---|---|
| 📢 Divulgação | Envia texto, imagem, vídeo, áudio ou documento para todos os grupos |
| ⏰ Agendamento | Agenda envios por hora (`!agendar 08:00`) ou por intervalo (`!intervalo 30`) |
| 🔗 Auto-entrar | Entra automaticamente em grupos via link detectado nas mensagens |
| 🚪 Auto-sair | Sai de grupos onde só admins podem falar |
| 🤖 IA no PV | Responde com Google Gemini a mensagens no PV de não-donos |
| 📢 Divulg. como serviço | Clientes pagam para ter o conteúdo deles enviado aos teus grupos |
| 💳 Pix automático | Integração com Mercado Pago — cliente paga e o plano activa sozinho |
| 🔔 Notificações PV | Recebe aviso quando alguém escreve ao bot no PV |

---

## Instalação

### Requisitos

- Node.js 22+
- Servidor/VPS com acesso à internet (recomendado: [bronxys.com](https://bronxys.com) ou [contabo.com](https://contabo.com))

### Passos

```bash
# 1. Descarregar o bot
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
| `planos_divulgacao` | Planos de divulgação que vendes aos teus clientes (`!plano`) |
| `planos_divulgacao.*.preco` | Preço em R$ |
| `planos_divulgacao.*.dias` | Duração do plano em dias |
| `planos_divulgacao.*.intervalo` | De quantos em quantos minutos o bot envia o conteúdo do cliente |
| `pixKey` | Chave Pix para receber pagamentos manuais (quando MP não está configurado) |

> Podes também gerir os planos directamente via comandos — ver secção [Planos de Divulgação](#planos-de-divulgação--vender-como-serviço).

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

> Para media: faz **reply** à imagem/vídeo/documento antes de usar o comando.

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

### 🛒 Planos de Divulgação

| Comando | Descrição |
|---|---|
| `!plano` | Lista os planos de divulgação configurados e o estado do Mercado Pago |
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

## Planos de Divulgação — Vender como Serviço

O dono pode **vender divulgação como serviço** — clientes pagam para ter o conteúdo deles enviado para os teus grupos de X em X minutos.

### 1. Criar os planos

```
!plano add basico 50 30 60
```
→ Cria o plano `basico`: R$50, 30 dias, envio a cada **60 minutos**

```
!plano add pro 90 30 30
```
→ Cria o plano `pro`: R$90, 30 dias, envio a cada **30 minutos**

```
!plano add ultra 150 30 15
```
→ Cria o plano `ultra`: R$150, 30 dias, envio a cada **15 minutos**

> Podes criar quantos planos quiseres com preços, durações e intervalos diferentes.

### 2. Configurar pagamento automático (opcional, mas recomendado)

```
!mptoken APP_USR-1234567890abcdef-...
```

Com o Mercado Pago configurado, o fluxo é 100% automático. Sem ele, o cliente paga e tu activás manualmente.

### 3. Fluxo para o cliente

```
Cliente → !plano basico  (no PV do bot)
        → Bot mostra termos do plano
        → Cliente responde "aceito"
        → Bot gera QR code Pix automaticamente
        → Cliente paga no banco
        → Bot detecta o pagamento e pede o conteúdo
        → Cliente envia mensagem, imagem ou vídeo
        → Bot agenda envio automático a cada 60 min por 30 dias
        → No fim do período, cancela automaticamente
```

### 4. Gerir clientes activos

```
!clientes_div
```
→ Mostra todos os clientes activos com o plano, intervalo e dias restantes

```
!expulsar 351912345678
```
→ Remove o cliente e cancela imediatamente o agendamento

---

## Pagamentos Automáticos — Mercado Pago

### Configurar

1. Acede a [mercadopago.com.br](https://mercadopago.com.br)
2. Inicia sessão na tua conta
3. Menu lateral → **Credenciais**
4. Selecciona **Produção** (nunca Teste)
5. Copia o **Access Token** (começa com `APP_USR-`)
6. No bot: `!mptoken APP_USR-...`

### Como funciona

- Quando um cliente aceita os termos, o bot gera um **QR code Pix** e envia na conversa
- O cliente copia o código e paga no banco
- O bot sonda o pagamento a cada **15 segundos** por até **30 minutos**
- Quando aprovado, activa o plano automaticamente e pede o conteúdo ao cliente
- Se o prazo de 30 minutos expirar sem pagamento, o bot avisa o cliente para tentar novamente

### Fallback sem Mercado Pago

Se não configurares o token MP, o bot mostra a chave Pix do `loja.json` e diz ao cliente para entrar em contacto. Tens de activar o plano manualmente após verificares o pagamento.

> ⚠️ **Segurança:** Nunca partilhes o Access Token. Trata-o como uma senha. Se for comprometido, regenera-o nas Credenciais do Mercado Pago.

---

## IA no PV

Quando `!ia on` está activo, o bot responde com inteligência artificial a qualquer pessoa que escreva no PV (que não seja dono).

### Configurar

1. Obtém uma API Key gratuita em [aistudio.google.com](https://aistudio.google.com) → **Get API Key**
2. Coloca-a em `config/bot.json` no campo `geminiKey`
3. Activa com `!ia on`

### Comportamento

- Não-donos que escrevem no PV recebem uma resposta gerada com IA
- Os comandos `!plano` continuam a funcionar mesmo com IA activa
- Com `!pv off`, a IA também é desactivada (bot não responde de todo)
- Com `!pv notificar on`, o dono recebe um aviso de cada mensagem recebida no PV

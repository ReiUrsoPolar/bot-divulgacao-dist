# Instalação em hosts

Seleciona Node 22.13 ou superior (Node 24 recomendado) e confirma que o host tem Git e acesso ao npm e ao GitHub. O Baileys 6 depende de libsignal distribuído pelo GitHub; instalar só Node não substitui Git.

1. Faz uma cópia da configuração, sessão e base de dados antes de atualizar. Não as apagues para resolver erros de módulos.
2. Na pasta do bot, executa `npm install --omit=dev`.
3. Executa `npm run check`. Este diagnóstico não liga o WhatsApp, não atualiza ficheiros e só abre SQLite em memória.
4. Usa `npm start` para arrancar.

Se o host não permitir compilar better-sqlite3, o bot pode usar SQLite embutido no Node. O diagnóstico confirma se esse motor funciona. Não é necessário instalar ferramentas de desenvolvimento do bot nos hosts dos clientes.

Se falhar, envia ao suporte o nome do host, a versão do Node e a primeira mensagem de erro do npm. Não envies tokens, ficheiros da sessão ou passwords.

Desde a versão 1.0.1 o bot usa Baileys 6.7.22, que corrige a vulnerabilidade GHSA-qvv5-jq5g-4cgg. Instalações antigas só recebem a correção depois de atualizar o pacote e as dependências.

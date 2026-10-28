/** Catálogo pt-BR. As chaves devem ser idênticas às de en.ts (testado). */

export const ptBR: Record<string, string> = {
  "plugin.epidbot.panel.title": "EpidBot",

  "plugin.epidbot.menu.open": "Abrir painel de conversa",
  "plugin.epidbot.menu.newSession": "Nova sessão",
  "plugin.epidbot.menu.export": "Exportar como Markdown",
  "plugin.epidbot.menu.settings": "Configurações…",
  "plugin.epidbot.menu.ask": "Perguntar sobre o mapa",
  "plugin.epidbot.menu.askExtent": "Perguntar sobre esta extensão",
  "plugin.epidbot.menu.askSelection": "Perguntar sobre esta seleção",

  "plugin.epidbot.prompt.extent":
    "Quais dados de saúde pública são relevantes para a extensão atual do mapa?",
  "plugin.epidbot.prompt.selection":
    "Resuma as características de saúde pública dos elementos selecionados.",
  "plugin.epidbot.prompt.noSelection":
    "Nenhum elemento selecionado. Selecione elementos no mapa primeiro.",
  "plugin.epidbot.prompt.noExtent": "A extensão do mapa não está disponível aqui.",

  "plugin.epidbot.context.attach": "Anexar contexto do mapa",
  "plugin.epidbot.context.help":
    "Envia as camadas visíveis, a extensão atual, o CRS e a seleção junto com a sua pergunta.",
  "plugin.epidbot.context.preview": "Pré-visualizar contexto",
  "plugin.epidbot.context.bytes": "{{bytes}} bytes",
  "plugin.epidbot.context.empty":
    "Nada a relatar — sem camadas, extensão ou seleção disponíveis.",
  "plugin.epidbot.context.unavailable": "O contexto do mapa não está disponível aqui.",

  "plugin.epidbot.composer.placeholder": "Pergunte sobre dados epidemiológicos…",
  "plugin.epidbot.composer.send": "Enviar",
  "plugin.epidbot.composer.stop": "Parar",

  "plugin.epidbot.status.submitting": "Enviando pergunta…",
  "plugin.epidbot.status.thinking": "EpidBot está pensando… (job {{job}})",
  "plugin.epidbot.status.loadingPlots": "Carregando gráficos…",

  "plugin.epidbot.welcome.title": "EpidBot — assistente de dados de saúde pública",
  "plugin.epidbot.welcome.body":
    "Pergunte sobre dados de saúde pública brasileira (DATASUS/SINAN, OPAS, OMS e mais 40 fontes). As respostas podem incluir gráficos e dados que você pode adicionar ao mapa.",
  "plugin.epidbot.welcome.noKey": "Adicione sua chave de API do EpidBot nas Configurações para começar.",
  "plugin.epidbot.welcome.getApiKey": "Obter uma chave de API (aplicativo web do EpidBot)",

  "plugin.epidbot.session.label": "Sessão",
  "plugin.epidbot.session.none": "Nova sessão",
  "plugin.epidbot.session.new": "Nova sessão",
  "plugin.epidbot.session.export": "Exportar como Markdown",
  "plugin.epidbot.session.exportEmpty": "Nada para exportar ainda.",
  "plugin.epidbot.session.loadFailed": "Não foi possível carregar o histórico desta sessão.",

  "plugin.epidbot.settings.title": "Configurações",
  "plugin.epidbot.settings.apiKey": "Chave de API",
  "plugin.epidbot.settings.apiKeyHelp":
    "Chave pessoal criada no aplicativo web do EpidBot (Configurações → API Keys). Guardada no {{storage}}.",
  "plugin.epidbot.settings.storage.keychain": "cofre de credenciais do sistema",
  "plugin.epidbot.settings.storage.browser": "armazenamento do navegador",
  "plugin.epidbot.settings.storage.none": "apenas na sessão atual",
  "plugin.epidbot.settings.serverUrl": "URL do servidor",
  "plugin.epidbot.settings.locale": "Idioma das respostas",
  "plugin.epidbot.settings.pollInterval": "Intervalo de consulta (segundos)",
  "plugin.epidbot.settings.test": "Testar chave",
  "plugin.epidbot.settings.testing": "Testando…",
  "plugin.epidbot.settings.testOk": "Chave OK — conectado como {{user}}",
  "plugin.epidbot.settings.testFail": "Não foi possível validar a chave: {{reason}}",
  "plugin.epidbot.settings.save": "Salvar",
  "plugin.epidbot.settings.saved": "Configurações salvas.",

  "plugin.epidbot.error.auth": "Chave de API inválida ou revogada. Verifique a chave nas Configurações.",
  "plugin.epidbot.error.plan":
    "Seu plano do EpidBot não inclui chaves de API — é preciso Max ou Team.",
  "plugin.epidbot.error.quota": "Cota da API excedida. Aguarde um momento e tente novamente.",
  "plugin.epidbot.error.network":
    "Não foi possível acessar o EpidBot. Verifique a URL do servidor e sua conexão.",
  "plugin.epidbot.error.timeout": "O EpidBot não respondeu a tempo. Tente novamente.",
  "plugin.epidbot.error.cancelled": "Pergunta cancelada.",
  "plugin.epidbot.error.server": "O EpidBot retornou um erro (HTTP {{status}}).",
  "plugin.epidbot.error.job": "O job falhou no servidor: {{reason}}",
  "plugin.epidbot.error.unknown": "Erro inesperado: {{reason}}",
  "plugin.epidbot.error.noKey": "Nenhuma chave de API configurada. Abra as Configurações para adicionar uma.",

  "plugin.epidbot.plot.download": "Salvar gráfico",
  "plugin.epidbot.plot.loadFailed": "Não foi possível carregar o gráfico.",
  "plugin.epidbot.code.copy": "Copiar",
  "plugin.epidbot.code.copied": "Copiado",
};

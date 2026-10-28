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
  "plugin.epidbot.menu.editLayer": "Deixar o EpidBot editar esta camada…",

  "plugin.epidbot.prompt.extent":
    "Quais dados de saúde pública são relevantes para a extensão atual do mapa?",
  "plugin.epidbot.prompt.selection":
    "Resuma as características de saúde pública dos elementos selecionados.",
  "plugin.epidbot.prompt.noSelection":
    "Nenhum elemento selecionado. Selecione elementos no mapa primeiro.",
  "plugin.epidbot.prompt.noExtent": "A extensão do mapa não está disponível aqui.",
  "plugin.epidbot.prompt.editLayer":
    "Adicione um novo campo a esta camada com os dados que você puder obter (ex.: contagens populacionais). Cruze os dados pelo campo '{{key}}'. Use os identificadores anexados acima como chaves de junção e devolva o resultado em um bloco epidbot-edit.",
  "plugin.epidbot.prompt.editLayerNoKey":
    "Adicione um novo campo a esta camada com os dados que você puder obter (ex.: contagens populacionais). Use os identificadores anexados acima como chaves de junção e devolva o resultado em um bloco epidbot-edit.",

  "plugin.epidbot.quick.placeholder": "Perguntas rápidas…",
  "plugin.epidbot.quick.dengue": "Resuma a última temporada de dengue no Brasil",
  "plugin.epidbot.quick.malaria": "Quais conjuntos de dados cobrem malária na Amazônia?",
  "plugin.epidbot.quick.layers": "Explique as camadas ativas do meu mapa",
  "plugin.epidbot.quick.sinan": "Como baixo dados do SINAN para o meu estado?",
  "plugin.epidbot.quick.population": "Qual a população em risco na extensão do meu mapa?",

  "plugin.epidbot.attach.label": "Anexar dados de camada à mensagem",
  "plugin.epidbot.attach.selected": "Anexar elementos selecionados",
  "plugin.epidbot.attach.extent": "Anexar elementos na vista",
  "plugin.epidbot.attach.all": "Anexar a camada inteira…",
  "plugin.epidbot.attach.identifiers": "Anexar apenas identificadores (para edições)",
  "plugin.epidbot.attach.noLayers": "Sem camadas no mapa.",
  "plugin.epidbot.attach.pickLayer": "Anexar camada — escolha uma camada:",
  "plugin.epidbot.attach.ok": "OK",
  "plugin.epidbot.attach.cancel": "Cancelar",
  "plugin.epidbot.attach.preparing": "Preparando anexo…",
  "plugin.epidbot.attach.unavailable":
    "Anexos de camada não estão disponíveis neste renderizador de mapa.",
  "plugin.epidbot.attach.remove": "Remover anexo",
  "plugin.epidbot.attach.chipMeta": "{{count}} elementos, {{kb}} KB",
  "plugin.epidbot.attach.tooLargeTitle": "Anexo muito grande",
  "plugin.epidbot.attach.tooLarge":
    "'{{label}}' tem {{size}} KB, acima do orçamento inline de {{budget}} KB.",
  "plugin.epidbot.attach.limitExtent": "Limitar à vista atual",
  "plugin.epidbot.attach.narrowSelection": "Restringir aos elementos selecionados",
  "plugin.epidbot.attach.reducePrecision": "Reduzir a precisão das coordenadas",
  "plugin.epidbot.attach.uploadArtifact": "Enviar como artefato (servidor)",
  "plugin.epidbot.attach.statsOnly": "Enviar apenas estatísticas",
  "plugin.epidbot.attach.dropped":
    "Anexo descartado — o contexto do mapa (nomes de campos, valores de exemplo, contagens) será enviado em vez disso.",
  "plugin.epidbot.attach.failedTitle": "Falha no anexo",
  "plugin.epidbot.attach.uploading": "Enviando artefato…",
  "plugin.epidbot.attach.uploadFailed": "Falha no envio do artefato: {{reason}}",
  "plugin.epidbot.attach.noArtifactId": "O servidor não devolveu um id de artefato.",

  "plugin.epidbot.edit.title": "O EpidBot quer editar uma camada",
  "plugin.epidbot.edit.intro":
    "O EpidBot propõe a seguinte alteração nos dados da sua camada. Revise com cuidado — os atributos serão modificados.",
  "plugin.epidbot.edit.review": "Revisar edição de campo: {{name}} ({{type}})",
  "plugin.epidbot.edit.reviewInvalid": "Revisar edição de campo (operação inválida)",
  "plugin.epidbot.edit.invalidOp": "Esta operação de edição é inválida:",
  "plugin.epidbot.edit.targetLabel": "Camada alvo",
  "plugin.epidbot.edit.opAdd": "Adicionar",
  "plugin.epidbot.edit.opUpdate": "Atualizar",
  "plugin.epidbot.edit.summary":
    "{{op}} campo {{name}} ({{type}}) — junção por {{key}}{{confidence}}",
  "plugin.epidbot.edit.confidenceFetched": " (valores obtidos de uma fonte de dados)",
  "plugin.epidbot.edit.confidenceEstimated":
    " (⚠ valores ESTIMADOS pelo modelo — verifique antes de usar)",
  "plugin.epidbot.edit.noMatchingLayer": "Nenhuma camada correspondente encontrada.",
  "plugin.epidbot.edit.cannotJoin": "Não é possível cruzar por esta chave: {{reason}}",
  "plugin.epidbot.edit.stats":
    "{{matched}} de {{total}} valores correspondem ({{unmatched}} sem correspondência, {{invalid}} inválidos).",
  "plugin.epidbot.edit.unmatchedKeys": "Chaves sem correspondência: {{keys}}",
  "plugin.epidbot.edit.moreRows": "… e mais {{count}}",
  "plugin.epidbot.edit.apply": "Aplicar",
  "plugin.epidbot.edit.cancel": "Cancelar",
  "plugin.epidbot.edit.applied": "{{op}} '{{field}}' em '{{layer}}': {{matched}} elementos{{note}}",
  "plugin.epidbot.edit.unmatchedNote": " ({{count}} chaves sem correspondência)",
  "plugin.epidbot.edit.notApplied": "Edição não aplicada: {{reason}}",
  "plugin.epidbot.edit.revert": "Desfazer",
  "plugin.epidbot.edit.reverted": "Edição desfeita.",
  "plugin.epidbot.edit.revertFailed": "Não foi possível desfazer: {{reason}}",

  "plugin.epidbot.context.attach": "Anexar contexto do mapa",
  "plugin.epidbot.context.help":
    "Envia as camadas visíveis, a extensão atual, o CRS e a seleção junto com a sua pergunta.",
  "plugin.epidbot.context.preview": "Pré-visualizar contexto",
  "plugin.epidbot.context.bytes": "{{bytes}} bytes",
  "plugin.epidbot.context.empty": "Nada a relatar — sem camadas, extensão ou seleção disponíveis.",
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
  "plugin.epidbot.welcome.noKey":
    "Adicione sua chave de API do EpidBot nas Configurações para começar.",
  "plugin.epidbot.welcome.getApiKey": "Obter uma chave de API (aplicativo web do EpidBot)",

  "plugin.epidbot.session.label": "Sessão",
  "plugin.epidbot.session.none": "Nova sessão",
  "plugin.epidbot.session.new": "Nova sessão",
  "plugin.epidbot.session.createdName": "Sessão {{stamp}}",
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

  "plugin.epidbot.error.auth":
    "Chave de API inválida ou revogada. Verifique a chave nas Configurações.",
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
  "plugin.epidbot.error.noKey":
    "Nenhuma chave de API configurada. Abra as Configurações para adicionar uma.",

  "plugin.epidbot.plot.download": "Salvar gráfico",
  "plugin.epidbot.plot.loadFailed": "Não foi possível carregar o gráfico.",
  "plugin.epidbot.code.copy": "Copiar",
  "plugin.epidbot.code.copied": "Copiado",

  "plugin.epidbot.results.title": "Adicionar ao mapa",
  "plugin.epidbot.results.features": "{{count}} elementos",
  "plugin.epidbot.results.addToMap": "Adicionar ao mapa",
  "plugin.epidbot.results.added": "Adicionado ✓",
  "plugin.epidbot.results.download": "Baixar .geojson",
  "plugin.epidbot.results.downloadFile": "Baixar",
  "plugin.epidbot.results.addTile": "Adicionar como camada de tiles",
  "plugin.epidbot.results.addFailed": "Não foi possível adicionar a camada: {{reason}}",
  "plugin.epidbot.results.styleFailed":
    "A camada foi adicionada, mas o estilo não pôde ser aplicado.",
  "plugin.epidbot.results.loading": "Carregando '{{name}}' para o mapa…",
  "plugin.epidbot.results.stillLoading": "Ainda carregando o conjunto de dados anterior…",
  "plugin.epidbot.results.addedNotice": "Camada '{{name}}' adicionada ao mapa.",
  "plugin.epidbot.results.unreadable":
    "Os dados não puderam ser lidos como GeoJSON e o CSV não tem colunas de coordenadas utilizáveis.",
  "plugin.epidbot.results.loadFailed": "Não foi possível carregar os dados geográficos: {{reason}}",

  "plugin.epidbot.settings.inlineBudget": "Orçamento inline de anexos (KiB)",
  "plugin.epidbot.settings.inlineBudgetHelp":
    "Anexos de camada acima deste tamanho são reduzidos ou enviados como artefatos.",
  "plugin.epidbot.settings.artifactUploads":
    "Permitir envio de camadas como artefatos no servidor (requer suporte do servidor)",
};
